export function registerPhase19({ app, pool, requireAdmin }) {
  // Safe cleanup for TEST complaints only. Real complaints can never be deleted here.
  app.get('/test-cleanup', requireAdmin, async (_, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>SafeVoice Test Cleanup</title><style>body{font-family:system-ui;margin:0;background:#f4f7fb;color:#111827}.wrap{max-width:760px;margin:auto;padding:16px}.card{background:#fff;border:1px solid #dbe3ee;border-radius:16px;padding:16px;margin:12px 0}button{background:#b91c1c;color:#fff;border:0;border-radius:10px;padding:10px 14px;font:inherit}small{color:#64748b}</style></head><body><div class="wrap"><div class="card"><h1>🧹 Test Complaint Cleanup</h1><p>Only complaints explicitly marked as tests can appear here.</p><small>Real hostel complaints are not deletable from this page.</small></div><div id="list">Loading…</div><script>async function api(u,o={}){const r=await fetch(u,{credentials:'same-origin',cache:'no-store',...o});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Request failed');return d}async function load(){const rows=await api('/api/admin/test-complaints');document.getElementById('list').innerHTML=rows.length?rows.map(c=>'<div class="card"><b>'+c.complaint_code+'</b><p>'+c.description.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</p><small>'+new Date(c.created_at).toLocaleString()+'</small><p><button onclick="del(\\''+c.complaint_code+'\\')">Delete this test</button></p></div>').join(''):'<div class="card">No test complaints found.</div>'}async function del(code){if(!confirm('Delete this TEST complaint permanently?'))return;try{await api('/api/admin/test-complaints/'+encodeURIComponent(code),{method:'DELETE'});await load()}catch(e){alert(e.message)}}load()</script></div></body></html>`);
  });

  app.get('/api/admin/test-complaints', requireAdmin, async (_, res) => {
    const r = await pool.query(`SELECT complaint_code,description,category,urgency,status,created_at FROM complaints WHERE UPPER(TRIM(description)) LIKE 'TEST %' OR UPPER(TRIM(category))='TEST' ORDER BY created_at DESC`);
    res.json(r.rows);
  });

  app.delete('/api/admin/test-complaints/:code', requireAdmin, async (req, res) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    const r = await pool.query(`DELETE FROM complaints WHERE complaint_code=$1 AND (UPPER(TRIM(description)) LIKE 'TEST %' OR UPPER(TRIM(category))='TEST') RETURNING complaint_code`, [code]);
    if (!r.rowCount) return res.status(404).json({ error: 'Test complaint not found. Real complaints cannot be deleted here.' });
    res.json({ ok: true, complaintId: r.rows[0].complaint_code });
  });
}
