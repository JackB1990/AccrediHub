import { db } from '../../server/hatchable.js';
import { attachThemes } from '../../lib/themes.js';
import { getBaseUrl, albumLinkFrom } from '../../lib/navidrome.js';

export const access = 'user';
export const methods = ['GET', 'PUT', 'DELETE'];

export default async function (req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid artist id.' });

  if (req.method === 'GET') {
    const artistRes = await db.query('SELECT * FROM artists WHERE id = $1', [id]);
    const artist = artistRes.rows[0];
    if (!artist) return res.status(404).json({ error: 'Artist not found.' });

    const tracksRes = await db.query(
      `SELECT id, title, album_name, album_art_url, release_date, navidrome_song_id, navidrome_album_id, navidrome_only, track_number, disc_number
         FROM tracks
        WHERE artist_id = $1
        ORDER BY (album_name IS NULL), album_name ASC, release_date ASC NULLS LAST, title ASC`,
      [id]
    );
    await attachThemes(tracksRes.rows);
    // Deep link into Navidrome's own web UI for tracks matched to a song there.
    const navidromeBaseUrl = await getBaseUrl();
    for (const t of tracksRes.rows) {
      t.navidrome_url = t.navidrome_song_id ? albumLinkFrom(navidromeBaseUrl, t.navidrome_album_id) : null;
    }

    const tourRes = await db.query(
      `SELECT td.id, td.event_date, td.venue, td.city, td.ticket_url, td.status,
              COUNT(ta.id)::int AS attendee_count,
              COALESCE(MAX(CASE WHEN ta.user_id = $2 THEN 1 ELSE 0 END), 0) AS is_attending
         FROM tour_dates td
         LEFT JOIN tour_attendance ta ON ta.tour_date_id = td.id
        WHERE td.artist_id = $1 AND td.event_date >= CURRENT_DATE
        GROUP BY td.id
        ORDER BY td.event_date ASC`,
      [id, String(req.user.id)]
    );

    const prRes = await db.query(
      `SELECT apc.id, apc.agency_id, pa.company AS agency_company,
              apc.contact_id, pc.name AS contact_name, pc.email AS contact_email, pc.phone AS contact_phone,
              apc.notes
         FROM artist_pr_contacts apc
         JOIN pr_agencies pa ON pa.id = apc.agency_id
         LEFT JOIN pr_contacts pc ON pc.id = apc.contact_id
        WHERE apc.artist_id = $1
        ORDER BY pa.company ASC`,
      [id]
    );

    // Group tracks by album (normalized key: trimmed + lowercased). The shown
    // album name is whichever variant appears most often in the group. A track
    // with no album name is a single, never grouped with other singles.
    const albumsMap = new Map();
    const singles = [];
    for (const t of tracksRes.rows) {
      const raw = (t.album_name || '').trim();
      if (!raw) { singles.push(t); continue; }
      const key = raw.toLowerCase();
      if (!albumsMap.has(key)) albumsMap.set(key, { tracks: [], nameCounts: new Map() });
      const group = albumsMap.get(key);
      group.tracks.push(t);
      group.nameCounts.set(raw, (group.nameCounts.get(raw) || 0) + 1);
    }
    const albums = Array.from(albumsMap.values()).map(({ tracks, nameCounts }) => {
      const dates = tracks.map(t => t.release_date).filter(Boolean).sort();
      // Album order: disc, then track number; tracks without a number go last (by title).
      tracks.sort((a, b) =>
        (a.disc_number ?? 1) - (b.disc_number ?? 1) ||
        (a.track_number ?? 1e9) - (b.track_number ?? 1e9) ||
        a.title.localeCompare(b.title));
      const albumArt = tracks.find(t => t.album_art_url)?.album_art_url || null;
      const album_name = Array.from(nameCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];
      return { album_name, release_date: dates[0] || null, album_art_url: albumArt, multiDisc: tracks.some(t => (t.disc_number || 1) > 1), tracks };
    }).sort((a, b) => {
      if (!a.release_date && !b.release_date) return 0;
      if (!a.release_date) return 1;
      if (!b.release_date) return -1;
      return a.release_date < b.release_date ? 1 : -1; // newest album first
    });
    singles.sort((a, b) => {
      if (!a.release_date && !b.release_date) return 0;
      if (!a.release_date) return 1;
      if (!b.release_date) return -1;
      return a.release_date < b.release_date ? 1 : -1; // newest single first
    });

    return res.json({ artist, albums, singles, tour_dates: tourRes.rows, pr_contacts: prRes.rows });
  }

  if (req.method === 'PUT') {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Artist name is required.' });
    const bio = req.body.bio ?? null;
    const photo_url = req.body.photo_url ?? null;
    const location = req.body.location ?? null;
    const year_formed = req.body.year_formed ? parseInt(req.body.year_formed, 10) : null;
    const year_split = req.body.year_split ? parseInt(req.body.year_split, 10) : null;
    const is_ai_artist = !!req.body.is_ai_artist;
    const is_profile_complete = !!req.body.is_profile_complete;
    const result = await db.query(
      `UPDATE artists SET name = $1, bio = $2, photo_url = $3, location = $4,
              year_formed = $5, year_split = $6, is_ai_artist = $7, is_profile_complete = $8, updated_at = now()
        WHERE id = $9 RETURNING *`,
      [name, bio, photo_url, location, year_formed, year_split, is_ai_artist, is_profile_complete, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Artist not found.' });
    return res.json({ artist: result.rows[0] });
  }

  const result = await db.query('DELETE FROM artists WHERE id = $1 RETURNING id', [id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Artist not found.' });
  return res.status(204).send('');
}
