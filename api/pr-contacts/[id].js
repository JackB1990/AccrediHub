import { db } from '../../server/hatchable.js';

export const access = 'user';
export const methods = ['PUT', 'DELETE'];

export default async function (req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid contact id.' });

  if (req.method === 'PUT') {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Contact name is required.' });
    const email = req.body.email ?? null;
    const phone = req.body.phone ?? null;
    const result = await db.query(
      'UPDATE pr_contacts SET name = $1, email = $2, phone = $3 WHERE id = $4 RETURNING *',
      [name, email, phone, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Contact not found.' });
    return res.json({ contact: result.rows[0] });
  }

  const result = await db.query('DELETE FROM pr_contacts WHERE id = $1 RETURNING id', [id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Contact not found.' });
  return res.status(204).send('');
}
