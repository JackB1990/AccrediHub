import { storage } from '../server/hatchable.js';
import crypto from 'node:crypto';

// Generic image upload for album art / artist photos.
// multipart/form-data: file field "file", optional field "kind" ("album"|"artist").
export const access = 'user';
export const methods = ['POST'];

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export default async function (req, res) {
  const file = (req.files || []).find((f) => f.field === 'file');
  if (!file) return res.status(400).json({ error: 'No file uploaded.' });
  if (file.buffer.length > MAX_BYTES) return res.status(413).json({ error: 'File too large (max 8 MB).' });
  if (!ALLOWED_MIMES.has(file.contentType)) return res.status(415).json({ error: 'Unsupported file type.' });

  const kind = (req.body.kind || 'image').replace(/[^a-z]/g, '') || 'image';
  const ext = ((file.filename.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'jpg';
  const key = `${kind}/${crypto.randomUUID()}.${ext}`;

  await storage.put(key, file.buffer, file.contentType);
  const url = await storage.urlPermanent(key);

  return res.status(201).json({ url, key });
}
