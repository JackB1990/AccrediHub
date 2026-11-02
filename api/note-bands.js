import { db } from '../server/hatchable.js';

export const access = 'user';
export const methods = ['GET'];

// Powers the band picker in the Playlist Builder's "Add show note" modal.
//   ?category=new_tour_announcement -> artists with a tour date added in the last 7 days
//   ?category=band_on_tour          -> artists with a tour date in the next 30 days
//   ?category=...&artist_id=123     -> { tour_dates } ALL of that artist's upcoming dates
const WINDOWS = {
  new_tour_announcement: `td.created_at >= now() - interval '7 days'`,
  band_on_tour: `td.event_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30`,
};

export default async function (req, res) {
  const category = req.query.category;
  const dateFilter = WINDOWS[category];
  if (!dateFilter) {
    return res.status(400).json({ error: 'category must be new_tour_announcement or band_on_tour.' });
  }

  const artistId = req.query.artist_id ? parseInt(req.query.artist_id, 10) : null;

  if (artistId) {
    const result = await db.query(
      `SELECT td.event_date, td.venue, td.city
         FROM tour_dates td
        WHERE td.artist_id = $1 AND td.event_date >= CURRENT_DATE
        ORDER BY td.event_date ASC`,
      [artistId]
    );
    return res.json({ tour_dates: result.rows });
  }

  const result = await db.query(
    `SELECT DISTINCT a.id, a.name
       FROM artists a
       JOIN tour_dates td ON td.artist_id = a.id
      WHERE ${dateFilter}
      ORDER BY a.name ASC`
  );
  return res.json({ artists: result.rows });
}
