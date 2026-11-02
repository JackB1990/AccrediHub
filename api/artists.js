import { db } from '../server/hatchable.js';

export const access = 'user';
export const methods = ['GET', 'POST'];

export default async function (req, res) {
  if (req.method === 'GET') {
    const q = (req.query.q || '').trim();
    const params = [];
    let where = '';
    if (q) { params.push(`%${q}%`); where = 'WHERE a.name ILIKE $1'; }
    const rows = (await db.query(
      `SELECT a.id, a.name, a.bio, a.photo_url, a.is_ai_artist, a.is_profile_complete,
              COUNT(DISTINCT t.id)::int AS track_count,
              COUNT(DISTINCT td.id)::int AS upcoming_tour_count
         FROM artists a
         LEFT JOIN tracks t ON t.artist_id = a.id
         LEFT JOIN tour_dates td ON td.artist_id = a.id AND td.event_date >= CURRENT_DATE
        ${where}
        GROUP BY a.id
        ORDER BY a.name COLLATE NOCASE ASC
        LIMIT ${q ? 500 : 1000}`,
      params
    )).rows;
    return res.json({ artists: rows });
  }

  // POST - create artist
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Artist name is required.' });
  const bio = req.body.bio || null;
  const photo_url = req.body.photo_url || null;

  const existing = await db.query('SELECT id FROM artists WHERE lower(name) = lower($1)', [name]);
  if (existing.rows.length) {
    return res.status(409).json({ error: 'An artist with that name already exists.', artist: existing.rows[0] });
  }

  const result = await db.query(
    'INSERT INTO artists (name, bio, photo_url) VALUES ($1, $2, $3) RETURNING id, name, bio, photo_url, created_at',
    [name, bio, photo_url]
  );
  return res.status(201).json({ artist: result.rows[0] });
}
