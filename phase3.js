export function registerPhase3({ app, pool, requireAdmin, requireHigher }) {
  async function ensurePhase3() {
    await pool.query(`CREATE TABLE IF NOT EXISTS complaint_audit (
      id BIGSERIAL PRIMARY KEY,
      complaint_code TEXT NOT NULL REFERENCES complaints(complaint_code) ON DELETE CASCADE,
      action TEXT NOT NULL,
      old_status TEXT,
      new_status TEXT,
      old_destination TEXT,
      new_destination TEXT,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_complaint_audit_code ON complaint_audit(complaint_code, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_complaints_open_age ON complaints(status, created_at)`);
  }

  const ageHours = `EXTRACT(EPOCH FROM (NOW() - c.created_at)) / 3600.0`;
  const overdueCase = `(c.status <> 'RESOLVED' AND ((c.urgency = 'तातडीची' AND ${ageHours} >= 4) OR (c.urgency = 'महत्त्वाची' AND ${ageHours} >= 24) OR (c.urgency = 'सामान्य' AND ${ageHours} >= 72)))`;

  app.get('/api/admin/oversight', requireAdmin, async (_, res) => {
    const r = await pool.query(`SELECT
      COUNT(*) FILTER (WHERE c.status <> 'RESOLVED')::int AS open_count,
      COUNT(*) FILTER (WHERE ${overdueCase})::int AS overdue_count,
      COUNT(*) FILTER (WHERE c.status='RESOLVED' AND c.updated_at >= NOW()-INTERVAL '24 hours')::int AS resolved_24h,
      ROUND(COALESCE(AVG(${ageHours}) FILTER (WHERE c.status <> 'RESOLVED'),0)::numeric,1) AS avg_open_age_hours
      FROM complaints c WHERE c.complaint_destination IN ('ADMIN','ESCALATED')`);
    res.json(r.rows[0]);
  });

  app.get('/api/higher/oversight', requireHigher, async (_, res) => {
    const r = await pool.query(`SELECT
      COUNT(*) FILTER (WHERE c.status <> 'RESOLVED')::int AS open_count,
      COUNT(*) FILTER (WHERE ${overdueCase})::int AS overdue_count,
      COUNT(*) FILTER (WHERE c.complaint_destination='ESCALATED')::int AS escalated_count,
      COUNT(*) FILTER (WHERE c.status='RESOLVED' AND c.updated_at >= NOW()-INTERVAL '24 hours')::int AS resolved_24h,
      ROUND(COALESCE(AVG(${ageHours}) FILTER (WHERE c.status <> 'RESOLVED'),0)::numeric,1) AS avg_open_age_hours
      FROM complaints c WHERE c.complaint_destination IN ('HIGHER_AUTHORITY','ESCALATED')`);
    res.json(r.rows[0]);
  });

  app.get('/api/admin/overdue', requireAdmin, async (_, res) => {
    const r = await pool.query(`SELECT c.complaint_code,c.category,c.urgency,c.status,c.complaint_destination,c.created_at,c.updated_at,
      ROUND(${ageHours}::numeric,1) AS age_hours
      FROM complaints c WHERE c.complaint_destination IN ('ADMIN','ESCALATED') AND ${overdueCase}
      ORDER BY CASE c.urgency WHEN 'तातडीची' THEN 1 WHEN 'महत्त्वाची' THEN 2 ELSE 3 END, c.created_at ASC LIMIT 200`);
    res.json(r.rows);
  });

  app.get('/api/higher/overdue', requireHigher, async (_, res) => {
    const r = await pool.query(`SELECT c.complaint_code,c.category,c.urgency,c.status,c.complaint_destination,c.created_at,c.updated_at,
      ROUND(${ageHours}::numeric,1) AS age_hours
      FROM complaints c WHERE c.complaint_destination IN ('HIGHER_AUTHORITY','ESCALATED') AND ${overdueCase}
      ORDER BY CASE c.urgency WHEN 'तातडीची' THEN 1 WHEN 'महत्त्वाची' THEN 2 ELSE 3 END, c.created_at ASC LIMIT 200`);
    res.json(r.rows);
  });

  app.get('/api/admin/complaints/:code/audit', requireAdmin, async (req, res) => {
    const r = await pool.query(`SELECT action,old_status,new_status,old_destination,new_destination,note,created_at FROM complaint_audit WHERE complaint_code=$1 ORDER BY created_at DESC LIMIT 100`, [req.params.code.toUpperCase()]);
    res.json(r.rows);
  });

  app.get('/api/higher/complaints/:code/audit', requireHigher, async (req, res) => {
    const r = await pool.query(`SELECT action,old_status,new_status,old_destination,new_destination,note,created_at FROM complaint_audit WHERE complaint_code=$1 ORDER BY created_at DESC LIMIT 100`, [req.params.code.toUpperCase()]);
    res.json(r.rows);
  });

  // Database-level audit trigger: records status/destination changes regardless of which protected route made them.
  pool.query(`CREATE OR REPLACE FUNCTION safevoice_audit_complaint() RETURNS trigger AS $$
    BEGIN
      IF NEW.status IS DISTINCT FROM OLD.status OR NEW.complaint_destination IS DISTINCT FROM OLD.complaint_destination THEN
        INSERT INTO complaint_audit(complaint_code,action,old_status,new_status,old_destination,new_destination)
        VALUES(NEW.complaint_code,
          CASE WHEN NEW.complaint_destination IS DISTINCT FROM OLD.complaint_destination THEN 'DESTINATION_CHANGED' ELSE 'STATUS_CHANGED' END,
          OLD.status,NEW.status,OLD.complaint_destination,NEW.complaint_destination);
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql`).catch(err => console.error('Phase 3 audit function setup failed:', err.message));

  pool.query(`DROP TRIGGER IF EXISTS safevoice_complaint_audit ON complaints`).then(() =>
    pool.query(`CREATE TRIGGER safevoice_complaint_audit AFTER UPDATE OF status, complaint_destination ON complaints FOR EACH ROW EXECUTE FUNCTION safevoice_audit_complaint()`)
  ).catch(err => console.error('Phase 3 audit trigger setup failed:', err.message));

  ensurePhase3().catch(err => console.error('Phase 3 database setup failed:', err.message));
}
