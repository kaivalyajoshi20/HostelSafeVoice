import express from 'express';
import cors from 'cors';
import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;
const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const frontendOrigin = process.env.FRONTEND_ORIGIN;
if (frontendOrigin) app.use(cors({ origin: frontendOrigin, credentials: true }));
else app.use(cors({ credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(express.static('public', { extensions: ['html'] }));
app.use('/api', (_, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: isProduction ? { rejectUnauthorized: false } : false });
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET;
const HIGHER_USERNAME = process.env.HIGHER_USERNAME || 'authority';
const HIGHER_PASSWORD = process.env.HIGHER_PASSWORD;
const HIGHER_SESSION_SECRET = process.env.HIGHER_SESSION_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'Hostel SafeVoice <onboarding@resend.dev>';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const ADMIN_COOKIE = 'safevoice_admin';
const HIGHER_COOKIE = 'safevoice_higher';

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS complaints (
    id BIGSERIAL PRIMARY KEY,
    complaint_code TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    urgency TEXT NOT NULL,
    location TEXT,
    affects_others TEXT,
    complaint_destination TEXT NOT NULL DEFAULT 'ADMIN',
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS complaint_destination TEXT NOT NULL DEFAULT 'ADMIN'`);
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
  await pool.query(`CREATE TABLE IF NOT EXISTS authority_instructions (
    id BIGSERIAL PRIMARY KEY,
    complaint_code TEXT NOT NULL REFERENCES complaints(complaint_code) ON DELETE CASCADE,
    instruction TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ
  )`);
}

function code() { return `HS3-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? '')); const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function sign(value, secret) { return crypto.createHmac('sha256', secret).update(value).digest('base64url'); }
function createToken(username, secret) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${username}|${expiresAt}`;
  return `${payload}|${sign(payload, secret)}`;
}
function verifyToken(token, expectedUsername, secret) {
  if (!token || !secret || !expectedUsername) return false;
  const parts = token.split('|'); if (parts.length !== 3) return false;
  const [username, expiresAtText, signature] = parts;
  const expiresAt = Number(expiresAtText);
  if (!username || !Number.isInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(signature, sign(`${username}|${expiresAt}`, secret)) && safeEqual(username, expectedUsername);
}
function parseCookies(header = '') {
  const result = {};
  for (const item of header.split(';')) { const [key, ...value] = item.trim().split('='); if (key && value.length) result[key] = decodeURIComponent(value.join('=')); }
  return result;
}
function requireRole(role) {
  return (req, res, next) => {
    const isAdmin = role === 'admin';
    const username = isAdmin ? ADMIN_USERNAME : HIGHER_USERNAME;
    const password = isAdmin ? ADMIN_PASSWORD : HIGHER_PASSWORD;
    const secret = isAdmin ? ADMIN_SESSION_SECRET : HIGHER_SESSION_SECRET;
    const cookie = isAdmin ? ADMIN_COOKIE : HIGHER_COOKIE;
    if (!username || !password || !secret) return res.status(503).json({ error: `${isAdmin ? 'Admin' : 'Higher authority'} login is not configured on the server` });
    const cookies = parseCookies(req.headers.cookie);
    if (!verifyToken(cookies[cookie], username, secret)) return res.status(401).json({ error: `${isAdmin ? 'Admin' : 'Higher authority'} authentication required` });
    req.role = role; next();
  };
}
const requireAdmin = requireRole('admin');
const requireHigher = requireRole('higher');

async function getSetting(key) { const r = await pool.query('SELECT value FROM app_settings WHERE key=$1', [key]); return r.rowCount ? r.rows[0].value : null; }
async function setSetting(key, value) { await pool.query(`INSERT INTO app_settings(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`, [key, value]); }
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

async function sendEmail(to, subject, text) {
  if (!to || !RESEND_API_KEY) return { sent: false, reason: 'email_not_configured' };
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, text }) });
  if (!response.ok) { const body = await response.text(); throw new Error(`Email provider error ${response.status}: ${body.slice(0, 300)}`); }
  return { sent: true };
}
async function sendComplaintAlert(complaint) {
  const to = complaint.destination === 'HIGHER_AUTHORITY' ? await getSetting('higher_notification_email') : await getSetting('notification_email');
  const audience = complaint.destination === 'HIGHER_AUTHORITY' ? 'higher authority' : 'admin';
  return sendEmail(to, `New Hostel SafeVoice complaint — ${complaint.complaintCode}`, [
    `A new anonymous Hostel SafeVoice complaint has been submitted to the ${audience}.`, '',
    `Complaint ID: ${complaint.complaintCode}`, `Category: ${complaint.category}`, `Urgency: ${complaint.urgency}`,
    `Location: ${complaint.location || 'Not specified'}`, `Affects other students: ${complaint.affectsOthers || 'Not specified'}`, '',
    'Description:', complaint.description, '', 'No student name, phone number, roll number, or other identity information is included by SafeVoice.'
  ].join('\n'));
}

app.get('/health', (_, res) => res.json({ ok: true, service: 'Hostel SafeVoice' }));
function loginHandler(role) {
  return (req, res) => {
    const isAdmin = role === 'admin';
    const username = isAdmin ? ADMIN_USERNAME : HIGHER_USERNAME;
    const password = isAdmin ? ADMIN_PASSWORD : HIGHER_PASSWORD;
    const secret = isAdmin ? ADMIN_SESSION_SECRET : HIGHER_SESSION_SECRET;
    const cookie = isAdmin ? ADMIN_COOKIE : HIGHER_COOKIE;
    if (!username || !password || !secret) return res.status(503).json({ error: `${isAdmin ? 'Admin' : 'Higher authority'} login is not configured on the server` });
    const { username: inputUser, password: inputPass } = req.body || {};
    if (!safeEqual(inputUser, username) || !safeEqual(inputPass, password)) return res.status(401).json({ error: 'Invalid credentials' });
    const token = createToken(username, secret);
    res.setHeader('Set-Cookie', `${cookie}=${encodeURIComponent(token)}; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; SameSite=Lax${isProduction ? '; Secure' : ''}; Path=/`);
    res.json({ ok: true });
  };
}
app.post('/api/admin/login', loginHandler('admin'));
app.post('/api/higher/login', loginHandler('higher'));
app.post('/api/admin/logout', (_, res) => { res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; Max-Age=0; HttpOnly; SameSite=Lax${isProduction ? '; Secure' : ''}; Path=/`); res.json({ ok: true }); });
app.post('/api/higher/logout', (_, res) => { res.setHeader('Set-Cookie', `${HIGHER_COOKIE}=; Max-Age=0; HttpOnly; SameSite=Lax${isProduction ? '; Secure' : ''}; Path=/`); res.json({ ok: true }); });
app.get('/api/admin/session', requireAdmin, (_, res) => res.json({ authenticated: true }));
app.get('/api/higher/session', requireHigher, (_, res) => res.json({ authenticated: true }));

