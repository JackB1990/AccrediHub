import { scheduler } from '../../server/hatchable.js';
import { runSyncChunk } from '../../lib/navidrome.js';

// Hourly tick (started by the server). Walks the next chunk of the Navidrome
// library into the local cache and re-arms itself shortly after while there is
// more left to walk. When the whole library has been walked, matching runs.
export const access = 'scheduler';
export const methods = ['POST'];

export default async function (req, res) {
  const result = await runSyncChunk();
  if (result.more) {
    await scheduler.at(new Date(Date.now() + 5_000), '/api/jobs/navidrome-sync', { name: 'navidrome-sync-catchup' });
  }
  return res.json(result);
}
