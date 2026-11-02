// Shared Navidrome (Subsonic API) integration.
//
// Auth: Subsonic accepts a hex-encoded plain password via `p=enc:<hex>`, which
// Navidrome fully supports. That avoids an MD5 implementation. The call is a
// server-to-server request to your own Navidrome instance.
//
// Matching strategy: rather than live-searching Navidrome per track, we walk
// the ENTIRE Navidrome library via the ID3 browsing endpoints (getArtists ->
// getArtist -> getAlbum) into a local `navidrome_library` cache table, then
// match every AccrediHub track against that cache in one pass. A walk can
// span several chunks; progress is persisted in `navidrome_sync_state` so it
// resumes correctly whatever triggers the next chunk.
import { db, config, scheduler, storage } from '../server/hatchable.js';
import crypto from 'node:crypto';

const API_VERSION = '1.16.1';
const CLIENT_ID = 'AccrediHub';
const ARTISTS_PER_CHUNK = 15; // how many artists' albums+songs to pull per chunk

export const NOT_CONFIGURED_MESSAGE =
  'Navidrome isn’t configured yet. Set NAVIDROME_URL, NAVIDROME_USERNAME and NAVIDROME_PASSWORD in your stack’s environment variables and redeploy.';

async function getCreds() {
  const [url, username, password] = await Promise.all([
    config.get('NAVIDROME_URL'),
    config.get('NAVIDROME_USERNAME'),
    config.get('NAVIDROME_PASSWORD'),
  ]);
  if (!url || !username || !password) return null;
  return { baseUrl: url.replace(/\/+$/, ''), username, password };
}

export async function isConfigured() {
  return !!(await getCreds());
}

function authParams(username, password) {
  const hexPass = Buffer.from(password, 'utf8').toString('hex');
  return { u: username, p: `enc:${hexPass}`, v: API_VERSION, c: CLIENT_ID, f: 'json' };
}

async function call(endpoint, extraParams = {}) {
  const creds = await getCreds();
  if (!creds) {
    const e = new Error('Navidrome is not configured.');
    e.code = 'SetupRequired';
    throw e;
  }
  const params = { ...authParams(creds.username, creds.password), ...extraParams };
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${creds.baseUrl}/rest/${endpoint}?${qs}`, { timeout_ms: 15000 });
  if (!r.ok) throw new Error(`Navidrome upstream returned ${r.status}`);
  const data = await r.json();
  const root = data['subsonic-response'];
  if (!root || root.status !== 'ok') {
    throw new Error(root?.error?.message || 'Unknown Navidrome error');
  }
  return root;
}

export async function ping() {
  await call('ping.view');
  return true;
}

// getCoverArt.view returns raw image bytes, not the JSON envelope.
async function fetchCoverArt(coverArtId, size = 600) {
  const creds = await getCreds();
  if (!creds) {
    const e = new Error('Navidrome is not configured.');
    e.code = 'SetupRequired';
    throw e;
  }
  const params = { ...authParams(creds.username, creds.password), id: coverArtId, size };
  delete params.f; // we want the binary image
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${creds.baseUrl}/rest/getCoverArt.view?${qs}`, { timeout_ms: 15000 });
  if (!r.ok) throw new Error(`Navidrome upstream returned ${r.status}`);
  const contentType = r.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) throw new Error('No cover art available.');
  const buffer = Buffer.from(await r.arrayBuffer());
  return { buffer, contentType };
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

async function listArtists() {
  const root = await call('getArtists.view');
  const indexes = asArray(root.artists?.index);
  const artists = [];
  for (const idx of indexes) artists.push(...asArray(idx.artist));
  return artists;
}

async function listAlbumsForArtist(artistId) {
  const root = await call('getArtist.view', { id: artistId });
  return asArray(root.artist?.album);
}

async function listSongsForAlbum(albumId) {
  const root = await call('getAlbum.view', { id: albumId });
  return asArray(root.album?.song);
}

export async function playUrl(albumId) {
  if (!albumId) return null;
  const creds = await getCreds();
  if (!creds) return null;
  return `${creds.baseUrl}/app/#/album/${encodeURIComponent(albumId)}/show`;
}

// For call sites attaching a link to many rows at once.
export async function getBaseUrl() {
  const creds = await getCreds();
  return creds ? creds.baseUrl : null;
}

