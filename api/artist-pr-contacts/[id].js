import { db } from '../../server/hatchable.js';

export const access = 'user';
export const methods = ['PUT', 'DELETE'];

export default async function (req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid link id.' });

  if (req.method === 'PUT') {
    const agency_id = parseInt(req.body.agency_id, 10);
    if (!agency_id) return res.status(400).json({ error: 'agency_id is required.' });
    const contact_id = req.body.contact_id ? parseInt(req.body.contact_id, 10) : null;
    const notes = req.body.notes ?? null;
    const result = await db.query(
      'UPDATE artist_pr_contacts SET agency_id = $1, contact_id = $2, notes = $3 WHERE id = $4 RETURNING *',
      [agency_id, contact_id, notes, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Link not found.' });
    return res.json({ link: result.rows[0] });
  }

  const result = await db.query('DELETE FROM artist_pr_contacts WHERE id = $1 RETURNING id', [id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Link not found.' });
  return res.status(204).send('');
}
