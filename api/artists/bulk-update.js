import { db } from '../../server/hatchable.js';

// Bulk-enrich artists (bio/location/year_formed/year_split/photo_url) in one request.
export const access = 'user';
export const methods = ['POST'];

export default async function (req, res) {
  const rows = Array.isArray(req.body.artists) ? req.body.artists : [];
  if (!rows.length) return res.status(400).json({ error: 'artists array is required.' });

  const statements = [];
  for (const r of rows) {
    const id = parseInt(r.id, 10);
    if (!id) continue;
    // COALESCE onto the existing column: a null/omitted field never overwrites data already on the row.
    statements.push({
      sql: `UPDATE artists SET
              bio = COALESCE($2, bio),
              location = COALESCE($3, location),
              year_formed = COALESCE($4, year_formed),
              year_split = COALESCE($5, year_split),
              photo_url = COALESCE($6, photo_url),
              updated_at = now()
            WHERE id = $1 RETURNING id`,
      params: [
        id,
        r.bio || null,
        r.location || null,
        r.year_formed ? parseInt(r.year_formed, 10) : null,
        r.year_split ? parseInt(r.year_split, 10) : null,
        r.photo_url || null,
      ],
    });
  }

  if (!statements.length) return res.status(400).json({ error: 'No valid artist ids provided.' });
  const results = await db.transaction(statements);
  return res.json({ updated: results.reduce((n, r) => n + r.rows.length, 0) });
}
