// AccrediHub server: static pages + file-based /api routes + single-admin login.
// No npm dependencies - just Node 22+.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { db, DATA_DIR, setJobRunner, storage } from './hatchable.js';
import { parseMultipart } from './multipart.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const API_DIR = path.join(ROOT, 'api');
const PORT = parseInt(process.env.PORT || '3000', 10);
const SESSION_DAYS = 30;

// ------------------------------------------------------------- migrations
async function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const dir = path.join(ROOT, 'migrations');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    if (applied.has(f)) continue;
    console.log('Applying migration', f);
    db.exec('BEGIN');
    try {
      db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
      db.exec(`INSERT INTO schema_migrations (name, applied_at) VALUES ('${f}', '${new Date().toISOString()}')`);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}
// ------------------------------------------------------ credentials & session
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
function loadSecrets() {
  let password = process.env.ADMIN_PASSWORD;
  const pwFile = path.join(DATA_DIR, '.generated-admin-password');
  if (!password) {
    if (fs.existsSync(pwFile)) password = fs.readFileSync(pwFile, 'utf8').trim();
    else {
      password = crypto.randomBytes(9).toString('base64url');
      fs.writeFileSync(pwFile, password + '\n', { mode: 0o600 });
      console.log('\n==============================================================');
      console.log(' ADMIN_PASSWORD was not set, so one was generated for you:');
      console.log(`   username: ${ADMIN_USER}`);
      console.log(`   password: ${password}`);
      console.log(' Set ADMIN_PASSWORD in your stack to choose your own.');
      console.log('==============================================================\n');
    }
  }
  let secret = process.env.SESSION_SECRET;
  const secFile = path.join(DATA_DIR, '.session-secret');
  if (!secret) {
    if (fs.existsSync(secFile)) secret = fs.readFileSync(secFile, 'utf8').trim();
    else { secret = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(secFile, secret, { mode: 0o600 }); }
  }
  return { password, secret };
}
const { password: ADMIN_PASSWORD, secret: SESSION_SECRET } = loadSecrets();

