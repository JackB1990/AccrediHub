import { scheduler } from '../../server/hatchable.js';
import { runSyncChunk, getSyncStatus, isConfigured, NOT_CONFIGURED_MESSAGE } from '../../lib/navidrome.js';

// Manual "Sync Navidrome now" trigger. Runs one walk chunk immediately and lets
// chained catch-ups carry the rest of the walk to completion.
export const access = 'user';
export const methods = ['POST', 'GET'];

export default async function (req, res) {
  if (req.method === 'GET') return res.json(await getSyncStatus());

  if (!(await isConfigured())) return res.status(412).json({ error: NOT_CONFIGURED_MESSAGE });
  try {
    const result = await runSyncChunk();
    if (result.more) {
      await scheduler.at(new Date(Date.now() + 5_000), '/api/jobs/navidrome-sync', { name: 'navidrome-sync-catchup' });
    }
    return res.json(result);
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Could not reach Navidrome.' });
  }
}
