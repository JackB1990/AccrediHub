import { db } from '../server/hatchable.js';
import { setTrackThemes, attachThemes } from '../lib/themes.js';
import { getBaseUrl, albumLinkFrom } from '../lib/navidrome.js';

export const access = 'user';
export const methods = ['GET', 'POST'];

export default async function (req, res) {
  if (req.method === 'GET') {
    const q = (req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    // Curated tracks come first, then tracks auto-added from Navidrome
    // (navidrome_only), each group newest-first - so the cursor is a
    // "<flag>:<id>" pair. A bare number means flag 0.
    let cursor = null;
    if (req.query.cursor) {
      const m = /^(?:([01]):)?(\d+)$/.exec(String(req.query.cursor));
      if (m) cursor = { flag: m[1] === '1' ? 1 : 0, id: parseInt(m[2], 10) };
    }
    const themeIds = (req.query.theme_ids || '')
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n));

    const params = [];
    let where = '';
    if (q) {
      params.push(`%${q}%`);
      where = `WHERE (t.title ILIKE $${params.length} OR a.name ILIKE $${params.length} OR t.album_name ILIKE $${params.length})`;
    }
    if (cursor) {
      params.push(cursor.flag);
      params.push(cursor.id);
      where += (where ? ' AND ' : 'WHERE ') +
        `(t.navidrome_only > $${params.length - 1} OR (t.navidrome_only = $${params.length - 1} AND t.id < $${params.length}))`;
    }
    if (themeIds.length) {
      // Tracks carrying ALL of the selected themes - each extra theme tightens the search.
      where += (where ? ' AND ' : 'WHERE ') +
        `t.id IN (SELECT track_id FROM track_themes WHERE theme_id IN (${themeIds.join(',')})
                   GROUP BY track_id HAVING COUNT(DISTINCT theme_id) = ${new Set(themeIds).size})`;
    }
    const navidromeOnly = ['1', 'true'].includes((req.query.navidrome_only || '').toLowerCase());
    if (navidromeOnly) {
      where += (where ? ' AND ' : 'WHERE ') + 't.navidrome_song_id IS NOT NULL';
    }
    params.push(limit + 1);

    const sql = `
      SELECT t.id, t.title, t.album_name, t.album_art_url, t.release_date, t.artist_id, a.name AS artist_name, a.is_ai_artist,
             t.navidrome_song_id, t.navidrome_album_id, t.navidrome_only
        FROM tracks t
        JOIN artists a ON a.id = t.artist_id
        ${where}
       ORDER BY t.navidrome_only ASC, t.id DESC
       LIMIT $${params.length}`;

    const result = await db.query(sql, params);
    const rows = result.rows.slice(0, limit);
    const hasMore = result.rows.length > limit;
    const last = rows[rows.length - 1];
    const nextCursor = hasMore ? `${last.navidrome_only ? 1 : 0}:${last.id}` : null;
    await attachThemes(rows);

    // Deep link into Navidrome for any track matched to a song there.
    const navidromeBaseUrl = await getBaseUrl();
    for (const t of rows) {
      t.navidrome_url = t.navidrome_song_id ? albumLinkFrom(navidromeBaseUrl, t.navidrome_album_id) : null;
    }

    return res.json({ tracks: rows, nextCursor });
  }

  // POST - create a track (looks up or creates the artist by name)
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Track title is required.' });

  let artist_id = req.body.artist_id ? parseInt(req.body.artist_id, 10) : null;
  const artist_name = (req.body.artist_name || '').trim();

  if (!artist_id) {
    if (!artist_name) return res.status(400).json({ error: 'artist_id or artist_name is required.' });
    const existing = await db.query('SELECT id FROM artists WHERE lower(name) = lower($1)', [artist_name]);
    if (existing.rows.length) {
      artist_id = existing.rows[0].id;
    } else {
      const created = await db.query('INSERT INTO artists (name) VALUES ($1) RETURNING id', [artist_name]);
      artist_id = created.rows[0].id;
    }
  }

  const album_name = (req.body.album_name || '').trim() || null;
  let album_art_url = (req.body.album_art_url || '').trim() || null;
  const release_date = req.body.release_date || null;

  // Album art is per-album: if this track brings none but siblings share its album, inherit theirs.
  if (!album_art_url && album_name) {
    const sibling = await db.query(
      `SELECT album_art_url FROM tracks
        WHERE artist_id = $1 AND lower(trim(album_name)) = lower(trim($2)) AND album_art_url IS NOT NULL
        LIMIT 1`,
      [artist_id, album_name]
    );
    if (sibling.rows.length) album_art_url = sibling.rows[0].album_art_url;
  }

  const result = await db.query(
    `INSERT INTO tracks (artist_id, title, album_name, album_art_url, release_date)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, artist_id, title, album_name, album_art_url, release_date, created_at`,
    [artist_id, title, album_name, album_art_url, release_date]
  );
  const track = result.rows[0];

  // Conversely, if this track DOES bring artwork, apply it to siblings in the same album.
  if (track.album_art_url && track.album_name) {
    await db.query(
      `UPDATE tracks SET album_art_url = $1, updated_at = now()
        WHERE artist_id = $2 AND id != $3
          AND lower(trim(album_name)) = lower(trim($4))
          AND album_art_url IS DISTINCT FROM $1`,
      [track.album_art_url, track.artist_id, track.id, track.album_name]
    );
  }

  track.themes = await setTrackThemes(track.id, req.body.themes);

  return res.status(201).json({ track });
}
