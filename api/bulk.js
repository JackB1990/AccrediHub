import { db } from '../server/hatchable.js';
import { normalizeThemeName } from '../lib/themes.js';

// Bulk upload / export of the whole library.
//
// POST /api/bulk  { section, rows }   - one section per request, client batches rows
//   sections: artists | tracks | tour_dates | pr_agencies | artist_pr
// GET  /api/bulk                      - full JSON bundle (same shape the uploader accepts)
//
// Everything is idempotent: existing records are matched by name / (artist,title) /
// (artist,date,venue) and counted as duplicates; blank fields on existing artists are filled in.
export const access = 'user';
export const methods = ['GET', 'POST'];

const s = (v) => (v == null ? '' : String(v)).trim();
const n = (v) => { const x = parseInt(v, 10); return Number.isFinite(x) ? x : null; };
const bool = (v) => (v === true || /^(1|true|yes|y)$/i.test(s(v)) ? 1 : 0);
function date(v) {
  v = s(v);
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
const STATUSES = ['new', 'applied', 'awaiting', 'approved', 'denied'];

async function artistMap() {
  const rows = (await db.query('SELECT id, lower(name) AS k FROM artists')).rows;
  return new Map(rows.map((r) => [r.k, r.id]));
}
async function ensureArtists(names, map, counters) {
  const missing = [...new Set(names.filter(Boolean))].filter((x) => !map.has(x.toLowerCase()));
  for (const name of missing) {
    const r = await db.query('INSERT INTO artists (name) VALUES ($1) ON CONFLICT (lower(name)) DO UPDATE SET name = artists.name RETURNING id', [name]);
    map.set(name.toLowerCase(), r.rows[0].id);
    if (counters) counters.autoArtists++;
  }
}

const handlers = {
  async artists(rows, out) {
    const map = await artistMap();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const name = s(r.name || r.artist_name || r.artist);
      if (!name) { out.skipped++; out.errors.push({ row: i + 1, error: 'Missing name.' }); continue; }
      const vals = [s(r.bio) || null, s(r.photo_url) || null, s(r.location) || null, n(r.year_formed), n(r.year_split)];
      const id = map.get(name.toLowerCase());
      if (id) {
        await db.query(
          `UPDATE artists SET bio = COALESCE(bio, $2), photo_url = COALESCE(photo_url, $3), location = COALESCE(location, $4),
             year_formed = COALESCE(year_formed, $5), year_split = COALESCE(year_split, $6),
             is_ai_artist = MAX(is_ai_artist, $7), is_profile_complete = MAX(is_profile_complete, $8), updated_at = now() WHERE id = $1`,
          [id, ...vals, bool(r.is_ai_artist), bool(r.is_profile_complete)]);
        out.duplicates++;
      } else {
        const c = await db.query(
          'INSERT INTO artists (name, bio, photo_url, location, year_formed, year_split, is_ai_artist, is_profile_complete) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
          [name, ...vals, bool(r.is_ai_artist), bool(r.is_profile_complete)]);
        map.set(name.toLowerCase(), c.rows[0].id);
        out.created++;
      }
    }
  },

  async tracks(rows, out) {
    const map = await artistMap();
    const clean = [];
    rows.forEach((r, i) => {
      r = r || {};
      const title = s(r.title), artist = s(r.artist_name || r.artist);
      if (!title || !artist) { out.skipped++; out.errors.push({ row: i + 1, error: 'Missing title or artist_name.' }); return; }
      let themes = r.themes;
      if (typeof themes === 'string') themes = themes.split(/[;|]/);
      clean.push({
        title, artist,
        album: s(r.album_name || r.album) || null,
        art: s(r.album_art_url || r.album_art) || null,
        release: date(r.release_date),
        tn: n(r.track_number), dn: n(r.disc_number),
        nsid: s(r.navidrome_song_id) || null, naid: s(r.navidrome_album_id) || null,
        themes: (Array.isArray(themes) ? themes : []).map(normalizeThemeName).filter(Boolean),
      });
    });
    await ensureArtists(clean.map((c) => c.artist), map, out);

    const existing = new Map();
    const artistIds = [...new Set(clean.map((c) => map.get(c.artist.toLowerCase())))].filter(Number.isInteger);
    for (let i = 0; i < artistIds.length; i += 300) {
      const rs = await db.query(`SELECT id, artist_id, lower(title) AS t FROM tracks WHERE artist_id IN (${artistIds.slice(i, i + 300).join(',')})`);
      for (const r of rs.rows) existing.set(r.artist_id + '::' + r.t, r.id);
    }

    const themeIds = new Map();
    const themeId = async (name) => {
      const k = name.toLowerCase();
      if (themeIds.has(k)) return themeIds.get(k);
      const r = await db.query('INSERT INTO themes (name) VALUES ($1) ON CONFLICT (lower(name)) DO UPDATE SET name = themes.name RETURNING id', [name]);
      themeIds.set(k, r.rows[0].id);
      return r.rows[0].id;
    };

    const ops = [];
    for (const c of clean) {
      const aid = map.get(c.artist.toLowerCase());
      const key = aid + '::' + c.title.toLowerCase();
      let tid = existing.get(key);
      if (tid) out.duplicates++;
      else {
        const r = await db.query(
          'INSERT INTO tracks (artist_id, title, album_name, album_art_url, release_date, track_number, disc_number, navidrome_song_id, navidrome_album_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
          [aid, c.title, c.album, c.art, c.release, c.tn, c.dn, c.nsid, c.naid]);
        tid = r.rows[0].id;
        existing.set(key, tid);
        out.created++;
      }
      for (const t of c.themes) {
        const thid = await themeId(t);
        ops.push({ sql: 'INSERT INTO track_themes (track_id, theme_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', params: [tid, thid] });
      }
    }
    if (ops.length) { await db.transaction(ops); out.themeLinks = (out.themeLinks || 0) + ops.length; }
  },

  async tour_dates(rows, out) {
    const map = await artistMap();
    const names = rows.map((r) => s(r && (r.artist_name || r.artist)));
    await ensureArtists(names, map, out);
    const seen = new Set((await db.query("SELECT artist_id, event_date, lower(coalesce(venue,'')) AS v FROM tour_dates")).rows
      .map((r) => r.artist_id + '::' + r.event_date + '::' + r.v));
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const artist = names[i], d = date(r.event_date || r.date);
      if (!artist || !d) { out.skipped++; out.errors.push({ row: i + 1, error: 'Missing artist_name or event_date.' }); continue; }
      const aid = map.get(artist.toLowerCase());
      const venue = s(r.venue) || null;
      const key = aid + '::' + d + '::' + (venue || '').toLowerCase();
      if (seen.has(key)) { out.duplicates++; continue; }
      seen.add(key);
      const status = STATUSES.includes(s(r.status)) ? s(r.status) : 'new';
      await db.query('INSERT INTO tour_dates (artist_id, event_date, venue, city, ticket_url, status, source) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [aid, d, venue, s(r.city) || null, s(r.ticket_url) || null, status, s(r.source) || null]);
      out.created++;
    }
  },

  async pr_agencies(rows, out) {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const company = s(r.company || r.name);
      if (!company) { out.skipped++; out.errors.push({ row: i + 1, error: 'Missing company.' }); continue; }
      let ag = (await db.query('SELECT id FROM pr_agencies WHERE lower(company) = lower($1)', [company])).rows[0];
      if (ag) out.duplicates++;
      else {
        ag = (await db.query('INSERT INTO pr_agencies (company, notes) VALUES ($1,$2) RETURNING id', [company, s(r.notes) || null])).rows[0];
        out.created++;
      }
      const contacts = Array.isArray(r.contacts) ? r.contacts : (s(r.contact_name) ? [{ name: r.contact_name, email: r.contact_email, phone: r.contact_phone }] : []);
      for (const c of contacts) {
        const name = s(c && c.name);
        if (!name) continue;
        await db.query('INSERT INTO pr_contacts (agency_id, name, email, phone) VALUES ($1,$2,$3,$4) ON CONFLICT (agency_id, lower(name)) DO NOTHING',
          [ag.id, name, s(c.email) || null, s(c.phone) || null]);
      }
    }
  },

  async artist_pr(rows, out) {
    const map = await artistMap();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const artist = s(r.artist_name || r.artist), company = s(r.agency || r.company);
      const aid = map.get(artist.toLowerCase());
      const ag = company ? (await db.query('SELECT id FROM pr_agencies WHERE lower(company) = lower($1)', [company])).rows[0] : null;
      if (!aid || !ag) { out.skipped++; out.errors.push({ row: i + 1, error: !aid ? 'Unknown artist "' + artist + '".' : 'Unknown agency "' + company + '".' }); continue; }
      let cid = null;
      if (s(r.contact)) cid = (await db.query('SELECT id FROM pr_contacts WHERE agency_id = $1 AND lower(name) = lower($2)', [ag.id, s(r.contact)])).rows[0]?.id ?? null;
      const dup = (await db.query('SELECT id FROM artist_pr_contacts WHERE artist_id = $1 AND agency_id = $2 AND contact_id IS $3', [aid, ag.id, cid])).rows[0];
      if (dup) { out.duplicates++; continue; }
      await db.query('INSERT INTO artist_pr_contacts (artist_id, agency_id, contact_id, notes) VALUES ($1,$2,$3,$4)', [aid, ag.id, cid, s(r.notes) || null]);
      out.created++;
    }
  },
};

