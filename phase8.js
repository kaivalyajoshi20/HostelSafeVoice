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

  // Privacy guard: public tracking intentionally exposes status/timestamps only.
  // Keep this endpoint separate so future dashboard changes cannot accidentally
  // expand the public complaint response.
  app.get('/api/privacy-check', (_, res) => {
    res.json({
      public_tracking_fields: ['complaint_code', 'status', 'created_at', 'updated_at'],
      identity_collection_by_form: false,
      note: 'Do not enter names, phone numbers, room numbers, roll numbers, or other identifying information.'
    });
  });
}
