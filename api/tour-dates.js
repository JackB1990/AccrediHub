import { db } from '../server/hatchable.js';

export const access = 'user';
export const methods = ['GET', 'POST'];

const VALID_STATUSES = new Set(['new', 'applied', 'awaiting', 'approved', 'denied']);

export default async function (req, res) {
  if (req.method === 'GET') {
    const artist_id = req.query.artist_id ? parseInt(req.query.artist_id, 10) : null;
    const withinDays = req.query.within_days ? parseInt(req.query.within_days, 10) : null;
    const from = req.query.from || null;
    const to = req.query.to || null;
    const status = VALID_STATUSES.has(req.query.status) ? req.query.status : null;
    // Default is "upcoming only". `from` or `all=1` opts into past dates too.
    const includePast = req.query.all === '1' || !!from;

    const params = [];
    let where = includePast ? 'WHERE 1=1' : 'WHERE td.event_date >= CURRENT_DATE';
    if (artist_id) { params.push(artist_id); where += ` AND td.artist_id = $${params.length}`; }
    if (withinDays) { params.push(withinDays); where += ` AND td.event_date <= CURRENT_DATE + $${params.length}::int`; }
    if (from) { params.push(from); where += ` AND td.event_date >= $${params.length}`; }
    if (to) { params.push(to); where += ` AND td.event_date <= $${params.length}`; }
    if (status) { params.push(status); where += ` AND td.status = $${params.length}`; }

    const result = await db.query(
      `SELECT td.id, td.artist_id, a.name AS artist_name, a.photo_url AS artist_photo_url,
              td.event_date, td.venue, td.city, td.ticket_url, td.status,
              COUNT(ta.id)::int AS attendee_count
         FROM tour_dates td
         JOIN artists a ON a.id = td.artist_id
         LEFT JOIN tour_attendance ta ON ta.tour_date_id = td.id
         ${where}
        GROUP BY td.id, a.name, a.photo_url
        ORDER BY td.event_date ASC
        LIMIT 1000`,
      params
    );
    return res.json({ tour_dates: result.rows });
  }

  const artist_id = parseInt(req.body.artist_id, 10);
  const event_date = (req.body.event_date || '').trim();
  if (!artist_id || !event_date) return res.status(400).json({ error: 'artist_id and event_date are required.' });

  const venue = req.body.venue || null;
  const city = req.body.city || null;
  const ticket_url = req.body.ticket_url || null;
  const status = VALID_STATUSES.has(req.body.status) ? req.body.status : 'new';

  const result = await db.query(
    `INSERT INTO tour_dates (artist_id, event_date, venue, city, ticket_url, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [artist_id, event_date, venue, city, ticket_url, status]
  );
  return res.status(201).json({ tour_date: result.rows[0] });
}
