export function registerPhase8({ app, pool, requireAdmin, requireHigher }) {
  async function oversightSummary() {
    const r = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status <> 'RESOLVED')::int AS open,
        COUNT(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved,
        COUNT(*) FILTER (WHERE review_status = 'NEEDS_REVIEW')::int AS needs_review,
        COUNT(*) FILTER (WHERE complaint_destination = 'ESCALATED' AND status <> 'RESOLVED')::int AS escalated,
        COUNT(*) FILTER (WHERE urgency = 'तातडीची' AND status <> 'RESOLVED')::int AS urgent_open,
        COUNT(*) FILTER (WHERE urgency = 'महत्त्वाची' AND status <> 'RESOLVED')::int AS important_open
      FROM complaints`);
    return r.rows[0];
  }

  app.get('/api/admin/oversight-summary', requireAdmin, async (_, res) => {
    try {
      res.json(await oversightSummary());
    } catch (err) {
      res.status(500).json({ error: 'Unable to load oversight summary' });
    }
  });

  app.get('/api/higher/oversight-summary', requireHigher, async (_, res) => {
    try {
      res.json(await oversightSummary());
    } catch (err) {
      res.status(500).json({ error: 'Unable to load oversight summary' });
    }
  });

  // Keep the public tracking contract explicit and narrow.
  // It intentionally does not expose complaint content or dashboard data.
  app.get('/api/privacy-check', (_, res) => {
    res.json({
      public_tracking_fields: ['complaint_code', 'status', 'created_at', 'updated_at'],
      form_identity_fields: false,
      note: 'The form does not request identity fields. Do not enter names, phone numbers, room numbers, roll numbers, or other identifying information.'
    });
  });
}
