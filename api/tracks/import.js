import { db } from '../../server/hatchable.js';

// Bulk CSV import - the client parses the CSV and posts rows as JSON:
// { rows: [{ title, artist_name, album_name, album_art_url, release_date }, ...] }
//
// A "song" is identified by (artist, title), case-insensitive and trimmed. A row
// matching an existing track, or an earlier row in the same import, is counted
// as a duplicate rather than inserted twice.
export const access = 'user';
export const methods = ['POST'];

function parseReleaseDate(raw) {
  const release_date = (raw || '').trim() || null;
  if (!release_date) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(release_date)) return release_date;
  const parsed = new Date(release_date);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export default async function (req, res) {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'No rows provided.' });
  if (rows.length > 5000) return res.status(400).json({ error: 'Max 5000 rows per import.' });

  let created = 0;
  let duplicates = 0;
  let skipped = 0;
  const errors = [];

  const clean = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const title = (r.title || '').trim();
    const artistName = (r.artist_name || r.artist || '').trim();
    if (!title || !artistName) {
      skipped++;
      errors.push({ row: i + 1, error: 'Missing title or artist_name.' });
      continue;
    }
    clean.push({
      rowNum: i + 1,
      title,
      artistName,
      album_name: (r.album_name || r.album || '').trim() || null,
      album_art_url: (r.album_art_url || r.album_art || '').trim() || null,
      release_date: parseReleaseDate(r.release_date),
    });
  }

  if (!clean.length) return res.json({ created, duplicates, skipped, errors: errors.slice(0, 50) });

  try {
    // --- Resolve artists ---------------------------------------------
    const allArtists = (await db.query('SELECT id, lower(name) AS lname FROM artists')).rows;
    const artistIdByLower = new Map(allArtists.map((r) => [r.lname, r.id]));
    const missingNames = [...new Set(clean.map((r) => r.artistName))].filter((n) => !artistIdByLower.has(n.toLowerCase()));
    if (missingNames.length) {
      const results = await db.transaction(missingNames.map((n) => ({
        sql: 'INSERT INTO artists (name) VALUES ($1) ON CONFLICT (lower(name)) DO UPDATE SET name = artists.name RETURNING id, lower(name) AS lname',
        params: [n],
      })));
      for (const r of results) for (const row of r.rows) artistIdByLower.set(row.lname, row.id);
    }

    // --- Existing tracks, for duplicate detection --------------------
    const existingTracks = await db.query('SELECT artist_id, lower(title) AS ltitle FROM tracks');
    const existingKeys = new Set(existingTracks.rows.map((r) => r.artist_id + '::' + r.ltitle));

    const seenThisRun = new Set();
    const toInsert = [];
    for (const row of clean) {
      const artistId = artistIdByLower.get(row.artistName.toLowerCase());
      const key = artistId + '::' + row.title.toLowerCase();
      if (existingKeys.has(key) || seenThisRun.has(key)) { duplicates++; continue; }
      seenThisRun.add(key);
      toInsert.push({ artistId, ...row });
    }

    if (toInsert.length) {
      const CHUNK = 500;
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        await db.transaction(toInsert.slice(i, i + CHUNK).map((r) => ({
          sql: 'INSERT INTO tracks (artist_id, title, album_name, album_art_url, release_date) VALUES ($1, $2, $3, $4, $5)',
          params: [r.artistId, r.title, r.album_name, r.album_art_url, r.release_date],
        })));
      }
      created += toInsert.length;

      // Album art is per-album: if any track of an artist+album has artwork,
      // share it with every track of that album that lacks it.
      const touched = [...new Set(toInsert.filter((r) => r.album_name).map((r) => r.artistId))];
      for (let i = 0; i < touched.length; i += 200) {
        const ids = touched.slice(i, i + 200).map(Number).filter(Number.isInteger).join(',');
        const withArt = (await db.query(
          `SELECT artist_id, lower(trim(album_name)) AS akey, MIN(album_art_url) AS art_url
             FROM tracks
            WHERE artist_id IN (${ids}) AND album_name IS NOT NULL AND album_art_url IS NOT NULL
            GROUP BY artist_id, lower(trim(album_name))`
        )).rows;
        if (withArt.length) {
          await db.transaction(withArt.map((a) => ({
            sql: `UPDATE tracks SET album_art_url = $3, updated_at = now()
                   WHERE artist_id = $1 AND lower(trim(album_name)) = $2 AND album_art_url IS DISTINCT FROM $3`,
            params: [a.artist_id, a.akey, a.art_url],
          })));
        }
      }
    }
  } catch (e) {
    console.error('Import failed', e);
    return res.status(500).json({ error: 'Import failed.', detail: e.message });
  }

  return res.json({ created, duplicates, skipped, errors: errors.slice(0, 50) });
}
