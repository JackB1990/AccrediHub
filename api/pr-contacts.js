import { db } from '../server/hatchable.js';

export const access = 'user';
export const methods = ['POST'];

export default async function (req, res) {
  const agency_id = parseInt(req.body.agency_id, 10);
  const name = (req.body.name || '').trim();
  if (!agency_id) return res.status(400).json({ error: 'agency_id is required.' });
  if (!name) return res.status(400).json({ error: 'Contact name is required.' });
  const email = req.body.email || null;
  const phone = req.body.phone || null;

  // Find-or-create within the agency, so re-saving the same named contact updates rather than duplicates.
  const existing = await db.query(
    'SELECT id FROM pr_contacts WHERE agency_id = $1 AND lower(name) = lower($2)',
    [agency_id, name]
  );
  if (existing.rows.length) {
    const result = await db.query(
      'UPDATE pr_contacts SET email = COALESCE($1, email), phone = COALESCE($2, phone) WHERE id = $3 RETURNING *',
      [email, phone, existing.rows[0].id]
    );
    return res.json({ contact: result.rows[0], existed: true });
  }
  const result = await db.query(
    'INSERT INTO pr_contacts (agency_id, name, email, phone) VALUES ($1, $2, $3, $4) RETURNING *',
    [agency_id, name, email, phone]
  );
  return res.status(201).json({ contact: result.rows[0] });
}