app.get('/api/admin/settings', requireAdmin, async (_, res) => res.json({ notificationEmail: await getSetting('notification_email'), emailAlertsConfigured: Boolean(RESEND_API_KEY) }));
app.patch('/api/admin/settings', requireAdmin, async (req, res) => {
  const email = String(req.body?.notificationEmail || '').trim().toLowerCase();
  if (!validEmail(email)) return res.status(400).json({ error: 'Please enter a valid admin email address' });
  await setSetting('notification_email', email);
  res.json({ ok: true, notificationEmail: email, emailAlertsConfigured: Boolean(RESEND_API_KEY) });
});
app.get('/api/higher/settings', requireHigher, async (_, res) => res.json({ notificationEmail: await getSetting('higher_notification_email'), emailAlertsConfigured: Boolean(RESEND_API_KEY) }));
app.patch('/api/higher/settings', requireHigher, async (req, res) => {
  const email = String(req.body?.notificationEmail || '').trim().toLowerCase();
  if (!validEmail(email)) return res.status(400).json({ error: 'Please enter a valid higher-authority email address' });
  await setSetting('higher_notification_email', email);
  res.json({ ok: true, notificationEmail: email, emailAlertsConfigured: Boolean(RESEND_API_KEY) });
});

app.post('/api/complaints', async (req, res) => {
  const { category, description, urgency, location, affects_others } = req.body || {};
  const destination = String(req.body?.complaint_destination || 'ADMIN').toUpperCase();
  if (!category || !description || !urgency) return res.status(400).json({ error: 'category, description and urgency are required' });
  if (!['ADMIN', 'HIGHER_AUTHORITY'].includes(destination)) return res.status(400).json({ error: 'Invalid complaint destination' });
  let complaintCode;
  for (;;) {
    complaintCode = code();
    try { await pool.query('INSERT INTO complaints (complaint_code,category,description,urgency,location,affects_others,complaint_destination) VALUES ($1,$2,$3,$4,$5,$6,$7)', [complaintCode, category, description, urgency, location || null, affects_others || null, destination]); break; }
    catch (e) { if (e.code !== '23505') throw e; }
  }
  const complaint = { complaintCode, category, description, urgency, location, affectsOthers: affects_others, destination };
  sendComplaintAlert(complaint).catch(err => console.error('Complaint alert email failed:', err.message));
  res.status(201).json({ complaintId: complaintCode, status: 'PENDING' });
});
app.get('/api/complaints/:code', async (req, res) => {
  const r = await pool.query('SELECT complaint_code,status,created_at,updated_at FROM complaints WHERE complaint_code=$1', [req.params.code.toUpperCase()]);
  if (!r.rowCount) return res.status(404).json({ error: 'Complaint not found' });
  res.json(r.rows[0]);
});

