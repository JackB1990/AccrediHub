import { scheduler } from '../../server/hatchable.js';
import { backfillArtworkBatch, isConfigured, NOT_CONFIGURED_MESSAGE } from '../../lib/navidrome.js';

// Manual "Backfill art from Navidrome" trigger. Runs one batch now and lets a
// chained catch-up handle the rest.
export const access = 'user';
export const methods = ['POST'];

export default async function (req, res) {
  if (!(await isConfigured())) return res.status(412).json({ error: NOT_CONFIGURED_MESSAGE });
  try {
    const result = await backfillArtworkBatch();
    if (result.more) {
      await scheduler.at(new Date(Date.now() + 5_000), '/api/jobs/navidrome-artwork', { name: 'navidrome-artwork-catchup' });
    }
    return res.json(result);
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Could not reach Navidrome.' });
  }
}
