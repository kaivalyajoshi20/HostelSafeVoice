import crypto from 'crypto';

export function registerPhase11({ app, pool }) {
  const username = process.env.PRIVATE_USERNAME || 'private';
  const password = process.env.PRIVATE_PASSWORD;
  const cookieName = 'safevoice_private';
  const ttl = 8 * 60 * 60;

  const equal = (a, b) => {
    const x = Buffer.from(String(a ?? ''));
    const y = Buffer.from(String(b ?? ''));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };
  const secret = () => crypto.createHash('sha256').update(String(password || '') + '|HostelSafeVoice|private-v1').digest('hex');
  const sign = value => crypto.createHmac('sha256', secret()).update(value).digest('base64url');
  const makeToken = () => {
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const payload = `${username}|${exp}`;
    return `${payload}|${sign(payload)}`;
  };
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hostel SafeVoice — Private Authority</title><style>body{font-family:system-ui;margin:0;background:#f4f7fb;color:#0b1220}.wrap{max-width:950px;margin:auto;padding:16px}.card{background:#fff;border:1px solid #dce3ec;border-radius:18px;padding:18px;margin:14px 0}.row{display:flex;gap:8px;flex-wrap:wrap}input,button{font:inherit;padding:11px;border-radius:10px;border:1px solid #cbd5e1}input{min-width:220px;flex:1}button{background:#0b1220;color:#fff;cursor:pointer}.hidden{display:none}.bad{color:#991b1b}.good{color:#166534}.private{background:#fff7ed;border:1px solid #fed7aa}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:650px){.grid{grid-template-columns:1fr}.wrap{padding:10px}}</style></head><body><div class="wrap"><section id="login" class="card"><h1>🔐 Private Authority</h1><p>This area is restricted. The login reason is private.</p><div class="row"><input id="u" value="private" readonly autocomplete="username"><input id="p" type="password" placeholder="Password" autocomplete="current-password"></div><p><input id="r" placeholder="Private reason for login" maxlength="1000"></p><button id="loginBtn" onclick="login()">Login</button><p id="msg"></p></section><main id="dash" class="hidden"><section class="card"><div class="row" style="justify-content:space-between"><div><h1>Private Authority Dashboard</h1><p>Protected identity review.</p></div><button onclick="logout()">Logout</button></div></section><section class="card"><h2>Complaints</h2><div id="list">Loading…</div></section><section id="details"></section></main></div><script>const $=x=>document.getElementById(x);async function api(u,o){const r=await fetch(u,{credentials:'same-origin',cache:'no-store',...o});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||('Request failed ('+r.status+')'));return d}async function login(){const b=$('loginBtn'),m=$('msg');m.textContent='';b.disabled=true;try{await api('/api/private/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'private',password:$('p').value,reason:$('r').value.trim()})});$('login').classList.add('hidden');$('dash').classList.remove('hidden');await load()}catch(e){m.textContent=e.message;m.className='bad'}finally{b.disabled=false}}async function load(){try{const cs=await api('/api/private/complaints');$('list').innerHTML=cs.length?cs.map(c=>'<div class="card"><b>'+esc(c.complaint_code)+'</b> · '+esc(c.category)+' · '+esc(c.urgency)+'<p>'+esc(c.description)+'</p><div class="row"><span>'+esc(c.status)+'</span><button onclick="details(\''+esc(c.complaint_code)+'\')">View Details</button></div></div>').join(''):'No complaints'}catch(e){$('list').innerHTML='<p class="bad">'+esc(e.message)+'</p>'}}async function details(c){try{const d=await api('/api/private/complaints/'+encodeURIComponent(c)+'/details');$('details').innerHTML='<div class="card private"><h2>🔒 Private Details — '+esc(c)+'</h2><p><b>Student name:</b> '+esc(d.private.student_name)+'</p><p><b>IP address:</b> '+esc(d.private.ip_address||'Not available')+'</p><p><b>Complaints from this IP:</b> '+d.private.complaints_from_ip+'</p><hr><p><b>Category:</b> '+esc(d.complaint.category)+'</p><p><b>Urgency:</b> '+esc(d.complaint.urgency)+'</p><p><b>Status:</b> '+esc(d.complaint.status)+'</p><p><b>Description:</b><br>'+esc(d.complaint.description)+'</p></div>'}catch(e){$('details').innerHTML='<div class="card bad">'+esc(e.message)+'</div>'}}async function logout(){try{await api('/api/private/logout',{method:'POST'})}finally{location.reload()}}function esc(s){return String(s??'').replace(/[&<>\\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\\"':'&quot;',"'":'&#39;'}[m]))}async function boot(){try{await api('/api/private/session');$('login').classList.add('hidden');$('dash').classList.remove('hidden');await load()}catch(_){}}boot();</script></body></html>`;

  const page = (req, res, next) => {
    if (req.method === 'GET' && req.path === '/private') return res.type('html').send(html);
    next();
  };
  app.use(page);
  const router = app.router;
  if (router?.stack) { const layer = router.stack.pop(); if (layer) router.stack.unshift(layer); }
}