export default async function (req, res) {
  if (req.method === 'GET') {
    const q = async (sql) => (await db.query(sql)).rows;
    const themes = await q('SELECT tt.track_id, t.name FROM track_themes tt JOIN themes t ON t.id = tt.theme_id');
    const byTrack = new Map();
    for (const r of themes) (byTrack.get(r.track_id) || byTrack.set(r.track_id, []).get(r.track_id)).push(r.name);
    const contacts = await q('SELECT agency_id, name, email, phone FROM pr_contacts ORDER BY id');
    const art = (u) => (u && !String(u).startsWith('data:') ? u : null);
    return res.json({
      accredihub_bundle: 1,
      exported_at: new Date().toISOString(),
      artists: (await q('SELECT name, bio, photo_url, location, year_formed, year_split, is_ai_artist, is_profile_complete FROM artists ORDER BY id'))
        .map((a) => ({ ...a, photo_url: art(a.photo_url) })),
      tracks: (await q('SELECT t.id, a.name AS artist_name, t.title, t.album_name, t.album_art_url, t.release_date, t.track_number, t.disc_number, t.navidrome_song_id, t.navidrome_album_id FROM tracks t JOIN artists a ON a.id = t.artist_id ORDER BY t.id'))
        .map(({ id, ...t }) => ({ ...t, album_art_url: art(t.album_art_url), themes: byTrack.get(id) || [] })),
      tour_dates: await q('SELECT a.name AS artist_name, d.event_date, d.venue, d.city, d.ticket_url, d.status, d.source FROM tour_dates d JOIN artists a ON a.id = d.artist_id ORDER BY d.id'),
      pr_agencies: (await q('SELECT id, company, notes FROM pr_agencies ORDER BY id'))
        .map(({ id, ...g }) => ({ ...g, contacts: contacts.filter((c) => c.agency_id === id).map(({ agency_id, ...c }) => c) })),
      artist_pr: await q('SELECT a.name AS artist_name, g.company AS agency, c.name AS contact, p.notes FROM artist_pr_contacts p JOIN artists a ON a.id = p.artist_id JOIN pr_agencies g ON g.id = p.agency_id LEFT JOIN pr_contacts c ON c.id = p.contact_id ORDER BY p.id'),
    });
  }

  const { section, rows } = req.body || {};
  if (!handlers[section]) return res.status(400).json({ error: 'Unknown section "' + section + '".' });
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'No rows provided.' });
  if (rows.length > 2000) return res.status(400).json({ error: 'Max 2000 rows per request.' });
  const out = { created: 0, duplicates: 0, skipped: 0, autoArtists: 0, errors: [] };
  try {
    await handlers[section](rows, out);
  } catch (e) {
    console.error('Bulk upload failed', e);
    return res.status(500).json({ error: 'Bulk upload failed: ' + e.message });
  }
  out.errors = out.errors.slice(0, 50);
  return res.json(out);
}
