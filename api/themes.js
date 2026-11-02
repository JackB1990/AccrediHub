import { db } from '../server/hatchable.js';

// The reusable theme vocabulary - themes are created implicitly when typed
// onto a track (see lib/themes.js), so this is read-only.
export const access = 'user';
export const methods = ['GET'];

export default async function (req, res) {
  const result = await db.query('SELECT id, name FROM themes ORDER BY name ASC');
  return res.json({ themes: result.rows });
}
