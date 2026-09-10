export function registerPhase7({ app, pool, requireAdmin, requireHigher }) {
  const retentionDays = Math.max(30, Number(process.env.DATA_RETENTION_DAYS || 180));

  async function checkDb() {
    const started = Date.now();
    await pool.query('SELECT 1');
    return Date.now() - started;
  }

  async function getTableCount(table) {
    const r = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
    return r.rows[0].count;
  }

  async function systemHealth() {
    const dbLatencyMs = await checkDb();
    const complaints = await getTableCount('complaints');
    const automationEvents = await getTableCount('complaint_automation_events');
    return {
      status: 'ok',
      database: 'ok',
      db_latency_ms: dbLatencyMs,
      complaints,
      automation_events: automationEvents,
      data_retention_days: retentionDays,
      generated_at: new Date().toISOString()
    };
  }

  app.get('/api/admin/system-health', requireAdmin, async (_, res) => {
    try {
      res.json(await systemHealth());
    } catch (err) {
      res.status(503).json({ status: 'degraded', database: 'error' });
    }
  });

  app.get('/api/higher/system-health', requireHigher, async (_, res) => {
    try {
      res.json(await systemHealth());
    } catch (err) {
      res.status(503).json({ status: 'degraded', database: 'error' });
    }
  });

  app.get('/api/admin/data-retention', requireAdmin, async (_, res) => {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const r = await pool.query(
      `SELECT COUNT(*)::int AS eligible_complaints
       FROM complaints WHERE created_at < $1`,
      [cutoff]
    );
    res.json({ retention_days: retentionDays, cutoff, eligible_complaints: r.rows[0].eligible_complaints });
  });

  app.get('/api/higher/data-retention', requireHigher, async (_, res) => {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const r = await pool.query(
      `SELECT COUNT(*)::int AS eligible_complaints
       FROM complaints WHERE created_at < $1`,
      [cutoff]
    );
    res.json({ retention_days: retentionDays, cutoff, eligible_complaints: r.rows[0].eligible_complaints });
  });
}
