export function registerPhase8({ app, pool, requireAdmin, requireHigher }) {
  const retentionDays = Math.max(30, Number(process.env.DATA_RETENTION_DAYS || 180));

  async function oversightSummary() {
    const r = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status <> 'RESOLVED')::int AS open,
        COUNT(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved,
        COUNT(*) FILTER (WHERE review_status = 'NEEDS_REVIEW')::int AS needs_review,
        COUNT(*) FILTER (WHERE complaint_destination = 'ESCALATED' AND status <> 'RESOLVED')::int AS escalated,
        COUNT(*) FILTER (WHERE urgency = 'तातडीची' AND status <> 'RESOLVED')::int AS urgent_open,
        COUNT(*) FILTER (WHERE urgency = 'महत्त्वाची' AND status <> 'RESOLVED')::int AS important_open,
        COUNT(*) FILTER (WHERE status <> 'RESOLVED' AND EXTRACT(EPOCH FROM (NOW()-created_at))/3600.0 >=
          CASE urgency WHEN 'तातडीची' THEN 4 WHEN 'महत्त्वाची' THEN 24 ELSE 72 END)::int AS overdue_open
      FROM complaints`);
    return r.rows[0];
  }

  async function automationSummary() {
    const r = await pool.query(`SELECT
      COUNT(*) FILTER (WHERE event_type='SLA_OVERDUE_NOTICE')::int AS overdue_notices,
      COUNT(*) FILTER (WHERE event_type='AUTO_ESCALATED')::int AS automatic_escalations,
      COUNT(*) FILTER (WHERE event_type='AUTO_ESCALATION_NOTICE')::int AS automatic_escalation_notices
      FROM complaint_automation_events`);
    return r.rows[0];
  }

  async function systemHealth() {
    const started = Date.now();
    await pool.query('SELECT 1');
    const counts = await pool.query(`SELECT
      (SELECT COUNT(*)::int FROM complaints) AS complaints,
      (SELECT COUNT(*)::int FROM complaint_automation_events) AS automation_events,
      (SELECT COUNT(*)::int FROM complaints WHERE review_status='NEEDS_REVIEW') AS review_queue`);
    return {
      status: 'ok', database: 'ok', db_latency_ms: Date.now() - started,
      complaints: counts.rows[0].complaints,
      automation_events: counts.rows[0].automation_events,
      review_queue: counts.rows[0].review_queue,
      data_retention_days: retentionDays,
      generated_at: new Date().toISOString()
    };
  }

  async function dashboardData(role) {
    return {
      role,
      oversight: await oversightSummary(),
      automation: await automationSummary(),
      health: await systemHealth(),
      retention: { retention_days: retentionDays }
    };
  }

  app.get('/api/admin/oversight-summary', requireAdmin, async (_, res) => {
    try { res.json(await oversightSummary()); }
    catch { res.status(500).json({ error: 'Unable to load oversight summary' }); }
  });

  app.get('/api/higher/oversight-summary', requireHigher, async (_, res) => {
    try { res.json(await oversightSummary()); }
    catch { res.status(500).json({ error: 'Unable to load oversight summary' }); }
  });

  app.get('/api/admin/phase8-dashboard', requireAdmin, async (_, res) => {
    try { res.json(await dashboardData('admin')); }
    catch { res.status(503).json({ error: 'Unable to load Phase 8 dashboard data' }); }
  });

  app.get('/api/higher/phase8-dashboard', requireHigher, async (_, res) => {
    try { res.json(await dashboardData('higher')); }
    catch { res.status(503).json({ error: 'Unable to load Phase 8 dashboard data' }); }
  });

  app.get('/api/admin/system-health', requireAdmin, async (_, res) => {
    try { res.json(await systemHealth()); }
    catch { res.status(503).json({ status: 'degraded', database: 'error' }); }
  });

  app.get('/api/higher/system-health', requireHigher, async (_, res) => {
    try { res.json(await systemHealth()); }
    catch { res.status(503).json({ status: 'degraded', database: 'error' }); }
  });

  app.get('/api/admin/data-retention', requireAdmin, async (_, res) => {
    try {
      const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
      const r = await pool.query(`SELECT COUNT(*)::int AS eligible_complaints FROM complaints WHERE created_at < $1`, [cutoff]);
      res.json({ retention_days: retentionDays, cutoff, eligible_complaints: r.rows[0].eligible_complaints });
    } catch { res.status(500).json({ error: 'Unable to load retention data' }); }
  });

  app.get('/api/higher/data-retention', requireHigher, async (_, res) => {
    try {
      const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
      const r = await pool.query(`SELECT COUNT(*)::int AS eligible_complaints FROM complaints WHERE created_at < $1`, [cutoff]);
      res.json({ retention_days: retentionDays, cutoff, eligible_complaints: r.rows[0].eligible_complaints });
    } catch { res.status(500).json({ error: 'Unable to load retention data' }); }
  });

  // Public tracking remains intentionally narrow: no description, location, destination,
  // review flags, dashboard metrics, or identity-related metadata is exposed here.
  app.get('/api/privacy-check', (_, res) => {
    res.json({
      public_tracking_fields: ['complaint_code', 'status', 'created_at', 'updated_at'],
      form_identity_fields: false,
      dashboard_identity_fields: false,
      note: 'The form does not request identity fields. Do not enter names, phone numbers, room numbers, roll numbers, or other identifying information.'
    });
  });
}
