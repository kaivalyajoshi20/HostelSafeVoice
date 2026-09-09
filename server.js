import express from 'express';
import cors from 'cors';
import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;
const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const frontendOrigin = process.env.FRONTEND_ORIGIN;
if (frontendOrigin) app.use(cors({ origin: frontendOrigin, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(express.static('public', { extensions: ['html'] }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: isProduction ? { rejectUnauthorized: false } : false });
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET;
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const ADMIN_COOKIE = 'safevoice_admin';

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS complaints (
    id BIGSERIAL PRIMARY KEY,
    complaint_code TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    urgency TEXT NOT NULL,
    location TEXT,
    affects_others TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

function code() {
  return `HS3-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function sign(value) {
  return crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(value).digest('base64url');
}

function createAdminToken(username) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${username}|${expiresAt}`;
  return `${payload}|${sign(payload)}`;
}

function verifyAdminToken(token) {
  if (!token || !ADMIN_SESSION_SECRET) return false;
  const parts = token.split('|');
  if (parts.length !== 3) return false;
  const [username, expiresAtText, signature] = parts;
  const expiresAt = Number(expiresAtText);
  if (!username || !Number.isInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(signature, sign(`${username}|${expiresAt}`)) && safeEqual(username, ADMIN_USERNAME);
}

function parseCookies(header = '') {
  const result = {};
  for (const item of header.split(';')) {
    const [key, ...value] = item.trim().split('=');
    if (key && value.length) result[key] = decodeURIComponent(value.join('='));
  }
  return result;
}

function requireAdmin(req, res, next) {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !ADMIN_SESSION_SECRET) {
    return res.status(503).json({ error: 'Admin login is not configured on the server' });
  }
  const cookies = parseCookies(req.headers.cookie);
  if (!verifyAdminToken(cookies[ADMIN_COOKIE])) return res.status(401).json({ error: 'Admin authentication required' });
  next();
}

app.get('/health', (_, res) => res.json({ ok: true, service: 'Hostel SafeVoice' }));

// Separate admin login: no Google account or student email is required.
app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !ADMIN_SESSION_SECRET) {
    return res.status(503).json({ error: 'Admin login is not configured on the server' });
  }
  const { username, password } = req.body || {};
  if (!safeEqual(username, ADMIN_USERNAME) || !safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Invalid admin credentials' });
  }
  const token = createAdminToken(ADMIN_USERNAME);
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; SameSite=Lax${isProduction ? '; Secure' : ''}; Path=/`);
  res.json({ ok: true, message: 'Admin login successful' });
});

app.post('/api/admin/logout', (_, res) => {
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; Max-Age=0; HttpOnly; SameSite=Lax${isProduction ? '; Secure' : ''}; Path=/`);
  res.json({ ok: true });
});

app.get('/api/admin/session', requireAdmin, (_, res) => res.json({ authenticated: true }));

app.post('/api/complaints', async (req, res) => {
  const { category, description, urgency, location, affects_others } = req.body || {};
  if (!category || !description || !urgency) return res.status(400).json({ error: 'category, description and urgency are required' });
  let complaintCode;
  for (;;) {
    complaintCode = code();
    try {
      await pool.query('INSERT INTO complaints (complaint_code, category, description, urgency, location, affects_others) VALUES ($1,$2,$3,$4,$5,$6)', [complaintCode, category, description, urgency, location || null, affects_others || null]);
      break;
    } catch (e) {
      if (e.code !== '23505') throw e;
    }
  }
  res.status(201).json({ complaintId: complaintCode, status: 'PENDING' });
});

app.get('/api/complaints/:code', async (req, res) => {
  const r = await pool.query('SELECT complaint_code, category, description, urgency, location, affects_others, status, created_at, updated_at FROM complaints WHERE complaint_code=$1', [req.params.code.toUpperCase()]);
  if (!r.rowCount) return res.status(404).json({ error: 'Complaint not found' });
  res.json(r.rows[0]);
});

app.get('/api/admin/complaints', requireAdmin, async (_, res) => {
  const r = await pool.query('SELECT complaint_code, category, description, urgency, location, affects_others, status, created_at, updated_at FROM complaints ORDER BY created_at DESC');
  res.json(r.rows);
});

app.patch('/api/admin/complaints/:code', requireAdmin, async (req, res) => {
  const allowed = ['PENDING', 'UNDER_REVIEW', 'IN_PROGRESS', 'RESOLVED'];
  const status = String(req.body?.status || '').toUpperCase();
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const r = await pool.query('UPDATE complaints SET status=$1, updated_at=NOW() WHERE complaint_code=$2 RETURNING complaint_code, status, updated_at', [status, req.params.code.toUpperCase()]);
  if (!r.rowCount) return res.status(404).json({ error: 'Complaint not found' });
  res.json(r.rows[0]);
});

app.use('/api', (_, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

const port = process.env.PORT || 10000;
init().then(() => app.listen(port, () => console.log(`SafeVoice API listening on ${port}`))).catch(err => { console.error(err); process.exit(1); });
