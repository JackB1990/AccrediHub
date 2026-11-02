// Look up album artwork for a single track via Apple's public iTunes Search API.
import { searchArtwork } from '../../lib/itunes.js';

export const access = 'user';
export const methods = ['GET'];

export default async function (req, res) {
  const title = (req.query.title || '').trim().slice(0, 200);
  const artist = (req.query.artist || '').trim().slice(0, 200);
  const album = (req.query.album || '').trim().slice(0, 200);
  if (!title) return res.status(400).json({ error: 'title is required.' });

  try {
    const result = await searchArtwork({ title, artist, album });
    return res.json(result);
  } catch (err) {
    console.error('itunes search failed', { title, artist, album, message: err?.message });
    return res.status(502).json({ error: 'Artwork search service unavailable.' });
  }
}
