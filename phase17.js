export function registerPhase17({ app, pool }) {
  const makeCode = () => `HS3-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  app.post('/api/final-complaint', async (req, res) => {
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
        studentName: Boolean(studentName), category: Boolean(category),
        description: Boolean(description), urgency: Boolean(urgency),
        affectsOthers: Boolean(affectsOthers), destination
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

      // Send the same generic notification without exposing the student's name.
      const emailKey = destination === 'HIGHER_AUTHORITY'
        ? 'higher_notification_email'
        : 'notification_email';
      const setting = await pool.query('SELECT value FROM app_settings WHERE key=$1', [emailKey]);
      const to = setting.rowCount ? setting.rows[0].value : null;
      const apiKey = process.env.RESEND_API_KEY;
      const from = process.env.EMAIL_FROM || 'Hostel SafeVoice <onboarding@resend.dev>';

      if (to && apiKey) {
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from,
            to: [to],
            subject: `New Hostel SafeVoice complaint — ${complaintCode}`,
            text: [
              `A new Hostel SafeVoice complaint has been submitted to the ${destination === 'HIGHER_AUTHORITY' ? 'higher authority' : 'admin'}.`,
              '',
              `Complaint ID: ${complaintCode}`,
              `Category: ${category}`,
              `Urgency: ${urgency}`,
              `Location: ${location || 'Not specified'}`,
              `Affects other students: ${affectsOthers}`,
              '',
              'Description:',
              description,
              '',
              'Student identity is stored separately and is not included in this email.'
            ].join('\n')
          })
        }).catch(e => console.error('FINAL_COMPLAINT_EMAIL_ERROR', e.message));
      }

      console.log(`FINAL_COMPLAINT_CREATED ${complaintCode}`);
      return res.status(201).json({ complaintId: complaintCode, status: 'PENDING' });
    } catch (e) {
      console.error('FINAL_COMPLAINT_ERROR', e);
      return res.status(500).json({ error: 'Server could not save the complaint. Please try again.' });
    }
  });
}
