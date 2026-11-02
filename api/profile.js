import { db, config } from '../server/hatchable.js';

// Profile page data: editable details, library counts, and which integrations are configured.
export const access = 'user';
export const methods = ['GET', 'PUT'];

const clean = (v, max) => { const s = String(v ?? '').trim().slice(0, max); return s || null; };

async function load() {
  const profile = (await db.query('SELECT display_name, email, avatar_url, default_weeks FROM profile WHERE id = 1')).rows[0] || {};
  const count = async (t) => Number((await db.query(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n);
  const nd = (await db.query('SELECT COUNT(*) AS n FROM tracks WHERE navidrome_song_id IS NOT NULL')).rows[0].n;
  const [tracks, artists, playlists, tour_dates, themes] = await Promise.all(['tracks', 'artists', 'playlists', 'tour_dates', 'themes'].map(count));
  const has = async (k) => !!(await config.get(k));
  return {
    profile,
    stats: { tracks, artists, playlists, tour_dates, themes, on_navidrome: Number(nd) },
    integrations: {
      navidrome: (await has('NAVIDROME_URL')) && (await has('NAVIDROME_USERNAME')) && (await has('NAVIDROME_PASSWORD')),
      bandsintown: await has('BANDSINTOWN_APP_ID'),
      ticketmaster: await has('TICKETMASTER_API_KEY'),
    },
  };
}

export default async function (req, res) {
  if (req.method === 'PUT') {
    const b = req.body || {};
    const email = clean(b.email, 200);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'That email address doesn’t look right.' });
    let weeks = b.default_weeks === '' || b.default_weeks == null ? null : parseInt(b.default_weeks, 10);
    if (weeks != null && (!Number.isInteger(weeks) || weeks < 0 || weeks > 520)) return res.status(400).json({ error: 'Weeks must be between 0 and 520.' });
    await db.query(
      `UPDATE profile SET display_name = $1, email = $2, avatar_url = $3, default_weeks = $4, updated_at = now() WHERE id = 1`,
      [clean(b.display_name, 80), email, clean(b.avatar_url, 500), weeks || null]
    );
  }
  return res.json(await load());
}
