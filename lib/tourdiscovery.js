// Finds upcoming tour dates for your artists and inserts any that aren't
// already in `tour_dates`.
//
// Sources: Bandsintown's Events API (needs BANDSINTOWN_APP_ID) and
// Ticketmaster's Discovery API (needs TICKETMASTER_API_KEY; filtered to GB
// music events whose performer matches the artist). Either can be configured
// on its own - the scan uses whichever are set.
//
// Progress is persisted in a single-row state table (`tour_discovery_state`)
// so a scan that spans several chunks resumes correctly.
import { db, config } from '../server/hatchable.js';

const ARTISTS_PER_CHUNK = 15;

// Once a scan completes successfully, don't start another until this long has passed.
const COOLDOWN_MS = 48 * 60 * 60 * 1000;

function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// A "successful" run is a completeScan() result with no `note` - paused runs
// always set `note` and never block a retry.
function computeCooldown(lastCompletedAt, lastResult) {
  if (!lastCompletedAt || !lastResult || lastResult.note) return { active: false, until: null };
  const until = new Date(lastCompletedAt).getTime() + COOLDOWN_MS;
  if (until > Date.now()) return { active: true, until: new Date(until).toISOString() };
  return { active: false, until: null };
}

// --- Bandsintown -------------------------------------------------------

async function getBandsintownAppId() {
  try { return (await config.get('BANDSINTOWN_APP_ID')) || null; } catch { return null; }
}

export async function isBandsintownConfigured() {
  return !!(await getBandsintownAppId());
}