export function albumLinkFrom(baseUrl, albumId) {
  if (!baseUrl || !albumId) return null;
  return `${baseUrl}/app/#/album/${encodeURIComponent(albumId)}/show`;
}

// Comparison key for titles / artist names: accents folded, everything that
// isn't a letter or digit in ANY script collapsed to a space.
function norm(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// --- Sync-state persistence -------------------------------------------------

async function loadState() {
  const r = await db.query(
    'SELECT phase, artist_ids, artist_cursor, run_started_at FROM navidrome_sync_state WHERE id = 1'
  );
  const row = r.rows[0];
  if (!row) return { phase: 'idle', artistIds: [], cursor: 0, runStartedAt: null };
  return {
    phase: row.phase,
    artistIds: row.artist_ids || [],
    cursor: row.artist_cursor || 0,
    runStartedAt: row.run_started_at,
  };
}

async function beginWalk(artistIds) {
  await db.query(
    `UPDATE navidrome_sync_state
        SET phase = 'walking', artist_ids = $1, artist_cursor = 0, run_started_at = now()
      WHERE id = 1`,
    [JSON.stringify(artistIds)]
  );
}

async function advanceWalk(cursor) {
  await db.query('UPDATE navidrome_sync_state SET artist_cursor = $1 WHERE id = 1', [cursor]);
}

async function setPhase(phase) {
  await db.query('UPDATE navidrome_sync_state SET phase = $1 WHERE id = 1', [phase]);
}

async function completeWalk(result) {
  await db.query(
    `UPDATE navidrome_sync_state
        SET phase = 'idle', artist_ids = NULL, artist_cursor = 0,
            last_completed_at = now(), last_result = $1
      WHERE id = 1`,
    [JSON.stringify(result)]
  );
}

async function upsertSongs(songs, seenAt) {
  const CHUNK = 300;
  for (let i = 0; i < songs.length; i += CHUNK) {
    const slice = songs.slice(i, i + CHUNK);
    const statements = slice.map((song) => ({
      sql: `INSERT INTO navidrome_library (song_id, title, artist, artist_id, album_id, cover_art, last_seen_at, track_number, disc_number)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (song_id) DO UPDATE
              SET title = $2, artist = $3, artist_id = $4, album_id = $5, cover_art = $6, last_seen_at = $7,
                  track_number = $8, disc_number = $9`,
      params: [
        String(song.id),
        song.title || '',
        song.artist || '',
        song.artistId ? String(song.artistId) : null,
        song.albumId ? String(song.albumId) : null,
        song.coverArt ? String(song.coverArt) : null,
        seenAt,
        Number.isInteger(song.track) && song.track > 0 ? song.track : null,
        Number.isInteger(song.discNumber) && song.discNumber > 0 ? song.discNumber : null,
      ],
    }));
    await db.transaction(statements);
  }
}

// --- Matching ---------------------------------------------------------------

// Compares EVERY track against the full library cache (no network calls).
// Requires title AND artist to line up so a same-titled track by a different
// artist never gets falsely marked playable.
async function matchAllTracks() {
  const tracks = (
    await db.query(`SELECT t.id, t.title, a.name AS artist_name FROM tracks t JOIN artists a ON a.id = t.artist_id`)
  ).rows;
  const lib = (await db.query('SELECT song_id, title, artist, album_id, track_number, disc_number FROM navidrome_library')).rows;

  const byTitle = new Map();
  for (const s of lib) {
    const key = norm(s.title);
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(s);
  }
  const libNorm = lib.map((s) => ({ s, nt: norm(s.title) }));

  const statements = [];
  let matched = 0;
  for (const t of tracks) {
    const wantTitle = norm(t.title);
    let candidates = byTitle.get(wantTitle);
    if (!candidates || !candidates.length) {
      candidates = libNorm.filter((x) => x.nt.includes(wantTitle) || wantTitle.includes(x.nt)).map((x) => x.s);
    }
    const hit = candidates.find((s) => artistsCompatible(s.artist, t.artist_name));
    if (hit) {
      matched++;
      statements.push({
        sql: `UPDATE tracks SET navidrome_song_id = $1, navidrome_album_id = $2, navidrome_checked_at = now(),
                     track_number = COALESCE($4, track_number), disc_number = COALESCE($5, disc_number)
               WHERE id = $3`,
        params: [hit.song_id, hit.album_id, t.id, hit.track_number ?? null, hit.disc_number ?? null],
      });
    } else {
      statements.push({
        sql: 'UPDATE tracks SET navidrome_song_id = NULL, navidrome_album_id = NULL, navidrome_checked_at = now() WHERE id = $1',
        params: [t.id],
      });
    }
  }

  const CHUNK = 500;
  for (let i = 0; i < statements.length; i += CHUNK) {
    await db.transaction(statements.slice(i, i + CHUNK));
  }

  return { tracksChecked: tracks.length, matched, librarySongs: lib.length };
}

// --- Main entry point --------------------------------------------------------

// Advances the library walk by one chunk of artists (or starts a fresh walk
// if idle), and kicks off matching once the whole library has been walked.
// Safe to call repeatedly - from the hourly timer, a chained catch-up, or a
// manual "Sync Navidrome" click - it resumes wherever the saved state left off.
export async function runSyncChunk() {
  if (!(await isConfigured())) {
    return { skipped: true, reason: 'not_configured', phase: 'idle', more: false };
  }

  let state = await loadState();

  if (state.phase === 'matching') {
    return { skipped: false, phase: 'matching', more: false };
  }

  if (state.phase !== 'walking') {
    const artists = await listArtists();
    await beginWalk(artists.map((a) => a.id));
    state = await loadState();
  }

  const seenAt = state.runStartedAt || new Date().toISOString();
  const slice = state.artistIds.slice(state.cursor, state.cursor + ARTISTS_PER_CHUNK);

  const collected = [];
  for (const artistId of slice) {
    const albums = await listAlbumsForArtist(artistId);
    const albumSongLists = await Promise.all(albums.map((al) => listSongsForAlbum(al.id)));
    for (const songs of albumSongLists) collected.push(...songs);
  }
  await upsertSongs(collected, seenAt);
  const songsSeen = collected.length;

  const newCursor = state.cursor + slice.length;
  const artistsTotal = state.artistIds.length;

  if (newCursor < artistsTotal) {
    await advanceWalk(newCursor);
    return { skipped: false, phase: 'walking', artistsProcessed: newCursor, artistsTotal, songsSeenThisChunk: songsSeen, more: true };
  }

  // Whole library walked - hand off to the matching job.
  await setPhase('matching');
  const seenAtIso = seenAt instanceof Date ? seenAt.toISOString() : seenAt;
  try {
    await scheduler.now('/api/jobs/navidrome-match', { seenAt: seenAtIso });
  } catch (e) {
    console.error('navidrome-match could not be scheduled, running inline', { message: e.message });
    await runMatchPhase(seenAtIso);
    return { skipped: false, phase: 'idle', artistsProcessed: newCursor, artistsTotal, songsSeenThisChunk: songsSeen, more: false, matchedInline: true };
  }

  return { skipped: false, phase: 'matching', artistsProcessed: newCursor, artistsTotal, songsSeenThisChunk: songsSeen, more: false };
}

// Matching phase: drops library rows not seen in the walk that just finished
// (songs removed from Navidrome), matches every track against the full
// library, and flips the sync state back to idle.
export async function runMatchPhase(seenAtIso) {
  const seenAt = seenAtIso ? new Date(seenAtIso).toISOString() : new Date().toISOString();
  const purged = (
    await db.query('DELETE FROM navidrome_library WHERE last_seen_at < $1 RETURNING song_id', [seenAt])
  ).rows.length;
  const matchResult = await matchAllTracks();
  const result = { ...matchResult, purged, completedAt: new Date().toISOString() };
  await completeWalk(result);

  // Newly-matched tracks may now have artwork Navidrome can supply.
  try {
    await scheduler.now('/api/jobs/navidrome-artwork', {});
  } catch (e) {
    console.error('navidrome-artwork could not be scheduled', { message: e.message });
  }

  return result;
}

// --- Importing Navidrome-only songs -----------------------------------------

// Pages through every album (names + ids) so imported tracks get a real album_name.
async function listAllAlbums() {
  const albums = new Map(); // albumId -> name
  const PAGE = 500;
  for (let offset = 0; offset < 20000; offset += PAGE) {
    const root = await call('getAlbumList2.view', { type: 'alphabeticalByName', size: PAGE, offset });
    const page = asArray(root.albumList2?.album);
    for (const al of page) albums.set(String(al.id), al.name || al.title || null);
    if (page.length < PAGE) break;
  }
  return albums;
}

// Same artist if either spelling contains the other, either strictly or
// ignoring "the" / "&" / "and" differences.
function artistsCompatible(a, b) {
  for (const f of [norm, looseNorm]) {
    const x = f(a), y = f(b);
    if (x && y && (x === y || x.includes(y) || y.includes(x))) return true;
  }
  return false;
}

function looseNorm(s) {
  return norm(s).replace(/^the /, '').replace(/\band\b/g, ' ').replace(/\s+/g, ' ').trim();
}

// Compares the cached Navidrome library with AccrediHub and adds every song
// that has no counterpart as a track flagged navidrome_only (shown greyed out),
// creating artists that don't exist yet. Safe to re-run.
export async function importNavidromeOnlyTracks({ dryRun = false } = {}) {
  if (!(await isConfigured())) {
    return { skipped: true, reason: 'not_configured' };
  }

  const lib = (await db.query('SELECT song_id, title, artist, album_id, track_number, disc_number FROM navidrome_library')).rows;
  const tracks = (await db.query('SELECT t.title, a.name AS artist_name FROM tracks t JOIN artists a ON a.id = t.artist_id')).rows;
  const artists = (await db.query('SELECT id, name FROM artists')).rows;

  const srByTitle = new Map();
  // Also index each existing title with credit / edition tags removed
  // ("X (feat. Y)", "X - Remastered 2011", "X - Single Version"), so a plain
  // Navidrome "X" isn't re-imported as a duplicate. Live, acoustic, demo and
  // remix tags are deliberately NOT stripped - those are different recordings.
  const editionCore = (title) => norm(
    (title || '')
      .replace(/\s*[\(\[]\s*(feat\.?|ft\.?|featuring|with)\b[^\)\]]*[\)\]]/gi, ' ')
      .replace(/\s*[\(\[]\s*www\.[^\)\]]*[\)\]]/gi, ' ')
      .replace(/\s+-\s+(feat\.?|ft\.?|featuring)\b.*$/i, ' ')
      .replace(/\s+-\s+(\d{4} )?(remaster(ed)?|single version|main version|studio version|original mix|7"\s*(edit|single)|radio edit)\b.*$/i, ' ')
      .replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, ' ')
  );
  for (const t of tracks) {
    for (const k of new Set([norm(t.title), editionCore(t.title)])) {
      if (!k) continue;
      if (!srByTitle.has(k)) srByTitle.set(k, []);
      srByTitle.get(k).push(t);
    }
  }

  // Missing songs, de-duplicated on (title, artist).
  const missing = new Map();
  let skippedBlank = 0;
  for (const s of lib) {
    const nt = norm(s.title);
    if (!nt) { skippedBlank++; continue; }
    const cands = srByTitle.get(nt) || [];
    if (cands.some((t) => artistsCompatible(t.artist_name, s.artist))) continue;
    const key = nt + '||' + norm(s.artist);
    if (!missing.has(key)) missing.set(key, s);
  }
  const toAdd = [...missing.values()];

  // Resolve each song's artist: exact name, then a component of a multi-artist
  // credit ("A • B", "A & B", "A feat. B"), then ignoring "the"/"and"
  // differences; otherwise it's a new artist.
  const exact = new Map(artists.map((a) => [norm(a.name), a.id]));
  const loose = new Map(artists.map((a) => [looseNorm(a.name), a.id]));
  const resolveExisting = (name) => {
    const n = norm(name);
    if (exact.has(n)) return exact.get(n);
    const parts = (name || '').split(/\s*[•&]\s*|\s+feat\.?\s+|\s+ft\.?\s+/i).filter(Boolean);
    if (parts.length > 1) {
      for (const p of parts) if (exact.has(norm(p))) return exact.get(norm(p));
    }
    if (loose.has(looseNorm(name))) return loose.get(looseNorm(name));
    return null;
  };

  const newArtistNames = new Map(); // norm -> display name
  for (const s of toAdd) {
    if (resolveExisting(s.artist) == null) {
      const n = norm(s.artist);
      if (n && !newArtistNames.has(n)) newArtistNames.set(n, (s.artist || '').trim());
    }
  }
  const summary = {
    librarySongs: lib.length,
    missingSongs: toAdd.length,
    newArtists: newArtistNames.size,
    skippedBlank,
  };
  if (dryRun) return { dryRun: true, ...summary, sampleNewArtists: [...newArtistNames.values()].slice(0, 50) };

  for (const [n, display] of newArtistNames) {
    const r = await db.query(
      `INSERT INTO artists (name) VALUES ($1)
       ON CONFLICT (lower(name)) DO UPDATE SET name = artists.name
       RETURNING id`,
      [display]
    );
    exact.set(n, r.rows[0].id);
  }

  const albumNames = await listAllAlbums();

  const statements = [];
  let unresolved = 0;
  for (const s of toAdd) {
    const artistId = resolveExisting(s.artist) ?? exact.get(norm(s.artist));
    if (!artistId) { unresolved++; continue; }
    statements.push({
      sql: `INSERT INTO tracks (artist_id, title, album_name, navidrome_song_id, navidrome_album_id, navidrome_checked_at, navidrome_only, track_number, disc_number)
            VALUES ($1, $2, $3, $4, $5, now(), 1, $6, $7)`,
      params: [artistId, s.title.trim(), s.album_id ? (albumNames.get(String(s.album_id)) || null) : null, s.song_id, s.album_id || null, s.track_number ?? null, s.disc_number ?? null],
    });
  }

  const CHUNK = 300;
  for (let i = 0; i < statements.length; i += CHUNK) {
    await db.transaction(statements.slice(i, i + CHUNK));
  }

  return { ...summary, tracksAdded: statements.length, unresolved, albumsLookedUp: albumNames.size };
}