const sign = (payload) => crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
function makeSession() {
  const payload = Buffer.from(JSON.stringify({ u: ADMIN_USER, v: sessionVersion, exp: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
  return payload + '.' + sign(payload);
}
function readSession(cookies) {
  const raw = cookies.tr_session;
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Date.now() || (data.v || 1) !== sessionVersion) return null;
    return { id: 'admin', email: data.u, name: data.u };
  } catch { return null; }
}
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---- stored password (set from the Profile page) and session version
let storedHash = null;      // "scrypt$salt$hash" or null -> fall back to ADMIN_PASSWORD env var
let sessionVersion = 1;     // bumped on password change, which signs out every other device
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`;
}
function verifyHash(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const a = crypto.scryptSync(String(pw), salt, 64);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function passwordOk(pw) { return storedHash ? verifyHash(pw, storedHash) : safeEqual(pw, ADMIN_PASSWORD); }
async function setSetting(key, value) {
  await db.query('INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, String(value)]);
}
async function loadAuthState() {
  if (process.env.RESET_ADMIN_PASSWORD === 'true') await db.query("DELETE FROM app_settings WHERE key = 'password_hash'");
  const rows = (await db.query('SELECT key, value FROM app_settings')).rows;
  storedHash = (rows.find((r) => r.key === 'password_hash') || {}).value || null;
  sessionVersion = parseInt((rows.find((r) => r.key === 'session_version') || {}).value || '1', 10);
}
async function withProfile(user) {
  if (!user) return null;
  const p = (await db.query('SELECT display_name, email, avatar_url FROM profile WHERE id = 1')).rows[0] || {};
  return { ...user, name: p.display_name || user.name, email: p.email || user.email, username: user.email, avatar_url: p.avatar_url || null };
}

// Slow down password guessing: 5 misses per IP in 10 minutes -> wait.
const failures = new Map();
function throttled(ip) {
  const f = failures.get(ip);
  return f && f.count >= 5 && Date.now() - f.last < 10 * 60 * 1000;
}

// -------------------------------------------------------------- API routes
const routes = [];
async function loadRoutes(dir, segs = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { await loadRoutes(full, [...segs, entry.name]); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const base = entry.name.slice(0, -3);
    const parts = [...segs, base];
    const mod = await import(pathToFileURL(full).href);
    routes.push({
      parts: parts.map((p) => (p.startsWith('[') ? { param: p.slice(1, -1) } : { lit: p })),
      mod, file: path.relative(ROOT, full),
    });
  }
  // literal segments before params so /artists/bulk-update beats /artists/:id
  routes.sort((a, b) => {
    for (let i = 0; i < Math.max(a.parts.length, b.parts.length); i++) {
      const x = a.parts[i], y = b.parts[i];
      if (!x || !y) return 0;
      if (!!x.lit !== !!y.lit) return x.lit ? -1 : 1;
    }
    return 0;
  });
}
function matchRoute(pathname) {
  const segs = pathname.replace(/^\/api\//, '').split('/').filter(Boolean).map(decodeURIComponent);
  for (const r of routes) {
    if (r.parts.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < segs.length; i++) {
      const p = r.parts[i];
      if (p.lit !== undefined) { if (p.lit !== segs[i]) { ok = false; break; } }
      else params[p.param] = segs[i];
    }
    if (ok) return { route: r, params };
  }
  return null;
}

function makeRes(nodeRes) {
  const res = {
    statusCode: 200, headers: {},
    status(n) { this.statusCode = n; return this; },
    set(k, v) { this.headers[k] = v; return this; },
    json(obj) {
      const body = JSON.stringify(obj);
      nodeRes.writeHead(this.statusCode, { 'Content-Type': 'application/json; charset=utf-8', ...this.headers });
      nodeRes.end(body);
    },
    send(body = '') {
      nodeRes.writeHead(this.statusCode, this.headers);
      nodeRes.end(body);
    },
  };
  return res;
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function readBody(req, limit = 40 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function handleApi(req, nodeRes, url) {
  const res = makeRes(nodeRes);
  const cookies = parseCookies(req.headers.cookie);
  const user = await withProfile(readSession(cookies));
  const secureCookie = process.env.COOKIE_SECURE === 'true' || req.headers['x-forwarded-proto'] === 'https';
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();

  // ---- auth endpoints
  if (url.pathname === '/api/auth/session') return res.json({ user });
  if (url.pathname === '/api/auth/logout') {
    res.set('Set-Cookie', `tr_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie ? '; Secure' : ''}`);
    return res.status(204).send('');
  }
  if (url.pathname === '/api/auth/login') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
    if (throttled(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    let body = {};
    try { body = JSON.parse((await readBody(req, 64 * 1024)).toString() || '{}'); } catch { /* empty */ }
    const ok = safeEqual(body.username || '', ADMIN_USER) & passwordOk(body.password || '');
    if (!ok) {
      const f = failures.get(ip) || { count: 0, last: 0 };
      failures.set(ip, { count: f.count + 1, last: Date.now() });
      await new Promise((r) => setTimeout(r, 600));
      return res.status(401).json({ error: 'Wrong username or password.' });
    }
    failures.delete(ip);
    res.set('Set-Cookie', `tr_session=${makeSession()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secureCookie ? '; Secure' : ''}`);
    return res.json({ user: await withProfile({ id: 'admin', email: ADMIN_USER, name: ADMIN_USER }) });
  }
  if (url.pathname === '/api/auth/password') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
    if (!user) return res.status(401).json({ error: 'Please sign in.' });
    if (throttled(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    let body = {};
    try { body = JSON.parse((await readBody(req, 64 * 1024)).toString() || '{}'); } catch { /* empty */ }
    if (!passwordOk(body.current_password || '')) {
      const f = failures.get(ip) || { count: 0, last: 0 };
      failures.set(ip, { count: f.count + 1, last: Date.now() });
      await new Promise((r) => setTimeout(r, 600));
      return res.status(400).json({ error: 'Current password is wrong.' });
    }
    const np = String(body.new_password || '');
    if (np.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    await setSetting('password_hash', hashPassword(np));
    storedHash = (await db.query("SELECT value FROM app_settings WHERE key = 'password_hash'")).rows[0].value;
    sessionVersion += 1;
    await setSetting('session_version', sessionVersion);
    failures.delete(ip);
    // keep this device signed in with a fresh session
    res.set('Set-Cookie', `tr_session=${makeSession()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secureCookie ? '; Secure' : ''}`);
    return res.json({ ok: true });
  }
  if (url.pathname === '/api/auth/signout-everywhere') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
    if (!user) return res.status(401).json({ error: 'Please sign in.' });
    sessionVersion += 1;
    await setSetting('session_version', sessionVersion);
    res.set('Set-Cookie', `tr_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie ? '; Secure' : ''}`);
    return res.json({ ok: true });
  }
  if (url.pathname === '/api/health') return res.json({ ok: true });

  const hit = matchRoute(url.pathname);
  if (!hit) return res.status(404).json({ error: 'Not found.' });
  const { route, params } = hit;
  const methods = route.mod.methods || ['GET'];
  if (!methods.includes(req.method)) return res.status(405).json({ error: 'Method not allowed.' });
  if (route.mod.access !== 'public' && !user) return res.status(401).json({ error: 'Please sign in.' });

  let body = {}, files = [];
  if (!['GET', 'HEAD'].includes(req.method)) {
    const raw = await readBody(req);
    const ct = (req.headers['content-type'] || '').toLowerCase();
    if (ct.startsWith('multipart/form-data')) {
      const parsed = parseMultipart(raw, req.headers['content-type']);
      body = parsed.fields; files = parsed.files;
    } else if (raw.length && ct.includes('json')) {
      try { body = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'Invalid JSON body.' }); }
    } else if (raw.length && ct.includes('urlencoded')) {
      body = Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
    }
  }
  const query = {};
  for (const [k, v] of url.searchParams) query[k] = v;

  const request = { method: req.method, headers: req.headers, params, query, body, files, user, cookies, path: url.pathname };
  try {
    await route.mod.default(request, res);
  } catch (e) {
    console.error('Route error', route.file, e);
    if (!nodeRes.headersSent) res.status(500).json({ error: 'Something went wrong on the server.' });
  }
}

// In-process job runner used by the scheduler (and cron).
async function runJob(jobPath, body) {
  const hit = matchRoute(jobPath);
  if (!hit) throw new Error('Unknown job ' + jobPath);
  const out = { statusCode: 200, json() {}, send() {}, status(n) { this.statusCode = n; return this; }, set() { return this; } };
  await hit.route.mod.default({ method: 'POST', params: hit.params, query: {}, body, files: [], user: null, headers: {} }, out);
}
setJobRunner(runJob);

// -------------------------------------------------------------- static files
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp',
};
function serveStatic(req, nodeRes, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    nodeRes.writeHead(404, { 'Content-Type': 'text/plain' });
    return nodeRes.end('Not found');
  }
  nodeRes.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(nodeRes);
}

const server = http.createServer(async (req, nodeRes) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, nodeRes, url);
    if (url.pathname.startsWith('/uploads/')) {
      if (!readSession(parseCookies(req.headers.cookie))) { nodeRes.writeHead(401); return nodeRes.end('Sign in required'); }
      const f = storage.resolve(url.pathname);
      if (!f) { nodeRes.writeHead(404); return nodeRes.end('Not found'); }
      nodeRes.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'private, max-age=86400' });
      return fs.createReadStream(f.file).pipe(nodeRes);
    }
    return serveStatic(req, nodeRes, url);
  } catch (e) {
    console.error('Request error', e);
    if (!nodeRes.headersSent) nodeRes.writeHead(e.status || 500, { 'Content-Type': 'application/json' });
    nodeRes.end(JSON.stringify({ error: e.status === 413 ? 'Request too large.' : 'Something went wrong on the server.' }));
  }
});

// ----------------------------------------------------------- hourly Navidrome sync
function startCron() {
  const tick = async () => {
    try { await runJob('/api/jobs/navidrome-sync', {}); }
    catch (e) { console.error('Hourly Navidrome sync failed:', e.message); }
  };
  const msToNextHour = 3600e3 - (Date.now() % 3600e3);
  setTimeout(() => { tick(); setInterval(tick, 3600e3).unref?.(); }, msToNextHour).unref?.();
}

await migrate();
await loadAuthState();
await loadRoutes(API_DIR);
server.listen(PORT, () => {
  console.log(`AccrediHub running on http://0.0.0.0:${PORT}  (data: ${DATA_DIR})`);
  startCron();
});
