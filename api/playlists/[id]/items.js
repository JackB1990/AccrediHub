import { db } from '../../../server/hatchable.js';

export const access = 'user';
export const methods = ['GET', 'POST', 'PUT', 'DELETE'];

const NOTE_CATEGORIES = ['new_tour_announcement', 'band_on_tour', 'news', 'competition', 'show_feature'];

export default async function (req, res) {
  const playlistId = parseInt(req.params.id, 10);
  if (!playlistId) return res.status(400).json({ error: 'Invalid playlist id.' });

  const owns = await db.query('SELECT id, show_date FROM playlists WHERE id = $1', [playlistId]);
  if (!owns.rows.length) return res.status(404).json({ error: 'Playlist not found.' });
  const playlist = owns.rows[0];

  if (req.method === 'GET') {
    const itemsRes = await db.query(
      `SELECT pi.id, pi.position, pi.item_type, pi.note_title, pi.note_body, pi.category, pi.artist_id,
              pi.track_id, t.title, t.album_name, t.album_art_url, t.release_date, a.name AS artist_name, a.is_ai_artist,
              na.name AS note_artist_name
         FROM playlist_items pi
         LEFT JOIN tracks t ON t.id = pi.track_id
         LEFT JOIN artists a ON a.id = t.artist_id
         LEFT JOIN artists na ON na.id = pi.artist_id
        WHERE pi.playlist_id = $1
        ORDER BY pi.position ASC, pi.id ASC`,
      [playlistId]
    );
    return res.json({ items: itemsRes.rows });
  }

  if (req.method === 'POST') {
    const item_type = req.body.item_type === 'note' ? 'note' : 'track';
    const maxPosRes = await db.query('SELECT COALESCE(MAX(position), -1) AS max_pos FROM playlist_items WHERE playlist_id = $1', [playlistId]);
    const position = maxPosRes.rows[0].max_pos + 1;

    if (item_type === 'track') {
      const track_id = parseInt(req.body.track_id, 10);
      if (!track_id) return res.status(400).json({ error: 'track_id is required for a track item.' });

      const inserted = await db.query(
        `INSERT INTO playlist_items (playlist_id, position, item_type, track_id)
         VALUES ($1, $2, 'track', $3) RETURNING id`,
        [playlistId, position, track_id]
      );

      // Auto-log a play: adding a track to a show playlist marks it played
      // (dated to the show date if set, otherwise now) for the recency filter.
      const playedAt = playlist.show_date || null;
      await db.query(
        `INSERT INTO play_history (track_id, playlist_id, played_at)
         VALUES ($1, $2, COALESCE($3, now()))`,
        [track_id, playlistId, playedAt]
      );

      return res.status(201).json({ id: inserted.rows[0].id });
    }

    // note item
    const note_title = (req.body.note_title || '').trim();
    const note_body = req.body.note_body || null;
    if (!note_title) return res.status(400).json({ error: 'note_title is required for a note item.' });
    const category = NOTE_CATEGORIES.includes(req.body.category) ? req.body.category : null;
    // artist_id links a New Tour Announcement / Band On Tour note to its band.
    const artist_id = (category === 'new_tour_announcement' || category === 'band_on_tour')
      ? (parseInt(req.body.artist_id, 10) || null)
      : null;

    const inserted = await db.query(
      `INSERT INTO playlist_items (playlist_id, position, item_type, note_title, note_body, category, artist_id)
       VALUES ($1, $2, 'note', $3, $4, $5, $6) RETURNING id`,
      [playlistId, position, note_title, note_body, category, artist_id]
    );
    return res.status(201).json({ id: inserted.rows[0].id });
  }

  if (req.method === 'PUT') {
    // Reorder: { order: [itemId, itemId, ...] } in the new display order.
    const order = Array.isArray(req.body.order) ? req.body.order : [];
    await db.transaction(order.map((itemId, i) => ({
      sql: 'UPDATE playlist_items SET position = $1 WHERE id = $2 AND playlist_id = $3',
      params: [i, parseInt(itemId, 10), playlistId],
    })));
    return res.json({ ok: true });
  }

  // DELETE - remove one item: { item_id }
  const item_id = parseInt(req.body.item_id, 10);
  if (!item_id) return res.status(400).json({ error: 'item_id is required.' });
  await db.query('DELETE FROM playlist_items WHERE id = $1 AND playlist_id = $2', [item_id, playlistId]);
  return res.status(204).send('');
}
