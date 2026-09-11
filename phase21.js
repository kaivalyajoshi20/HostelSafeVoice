export function registerPhase21({ app, pool, requireAdmin }) {
  const MAX = 100000;
  const BATCH = 1000;

  app.post('/api/admin/load-test', requireAdmin, async (req, res) => {
    const requested = Number(req.body?.count || 0);
    const count = Number.isInteger(requested) ? requested : 0;
    if (![1000, 10000, 100000].includes(count)) {
      return res.status(400).json({ error: 'Load test count must be exactly 1000, 10000, or 100000.' });
    }

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const started = Date.now();
    let inserted = 0;

    try {
      for (let offset = 0; offset < count; offset += BATCH) {
        const size = Math.min(BATCH, count - offset);
        const values = [];
        const params = [];
        for (let i = 0; i < size; i++) {
          const n = offset + i + 1;
          const code = `HS3-LT-${runId}-${n}`;
          values.push(`($${params.length + 1},$${params.length + 2},$${params.length + 3},$${params.length + 4},$${params.length + 5},$${params.length + 6},$${params.length + 7})`);
          params.push(code, 'LOAD_TEST', `Synthetic load-test complaint ${runId} #${n}`, n % 10 === 0 ? 'HIGH' : 'NORMAL', '3rd Floor', 'NO', 'ADMIN');
        }
        await pool.query(`INSERT INTO complaints (complaint_code,category,description,urgency,location,affects_others,complaint_destination) VALUES ${values.join(',')}`, params);
        inserted += size;
      }
      const elapsedMs = Date.now() - started;
      res.json({ ok: true, runId, inserted, elapsedMs, note: 'Synthetic LOAD_TEST records only. No notification email was sent.' });
    } catch (err) {
      console.error('Load test failed:', err.message);
      res.status(500).json({ error: 'Load test failed', inserted, message: err.message });
    }
  });

  app.get('/api/admin/load-test/metrics', requireAdmin, async (_, res) => {
    try {
      const result = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE category='LOAD_TEST')::int AS load_test_count,
          COUNT(*)::int AS total_complaints,
          pg_size_pretty(pg_total_relation_size('complaints')) AS complaints_table_size,
          pg_size_pretty(pg_total_relation_size('complaint_private_identity')) AS private_identity_table_size
        FROM complaints
      `);
      const explain = await pool.query(`EXPLAIN (ANALYZE, FORMAT JSON) SELECT complaint_code,status,created_at,updated_at FROM complaints WHERE category='LOAD_TEST' ORDER BY created_at DESC LIMIT 50`);
      res.json({ ok: true, metrics: result.rows[0], queryPlan: explain.rows[0]['QUERY PLAN'] });
    } catch (err) {
      res.status(500).json({ error: 'Could not collect load-test metrics', message: err.message });
    }
  });

  app.delete('/api/admin/load-test', requireAdmin, async (_, res) => {
    try {
      const result = await pool.query(`DELETE FROM complaints WHERE category='LOAD_TEST' RETURNING complaint_code`);
      res.json({ ok: true, deleted: result.rowCount, note: 'Only LOAD_TEST synthetic complaints were deleted.' });
    } catch (err) {
      res.status(500).json({ error: 'Load-test cleanup failed', message: err.message });
    }
  });

  app.get('/load-test', requireAdmin, (_, res) => {
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SafeVoice Load Test</title><style>body{font-family:system-ui;background:#eef4fb;color:#10233f;margin:0}.wrap{max-width:720px;margin:auto;padding:18px}.card{background:#fff;border:1px solid #d7e2ef;border-radius:18px;padding:18px;margin:14px 0}button{padding:12px 16px;border:0;border-radius:10px;background:#1459a6;color:#fff;font-weight:700;margin:5px}pre{white-space:pre-wrap;word-break:break-word;background:#f5f8fc;padding:12px;border-radius:12px}.danger{background:#8b1e2d}</style></head><body><div class="wrap"><div class="card"><h1>🧪 SafeVoice Load Test</h1><p>Admin-only synthetic database test. This never sends complaint notification emails.</p><button onclick="run(1000)">Insert 1,000</button><button onclick="run(10000)">Insert 10,000</button><button onclick="run(100000)">Insert 100,000</button><button onclick="metrics()">Measure</button><button class="danger" onclick="cleanup()">Delete LOAD_TEST data</button></div><div class="card"><pre id="out">Ready.</pre></div></div><script>const out=document.getElementById('out');async function api(u,o){const r=await fetch(u,{credentials:'same-origin',cache:'no-store',...o});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||d.message||'Request failed');return d}async function run(n){out.textContent='Running '+n.toLocaleString()+' synthetic inserts…';try{out.textContent=JSON.stringify(await api('/api/admin/load-test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({count:n})}),null,2)}catch(e){out.textContent=e.message}}async function metrics(){out.textContent='Measuring…';try{out.textContent=JSON.stringify(await api('/api/admin/load-test/metrics'),null,2)}catch(e){out.textContent=e.message}}async function cleanup(){if(!confirm('Delete only synthetic LOAD_TEST complaints?'))return;out.textContent='Cleaning…';try{out.textContent=JSON.stringify(await api('/api/admin/load-test',{method:'DELETE'}),null,2)}catch(e){out.textContent=e.message}}</script></body></html>`);
  });
}
