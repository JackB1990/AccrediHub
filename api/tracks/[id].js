import { db } from '../../server/hatchable.js';
import { setTrackThemes, attachThemes } from '../../lib/themes.js';

export const access = 'user';
export const methods = ['GET', 'PUT', 'DELETE'];

export default async function (req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid track id.' });

  if (req.method === 'GET') {
    const result = await db.query(
      `SELECT t.*, a.name AS artist_name
         FROM tracks t JOIN artists a ON a.id = t.artist_id
        WHERE t.id = $1`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Track not found.' });
    const [track] = await attachThemes(result.rows);
    return res.json({ track });
  }

  if (req.method === 'PUT') {
    const title = (req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Track title is required.' });
    const album_name = (req.body.album_name ?? '').trim() || null;
    const album_art_url = (req.body.album_art_url ?? '').trim() || null;
    const release_date = req.body.release_date ?? null;
    const artist_id = req.body.artist_id ? parseInt(req.body.artist_id, 10) : null;

    const result = await db.query(
      // Editing a track adopts it, so a track auto-added from Navidrome stops being greyed out.
      `UPDATE tracks SET title = $1, album_name = $2, album_art_url = $3, release_date = $4,
              artist_id = COALESCE($5, artist_id), navidrome_only = 0, updated_at = now()
        WHERE id = $6 RETURNING *`,
      [title, album_name, album_art_url, release_date, artist_id, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Track not found.' });
    const track = result.rows[0];

    // Album art is per-album: apply this track's artwork to the rest of the album.
    if (track.album_art_url && track.album_name) {
      await db.query(
        `UPDATE tracks SET album_art_url = $1, updated_at = now()
          WHERE artist_id = $2 AND id != $3
            AND lower(trim(album_name)) = lower(trim($4))
            AND album_art_url IS DISTINCT FROM $1`,
        [track.album_art_url, track.artist_id, track.id, track.album_name]
      );
    }

    // req.body.themes, when present, is the full desired set of theme names for this track.
    if (req.body.themes !== undefined) {
      track.themes = await setTrackThemes(track.id, req.body.themes);
    } else {
      track.themes = (await attachThemes([track]))[0].themes;
    }

    return res.json({ track });
  }

  const result = await db.query('DELETE FROM tracks WHERE id = $1 RETURNING id', [id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Track not found.' });
  return res.status(204).send('');
}
