import { scheduler } from '../../server/hatchable.js';
import { runDiscoveryChunk } from '../../lib/tourdiscovery.js';

// Chained catch-up run armed by api/tour-dates/discover.js until a full artist scan completes.
export const access = 'scheduler';
export const methods = ['POST'];

export default async function (req, res) {
  const result = await runDiscoveryChunk();
  if (result.more) {
    await scheduler.at(new Date(Date.now() + 5_000), '/api/jobs/tour-discovery-scan', { name: 'tour-discovery-catchup' });
  }
  return res.json(result);
}
