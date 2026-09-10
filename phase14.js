import crypto from 'crypto';

export function registerPhase14({ app, pool }) {
  function clientIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return (forwarded || req.ip || req.socket?.remoteAddress || '').slice(0, 100) || null;
  }
  function code() { return `HS3-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
  const submit = async (req, res) => {
    try {
      const body = req.body || {};
      const studentName = String(body.student_name || '').trim().slice(0, 120);
      const category = String(body.category || '').trim().slice(0, 120);
      const description = String(body.description || '').trim().slice(0, 2000);
      const urgency = String(body.urgency || '').trim().slice(0, 40);
      const location = String(body.location || '').trim().slice(0, 200);
      const affects = String(body.affects_others || '').trim().slice(0, 80);
      const destination = String(body.complaint_destination || 'ADMIN').toUpperCase();
      if (!studentName || !category || !description || !urgency || !affects) return res.status(400).json({ error: 'Please fill all required fields.' });
      if (!['ADMIN', 'HIGHER_AUTHORITY'].includes(destination)) return res.status(400).json({ error: 'Invalid complaint destination.' });
      let complaintCode;
      for (;;) {
        complaintCode = code();
        try {
          await pool.query('INSERT INTO complaints (complaint_code,category,description,urgency,location,affects_others,complaint_destination) VALUES ($1,$2,$3,$4,$5,$6,$7)', [complaintCode, category, description, urgency, location || null, affects, destination]);
          break;
        } catch (e) { if (e.code !== '23505') throw e; }
      }
      await pool.query('INSERT INTO complaint_private_identity (complaint_code,student_name,ip_address) VALUES ($1,$2,$3) ON CONFLICT (complaint_code) DO UPDATE SET student_name=EXCLUDED.student_name,ip_address=EXCLUDED.ip_address', [complaintCode, studentName, clientIp(req)]);
      console.log(`SafeVoice complaint created ${complaintCode} destination=${destination}`);
      res.status(201).json({ complaintId: complaintCode, status: 'PENDING' });
    } catch (e) {
      console.error('Student complaint submission failed:', e.message);
      res.status(500).json({ error: 'Server could not save the complaint. Please try again.' });
    }
  };
  app.post('/api/complaints', submit);
  const router = app.router;
  if (router?.stack) {
    const layer = router.stack.pop();
    if (layer) router.stack.unshift(layer);
  }

  const html = `<!doctype html><html lang="mr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1220"><title>Hostel SafeVoice — Student</title><style>body{margin:0;background:#f4f7fb;color:#162033;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Noto Sans Devanagari",sans-serif}.wrap{max-width:760px;margin:auto;padding:12px}.hero,.card{background:#fff;border:1px solid #dce3ec;border-radius:20px;padding:18px;margin:12px 0}.hero{background:#0b1220;color:#fff}.tag{display:inline-block;border:1px solid #ffffff33;border-radius:999px;padding:6px 9px;font-size:12px}.field{margin:16px 0}.field label{display:block;font-weight:800;margin-bottom:7px}.hint{font-size:12px;color:#64748b;font-weight:500}input,select,textarea,button{font:inherit}input,select,textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:13px;padding:12px;background:#fff}textarea{min-height:120px}.choice{display:grid;grid-template-columns:1fr 1fr;gap:9px}.choice label{border:1px solid #dce3ec;border-radius:13px;padding:12px}.choice input{width:auto}.primary{width:100%;border:0;border-radius:14px;padding:14px;background:#0b1220;color:#fff;font-weight:800}.note{background:#eef3f9;border-radius:14px;padding:13px;line-height:1.55}.privacy{background:#ecfdf5;border:1px solid #bbf7d0}.result{margin-top:13px;padding:14px;border-radius:14px}.success{background:#ecfdf5;border:1px solid #bbf7d0}.error{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}.idbox{margin-top:9px;background:#fff;border:1px dashed #94a3b8;border-radius:12px;padding:11px;font-weight:900}@media(max-width:600px){.choice{grid-template-columns:1fr}.wrap{padding:9px}}</style></head><body><main class="wrap"><section class="hero"><span class="tag">🛡️ HOSTEL SAFEVOICE</span><h1>तुमची समस्या ऐकली जावी,<br>ओळख नाही.</h1><p>तिसऱ्या मजल्यावरील समस्या सुरक्षितपणे कळवा.</p><span class="tag">तिसरा मजला • सुरक्षित तक्रार प्रणाली</span></section><section class="card"><h2>सुरक्षित तक्रार नोंदवा</h2><div class="note privacy"><b>गोपनीयता प्रथम</b><br>तुमचे नाव वेगळे आणि सुरक्षित साठवले जाईल. सामान्य Admin किंवा Higher Authority च्या तक्रार दृश्यात ते दाखवले जाणार नाही.</div><form id="safeForm"><div class="field"><label for="name">तुमचे नाव <span class="hint">गोपनीय ठेवले जाईल</span></label><input id="name" required maxlength="120" autocomplete="name" placeholder="तुमचे पूर्ण नाव"></div><div class="field"><label>तक्रार कुठे करायची आहे?</label><div class="choice"><label><input type="radio" name="destination" value="ADMIN" checked> 👤 Hostel Admin<br><small>सामान्य तक्रारींसाठी</small></label><label><input type="radio" name="destination" value="HIGHER_AUTHORITY"> 🏛️ Higher Authority<br><small>Admin कडून कारवाई होत नसेल तर</small></label></div></div><div class="field"><label for="category">समस्येचा प्रकार</label><select id="category" required><option value="">निवडा</option><option>पाणी</option><option>वीज</option><option>लाईट</option><option>स्वच्छता</option><option>बाथरूम</option><option>दुरुस्ती</option><option>देखभाल</option><option>जेवण</option><option>सुरक्षितता</option><option>त्रास</option><option>इतर</option></select></div><div class="field"><label for="description">समस्येचे वर्णन</label><textarea id="description" required maxlength="2000" placeholder="काय + कुठे + कधीपासून?"></textarea></div><div class="field"><label for="urgency">तातडीची पातळी</label><select id="urgency" required><option value="">निवडा</option><option>सामान्य</option><option>महत्त्वाची</option><option>तातडीची</option></select></div><div class="field"><label for="location">समस्येचे ठिकाण <span class="hint">ऐच्छिक</span></label><input id="location" maxlength="200" placeholder="उदा. कॉरिडॉर / बाथरूम"></div><div class="field"><label for="affects">इतर विद्यार्थ्यांवर परिणाम</label><select id="affects" required><option value="">निवडा</option><option>होय</option><option>नाही</option><option>माहित नाही</option></select></div><div class="note">📌 तक्रार पाठवल्यावर मिळणारा Complaint ID सुरक्षित ठेवा.</div><button id="submit" class="primary" type="submit">तक्रार सुरक्षितपणे पाठवा</button><div id="result" class="result" hidden></div></form></section></main><script>const $=id=>document.getElementById(id);$('safeForm').addEventListener('submit',async e=>{e.preventDefault();const out=$('result'),btn=$('submit');if(!$('name').value.trim()||!$('category').value||!$('description').value.trim()||!$('urgency').value||!$('affects').value){out.hidden=false;out.className='result error';out.textContent='कृपया सर्व आवश्यक माहिती भरा.';return}btn.disabled=true;btn.textContent='तक्रार पाठवत आहे...';out.hidden=false;out.className='result';out.textContent='कृपया थोडा वेळ थांबा...';try{const r=await fetch('/api/complaints',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({student_name:$('name').value.trim(),category:$('category').value,description:$('description').value.trim(),urgency:$('urgency').value,location:$('location').value.trim(),affects_others:$('affects').value,complaint_destination:(document.querySelector('input[name="destination"]:checked')||{}).value||'ADMIN'})});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||('Server error '+r.status));out.className='result success';out.innerHTML='<b>तक्रार यशस्वीपणे नोंदवली आहे. ✅</b><div class="idbox">Complaint ID: '+String(d.complaintId||'')+'</div><div>हा ID सुरक्षित ठेवा.</div>';e.target.reset()}catch(err){out.className='result error';out.textContent=err.message}finally{btn.disabled=false;btn.textContent='तक्रार सुरक्षितपणे पाठवा'}});</script></body></html>`;
  app.get(['/student','/student/'], (_, res) => res.type('html').send(html));
  if (app.router?.stack) {
    const layer = app.router.stack.pop();
    if (layer) app.router.stack.unshift(layer);
  }
}
