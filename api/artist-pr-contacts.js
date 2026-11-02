import { db } from '../server/hatchable.js';

export const access = 'user';
export const methods = ['POST'];

export default async function (req, res) {
  const artist_id = parseInt(req.body.artist_id, 10);
  const agency_id = parseInt(req.body.agency_id, 10);
  if (!artist_id) return res.status(400).json({ error: 'artist_id is required.' });
  if (!agency_id) return res.status(400).json({ error: 'agency_id is required.' });
  const contact_id = req.body.contact_id ? parseInt(req.body.contact_id, 10) : null;
  const notes = req.body.notes || null;

  const result = await db.query(
    `INSERT INTO artist_pr_contacts (artist_id, agency_id, contact_id, notes)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [artist_id, agency_id, contact_id, notes]
  );
  return res.status(201).json({ link: result.rows[0] });
}
