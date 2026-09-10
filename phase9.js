import fs from 'fs/promises';
import crypto from 'crypto';

export function registerPhase9({ app, pool }) {
  const privateUsername = process.env.PRIVATE_USERNAME || 'private';
  const privatePassword = process.env.PRIVATE_PASSWORD;
  const privateCookie = 'safevoice_private';
  const ttl = 8 * 60 * 60;
  const attempts = new Map();

  const ensure = pool.query(`
    CREATE TABLE IF NOT EXISTS complaint_private_identity (
      id BIGSERIAL PRIMARY KEY,
      complaint_code TEXT UNIQUE NOT NULL REFERENCES complaints(complaint_code) ON DELETE CASCADE,
      student_name TEXT NOT NULL,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS private_authority_access_log (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      complaint_code TEXT,
      reason TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(err => console.error('Phase 9 database setup failed:', err.message));

  function equal(a, b) {
    const x = Buffer.from(String(a ?? '')); const y = Buffer.from(String(b ?? ''));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }
  function secret() {
    return crypto.createHash('sha256').update(String(privatePassword || '') + '|HostelSafeVoice|private-v1').digest('hex');
  }
  function sign(value) { return crypto.createHmac('sha256', secret()).update(value).digest('base64url'); }
  function token() {
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const payload = `${privateUsername}|${exp}`;
    return `${payload}|${sign(payload)}`;
  }
  function authenticated(req) {
    if (!privatePassword) return false;
    const cookies = {};
    for (const item of String(req.headers.cookie || '').split(';')) {
      const [k, ...v] = item.trim().split('=');
      if (k && v.length) cookies[k] = decodeURIComponent(v.join('='));
    }
    const parts = String(cookies[privateCookie] || '').split('|');
    if (parts.length !== 3) return false;
    const [u, expText, sig] = parts; const exp = Number(expText);
    return equal(u, privateUsername) && Number.isInteger(exp) && exp >= Math.floor(Date.now() / 1000) && equal(sig, sign(`${u}|${exp}`));
  }
  function clientIp(req) {
    return String(req.ip || req.socket?.remoteAddress || '').slice(0, 100) || null;
  }
  function limited(ip) {
    const now = Date.now(); const old = attempts.get(ip) || [];
    const fresh = old.filter(t => now - t < 10 * 60 * 1000);
    if (fresh.length >= 5) { attempts.set(ip, fresh); return true; }
    fresh.push(now); attempts.set(ip, fresh); return false;
  }
  function privateOnly(req, res, next) {
    if (!privatePassword) return res.status(503).json({ error: 'Private Authority login is not configured on the server' });
    if (!authenticated(req)) return res.status(401).json({ error: 'Private Authority authentication required' });
    req.role = 'private'; next();
  }
  async function logAccess(username, action, complaintCode, reason, ip) {
    await ensure;
    await pool.query('INSERT INTO private_authority_access_log(username,action,complaint_code,reason,ip_address) VALUES($1,$2,$3,$4,$5)', [username, action, complaintCode || null, reason || null, ip || null]);
  }

  app.post('/api/private/login', async (req, res) => {
    if (!privatePassword) return res.status(503).json({ error: 'Private Authority login is not configured on the server' });
    const ip = clientIp(req); if (limited(ip)) return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    const user = String(req.body?.username || '').trim();
    const pass = String(req.body?.password || '');
    const reason = String(req.body?.reason || '').trim().slice(0, 1000);
    if (!reason) return res.status(400).json({ error: 'A private login reason is required' });
    if (!equal(user, privateUsername) || !equal(pass, privatePassword)) {
      await logAccess(user || 'unknown', 'LOGIN_FAILED', null, reason, ip);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.setHeader('Set-Cookie', `${privateCookie}=${encodeURIComponent(token())}; Max-Age=${ttl}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}; Path=/`);
    await logAccess(privateUsername, 'LOGIN', null, reason, ip);
    res.json({ ok: true });
  });

  app.post('/api/private/logout', privateOnly, async (req, res) => {
    res.setHeader('Set-Cookie', `${privateCookie}=; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}; Path=/`);
    res.json({ ok: true });
  });
  app.get('/api/private/session', privateOnly, (_, res) => res.json({ authenticated: true, role: 'private' }));

  app.get('/api/private/complaints', privateOnly, async (_, res) => {
    await ensure;
    const r = await pool.query(`SELECT c.complaint_code,c.category,c.description,c.urgency,c.location,c.affects_others,c.complaint_destination,c.status,c.created_at,c.updated_at,
      COALESCE(json_agg(json_build_object('id',i.id,'instruction',i.instruction,'created_at',i.created_at,'acknowledged_at',i.acknowledged_at) ORDER BY i.created_at DESC) FILTER (WHERE i.id IS NOT NULL),'[]') AS instructions
      FROM complaints c LEFT JOIN authority_instructions i ON i.complaint_code=c.complaint_code
      WHERE c.complaint_destination='HIGHER_AUTHORITY' OR c.complaint_destination='ESCALATED'
      GROUP BY c.id ORDER BY c.created_at DESC`);
    res.json(r.rows);
  });

  app.get('/api/private/complaints/:code/details', privateOnly, async (req, res) => {
    await ensure;
    const code = String(req.params.code || '').toUpperCase();
    const c = await pool.query(`SELECT complaint_code,category,description,urgency,location,affects_others,complaint_destination,status,created_at,updated_at FROM complaints WHERE complaint_code=$1 AND (complaint_destination='HIGHER_AUTHORITY' OR complaint_destination='ESCALATED')`, [code]);
    if (!c.rowCount) return res.status(404).json({ error: 'Complaint not found' });
    const identity = await pool.query('SELECT student_name,ip_address,created_at FROM complaint_private_identity WHERE complaint_code=$1', [code]);
    if (!identity.rowCount) return res.status(404).json({ error: 'Private identity record not found' });
    const ip = identity.rows[0].ip_address;
    const count = await pool.query('SELECT COUNT(*)::int AS complaint_count FROM complaint_private_identity WHERE ip_address=$1', [ip]);
    const reason = String(req.query?.reason || 'Reviewing complaint details').slice(0, 500);
    await logAccess(privateUsername, 'VIEW_IDENTITY', code, reason, clientIp(req));
    res.json({ complaint: c.rows[0], private: { student_name: identity.rows[0].student_name, ip_address: ip, complaints_from_ip: count.rows[0].complaint_count, captured_at: identity.rows[0].created_at } });
  });

  app.get('/private', async (_, res) => {
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hostel SafeVoice — Private Authority</title><style>body{font-family:system-ui;margin:0;background:#f4f7fb;color:#0b1220}.wrap{max-width:950px;margin:auto;padding:16px}.card{background:#fff;border:1px solid #dce3ec;border-radius:18px;padding:18px;margin:14px 0}.row{display:flex;gap:8px;flex-wrap:wrap}input,button{font:inherit;padding:11px;border-radius:10px;border:1px solid #cbd5e1}input{min-width:220px;flex:1}button{background:#0b1220;color:#fff;cursor:pointer}.hidden{display:none}.bad{color:#991b1b}.good{color:#166534}.private{background:#fff7ed;border:1px solid #fed7aa}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:650px){.grid{grid-template-columns:1fr}.wrap{padding:10px}}</style></head><body><div class="wrap"><section id="login" class="card"><h1>🔐 Private Authority</h1><p>This area is restricted. The login reason is private to this authority.</p><div class="row"><input id="u" placeholder="Username" autocomplete="username"><input id="p" type="password" placeholder="Password" autocomplete="current-password"></div><p><input id="r" placeholder="Private reason for login" maxlength="1000"></p><button onclick="login()">Login</button><p id="msg"></p></section><main id="dash" class="hidden"><section class="card"><div class="row" style="justify-content:space-between"><div><h1>Private Authority Dashboard</h1><p>Higher-authority complaint view with protected identity review.</p></div><button onclick="logout()">Logout</button></div></section><section class="card"><h2>Complaints</h2><div id="list">Loading…</div></section><section id="details"></section></main></div><script>const $=x=>document.getElementById(x);async function api(u,o){const r=await fetch(u,{credentials:'same-origin',cache:'no-store',...o});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Request failed');return d}async function login(){try{await api('/api/private/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('u').value,password:$('p').value,reason:$('r').value})});show()}catch(e){$('msg').textContent=e.message;$('msg').className='bad'}}async function show(){try{await api('/api/private/session');$('login').classList.add('hidden');$('dash').classList.remove('hidden');load()}catch(e){}}async function load(){try{const cs=await api('/api/private/complaints');$('list').innerHTML=cs.length?cs.map(c=>'<div class="card"><b>'+c.complaint_code+'</b> · '+c.category+' · '+c.urgency+'<p>'+c.description+'</p><div class="row"><span>'+c.status+'</span><button onclick="details(\''+c.complaint_code+'\')">View Details</button></div></div>').join(''):'No complaints'}catch(e){$('list').innerHTML='<p class="bad">'+e.message+'</p>'}}async function details(c){try{const d=await api('/api/private/complaints/'+c+'/details');$('details').innerHTML='<div class="card private"><h2>🔒 Private Details — '+c+'</h2><p><b>Student name:</b> '+esc(d.private.student_name)+'</p><p><b>IP address:</b> '+esc(d.private.ip_address||'Not available')+'</p><p><b>Complaints from this IP:</b> '+d.private.complaints_from_ip+'</p><hr><div class="grid"><div><b>Category</b><br>'+esc(d.complaint.category)+'</div><div><b>Urgency</b><br>'+esc(d.complaint.urgency)+'</div><div><b>Status</b><br>'+esc(d.complaint.status)+'</div><div><b>Location</b><br>'+esc(d.complaint.location||'Not specified')+'</div></div><p><b>Description</b><br>'+esc(d.complaint.description)+'</p><p><input id="reviewReason" placeholder="Private reason for viewing this identity" maxlength="500"><button onclick="recordReview(\''+c+'\')">Record private review</button></p></div>'}catch(e){$('details').innerHTML='<div class="card bad">'+e.message+'</div>'}}async function recordReview(c){const reason=$('reviewReason').value.trim()||'Private review';await api('/api/private/complaints/'+c+'/details?reason='+encodeURIComponent(reason));alert('Private review recorded.');}function esc(s){return String(s??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]))}async function logout(){await api('/api/private/logout',{method:'POST'});location.reload()}show();</script></body></html>`);
  });

  // Put the Phase 9 handlers ahead of the existing generic complaint route and static root.
  const router = app.router;
  if (router?.stack) {
    const originalUse = app.use.bind(app);
    const rootMiddleware = async (req, res, next) => {
      if (req.method === 'GET' && (req.path === '/' || req.path === '/index.html')) {
        try {
          let html = await fs.readFile(new URL('./public/index.html', import.meta.url), 'utf8');
          const nameField = `<div class="field"><label for="student_name">तुमचे नाव <span class="hint">फक्त Private Authority पाहू शकते</span></label><input id="student_name" maxlength="120" required placeholder="तुमचे पूर्ण नाव"></div>`;
          html = html.replace('<div class="field"><label for="category">समस्येचा प्रकार</label>', nameField + '<div class="field"><label for="category">समस्येचा प्रकार</label>');
          html = html.replace('नाव, मोबाईल नंबर, रोल नंबर, रूम नंबर किंवा ओळख पटेल अशी माहिती लिहू नका.', 'तुमचे नाव द्या. हे नाव फक्त Private Authority कडे सुरक्षित तपासणीसाठी उपलब्ध असेल; Admin किंवा Higher Authority ला ते दिसणार नाही.');
          html = html.replace('फक्त समस्येबद्दल माहिती द्या.', 'समस्येबद्दल माहिती द्या आणि तुमचे नाव फक्त Private Authority साठी द्या.');
          html = html.replace("fetch('/api/complaints'", "fetch('/api/complaints'");
          html = html.replace('body:JSON.stringify({category:$(' + "'category'" + ').value,description:$(' + "'description'" + ').value,urgency:$(' + "'urgency'" + ').value,location:$(' + "'location'" + ').value,affects_others:$(' + "'affects_others'" + ').value,complaint_destination:document.querySelector(' + "'input[name=\\\"destination\\\"]:checked'" + ').value})', 'body:JSON.stringify({student_name:$(\'student_name\').value,category:$(\'category\').value,description:$(\'description\').value,urgency:$(\'urgency\').value,location:$(\'location\').value,affects_others:$(\'affects_others\').value,complaint_destination:document.querySelector(\'input[name="destination"]:checked\').value})');
          res.type('html').send(html);
        } catch { next(); }
      } else next();
    };
    originalUse(rootMiddleware);
    const layer = router.stack.pop();
    router.stack.unshift(layer);
  }

  const complaintLayerMiddleware = async (req, res, next) => {
    if (req.method !== 'POST' || req.path !== '/api/complaints') return next();
    try {
      await ensure;
      const { student_name, category, description, urgency, location, affects_others } = req.body || {};
      const destination = String(req.body?.complaint_destination || 'ADMIN').toUpperCase();
      const name = String(student_name || '').trim().slice(0, 120);
      if (!name || !category || !description || !urgency) return res.status(400).json({ error: 'student name, category, description and urgency are required' });
      if (!['ADMIN','HIGHER_AUTHORITY'].includes(destination)) return res.status(400).json({ error: 'Invalid complaint destination' });
      let complaintCode;
      for (;;) {
        complaintCode = `HS3-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        try {
          await pool.query('INSERT INTO complaints (complaint_code,category,description,urgency,location,affects_others,complaint_destination) VALUES ($1,$2,$3,$4,$5,$6,$7)', [complaintCode, category, description, urgency, location || null, affects_others || null, destination]);
          break;
        } catch (e) { if (e.code !== '23505') throw e; }
      }
      await pool.query('INSERT INTO complaint_private_identity(complaint_code,student_name,ip_address) VALUES($1,$2,$3)', [complaintCode, name, clientIp(req)]);
      const to = destination === 'HIGHER_AUTHORITY' ? (await pool.query("SELECT value FROM app_settings WHERE key='higher_notification_email'")).rows[0]?.value : (await pool.query("SELECT value FROM app_settings WHERE key='notification_email'")).rows[0]?.value;
      const apiKey = process.env.RESEND_API_KEY;
      if (to && apiKey) {
        const audience = destination === 'HIGHER_AUTHORITY' ? 'higher authority' : 'admin';
        await fetch('https://api.resend.com/emails', { method:'POST', headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'}, body:JSON.stringify({from:process.env.EMAIL_FROM||'Hostel SafeVoice <onboarding@resend.dev>',to:[to],subject:`New Hostel SafeVoice complaint — ${complaintCode}`,text:[`A new Hostel SafeVoice complaint has been submitted to the ${audience}.`,'',`Complaint ID: ${complaintCode}`,`Category: ${category}`,`Urgency: ${urgency}`,`Location: ${location || 'Not specified'}`,'','Description:',description].join('\n')}) }).catch(() => {});
      }
      res.status(201).json({ complaintId: complaintCode, status: 'PENDING' });
    } catch (e) { console.error('Phase 9 complaint submission failed:', e.message); res.status(500).json({ error: 'Unable to submit complaint' }); }
  };
  app.use(complaintLayerMiddleware);
  const layer = app.router?.stack?.pop();
  if (layer && app.router?.stack) app.router.stack.unshift(layer);
}
