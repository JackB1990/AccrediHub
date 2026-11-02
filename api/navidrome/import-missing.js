import { importNavidromeOnlyTracks, isConfigured, NOT_CONFIGURED_MESSAGE } from '../../lib/navidrome.js';

// Adds any song that only exists in Navidrome as a track flagged navidrome_only
// (shown greyed out). Send { "dry_run": true } to just get the counts.
export const access = 'user';
export const methods = ['POST'];

export default async function (req, res) {
  if (!(await isConfigured())) return res.status(412).json({ error: NOT_CONFIGURED_MESSAGE });
  try {
    const dryRun = !!(req.body && req.body.dry_run);
    const result = await importNavidromeOnlyTracks({ dryRun });
    return res.json(result);
  } catch (e) {
    console.error('import-missing failed', { message: e.message });
    return res.status(502).json({ error: e.message || 'Import failed.' });
  }
}