const complaintSelect = `SELECT c.complaint_code,c.category,c.description,c.urgency,c.location,c.affects_others,c.complaint_destination,c.status,c.created_at,c.updated_at,
COALESCE(json_agg(json_build_object('id',i.id,'instruction',i.instruction,'created_at',i.created_at,'acknowledged_at',i.acknowledged_at) ORDER BY i.created_at DESC) FILTER (WHERE i.id IS NOT NULL),'[]') AS instructions
FROM complaints c LEFT JOIN authority_instructions i ON i.complaint_code=c.complaint_code`;
app.get('/api/admin/complaints', requireAdmin, async (_, res) => {
  const r = await pool.query(`${complaintSelect} WHERE c.complaint_destination='ADMIN' OR c.complaint_destination='ESCALATED' GROUP BY c.id ORDER BY c.created_at DESC`); res.json(r.rows);
});
app.get('/api/higher/complaints', requireHigher, async (_, res) => {
  const r = await pool.query(`${complaintSelect} WHERE c.complaint_destination='HIGHER_AUTHORITY' OR c.complaint_destination='ESCALATED' GROUP BY c.id ORDER BY c.created_at DESC`); res.json(r.rows);
});

app.patch('/api/admin/complaints/:code', requireAdmin, async (req, res) => {
  const allowed=['PENDING','UNDER_REVIEW','IN_PROGRESS','RESOLVED']; const status=String(req.body?.status||'').toUpperCase();
  if(!allowed.includes(status)) return res.status(400).json({error:'Invalid status'});
  const r=await pool.query(`UPDATE complaints SET status=$1,updated_at=NOW() WHERE complaint_code=$2 AND (complaint_destination='ADMIN' OR complaint_destination='ESCALATED') RETURNING complaint_code,status,updated_at`,[status,req.params.code.toUpperCase()]);
  if(!r.rowCount)return res.status(404).json({error:'Complaint not found'}); res.json(r.rows[0]);
});
app.post('/api/admin/complaints/:code/escalate', requireAdmin, async (req,res)=>{
  const reason=String(req.body?.reason||'').trim().slice(0,1000);
  const r=await pool.query(`UPDATE complaints SET complaint_destination='ESCALATED',updated_at=NOW() WHERE complaint_code=$1 RETURNING complaint_code`,[req.params.code.toUpperCase()]);
  if(!r.rowCount)return res.status(404).json({error:'Complaint not found'});
  const c=(await pool.query('SELECT complaint_code,category,description,urgency,location FROM complaints WHERE complaint_code=$1',[req.params.code.toUpperCase()])).rows[0];
  sendEmail(await getSetting('higher_notification_email'),`SafeVoice complaint escalated — ${c.complaint_code}`,['An anonymous Hostel SafeVoice complaint has been escalated for higher-authority attention.','',`Complaint ID: ${c.complaint_code}`,`Category: ${c.category}`,`Urgency: ${c.urgency}`,`Location: ${c.location||'Not specified'}`,'','Reason for escalation:',reason||'Admin requested higher-authority review.','','Description:',c.description].join('\n')).catch(err=>console.error('Escalation email failed:',err.message));
  res.json({ok:true,complaintId:c.complaint_code});
});
app.get('/api/admin/instructions', requireAdmin, async (_,res)=>{const r=await pool.query(`SELECT id,complaint_code,instruction,created_at,acknowledged_at FROM authority_instructions ORDER BY created_at DESC LIMIT 100`);res.json(r.rows);});
app.patch('/api/admin/instructions/:id/acknowledge',requireAdmin,async(req,res)=>{const r=await pool.query(`UPDATE authority_instructions SET acknowledged_at=NOW() WHERE id=$1 RETURNING id,acknowledged_at`,[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Instruction not found'});res.json(r.rows[0]);});
app.patch('/api/higher/complaints/:code/status',requireHigher,async(req,res)=>{const allowed=['PENDING','UNDER_REVIEW','IN_PROGRESS','RESOLVED'];const status=String(req.body?.status||'').toUpperCase();if(!allowed.includes(status))return res.status(400).json({error:'Invalid status'});const r=await pool.query(`UPDATE complaints SET status=$1,updated_at=NOW() WHERE complaint_code=$2 AND (complaint_destination='HIGHER_AUTHORITY' OR complaint_destination='ESCALATED') RETURNING complaint_code,status,updated_at`,[status,req.params.code.toUpperCase()]);if(!r.rowCount)return res.status(404).json({error:'Complaint not found'});res.json(r.rows[0]);});
app.post('/api/higher/complaints/:code/instructions',requireHigher,async(req,res)=>{const instruction=String(req.body?.instruction||'').trim().slice(0,2000);if(instruction.length<3)return res.status(400).json({error:'Please enter an instruction'});const r=await pool.query(`INSERT INTO authority_instructions(complaint_code,instruction) SELECT complaint_code,$2 FROM complaints WHERE complaint_code=$1 RETURNING id,complaint_code,instruction,created_at`,[req.params.code.toUpperCase(),instruction]);if(!r.rowCount)return res.status(404).json({error:'Complaint not found'});await pool.query(`UPDATE complaints SET status=CASE WHEN status='PENDING' THEN 'UNDER_REVIEW' ELSE status END,updated_at=NOW() WHERE complaint_code=$1`,[req.params.code.toUpperCase()]);sendEmail(await getSetting('notification_email'),`Higher-authority instruction — ${r.rows[0].complaint_code}`,[`A higher authority has issued an instruction for Hostel SafeVoice complaint ${r.rows[0].complaint_code}.`,'','Instruction:',instruction,'','Please review and act on this complaint.'].join('\n')).catch(err=>console.error('Instruction email failed:',err.message));res.status(201).json(r.rows[0]);});

app.post('/api/silent-alert', async (req,res)=>{const floor=Number(req.body?.floor??3);if(floor!==3)return res.status(400).json({error:'This prototype is configured for floor 3 only'});await pool.query('INSERT INTO silent_alerts(floor) VALUES($1)',[floor]);res.status(201).json({ok:true,message:'Silent alert received'});});
app.get('/api/admin/silent-alerts',requireAdmin,async(_,res)=>{const r=await pool.query('SELECT id,floor,created_at FROM silent_alerts ORDER BY created_at DESC LIMIT 50');res.json(r.rows);});

const port=process.env.PORT||10000;
init().then(()=>app.listen(port,()=>console.log(`SafeVoice API listening on ${port}`))).catch(err=>{console.error(err);process.exit(1)});
