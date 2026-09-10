import fs from 'fs/promises';

export function registerPhase12({ app }) {
  const middleware = async (req, res, next) => {
    if (req.method !== 'GET' || (req.path !== '/' && req.path !== '/index.html')) return next();
    try {
      let html = await fs.readFile(new URL('./public/index.html', import.meta.url), 'utf8');
      const field = `<div class="field"><label for="student_name">तुमचे नाव <span class="hint">गोपनीय ठेवले जाईल</span></label><input id="student_name" maxlength="120" required placeholder="तुमचे पूर्ण नाव"></div>`;
      html = html.replace('<div class="field"><label for="category">समस्येचा प्रकार</label>', field + '<div class="field"><label for="category">समस्येचा प्रकार</label>');
      html = html.replace('नाव, मोबाईल नंबर, रोल नंबर, रूम नंबर किंवा ओळख पटेल अशी माहिती लिहू नका.', 'तुमचे नाव गोपनीय ठेवले जाईल. ते सामान्य Admin किंवा Higher Authority च्या तक्रार दृश्यामध्ये दाखवले जाणार नाही.');
      html = html.replace('नाव, मोबाईल किंवा रोल नंबर देण्याची गरज नाही.', 'तुमचे नाव गोपनीय ठेवले जाईल आणि तक्रारीच्या सामान्य प्रक्रियेत दाखवले जाणार नाही.');
      const script = `<script>(function(){function esc(s){return String(s??'').replace(/[&<>\"']/g,function(m){return({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m])})}function setup(){var f=document.getElementById('complaintForm');if(!f||f.dataset.phase12)return;f.dataset.phase12='1';f.addEventListener('submit',async function(e){e.preventDefault();e.stopImmediatePropagation();var name=document.getElementById('student_name').value.trim(),out=document.getElementById('formResult'),btn=document.getElementById('submitBtn');if(!name){out.className='result error';out.textContent='कृपया तुमचे नाव भरा.';return}btn.disabled=true;btn.textContent='तक्रार पाठवत आहे...';out.className='result';out.textContent='कृपया थोडा वेळ थांबा...';try{var r=await fetch('/api/complaints',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({student_name:name,category:document.getElementById('category').value,description:document.getElementById('description').value,urgency:document.getElementById('urgency').value,location:document.getElementById('location').value,affects_others:document.getElementById('affects_others').value,complaint_destination:(document.querySelector('input[name="destination"]:checked')||{}).value||'ADMIN'})});var d=await r.json().catch(function(){return{}});if(!r.ok)throw Error(d.error||'तक्रार पाठवता आली नाही');out.className='result success';out.innerHTML='<b>तक्रार यशस्वीपणे नोंदवली आहे. ✅</b><div class="idbox"><div class="idrow"><span class="idcode">'+esc(d.complaintId)+'</span></div><div class="muted">हा ID सुरक्षित ठेवा.</div></div>';f.reset()}catch(err){out.className='result error';out.textContent=err.message}finally{btn.disabled=false;btn.textContent='तक्रार सुरक्षितपणे पाठवा'}},true)}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup()})();</script>`;
      html = html.replace('</body>', script + '</body>');
      res.type('html').send(html);
    } catch { next(); }
  };
  app.use(middleware);
  const stack = app.router?.stack;
  const layer = stack?.pop();
  if (layer && stack) stack.unshift(layer);
}
