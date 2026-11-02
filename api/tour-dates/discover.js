import { scheduler } from '../../server/hatchable.js';
import { runDiscoveryChunk, getDiscoveryStatus } from '../../lib/tourdiscovery.js';

// Manual "Find new tour dates" trigger. Runs one scan chunk now and chains
// itself until the whole artist list has been scanned.
export const access = 'user';
export const methods = ['POST', 'GET'];

export default async function (req, res) {
  if (req.method === 'GET') return res.json(await getDiscoveryStatus());

  try {
    const result = await runDiscoveryChunk();
    if (result.more) {
      await scheduler.at(new Date(Date.now() + 5_000), '/api/jobs/tour-discovery-scan', { name: 'tour-discovery-catchup' });
    }
    return res.json(result);
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Could not complete the scan.' });
  }
}
