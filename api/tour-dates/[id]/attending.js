import { db } from '../../../server/hatchable.js';

export const access = 'user';
export const methods = ['POST', 'DELETE'];

export default async function (req, res) {
  const tour_date_id = parseInt(req.params.id, 10);
  if (!tour_date_id) return res.status(400).json({ error: 'Invalid tour date id.' });

  if (req.method === 'POST') {
    await db.query(
      'INSERT INTO tour_attendance (tour_date_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [tour_date_id]
    );
    return res.status(201).json({ ok: true });
  }

  await db.query('DELETE FROM tour_attendance WHERE tour_date_id = $1', [tour_date_id]);
  return res.status(204).send('');
}
