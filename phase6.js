export function registerPhase6({ app, pool, requireAdmin, requireHigher }) {
  const CHECK_MS = 15 * 60 * 1000;

  const slaHours = `(CASE c.urgency
    WHEN 'तातडीची' THEN 4
    WHEN 'महत्त्वाची' THEN 24
    ELSE 72
  END)`;

  async function ensurePhase6() {
    for (let attempt = 1; attempt <= 20; attempt++) {
      try {
        await pool.query(`CREATE TABLE IF NOT EXISTS complaint_automation_events (
          id BIGSERIAL PRIMARY KEY,
          complaint_code TEXT NOT NULL REFERENCES complaints(complaint_code) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (complaint_code, event_type)
        )`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_automation_events_code ON complaint_automation_events(complaint_code, created_at DESC)`);
        return;
      } catch (err) {
        if (attempt === 20) throw err;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  async function getSetting(key) {
    const r = await pool.query('SELECT value FROM app_settings WHERE key=$1', [key]);
    return r.rowCount ? r.rows[0].value : null;
  }

  async function sendEmail(to, subject, text) {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM || 'Hostel SafeVoice <onboarding@resend.dev>';
    if (!to || !key) return false;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text })
    });
    if (!response.ok) throw new Error(`Email provider error ${response.status}`);
    return true;
  }

  async function recordEvent(code, eventType) {
    const r = await pool.query(
      `INSERT INTO complaint_automation_events(complaint_code,event_type)
       VALUES($1,$2) ON CONFLICT(complaint_code,event_type) DO NOTHING RETURNING id`,
      [code, eventType]
    );
    return r.rowCount > 0;
  }

  async function runAutomation() {
    const adminEmail = await getSetting('notification_email');
    const higherEmail = await getSetting('higher_notification_email');
    const r = await pool.query(`
      SELECT c.complaint_code,c.category,c.urgency,c.description,c.location,c.status,
             c.complaint_destination,c.created_at,
             EXTRACT(EPOCH FROM (NOW()-c.created_at))/3600.0 AS age_hours
      FROM complaints c
      WHERE c.status <> 'RESOLVED'
        AND c.complaint_destination IN ('ADMIN','ESCALATED')
        AND EXTRACT(EPOCH FROM (NOW()-c.created_at))/3600.0 >= ${slaHours}
      ORDER BY c.created_at ASC
      LIMIT 200
    `);

    for (const c of r.rows) {
      const overdueEvent = await recordEvent(c.complaint_code, 'SLA_OVERDUE_NOTICE');
      if (overdueEvent && adminEmail && c.complaint_destination === 'ADMIN') {
        await sendEmail(adminEmail, `SafeVoice SLA overdue — ${c.complaint_code}`, [
          'An anonymous Hostel SafeVoice complaint has passed its response SLA.',
          '', `Complaint ID: ${c.complaint_code}`, `Category: ${c.category}`, `Urgency: ${c.urgency}`,
          `Age: ${Number(c.age_hours).toFixed(1)} hours`, `Location: ${c.location || 'Not specified'}`,
          '', 'Please review and update the complaint status.'
        ].join('\n'));
      }

      const multiplier = c.urgency === 'तातडीची' ? 8 : c.urgency === 'महत्त्वाची' ? 48 : 144;
      if (Number(c.age_hours) >= multiplier && c.complaint_destination === 'ADMIN') {
        const escalationEvent = await recordEvent(c.complaint_code, 'AUTO_ESCALATED');
        if (escalationEvent) {
          await pool.query(
            `UPDATE complaints SET complaint_destination='ESCALATED', updated_at=NOW()
             WHERE complaint_code=$1 AND complaint_destination='ADMIN' AND status <> 'RESOLVED'`,
            [c.complaint_code]
          );
          if (higherEmail) {
            await sendEmail(higherEmail, `SafeVoice automatic escalation — ${c.complaint_code}`, [
              'An anonymous Hostel SafeVoice complaint has exceeded twice its response SLA and was automatically escalated.',
              '', `Complaint ID: ${c.complaint_code}`, `Category: ${c.category}`, `Urgency: ${c.urgency}`,
              `Age: ${Number(c.age_hours).toFixed(1)} hours`, `Location: ${c.location || 'Not specified'}`,
              '', 'Please review the complaint and provide instructions to the admin if required.'
            ].join('\n'));
          }
        }
      }
    }
  }

  app.get('/api/admin/automation', requireAdmin, async (_, res) => {
    const r = await pool.query(`SELECT COUNT(*) FILTER (WHERE event_type='SLA_OVERDUE_NOTICE')::int AS overdue_notices,
      COUNT(*) FILTER (WHERE event_type='AUTO_ESCALATED')::int AS automatic_escalations
      FROM complaint_automation_events`);
    res.json(r.rows[0]);
  });

  app.get('/api/higher/automation', requireHigher, async (_, res) => {
    const r = await pool.query(`SELECT COUNT(*) FILTER (WHERE event_type='SLA_OVERDUE_NOTICE')::int AS overdue_notices,
      COUNT(*) FILTER (WHERE event_type='AUTO_ESCALATED')::int AS automatic_escalations
      FROM complaint_automation_events`);
    res.json(r.rows[0]);
  });

  ensurePhase6().then(() => {
    runAutomation().catch(err => console.error('Phase 6 automation failed:', err.message));
    const timer = setInterval(() => runAutomation().catch(err => console.error('Phase 6 automation failed:', err.message)), CHECK_MS);
    timer.unref?.();
  }).catch(err => console.error('Phase 6 database setup failed:', err.message));
}
