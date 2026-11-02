import { db } from '../../server/hatchable.js';

export const access = 'user';
export const methods = ['GET', 'PUT', 'DELETE'];

export default async function (req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid agency id.' });

  if (req.method === 'GET') {
    const agencyRows = (await db.query(
      'SELECT id, company, notes, created_at FROM pr_agencies WHERE id = $1', [id]
    )).rows;
    if (!agencyRows.length) return res.status(404).json({ error: 'Agency not found.' });
    const agency = agencyRows[0];

    agency.contacts = (await db.query(
      'SELECT id, agency_id, name, email, phone FROM pr_contacts WHERE agency_id = $1 ORDER BY name ASC',
      [id]
    )).rows;

    agency.artists = (await db.query(
      `SELECT apc.id, apc.artist_id, a.name AS artist_name, apc.agency_id,
              apc.contact_id, c.name AS contact_name, apc.notes
         FROM artist_pr_contacts apc
         JOIN artists a ON a.id = apc.artist_id
         LEFT JOIN pr_contacts c ON c.id = apc.contact_id
        WHERE apc.agency_id = $1
        ORDER BY a.name ASC`,
      [id]
    )).rows;

    return res.json({ agency });
  }

  if (req.method === 'PUT') {
    const company = (req.body.company || '').trim();
    if (!company) return res.status(400).json({ error: 'Company name is required.' });
    const notes = req.body.notes ?? null;
    const result = await db.query(
      'UPDATE pr_agencies SET company = $1, notes = $2 WHERE id = $3 RETURNING id, company, notes, created_at',
      [company, notes, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Agency not found.' });
    return res.json({ agency: result.rows[0] });
  }

  // DELETE - cascades to its contacts and artist links
  const result = await db.query('DELETE FROM pr_agencies WHERE id = $1 RETURNING id', [id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Agency not found.' });
  return res.status(204).send('');
}
