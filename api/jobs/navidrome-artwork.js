import { scheduler } from '../../server/hatchable.js';
import { backfillArtworkBatch } from '../../lib/navidrome.js';

// Fired right after a match pass completes; re-arms itself while there's a
// backlog of tracks matched to Navidrome that still have no artwork.
export const access = 'scheduler';
export const methods = ['POST'];

export default async function (req, res) {
  const result = await backfillArtworkBatch();
  if (result.more) {
    await scheduler.at(new Date(Date.now() + 5_000), '/api/jobs/navidrome-artwork', { name: 'navidrome-artwork-catchup' });
  }
  return res.json(result);
}
