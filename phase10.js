import fs from 'fs/promises';

export function registerPhase10({ app }) {
  const middleware = async (req, res, next) => {
    if (req.method !== 'GET' || (req.path !== '/' && req.path !== '/index.html')) return next();
    try {
      let html = await fs.readFile(new URL('./public/index.html', import.meta.url), 'utf8');
      const field = `<div class="field"><label for="student_name">तुमचे नाव <span class="hint">गोपनीय ठेवले जाईल</span></label><input id="student_name" maxlength="120" required placeholder="तुमचे पूर्ण नाव"></div>`;
      html = html.replace('<div class="field"><label for="category">समस्येचा प्रकार</label>', field + '<div class="field"><label for="category">समस्येचा प्रकार</label>');
      html = html.replace('नाव, मोबाईल नंबर, रोल नंबर, रूम नंबर किंवा ओळख पटेल अशी माहिती लिहू नका.', 'तुमचे नाव गोपनीय ठेवले जाईल. ते सामान्य Admin किंवा Higher Authority च्या तक्रार दृश्यामध्ये दाखवले जाणार नाही.');
      html = html.replace('नाव, मोबाईल किंवा रोल नंबर देण्याची गरज नाही.', 'तुमचे नाव गोपनीय ठेवले जाईल आणि तक्रारीच्या सामान्य प्रक्रियेत दाखवले जाणार नाही.');
      const script = `<script>(function(){function esc(s){return String(s??'').replace(/[&<>\\\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\\\"':'&quot;',"'":'&#39;'}[m]))}function setup(){var form=document.getElementById('complaintForm');if(!form||form.dataset.privateReady)return;form.dataset.privateReady='1';form.addEventListener('submit',async function(e){e.preventDefault();e.stopImmediatePropagation();var name=document.getElementById('student_name').value.trim();var result=document.getElementById('formResult');var btn=document.getElementById('submitBtn');if(!name){result.className='result error';result.textContent='कृपया तुमचे नाव भरा.';return}btn.disabled=true;btn.textContent='पाठवत आहे…';try{var r=await fetch('/api/complaints',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({student_name:name,category:document.getElementById('category').value,description:document.getElementById('description').value,urgency:document.getElementById('urgency').value,location:document.getElementById('location').value,affects_others:document.getElementById('affects_others').value,complaint_destination:document.querySelector('input[name="destination"]:checked').value})});var d=await r.json().catch(function(){return{}});if(!r.ok)throw Error(d.error||'तक्रार पाठवता आली नाही.');result.className='result success';result.innerHTML='<b>तक्रार यशस्वीपणे नोंदवली.</b><div class="idbox"><div>तुमचा Complaint ID</div><div class="idrow"><span class="idcode">'+esc(d.complaintId)+'</span></div></div><p>हा ID सुरक्षित ठेवा. स्टेटस तपासण्यासाठी याचा वापर करा.</p>';form.reset();}catch(err){result.className='result error';result.textContent=err.message}finally{btn.disabled=false;btn.textContent='तक्रार सुरक्षितपणे पाठवा'}} ,true)}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup()})();</script>`;
      html = html.replace('</body>', script + '</body>');
      res.type('html').send(html);
    } catch { next(); }
  };
  app.use(middleware);
  const stack = app.router?.stack;
  const layer = stack?.pop();
  if (layer && stack) stack.unshift(layer);
}
