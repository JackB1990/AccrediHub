import { db } from '../server/hatchable.js';
import { getBaseUrl, albumLinkFrom } from '../lib/navidrome.js';
import { attachThemes } from '../lib/themes.js';

// Feeds the playlist-builder page: partitions the library into
// New Releases / Touring Soon / Favourites / Artists (everything else),
// annotated with per-track last-played info so the UI can apply the
// "not played within N weeks" filter. Search covers title, artist, album and theme.
export const access = 'user';
export const methods = ['GET'];

export default async function (req, res) {
  const weeks = req.query.weeks ? parseFloat(req.query.weeks) : null; // exclude tracks played within this many weeks
  const q = (req.query.q || '').trim();
  const excludeIdsRaw = (req.query.exclude || '').trim();
  const excludeIds = excludeIdsRaw ? excludeIdsRaw.split(',').map(n => parseInt(n, 10)).filter(Boolean) : [];

  const params = [];
  let where = 'WHERE 1=1';
  if (q) {
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    where += ` AND (t.title ILIKE ${p} OR a.name ILIKE ${p} OR t.album_name ILIKE ${p}
      OR EXISTS (SELECT 1 FROM track_themes tt JOIN themes th ON th.id = tt.theme_id
                  WHERE tt.track_id = t.id AND th.name ILIKE ${p}))`;
  }
  if (excludeIds.length) {
    where += ` AND t.id NOT IN (${excludeIds.join(',')})`;
  }
  const navidromeOnly = ['1', 'true'].includes((req.query.navidrome_only || '').toLowerCase());
  if (navidromeOnly) {
    where += ' AND t.navidrome_song_id IS NOT NULL';
  }

  const sql = `
    SELECT t.id, t.title, t.album_name, t.album_art_url, t.release_date, t.artist_id, a.name AS artist_name, a.is_ai_artist,
           t.navidrome_song_id, t.navidrome_album_id, t.navidrome_only,
           EXISTS(SELECT 1 FROM favourites f WHERE f.track_id = t.id) AS is_favourite,
           EXISTS(
             SELECT 1 FROM tour_dates td
              WHERE td.artist_id = t.artist_id
                AND td.event_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
           ) AS touring_soon,
           (SELECT MAX(ph.played_at) FROM play_history ph WHERE ph.track_id = t.id) AS last_played_at
      FROM tracks t
      JOIN artists a ON a.id = t.artist_id
      ${where}
     ORDER BY t.navidrome_only ASC, t.release_date DESC, t.title ASC
     LIMIT 3000`;

  const result = await db.query(sql, params);
  let rows = result.rows;

  if (weeks !== null && !isNaN(weeks)) {
    const cutoff = Date.now() - weeks * 7 * 24 * 60 * 60 * 1000;
    rows = rows.filter(r => !r.last_played_at || new Date(r.last_played_at).getTime() < cutoff);
  }

  // One config read for the whole page; attach a deep link into Navidrome for matched tracks.
  const navidromeBaseUrl = await getBaseUrl();
  for (const r of rows) {
    r.navidrome_url = r.navidrome_song_id ? albumLinkFrom(navidromeBaseUrl, r.navidrome_album_id) : null;
  }

  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const sixtyDaysStr = sixtyDaysAgo.toISOString().slice(0, 10);

  const new_releases = [];
  const touring_soon = [];
  const favourites = [];
  const others = [];

  for (const r of rows) {
    const isNew = r.release_date && r.release_date >= sixtyDaysStr;
    let placed = false;
    if (isNew) { new_releases.push(r); placed = true; }
    if (r.touring_soon) { touring_soon.push(r); placed = true; }
    if (r.is_favourite) { favourites.push(r); placed = true; }
    if (!placed) others.push(r);
  }

  const othersOut = others.slice(0, q ? 1500 : 500);

  // Attach themes once for every distinct row we return.
  const uniq = new Map();
  for (const r of [...new_releases, ...touring_soon, ...favourites, ...othersOut]) uniq.set(r.id, r);
  await attachThemes([...uniq.values()]);

  return res.json({ new_releases, touring_soon, favourites, others: othersOut });
}
