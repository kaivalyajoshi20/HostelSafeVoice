export function registerPhase16({ app, pool }) {
  const makeCode = () => `HS3-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  const submit = async (req, res) => {
    try {
      const b = req.body || {};
      const studentName = String(b.student_name ?? '').trim().slice(0, 120);
      const category = String(b.category ?? '').trim().slice(0, 120);
      const description = String(b.description ?? '').trim().slice(0, 2000);
      const urgency = String(b.urgency ?? '').trim().slice(0, 40);
      const location = String(b.location ?? '').trim().slice(0, 200);
      const affectsOthers = String(b.affects_others ?? '').trim().slice(0, 80);
      const destination = String(b.complaint_destination ?? 'ADMIN').trim().toUpperCase();

      console.log('FINAL_COMPLAINT_REQUEST', {
        studentName: Boolean(studentName),
        category: Boolean(category),
        description: Boolean(description),
        urgency: Boolean(urgency),
        affectsOthers: Boolean(affectsOthers),
        destination
      });

      if (!studentName || !category || !description || !urgency || !affectsOthers) {
        return res.status(400).json({ error: 'Please fill all required fields.' });
      }
      if (!['ADMIN', 'HIGHER_AUTHORITY'].includes(destination)) {
        return res.status(400).json({ error: 'Invalid complaint destination.' });
      }

      await pool.query(`CREATE TABLE IF NOT EXISTS complaint_private_identity (
        id BIGSERIAL PRIMARY KEY,
        complaint_code TEXT UNIQUE NOT NULL REFERENCES complaints(complaint_code) ON DELETE CASCADE,
        student_name TEXT NOT NULL,
        ip_address TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);

      let complaintCode;
      for (;;) {
        complaintCode = makeCode();
        try {
          await pool.query(
            `INSERT INTO complaints (complaint_code,category,description,urgency,location,affects_others,complaint_destination)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [complaintCode, category, description, urgency, location || null, affectsOthers, destination]
          );
          break;
        } catch (e) {
          if (e.code !== '23505') throw e;
        }
      }

      const forwarded = req.headers['x-forwarded-for'];
      const ipAddress = forwarded
        ? String(forwarded).split(',')[0].trim()
        : req.socket?.remoteAddress || null;

      await pool.query(
        `INSERT INTO complaint_private_identity (complaint_code,student_name,ip_address)
         VALUES ($1,$2,$3)`,
        [complaintCode, studentName, ipAddress]
      );

      console.log(`FINAL_COMPLAINT_CREATED ${complaintCode}`);
      return res.status(201).json({ complaintId: complaintCode, status: 'PENDING' });
    } catch (e) {
      console.error('FINAL_COMPLAINT_ERROR', e);
      return res.status(500).json({ error: 'Server could not save the complaint. Please try again.' });
    }
  };

  const html = `<!doctype html>
<html lang="mr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Cache-Control" content="no-store">
<title>Hostel SafeVoice — Secure Complaint</title>
<style>
body{font-family:system-ui,"Noto Sans Devanagari",sans-serif;background:#f4f7fb;color:#162033;margin:0}.wrap{max-width:700px;margin:auto;padding:14px}.card{background:#fff;border:1px solid #dbe3ec;border-radius:18px;padding:18px;margin:12px 0}.hero{background:#0b1220;color:#fff}.field{margin:16px 0}label{display:block;font-weight:700;margin-bottom:7px}input,select,textarea,button{font:inherit;width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid #cbd5e1}textarea{min-height:120px}.radio{display:flex;gap:8px;align-items:center;padding:12px;border:1px solid #ddd;border-radius:12px;margin:7px 0}.radio input{width:auto}.btn{background:#0b1220;color:#fff;font-weight:800;border:0}.result{padding:14px;border-radius:12px;margin-top:14px}.ok{background:#ecfdf5;border:1px solid #bbf7d0}.err{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}.hidden{display:none}@media(max-width:600px){.wrap{padding:10px}}
</style>
</head>
<body>
<main class="wrap">
<section class="card hero"><h1>🛡️ Hostel SafeVoice</h1><p>तिसरा मजला — सुरक्षित तक्रार प्रणाली</p></section>
<section class="card">
<div class="field"><label for="student_name">तुमचे नाव</label><input id="student_name" name="student_name" required maxlength="120" autocomplete="off" placeholder="तुमचे पूर्ण नाव"></div>
<div class="field"><label>तक्रार कुठे करायची आहे?</label><label class="radio"><input type="radio" name="destination" value="ADMIN" checked> Hostel Admin</label><label class="radio"><input type="radio" name="destination" value="HIGHER_AUTHORITY"> Higher Authority</label></div>
<div class="field"><label for="category">समस्येचा प्रकार</label><select id="category" name="category" required><option value="">निवडा</option><option>पाणी</option><option>वीज</option><option>लाईट</option><option>स्वच्छता</option><option>बाथरूम</option><option>दुरुस्ती</option><option>देखभाल</option><option>जेवण</option><option>सुरक्षितता</option><option>त्रास</option><option>इतर</option></select></div>
<div class="field"><label for="description">समस्येचे वर्णन</label><textarea id="description" name="description" required maxlength="2000" placeholder="काय + कुठे + कधीपासून?"></textarea></div>
<div class="field"><label for="urgency">तातडीची पातळी</label><select id="urgency" name="urgency" required><option value="">निवडा</option><option>सामान्य</option><option>महत्त्वाची</option><option>तातडीची</option></select></div>
<div class="field"><label for="location">समस्येचे ठिकाण <small>(ऐच्छिक)</small></label><input id="location" name="location" maxlength="200" placeholder="उदा. कॉरिडॉर / बाथरूम"></div>
<div class="field"><label for="affects_others">इतर विद्यार्थ्यांवर परिणाम</label><select id="affects_others" name="affects_others" required><option value="">निवडा</option><option>होय</option><option>नाही</option><option>माहित नाही</option></select></div>
<button id="send" class="btn" type="button">तक्रार सुरक्षितपणे पाठवा</button>
<div id="result" class="hidden"></div>
</section>
</main>
<script>
const $ = id => document.getElementById(id);
$('send').addEventListener('click', async () => {
  const payload = {
    student_name: $('student_name').value.trim(),
    category: $('category').value.trim(),
    description: $('description').value.trim(),
    urgency: $('urgency').value.trim(),
    location: $('location').value.trim(),
    affects_others: $('affects_others').value.trim(),
    complaint_destination: (document.querySelector('input[name="destination"]:checked') || {}).value || 'ADMIN'
  };

  const required = ['student_name','category','description','urgency','affects_others'];
  const missing = required.find(key => !payload[key]);
  if (missing) {
    $('result').className = 'result err';
    $('result').textContent = 'कृपया सर्व आवश्यक माहिती भरा.';
    return;
  }

  $('send').disabled = true;
  $('send').textContent = 'पाठवत आहे...';
  $('result').className = 'hidden';

  try {
    const response = await fetch('/api/final-complaint', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      cache: 'no-store',
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || ('Server error ' + response.status));

    $('result').className = 'result ok';
    $('result').innerHTML = '<b>तक्रार यशस्वीरित्या नोंदवली आहे. ✅</b><br><br>Complaint ID:<br><strong style="font-size:22px">' + data.complaintId + '</strong><br><br>हा ID सुरक्षित ठेवा.';
    $('send').disabled = true;
  } catch (e) {
    $('result').className = 'result err';
    $('result').textContent = e.message;
    $('send').disabled = false;
    $('send').textContent = 'तक्रार सुरक्षितपणे पाठवा';
  }
});
</script>
</body>
</html>`;

  // Use a completely new API path so none of the old complaint handlers can intercept it.
  app.post('/api/final-complaint', submit);
  app.get(['/final-complaint','/final-complaint/'], (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.type('html').send(html);
  });
}
