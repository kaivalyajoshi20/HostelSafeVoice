export function registerPhase18({ app }) {
  const privateUsername = String(process.env.PRIVATE_USERNAME || 'private');

  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SafeVoice — Private Authority</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#f4f7fb;margin:0;color:#172033}.wrap{max-width:560px;margin:0 auto;padding:28px 16px}.card{background:#fff;border-radius:18px;padding:22px;box-shadow:0 8px 30px rgba(0,0,0,.08)}h1{margin:0 0 8px;font-size:25px}.muted{color:#65708a;font-size:14px;line-height:1.5}.field{margin:16px 0}label{display:block;font-weight:700;margin-bottom:7px}input{width:100%;box-sizing:border-box;padding:13px;border:1px solid #ccd4e0;border-radius:10px;font-size:16px}button{width:100%;padding:14px;border:0;border-radius:10px;background:#172033;color:#fff;font-weight:800;font-size:16px;cursor:pointer}.msg{margin-top:14px;padding:11px;border-radius:9px;display:none;white-space:pre-wrap}.err{background:#fff0f0;color:#a40000}.ok{background:#effaf2;color:#176b2c}.hide{display:none}.row{display:flex;gap:10px}.smallbtn{background:#e9edf4;color:#172033;width:auto;padding:10px 14px}</style></head><body><div class="wrap"><div class="card"><h1>Private Authority Access</h1><p class="muted">Protected access for reviewing confidential complaint identity information. The login reason is private and is recorded only for Private Authority access.</p><div id="loginBox"><div class="field"><label>Username</label><input id="u" autocomplete="username" readonly></div><div class="field"><label>Password</label><input id="p" type="password" autocomplete="current-password"></div><div class="field"><label>Reason for login</label><input id="r" autocomplete="off" placeholder="Why are you accessing the dashboard?"></div><button id="loginBtn">Login</button><div id="msg" class="msg"></div></div><div id="dash" class="hide"><div class="row"><h2 style="margin:0 0 14px;flex:1">Private Complaints</h2><button class="smallbtn" id="logoutBtn">Logout</button></div><div id="list"></div><div id="dashMsg" class="msg"></div></div></div></div><script>
const username = ${JSON.stringify(privateUsername)};
const $ = id => document.getElementById(id);
$('u').value = username;
function message(text, ok=false){const el=$('msg');el.textContent=text;el.className='msg '+(ok?'ok':'err');el.style.display='block'}
function dashMessage(text,ok=false){const el=$('dashMsg');el.textContent=text;el.className='msg '+(ok?'ok':'err');el.style.display='block'}
async function login(){
  const password=$('p').value; const reason=$('r').value.trim();
  if(!password){message('Password is required.');return}
  if(!reason){message('Reason for login is required.');return}
  $('loginBtn').disabled=true; $('loginBtn').textContent='Signing in…'; message('Checking access…',true);
  try{
    const res=await fetch('/api/private/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({username,password,reason})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || ('Login failed (HTTP '+res.status+')'));
    const session=await fetch('/api/private/session',{credentials:'same-origin'}); const sd=await session.json().catch(()=>({}));
    if(!session.ok || !sd.authenticated) throw new Error(sd.error || 'Login succeeded but the private session could not be created. Please try again.');
    $('loginBox').classList.add('hide'); $('dash').classList.remove('hide'); await load();
  }catch(e){message(e.message || 'Login failed. Please try again.')}finally{$('loginBtn').disabled=false;$('loginBtn').textContent='Login'}
}
async function load(){
  try{const res=await fetch('/api/private/complaints',{credentials:'same-origin'});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||('Could not load complaints (HTTP '+res.status+')'));const rows=data.complaints||data.rows||[];if(!rows.length){$('list').innerHTML='<p class="muted">No complaints available.</p>';return}$('list').innerHTML=rows.map(c=>`<div style="border:1px solid #dce2eb;border-radius:12px;padding:14px;margin:10px 0"><b>${escapeHtml(c.complaint_code||c.complaintCode||c.id||'Complaint')}</b><div class="muted">${escapeHtml(c.category||'')} · ${escapeHtml(c.status||'')}</div><button style="margin-top:10px" onclick="details('${encodeURIComponent(c.complaint_code||c.complaintCode||c.id||'')}')">View Details</button></div>`).join('')}catch(e){dashMessage(e.message||'Could not load complaints.')}
}
async function details(code){const reason=prompt('Reason for viewing protected identity information:');if(!reason||!reason.trim())return;try{const res=await fetch('/api/private/complaints/'+code+'/details',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({reason:reason.trim()})});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||('Could not open details (HTTP '+res.status+')'));alert('Student name: '+(data.private?.student_name||'Not available')+'\nIP address: '+(data.private?.ip_address||'Not available')+'\nComplaints from this IP: '+(data.private?.complaints_from_ip??'Not available'));}catch(e){dashMessage(e.message||'Could not open details.')}}
async function logout(){await fetch('/api/private/logout',{method:'POST',credentials:'same-origin'}).catch(()=>{});location.reload()}
function escapeHtml(v){return String(v).replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]))}
$('loginBtn').addEventListener('click',login);$('logoutBtn').addEventListener('click',logout);$('p').addEventListener('keydown',e=>{if(e.key==='Enter')login()});$('r').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
(async()=>{try{const res=await fetch('/api/private/session',{credentials:'same-origin'});const d=await res.json().catch(()=>({}));if(res.ok&&d.authenticated){$('loginBox').classList.add('hide');$('dash').classList.remove('hide');load()}}catch(_){}})();
</script></body></html>`;

  const handler = (req,res) => { res.setHeader('Cache-Control','no-store'); res.type('html').send(page); };
  app.get('/private', handler);
  app.get('/private/', handler);

  // Put the corrected page before older phase pages so Express cannot shadow it.
  const layer = app._router?.stack?.find(l => l.route?.path === '/private' && l.route?.methods?.get);
  if (layer) {
    const stack = app._router.stack;
    const idx = stack.indexOf(layer);
    if (idx > 0) stack.splice(idx,1);
    stack.unshift(layer);
  }
}
