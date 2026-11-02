import { db } from '../server/hatchable.js';

export const access = 'user';
export const methods = ['GET', 'POST', 'DELETE'];

export default async function (req, res) {
  if (req.method === 'GET') {
    const result = await db.query(
      `SELECT f.track_id, t.title, t.album_name, t.album_art_url, t.release_date, t.artist_id, a.name AS artist_name
         FROM favourites f
         JOIN tracks t ON t.id = f.track_id
         JOIN artists a ON a.id = t.artist_id
        ORDER BY f.created_at DESC`
    );
    return res.json({ favourites: result.rows });
  }

  const track_id = parseInt(req.body.track_id, 10);
  if (!track_id) return res.status(400).json({ error: 'track_id is required.' });

  if (req.method === 'POST') {
    await db.query('INSERT INTO favourites (track_id) VALUES ($1) ON CONFLICT DO NOTHING', [track_id]);
    return res.status(201).json({ ok: true });
  }

  await db.query('DELETE FROM favourites WHERE track_id = $1', [track_id]);
  return res.status(204).send('');
}
