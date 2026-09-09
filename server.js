import express from 'express';
import cors from 'cors';
import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;
const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

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

app.get('/health', (_, res) => res.json({ ok: true, service: 'Hostel SafeVoice' }));

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

app.get('/api/admin/complaints', async (_, res) => {
  const r = await pool.query('SELECT complaint_code, category, description, urgency, location, affects_others, status, created_at, updated_at FROM complaints ORDER BY created_at DESC');
  res.json(r.rows);
});

app.patch('/api/admin/complaints/:code', async (req, res) => {
  const allowed = ['PENDING', 'UNDER_REVIEW', 'IN_PROGRESS', 'RESOLVED'];
  const status = String(req.body?.status || '').toUpperCase();
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const r = await pool.query('UPDATE complaints SET status=$1, updated_at=NOW() WHERE complaint_code=$2 RETURNING complaint_code, status, updated_at', [status, req.params.code.toUpperCase()]);
  if (!r.rowCount) return res.status(404).json({ error: 'Complaint not found' });
  res.json(r.rows[0]);
});

const port = process.env.PORT || 10000;
init().then(() => app.listen(port, () => console.log(`SafeVoice API listening on ${port}`))).catch(err => { console.error(err); process.exit(1); });
