import { runMatchPhase } from '../../lib/navidrome.js';

// Fired the moment a full Navidrome library walk finishes.
export const access = 'scheduler';
export const methods = ['POST'];

export default async function (req, res) {
  const { seenAt } = req.body || {};
  const result = await runMatchPhase(seenAt);
  return res.json(result);
}
