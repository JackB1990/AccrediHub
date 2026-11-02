// Tiny runtime layer that gives the app code a database (SQLite, built into
// Node 22), configuration (environment variables), file storage (a folder on
// disk) and a scheduler (in-process timers). It has no npm dependencies.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

// fetch() with the `timeout_ms` option the app code uses.
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (url, opts = {}) => {
  const { timeout_ms, ...rest } = opts || {};
  if (timeout_ms && !rest.signal) rest.signal = AbortSignal.timeout(timeout_ms);
  return nativeFetch(url, rest);
};

// ---------------------------------------------------------------- database
const sqlite = new DatabaseSync(path.join(DATA_DIR, 'accredihub.db'));
sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');

// Unicode-aware lower() (SQLite's own only handles A-Z) and ILIKE.
sqlite.function('lower', { deterministic: true }, (s) => (s == null ? null : String(s).toLowerCase()));
const likeCache = new Map();
sqlite.function('ilike', { deterministic: true }, (text, pattern) => {
  if (text == null || pattern == null) return null;
  let re = likeCache.get(pattern);
  if (!re) {
    const src = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
    re = new RegExp('^' + src + '$', 'isu');
    if (likeCache.size > 500) likeCache.clear();
    likeCache.set(pattern, re);
  }
  return re.test(String(text)) ? 1 : 0;
});

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

// Postgres-flavoured SQL (what the app was written in) -> SQLite.
function translate(sql) {
  return sql
    .replace(/\bCURRENT_DATE\s*\+\s*\$(\d+)(?:::int)?/gi, (m, n) => "date('now', '+' || ?" + n + " || ' day')")
    .replace(/\bCURRENT_DATE\s*\+\s*(\d+)/gi, "date('now', '+$1 day')")
    .replace(/\bCURRENT_DATE\b/gi, "date('now')")
    .replace(/\bnow\(\)\s*-\s*interval\s*'(\d+) days'/gi, "strftime('%Y-%m-%dT%H:%M:%fZ','now','-$1 days')")
    .replace(/\bnow\(\)/gi, NOW_SQL)
    .replace(/::(?:bigint|int|integer|text|date|timestamptz|timestamp|jsonb|json|numeric|boolean)(?:\[\])?/gi, '')
    .replace(/([\w.]+)\s+ILIKE\s+(\$\d+)/gi, 'ilike($1, $2)')
    .replace(/\$(\d+)/g, '?$1');
}

const BOOL_COL = /^(is_|has_)|^(touring_soon|navidrome_only|more)$/;
const JSON_COLS = new Set(['artist_ids', 'last_result']);

function bind(params = []) {
  return params.map((v) => {
    if (v === undefined) return null;
    if (v === true) return 1;
    if (v === false) return 0;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'bigint') return Number(v);
    if (Array.isArray(v) || (v && typeof v === 'object')) return JSON.stringify(v);
    return v;
  });
}

function shape(row) {
  const out = {};
  for (const k of Object.keys(row)) {
    let v = row[k];
    if (typeof v === 'number' && BOOL_COL.test(k) && (v === 0 || v === 1)) v = v === 1;
    else if (typeof v === 'string' && JSON_COLS.has(k)) { try { v = JSON.parse(v); } catch { /* leave as string */ } }
    out[k] = v;
  }
  return out;
}

const stmtCache = new Map();
function run(sql, params) {
  const text = translate(sql);
  let stmt = stmtCache.get(text);
  if (!stmt) {
    stmt = sqlite.prepare(text);
    if (stmtCache.size > 400) stmtCache.clear();
    stmtCache.set(text, stmt);
  }
  const rows = stmt.all(...bind(params));
  return { rows: rows.map(shape), rowCount: rows.length };
}

export const db = {
  async query(sql, params = []) { return run(sql, params); },
  async transaction(statements) {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((s) => run(s.sql, s.params || []));
      sqlite.exec('COMMIT');
      return results;
    } catch (e) {
      try { sqlite.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw e;
    }
  },
  exec(sql) { sqlite.exec(sql); },
};

// ------------------------------------------------------------------ config
export const config = {
  async get(name) {
    const v = process.env[name];
    return v === undefined || v === '' ? null : v;
  },
};

// ----------------------------------------------------------------- storage
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
export const storage = {
  async put(key, buffer /* , contentType */) {
    const file = path.join(DATA_DIR, 'uploads', key);
    if (!file.startsWith(path.join(DATA_DIR, 'uploads') + path.sep)) throw new Error('Bad storage key');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer);
  },
  async urlPermanent(key) { return '/uploads/' + key.split('/').map(encodeURIComponent).join('/'); },
  resolve(urlPath) {
    const rel = decodeURIComponent(urlPath.replace(/^\/uploads\//, ''));
    const file = path.join(DATA_DIR, 'uploads', rel);
    if (!file.startsWith(path.join(DATA_DIR, 'uploads') + path.sep) || !fs.existsSync(file)) return null;
    const ext = path.extname(file).slice(1).toLowerCase();
    return { file, type: MIME[ext] || 'application/octet-stream' };
  },
};

// --------------------------------------------------------------- scheduler
// "Run this API job soon / later". In-process only: if the container
// restarts, the hourly Navidrome sync simply resumes from its saved state.
let runner = null;
export function setJobRunner(fn) { runner = fn; }
const named = new Map();
async function fire(jobPath, body) {
  try { if (runner) await runner(jobPath, body || {}); }
  catch (e) { console.error('scheduled job failed', jobPath, e.message); }
}
export const scheduler = {
  async now(jobPath, body) { setImmediate(() => fire(jobPath, body)); },
  async at(when, jobPath, body) {
    const delay = Math.max(0, new Date(when).getTime() - Date.now());
    const name = body && body.name ? jobPath + '#' + body.name : null;
    if (name && named.has(name)) clearTimeout(named.get(name));
    const t = setTimeout(() => { if (name) named.delete(name); fire(jobPath, body); }, delay);
    t.unref?.();
    if (name) named.set(name, t);
  },
};

export { crypto };
