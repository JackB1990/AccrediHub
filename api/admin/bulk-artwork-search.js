// Look up album artwork for a batch of albums in a single request, reusing the
// same iTunes matching strategy as api/tracks/artwork-search.js.
//
// Body: { items: [{ artist_id, artist_name, album_name, title }] }
import { searchArtwork } from '../../lib/itunes.js';

export const access = 'user';
export const methods = ['POST'];

export default async function (req, res) {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'items array is required.' });
  if (items.length > 25) return res.status(400).json({ error: 'Max 25 items per request.' });

  // iTunes rate-limits bursts (429s): small delay between lookups + one retry.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const results = [];
  for (const item of items) {
    const { artist_id, artist_name, album_name, title } = item || {};
    let r;
    try {
      r = await searchArtwork({ title, artist: artist_name, album: album_name });
    } catch (err) {
      if (String(err?.message).includes('429')) {
        await sleep(2000);
        try {
          r = await searchArtwork({ title, artist: artist_name, album: album_name });
        } catch (err2) {
          r = { found: false, error: err2?.message || 'lookup failed' };
        }
      } else {
        r = { found: false, error: err?.message || 'lookup failed' };
      }
    }
    results.push({ artist_id, album_name, ...r });
    await sleep(400);
  }
  return res.json({ results });
}
