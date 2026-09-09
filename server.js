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
app.use('/api', (_, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: isProduction ? { rejectUnauthorized: false } : false });
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'Hostel SafeVoice <onboarding@resend.dev>';
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
  await pool.query(`CREATE TABLE IF NOT EXISTS silent_alerts (
    id BIGSERIAL PRIMARY KEY,
    floor INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
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

async function getNotificationEmail() {
  const r = await pool.query("SELECT value FROM app_settings WHERE key='notification_email'");
  return r.rowCount ? r.rows[0].value : null;
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendComplaintAlert(complaint) {
  const to = await getNotificationEmail();
  if (!to || !RESEND_API_KEY) return { sent: false, reason: 'email_not_configured' };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [to],
      subject: `New Hostel SafeVoice complaint — ${complaint.complaintCode}`,
      text: [
        'A new anonymous Hostel SafeVoice complaint has been registered.',
        '',
        `Complaint ID: ${complaint.complaintCode}`,
        `Category: ${complaint.category}`,
        `Urgency: ${complaint.urgency}`,
        `Location: ${complaint.location || 'Not specified'}`,
        `Affects other students: ${complaint.affectsOthers || 'Not specified'}`,
        '',
        'Description:',
        complaint.description,
        '',
        'No student name, phone number, roll number, or other identity information is included by SafeVoice.'
      ].join('\n')
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Email provider error ${response.status}: ${body.slice(0, 300)}`);
  }
  return { sent: true };
}

app.get('/health', (_, res) => res.json({ ok: true, service: 'Hostel SafeVoice' }));

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

app.get('/api/admin/settings', requireAdmin, async (_, res) => {
  res.json({ notificationEmail: await getNotificationEmail(), emailAlertsConfigured: Boolean(RESEND_API_KEY) });
});

app.patch('/api/admin/settings', requireAdmin, async (req, res) => {
  const email = String(req.body?.notificationEmail || '').trim().toLowerCase();
  if (!validEmail(email)) return res.status(400).json({ error: 'Please enter a valid admin email address' });
  await pool.query(`INSERT INTO app_settings (key, value, updated_at) VALUES ('notification_email',$1,NOW()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [email]);
  res.json({ ok: true, notificationEmail: email, emailAlertsConfigured: Boolean(RESEND_API_KEY) });
});

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

  const complaint = { complaintCode, category, description, urgency, location, affectsOthers: affects_others };
  // Email failure must not make the student's complaint fail after it is saved.
  sendComplaintAlert(complaint).catch(err => console.error('Complaint alert email failed:', err.message));

  res.status(201).json({ complaintId: complaintCode, status: 'PENDING' });
});

app.get('/api/complaints/:code', async (req, res) => {
  const r = await pool.query('SELECT complaint_code, category, description, urgency, location, affects_others, status, created_at, updated_at FROM complaints WHERE complaint_code=$1', [req.params.code.toUpperCase()]);
  if (!r.rowCount) return res.status(404).json({ error: 'Complaint not found' });
  res.json(r.rows[0]);
});

app.post('/api/silent-alert', async (req, res) => {
  const floor = Number(req.body?.floor ?? 3);
  if (floor !== 3) return res.status(400).json({ error: 'This prototype is configured for floor 3 only' });
  await pool.query('INSERT INTO silent_alerts (floor) VALUES ($1)', [floor]);
  res.status(201).json({ ok: true, message: 'Silent alert received' });
});

app.get('/api/admin/complaints', requireAdmin, async (_, res) => {
  const r = await pool.query('SELECT complaint_code, category, description, urgency, location, affects_others, status, created_at, updated_at FROM complaints ORDER BY created_at DESC');
  res.json(r.rows);
});

app.get('/api/admin/silent-alerts', requireAdmin, async (_, res) => {
  const r = await pool.query('SELECT id, floor, created_at FROM silent_alerts ORDER BY created_at DESC LIMIT 50');
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

const port = process.env.PORT || 10000;
init().then(() => app.listen(port, () => console.log(`SafeVoice API listening on ${port}`))).catch(err => { console.error(err); process.exit(1); });