function mapBandsintownEvent(e) {
  const date = (e?.datetime || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const venue = (e.venue && e.venue.name) || null;
  const city = (e.venue && e.venue.city) || null;
  const offers = Array.isArray(e.offers) ? e.offers : [];
  const ticket_url = (offers.find((o) => o.type === 'Tickets') || offers[0])?.url || e.url || null;
  return { event_date: date, venue, city, ticket_url, source: 'bandsintown' };
}

async function fetchBandsintownEvents(artistName) {
  const appId = await getBandsintownAppId();
  if (!appId) return [];
  try {
    const url = `https://rest.bandsintown.com/artists/${encodeURIComponent(artistName)}/events/?app_id=${encodeURIComponent(appId)}&date=upcoming`;
    const r = await fetch(url, { timeout_ms: 15000 });
    if (r.status === 404) return [];
    if (!r.ok) {
      console.error('bandsintown upstream error', { artistName, status: r.status });
      return [];
    }
    const events = await r.json();
    if (!Array.isArray(events)) return [];
    return events.map(mapBandsintownEvent).filter(Boolean);
  } catch (e) {
    console.error('bandsintown request failed', { artistName, message: e.message });
    return [];
  }
}

// --- Ticketmaster ------------------------------------------------------

async function getTicketmasterApiKey() {
  try { return (await config.get('TICKETMASTER_API_KEY')) || null; } catch { return null; }
}

export async function isTicketmasterConfigured() {
  return !!(await getTicketmasterApiKey());
}

function mapTicketmasterEvent(e) {
  const date = e?.dates?.start?.localDate;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const venueObj = e?._embedded?.venues?.[0];
  const venue = (venueObj && venueObj.name) || null;
  const city = (venueObj && venueObj.city && venueObj.city.name) || null;
  return { event_date: date, venue, city, ticket_url: e.url || null, source: 'ticketmaster' };
}

async function fetchTicketmasterEvents(artistName) {
  const apiKey = await getTicketmasterApiKey();
  if (!apiKey) return [];
  try {
    const url =
      `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${encodeURIComponent(apiKey)}` +
      `&keyword=${encodeURIComponent(artistName)}&classificationName=music&countryCode=GB&size=50`;
    const r = await fetch(url, { timeout_ms: 15000 });
    if (r.status === 404) return [];
    if (!r.ok) {
      console.error('ticketmaster upstream error', { artistName, status: r.status });
      return [];
    }
    const data = await r.json();
    const events = (data && data._embedded && data._embedded.events) || [];
    // Keyword search can surface loosely-related results, so only keep events
    // whose attraction (performer) name actually matches the artist.
    const wanted = norm(artistName);
    const matched = events.filter((e) => {
      const attractions = (e._embedded && e._embedded.attractions) || [];
      if (!attractions.length) return norm(e.name).includes(wanted);
      return attractions.some((a) => {
        const n = norm(a.name);
        return n === wanted || n.includes(wanted) || wanted.includes(n);
      });
    });
    return matched.map(mapTicketmasterEvent).filter(Boolean);
  } catch (e) {
    console.error('ticketmaster request failed', { artistName, message: e.message });
    return [];
  }
}

// --- Persisting results ----------------------------------------------------

async function insertNewDates(artistId, found) {
  if (!found.length) return 0;

  const existing = (
    await db.query(
      `SELECT event_date, lower(trim(coalesce(venue, ''))) AS venue_key, lower(trim(coalesce(city, ''))) AS city_key
         FROM tour_dates WHERE artist_id = $1`,
      [artistId]
    )
  ).rows;
  const existingKeys = new Set(existing.map((r) => `${r.event_date}::${r.venue_key}::${r.city_key}`));

  const toInsert = [];
  const seenThisRun = new Set();
  for (const f of found) {
    const key = `${f.event_date}::${norm(f.venue)}::${norm(f.city)}`;
    if (existingKeys.has(key) || seenThisRun.has(key)) continue;
    seenThisRun.add(key);
    toInsert.push(f);
  }
  if (!toInsert.length) return 0;

  await db.transaction(toInsert.map((f) => ({
    sql: `INSERT INTO tour_dates (artist_id, event_date, venue, city, ticket_url, status, source)
          VALUES ($1, $2, $3, $4, $5, 'new', $6)`,
    params: [artistId, f.event_date, f.venue, f.city, f.ticket_url, f.source],
  })));
  return toInsert.length;
}

// --- State persistence -----------------------------------------------------

async function loadState() {
  const r = await db.query(
    'SELECT phase, artist_ids, artist_cursor, found_so_far, run_started_at, last_completed_at, last_result FROM tour_discovery_state WHERE id = 1'
  );
  const row = r.rows[0];
  if (!row) return { phase: 'idle', artistIds: [], cursor: 0, foundSoFar: 0, runStartedAt: null, lastCompletedAt: null, lastResult: null };
  return {
    phase: row.phase,
    artistIds: row.artist_ids || [],
    cursor: row.artist_cursor || 0,
    foundSoFar: row.found_so_far || 0,
    runStartedAt: row.run_started_at,
    lastCompletedAt: row.last_completed_at,
    lastResult: row.last_result,
  };
}

async function beginScan(artistIds) {
  await db.query(
    `UPDATE tour_discovery_state
        SET phase = 'scanning', artist_ids = $1, artist_cursor = 0,
            found_so_far = 0, run_started_at = now()
      WHERE id = 1`,
    [JSON.stringify(artistIds)]
  );
}

async function advanceScan(cursor, foundSoFar) {
  await db.query('UPDATE tour_discovery_state SET artist_cursor = $1, found_so_far = $2 WHERE id = 1', [cursor, foundSoFar]);
}

async function completeScan(result) {
  await db.query(
    `UPDATE tour_discovery_state
        SET phase = 'idle', artist_ids = NULL, artist_cursor = 0, found_so_far = 0,
            last_completed_at = now(), last_result = $1
      WHERE id = 1`,
    [JSON.stringify(result)]
  );
}

export async function getDiscoveryStatus() {
  const r = await db.query(
    `SELECT phase, artist_cursor, found_so_far, artist_ids, last_completed_at, last_result
       FROM tour_discovery_state WHERE id = 1`
  );
  const row = r.rows[0] || { phase: 'idle' };
  row.artists_total = Array.isArray(row.artist_ids) ? row.artist_ids.length : 0;
  delete row.artist_ids;
  const [bandsintown, ticketmaster] = await Promise.all([isBandsintownConfigured(), isTicketmasterConfigured()]);
  row.bandsintown_configured = bandsintown;
  row.ticketmaster_configured = ticketmaster;
  const cooldown = computeCooldown(row.last_completed_at, row.last_result);
  row.cooldown_active = cooldown.active;
  row.cooldown_until = cooldown.until;
  return row;
}

// Advances the scan by one chunk of artists (or starts a fresh scan if idle).
export async function runDiscoveryChunk() {
  const [bandsintownConfiguredAtStart, ticketmasterConfiguredAtStart] = await Promise.all([
    isBandsintownConfigured(),
    isTicketmasterConfigured(),
  ]);
  if (!bandsintownConfiguredAtStart && !ticketmasterConfiguredAtStart) {
    const state0 = await loadState();
    if (state0.phase === 'scanning') {
      await completeScan({
        note: 'Paused: no data source is configured (BANDSINTOWN_APP_ID / TICKETMASTER_API_KEY).',
        totalFound: state0.foundSoFar,
        artistsScanned: state0.cursor,
      });
    }
    return {
      phase: 'idle', more: false, artistsProcessed: 0, artistsTotal: 0, foundThisChunk: 0,
      bandsintownConfigured: false, ticketmasterConfigured: false,
    };
  }

  let state = await loadState();

  if (state.phase !== 'scanning') {
    const cooldown = computeCooldown(state.lastCompletedAt, state.lastResult);
    if (cooldown.active) {
      return {
        phase: 'idle', more: false, onCooldown: true, cooldownUntil: cooldown.until,
        artistsProcessed: 0, artistsTotal: 0, foundThisChunk: 0,
        bandsintownConfigured: bandsintownConfiguredAtStart, ticketmasterConfigured: ticketmasterConfiguredAtStart,
      };
    }

    const artists = (await db.query('SELECT id FROM artists ORDER BY name ASC')).rows;
    if (!artists.length) {
      return { phase: 'idle', more: false, artistsProcessed: 0, artistsTotal: 0, foundThisChunk: 0 };
    }
    await beginScan(artists.map((a) => a.id));
    state = await loadState();
  }

  const slice = state.artistIds.slice(state.cursor, state.cursor + ARTISTS_PER_CHUNK);
  const ids = slice.map((n) => Number(n)).filter(Number.isInteger);
  const rows = ids.length
    ? (await db.query(`SELECT id, name FROM artists WHERE id IN (${ids.join(',')})`)).rows
    : [];
  const byId = new Map(rows.map((r) => [r.id, r.name]));

  let foundThisChunk = 0;
  for (const artistId of slice) {
    const name = byId.get(artistId);
    if (!name) continue;
    const [a, b] = await Promise.all([fetchBandsintownEvents(name), fetchTicketmasterEvents(name)]);
    foundThisChunk += await insertNewDates(artistId, [...a, ...b]);
  }

  const newCursor = state.cursor + slice.length;
  const artistsTotal = state.artistIds.length;
  const totalFoundSoFar = state.foundSoFar + foundThisChunk;
  const [bandsintownConfigured, ticketmasterConfigured] = await Promise.all([
    isBandsintownConfigured(),
    isTicketmasterConfigured(),
  ]);

  if (newCursor < artistsTotal) {
    await advanceScan(newCursor, totalFoundSoFar);
    return { phase: 'scanning', artistsProcessed: newCursor, artistsTotal, foundThisChunk, bandsintownConfigured, ticketmasterConfigured, more: true };
  }

  await completeScan({
    artistsScanned: artistsTotal,
    totalFound: totalFoundSoFar,
    bandsintownConfigured,
    ticketmasterConfigured,
    completedAt: new Date().toISOString(),
  });

  return {
    phase: 'idle', artistsProcessed: newCursor, artistsTotal, foundThisChunk, totalFound: totalFoundSoFar,
    bandsintownConfigured, ticketmasterConfigured, more: false,
  };
}
