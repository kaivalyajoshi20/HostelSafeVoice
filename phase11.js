export function registerPhase11({ app }) {
  const privateUsername = process.env.PRIVATE_USERNAME || 'private';
  const usernameJson = JSON.stringify(privateUsername);

  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hostel SafeVoice — Private Authority</title><style>body{font-family:system-ui;margin:0;background:#f4f7fb;color:#0b1220}.wrap{max-width:950px;margin:auto;padding:16px}.card{background:#fff;border:1px solid #dce3ec;border-radius:18px;padding:18px;margin:14px 0}.row{display:flex;gap:8px;flex-wrap:wrap}input,button{font:inherit;padding:11px;border-radius:10px;border:1px solid #cbd5e1}input{min-width:220px;flex:1}button{background:#0b1220;color:#fff;cursor:pointer}button:disabled{opacity:.6;cursor:wait}.hidden{display:none}.bad{color:#991b1b}.private{background:#fff7ed;border:1px solid #fed7aa}@media(max-width:650px){.wrap{padding:10px}}</style></head><body><div class="wrap"><section id="login" class="card"><h1>🔐 Private Authority</h1><p>This area is restricted. The login reason is private.</p><div class="row"><input id="u" readonly autocomplete="username"><input id="p" type="password" placeholder="Password" autocomplete="current-password"></div><p><input id="r" placeholder="Private reason for login" maxlength="1000"></p><button id="loginBtn" type="button">Login</button><p id="msg"></p></section><main id="dash" class="hidden"><section class="card"><div class="row" style="justify-content:space-between"><div><h1>Private Authority Dashboard</h1><p>Protected identity review.</p></div><button id="logoutBtn" type="button">Logout</button></div></section><section class="card"><h2>Complaints</h2><div id="list">Loading…</div></section><section id="details"></section></main></div><script>
(function(){
  const username=${usernameJson};
  const $=id=>document.getElementById(id);
  const esc=value=>String(value==null?'':value).replace(/[&<>\"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch];});
  async function api(url,options){
    const response=await fetch(url,Object.assign({credentials:'same-origin',cache:'no-store'},options||{}));
    const data=await response.json().catch(function(){return {};});
    if(!response.ok) throw new Error(data.error||('Request failed ('+response.status+')'));
    return data;
  }
  async function load(){
    try{
      const complaints=await api('/api/private/complaints');
      $('list').innerHTML=complaints.length?complaints.map(function(c){
        return '<div class="card"><b>'+esc(c.complaint_code)+'</b> · '+esc(c.category)+' · '+esc(c.urgency)+'<p>'+esc(c.description)+'</p><div class="row"><span>'+esc(c.status)+'</span><button type="button" data-code="'+esc(c.complaint_code)+'" class="detailsBtn">View Details</button></div></div>';
      }).join(''):'No complaints';
      document.querySelectorAll('.detailsBtn').forEach(function(btn){btn.addEventListener('click',function(){showDetails(btn.dataset.code);});});
    }catch(error){$('list').innerHTML='<p class="bad">'+esc(error.message)+'</p>';}
  }
  async function showDetails(code){
    try{
      const data=await api('/api/private/complaints/'+encodeURIComponent(code)+'/details');
      $('details').innerHTML='<div class="card private"><h2>🔒 Private Details — '+esc(code)+'</h2><p><b>Student name:</b> '+esc(data.private.student_name)+'</p><p><b>IP address:</b> '+esc(data.private.ip_address||'Not available')+'</p><p><b>Complaints from this IP:</b> '+esc(data.private.complaints_from_ip)+'</p><hr><p><b>Category:</b> '+esc(data.complaint.category)+'</p><p><b>Urgency:</b> '+esc(data.complaint.urgency)+'</p><p><b>Status:</b> '+esc(data.complaint.status)+'</p><p><b>Location:</b> '+esc(data.complaint.location||'Not specified')+'</p><p><b>Description:</b><br>'+esc(data.complaint.description)+'</p></div>';
    }catch(error){$('details').innerHTML='<div class="card bad">'+esc(error.message)+'</div>';}
  }
  async function login(){
    const button=$('loginBtn'), msg=$('msg');
    button.disabled=true;button.textContent='Signing in…';msg.textContent='';msg.className='';
    try{
      await api('/api/private/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:username,password:$('p').value,reason:$('r').value.trim()})});
      msg.textContent='Login successful. Opening dashboard…';msg.className='good';
      await api('/api/private/session');
      $('login').classList.add('hidden');$('dash').classList.remove('hidden');
      await load();
    }catch(error){msg.textContent=error.message;msg.className='bad';}
    finally{button.disabled=false;button.textContent='Login';}
  }
  async function logout(){try{await api('/api/private/logout',{method:'POST'});}catch(_){}location.reload();}
  async function boot(){
    $('u').value=username;
    $('loginBtn').addEventListener('click',login);
    $('logoutBtn').addEventListener('click',logout);
    try{await api('/api/private/session');$('login').classList.add('hidden');$('dash').classList.remove('hidden');await load();}catch(_){}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
</script></body></html>`;

  const middleware=(req,res,next)=>{
    if(req.method==='GET' && req.path==='/private') return res.type('html').send(page);
    next();
  };
  app.use(middleware);
  const stack=app.router?.stack;
  const layer=stack?.pop();
  if(layer&&stack)stack.unshift(layer);
}
