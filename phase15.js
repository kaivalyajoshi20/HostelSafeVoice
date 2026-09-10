import crypto from 'crypto';

export function registerPhase15({ app, pool }) {
  const ip = req => String(req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0,100) || null;
  const makeCode = () => `HS3-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const submit = async (req, res) => {
    try {
      const b = req.body || {};
      const name = String(b.student_name || '').trim().slice(0,120);
      const category = String(b.category || '').trim().slice(0,120);
      const description = String(b.description || '').trim().slice(0,2000);
      const urgency = String(b.urgency || '').trim().slice(0,40);
      const location = String(b.location || '').trim().slice(0,200);
      const affects = String(b.affects_others || '').trim().slice(0,80);
      const destination = String(b.complaint_destination || 'ADMIN').toUpperCase();
      if (!name || !category || !description || !urgency || !affects) return res.status(400).json({error:'Please fill all required fields.'});
      if (!['ADMIN','HIGHER_AUTHORITY'].includes(destination)) return res.status(400).json({error:'Invalid complaint destination.'});
      let id;
      for (;;) {
        id = makeCode();
        try {
          await pool.query('INSERT INTO complaints (complaint_code,category,description,urgency,location,affects_others,complaint_destination) VALUES ($1,$2,$3,$4,$5,$6,$7)',[id,category,description,urgency,location||null,affects,destination]);
          break;
        } catch(e) { if(e.code !== '23505') throw e; }
      }
      await pool.query('INSERT INTO complaint_private_identity (complaint_code,student_name,ip_address) VALUES ($1,$2,$3) ON CONFLICT (complaint_code) DO UPDATE SET student_name=EXCLUDED.student_name,ip_address=EXCLUDED.ip_address',[id,name,ip(req)]);
      console.log(`STUDENT_TEST_OK ${id}`);
      res.status(201).json({complaintId:id,status:'PENDING'});
    } catch(e) {
      console.error('STUDENT_SUBMIT_ERROR',e.message);
      res.status(500).json({error:'Server could not save the complaint. Please try again.'});
    }
  };

  const html = `<!doctype html><html lang="mr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Cache-Control" content="no-store"><title>Hostel SafeVoice — Secure Complaint</title><style>body{font-family:system-ui,"Noto Sans Devanagari",sans-serif;background:#f4f7fb;color:#162033;margin:0}.wrap{max-width:720px;margin:auto;padding:14px}.card{background:white;border:1px solid #dbe3ec;border-radius:18px;padding:18px;margin:12px 0}.hero{background:#0b1220;color:white}.field{margin:15px 0}label{display:block;font-weight:700;margin-bottom:6px}input,select,textarea,button{font:inherit;width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid #cbd5e1}textarea{min-height:110px}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.radio{padding:10px;border:1px solid #ddd;border-radius:12px}.radio input{width:auto}.btn{background:#0b1220;color:#fff;font-weight:800;border:0}.result{padding:12px;border-radius:12px;margin-top:12px}.ok{background:#ecfdf5}.err{background:#fef2f2;color:#991b1b}@media(max-width:600px){.row{grid-template-columns:1fr}}</style></head><body><main class="wrap"><section class="card hero"><h1>🛡️ Hostel SafeVoice</h1><p>तिसरा मजला — सुरक्षित तक्रार प्रणाली</p></section><section class="card"><div class="field"><label>तुमचे नाव</label><input id="name" autocomplete="name" required placeholder="तुमचे पूर्ण नाव"></div><div class="field"><label>तक्रार कुठे करायची आहे?</label><div class="row"><label class="radio"><input type="radio" name="dest" value="ADMIN" checked> Hostel Admin</label><label class="radio"><input type="radio" name="dest" value="HIGHER_AUTHORITY"> Higher Authority</label></div></div><div class="field"><label>समस्येचा प्रकार</label><select id="category" required><option value="">निवडा</option><option>पाणी</option><option>वीज</option><option>लाईट</option><option>स्वच्छता</option><option>बाथरूम</option><option>दुरुस्ती</option><option>देखभाल</option><option>जेवण</option><option>सुरक्षितता</option><option>त्रास</option><option>इतर</option></select></div><div class="field"><label>समस्येचे वर्णन</label><textarea id="description" required placeholder="काय + कुठे + कधीपासून?"></textarea></div><div class="field"><label>तातडीची पातळी</label><select id="urgency" required><option value="">निवडा</option><option>सामान्य</option><option>महत्त्वाची</option><option>तातडीची</option></select></div><div class="field"><label>समस्येचे ठिकाण</label><input id="location" placeholder="उदा. कॉरिडॉर / बाथरूम"></div><div class="field"><label>इतर विद्यार्थ्यांवर परिणाम</label><select id="affects" required><option value="">निवडा</option><option>होय</option><option>नाही</option><option>माहित नाही</option></select></div><button id="send" class="btn">तक्रार सुरक्षितपणे पाठवा</button><div id="result" hidden></div></section></main><script>const $=x=>document.getElementById(x);$('send').onclick=async()=>{const fields=[['name','तुमचे नाव'],['category','समस्येचा प्रकार'],['description','समस्येचे वर्णन'],['urgency','तातडीची पातळी'],['affects','इतर विद्यार्थ्यांवर परिणाम']];for(const [id,label] of fields){if(!$(id).value.trim()){show('कृपया '+label+' भरा.','err');$(id).focus();return}}const body={student_name:$('name').value.trim(),category:$('category').value,description:$('description').value.trim(),urgency:$('urgency').value,location:$('location').value.trim(),affects_others:$('affects').value,complaint_destination:(document.querySelector('input[name="dest"]:checked')||{}).value||'ADMIN'};$('send').disabled=true;$('send').textContent='पाठवत आहे...';try{const r=await fetch('/api/complaints',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||('Server error '+r.status));show('तक्रार यशस्वीपणे नोंदवली आहे. ✅<br><b>Complaint ID: '+d.complaintId+'</b>','ok')}catch(e){show(e.message,'err')}finally{$('send').disabled=false;$('send').textContent='तक्रार सुरक्षितपणे पाठवा'}};function show(t,c){const x=$('result');x.hidden=false;x.className='result '+c;x.innerHTML=t}</script></body></html>`;

  app.post('/api/complaints', submit);
  app.get(['/complaint','/complaint/'], (req,res)=>{res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');res.set('Pragma','no-cache');res.type('html').send(html)});

  if(app.router?.stack){
    const gets=[], posts=[];
    for(let i=app.router.stack.length-1;i>=0;i--){const l=app.router.stack[i]; if(l?.route?.path && (l.route.path === '/complaint' || l.route.path === '/complaint/' || l.route.path === '/api/complaints')) {app.router.stack.splice(i,1); if(l.route.path === '/api/complaints') posts.push(l); else gets.push(l)}}
    app.router.stack.unshift(...posts,...gets);
  }
}