// --- Album art backfill ------------------------------------------------------

const ARTWORK_BATCH = 20;

// Pulls cover art from Navidrome for any track that's matched to a song there
// but still has no artwork. Art is per-album, so a fetched image is applied to
// every track sharing that artist + album name that's still missing art.
export async function backfillArtworkBatch(limit = ARTWORK_BATCH) {
  if (!(await isConfigured())) {
    return { skipped: true, reason: 'not_configured', processed: 0, applied: 0, more: false };
  }

  // One row per ALBUM (artist + album name); tracks with no album stay one row each.
  const rows = (
    await db.query(
      `SELECT MIN(t.id) AS id, t.artist_id, t.album_name, nl.cover_art
         FROM tracks t
         JOIN navidrome_library nl ON nl.song_id = t.navidrome_song_id
        WHERE t.album_art_url IS NULL
          AND t.navidrome_song_id IS NOT NULL
          AND nl.cover_art IS NOT NULL
        GROUP BY t.artist_id, COALESCE(lower(trim(t.album_name)), '#' || t.id)
        ORDER BY t.artist_id, MIN(t.id)
        LIMIT $1`,
      [limit]
    )
  ).rows;

  let applied = 0;
  for (const row of rows) {
    try {
      const { buffer, contentType } = await fetchCoverArt(row.cover_art);
      const ext = contentType.split('/')[1]?.split(/[;+]/)[0] || 'jpg';
      const key = `album/navidrome-${crypto.randomUUID()}.${ext}`;
      await storage.put(key, buffer, contentType);
      const url = await storage.urlPermanent(key);

      if (row.album_name) {
        await db.query(
          `UPDATE tracks SET album_art_url = $1, updated_at = now()
            WHERE artist_id = $2 AND lower(trim(album_name)) = lower(trim($3)) AND album_art_url IS NULL`,
          [url, row.artist_id, row.album_name]
        );
      } else {
        await db.query(
          'UPDATE tracks SET album_art_url = $1, updated_at = now() WHERE id = $2 AND album_art_url IS NULL',
          [url, row.id]
        );
      }
      applied++;
    } catch (e) {
      // Skip this one; it still has no album_art_url so it's retried next time.
    }
  }

  return { skipped: false, processed: rows.length, applied, more: rows.length === limit };
}

export async function getSyncStatus() {
  const r = await db.query(
    'SELECT phase, artist_cursor, artist_ids, last_completed_at, last_result FROM navidrome_sync_state WHERE id = 1'
  );
  const row = r.rows[0];
  if (!row) return { phase: 'idle' };
  return {
    phase: row.phase,
    artist_cursor: row.artist_cursor,
    artists_total: Array.isArray(row.artist_ids) ? row.artist_ids.length : 0,
    last_completed_at: row.last_completed_at,
    last_result: row.last_result,
  };
}
