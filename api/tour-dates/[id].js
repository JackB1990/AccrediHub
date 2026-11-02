import { db } from '../../server/hatchable.js';

export const access = 'user';
export const methods = ['PUT', 'DELETE'];

const VALID_STATUSES = new Set(['new', 'applied', 'awaiting', 'approved', 'denied']);

export default async function (req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid tour date id.' });

  if (req.method === 'PUT') {
    const event_date = (req.body.event_date || '').trim();
    if (!event_date) return res.status(400).json({ error: 'event_date is required.' });
    const venue = req.body.venue ?? null;
    const city = req.body.city ?? null;
    const ticket_url = req.body.ticket_url ?? null;
    // Only touch status when the caller sent a valid one.
    const status = VALID_STATUSES.has(req.body.status) ? req.body.status : null;
    const result = await db.query(
      `UPDATE tour_dates SET event_date = $1, venue = $2, city = $3, ticket_url = $4,
              status = COALESCE($5, status)
        WHERE id = $6 RETURNING *`,
      [event_date, venue, city, ticket_url, status, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Tour date not found.' });
    return res.json({ tour_date: result.rows[0] });
  }

  const result = await db.query('DELETE FROM tour_dates WHERE id = $1 RETURNING id', [id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Tour date not found.' });
  return res.status(204).send('');
}
