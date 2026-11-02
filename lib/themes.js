import { db } from '../server/hatchable.js';

// Normalize a theme name for dedup/display: trim, collapse internal whitespace.
// Uniqueness across themes is enforced case-insensitively by the DB.
export function normalizeThemeName(raw) {
  return (raw || '').replace(/\s+/g, ' ').trim();
}

const intList = (ids) => ids.map((n) => Number(n)).filter(Number.isInteger).join(',');

// Replace the full set of themes attached to a track with exactly the given
// names, creating any that don't exist yet. Returns [{ id, name }] sorted by name.
export async function setTrackThemes(trackId, rawNames) {
  const names = [...new Set((Array.isArray(rawNames) ? rawNames : []).map(normalizeThemeName).filter(Boolean))];

  if (!names.length) {
    await db.query('DELETE FROM track_themes WHERE track_id = $1', [trackId]);
    return [];
  }

  const themeIds = [];
  for (const name of names) {
    const existing = await db.query('SELECT id FROM themes WHERE lower(name) = lower($1)', [name]);
    if (existing.rows.length) { themeIds.push(existing.rows[0].id); continue; }
    const created = await db.query('INSERT INTO themes (name) VALUES ($1) RETURNING id', [name]);
    themeIds.push(created.rows[0].id);
  }

  await db.query(`DELETE FROM track_themes WHERE track_id = $1 AND theme_id NOT IN (${intList(themeIds)})`, [trackId]);
  for (const themeId of themeIds) {
    await db.query('INSERT INTO track_themes (track_id, theme_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [trackId, themeId]);
  }

  const result = await db.query(
    `SELECT th.id, th.name FROM track_themes tt JOIN themes th ON th.id = tt.theme_id
      WHERE tt.track_id = $1 ORDER BY th.name ASC`,
    [trackId]
  );
  return result.rows;
}

// Attach a `themes` array to each row in `rows` (each must have `.id`),
// batched into as few queries as possible. Mutates and returns `rows`.
export async function attachThemes(rows) {
  if (!rows || !rows.length) return rows;
  const byTrack = new Map();
  const ids = [...new Set(rows.map((r) => r.id))];
  for (let i = 0; i < ids.length; i += 500) {
    const slice = ids.slice(i, i + 500);
    const result = await db.query(
      `SELECT tt.track_id, th.id, th.name FROM track_themes tt
         JOIN themes th ON th.id = tt.theme_id
        WHERE tt.track_id IN (${intList(slice)})
        ORDER BY th.name ASC`
    );
    for (const row of result.rows) {
      if (!byTrack.has(row.track_id)) byTrack.set(row.track_id, []);
      byTrack.get(row.track_id).push({ id: row.id, name: row.name });
    }
  }
  for (const r of rows) r.themes = byTrack.get(r.id) || [];
  return rows;
}
