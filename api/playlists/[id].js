import { db } from '../../server/hatchable.js';

export const access = 'user';
export const methods = ['GET', 'PUT', 'DELETE'];

export default async function (req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid playlist id.' });

  if (req.method === 'GET') {
    const playlistRes = await db.query('SELECT * FROM playlists WHERE id = $1', [id]);
    const playlist = playlistRes.rows[0];
    if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });

    const itemsRes = await db.query(
      `SELECT pi.id, pi.position, pi.item_type, pi.note_title, pi.note_body, pi.category, pi.created_at,
              pi.track_id, t.title, t.album_name, t.album_art_url, t.release_date,
              a.id AS artist_id, a.name AS artist_name, a.is_ai_artist,
              (t.navidrome_song_id IS NOT NULL) AS on_navidrome,
              EXISTS(SELECT 1 FROM favourites f WHERE f.track_id = t.id) AS is_favourite,
              EXISTS(SELECT 1 FROM tour_dates td2 WHERE td2.artist_id = t.artist_id
                       AND td2.event_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) AS touring_soon,
              pi.artist_id AS note_artist_id, na.name AS note_artist_name
         FROM playlist_items pi
         LEFT JOIN tracks t ON t.id = pi.track_id
         LEFT JOIN artists a ON a.id = t.artist_id
         LEFT JOIN artists na ON na.id = pi.artist_id
        WHERE pi.playlist_id = $1
        ORDER BY pi.position ASC, pi.id ASC`,
      [id]
    );
    const items = itemsRes.rows;

    // Upcoming tour dates for the band a show-note is about.
    const noteArtistIds = [...new Set(items.filter((i) => i.note_artist_id).map((i) => Number(i.note_artist_id)))];
    const datesByArtist = new Map();
    if (noteArtistIds.length) {
      const td = await db.query(
        `SELECT artist_id, event_date, venue, city FROM tour_dates
          WHERE artist_id IN (${noteArtistIds.join(',')}) AND event_date >= CURRENT_DATE
          ORDER BY event_date ASC`
      );
      for (const r of td.rows) {
        if (!datesByArtist.has(r.artist_id)) datesByArtist.set(r.artist_id, []);
        datesByArtist.get(r.artist_id).push({ event_date: r.event_date, venue: r.venue, city: r.city });
      }
    }
    for (const it of items) it.note_tour_dates = it.note_artist_id ? (datesByArtist.get(it.note_artist_id) || []) : [];

    // Themes for each track (used by the builder's statistics).
    const trackIds = [...new Set(items.filter((i) => i.track_id).map((i) => Number(i.track_id)))];
    const themesByTrack = new Map();
    if (trackIds.length) {
      const tr = await db.query(
        `SELECT tt.track_id, th.id, th.name FROM track_themes tt JOIN themes th ON th.id = tt.theme_id
          WHERE tt.track_id IN (${trackIds.join(',')}) ORDER BY th.name ASC`
      );
      for (const r of tr.rows) {
        if (!themesByTrack.has(r.track_id)) themesByTrack.set(r.track_id, []);
        themesByTrack.get(r.track_id).push({ id: r.id, name: r.name });
      }
    }
    for (const it of items) it.themes = it.track_id ? (themesByTrack.get(it.track_id) || []) : [];

    return res.json({ playlist, items });
  }

  if (req.method === 'PUT') {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Playlist name is required.' });
    const show_date = req.body.show_date ?? null;
    const theme = req.body.theme ?? null;
    const result = await db.query(
      'UPDATE playlists SET name = $1, show_date = $2, theme = $3, updated_at = now() WHERE id = $4 RETURNING *',
      [name, show_date, theme, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Playlist not found.' });
    return res.json({ playlist: result.rows[0] });
  }

  const result = await db.query('DELETE FROM playlists WHERE id = $1 RETURNING id', [id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Playlist not found.' });
  return res.status(204).send('');
}
