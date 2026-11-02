import { db } from '../server/hatchable.js';

export const access = 'user';
export const methods = ['GET', 'POST'];

export default async function (req, res) {
  if (req.method === 'GET') {
    const result = await db.query(
      `SELECT p.id, p.name, p.show_date, p.theme, p.created_at, p.updated_at,
              (SELECT COUNT(*) FROM playlist_items pi WHERE pi.playlist_id = p.id AND pi.item_type = 'track') AS track_count,
              (SELECT COUNT(*) FROM playlist_items pi WHERE pi.playlist_id = p.id AND pi.item_type = 'note') AS note_count
         FROM playlists p
        ORDER BY COALESCE(p.show_date, date(p.created_at)) DESC, p.created_at DESC`
    );
    return res.json({ playlists: result.rows });
  }

  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Playlist name is required.' });
  const show_date = req.body.show_date || null;
  const theme = req.body.theme || null;

  const result = await db.query(
    'INSERT INTO playlists (name, show_date, theme) VALUES ($1, $2, $3) RETURNING *',
    [name, show_date, theme]
  );
  return res.status(201).json({ playlist: result.rows[0] });
}
