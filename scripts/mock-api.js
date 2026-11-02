/* AccrediHub DEMO backend.
 * Replaces the server with an in-browser fake: every call the pages make to /api/*
 * is answered from sample data kept in localStorage. Nothing leaves your browser.
 */
(function () {
  const KEY = 'accredihub_demo_v1';
  const realFetch = window.fetch.bind(window);
  const DAY = 864e5;
  const iso = (off) => new Date(Date.now() + off * DAY).toISOString().slice(0, 10);
  const nowIso = (offDays = 0) => new Date(Date.now() + offDays * DAY).toISOString();
  const lc = (s) => String(s || '').toLowerCase();

  // ---------- generated artwork (no network needed)
  function hue(str) { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  function artSvg(label, round) {
    const h = hue(label), h2 = (h + 50) % 360;
    const ini = String(label).split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,45%)"/><stop offset="1" stop-color="hsl(${h2},75%,30%)"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><circle cx="100" cy="100" r="62" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="3"/><circle cx="100" cy="100" r="14" fill="rgba(0,0,0,.35)"/><text x="100" y="${round ? 118 : 172}" font-family="Arial,sans-serif" font-size="${round ? 56 : 26}" font-weight="700" fill="rgba(255,255,255,.9)" text-anchor="middle">${ini}</text></svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  // ---------- sample data
  function seed() {
    const db = { seq: 1000, artists: [], tracks: [], themes: [], trackThemes: [], favourites: [], tourDates: [], attending: [],
      agencies: [], contacts: [], links: [], playlists: [], items: [] };
    const id = () => ++db.seq;
    const artist = (name, extra = {}) => { const a = { id: id(), name, bio: '', photo_url: null, location: '', year_formed: null, year_split: null, is_ai_artist: false, is_profile_complete: false, ...extra }; db.artists.push(a); return a; };
    const theme = (name) => { let t = db.themes.find((x) => lc(x.name) === lc(name)); if (!t) { t = { id: id(), name }; db.themes.push(t); } return t; };
    let ndn = 0;
    const track = (a, title, o = {}) => {
      const onNd = o.nd !== false;
      const t = { id: id(), title, artist_id: a.id, album_name: o.album || null, album_art_url: o.album ? artSvg(o.album) : (o.art === false ? null : artSvg(title)),
        release_date: o.date || null, track_number: o.no || null, disc_number: o.disc || null,
        navidrome_song_id: onNd ? 'nd-' + (++ndn) : null, navidrome_url: onNd ? '#navidrome-demo' : null, navidrome_only: !!o.only, last_played: o.played || null };
      db.tracks.push(t);
      (o.themes || []).forEach((n) => db.trackThemes.push({ track_id: t.id, theme_id: theme(n).id }));
      return t;
    };

    const neon = artist('Neon Harbour', { bio: 'Synth-pop trio from Brighton with a weakness for 80s drum machines.', location: 'Brighton, UK', year_formed: 2016, photo_url: artSvg('Neon Harbour', true), is_profile_complete: true });
    const lantern = artist('The Lantern Keepers', { bio: 'Five-piece folk band telling small-town stories.', location: 'Leeds, UK', year_formed: 2011 });
    const velvet = artist('Velvet Static', { bio: 'Loud, fuzzy indie rock.', location: 'Manchester, UK', year_formed: 2019, photo_url: artSvg('Velvet Static', true) });
    const marlowe = artist('Marlowe & the Tides', { bio: 'Singer-songwriter Ellie Marlowe and her rotating cast of friends.', location: 'Cardiff, UK', year_formed: 2014, is_profile_complete: true });
    const orbit = artist('Orbit Cassette', { bio: 'AI-generated electronic project.', is_ai_artist: true, year_formed: 2024 });
    const juniper = artist('Juniper Hale', { bio: 'Quiet, careful folk songs.', location: 'Glasgow, UK', year_formed: 2018 });
    const paper = artist('Paper Satellites', { bio: 'Dreamy indie from the Midlands.', location: 'Nottingham, UK', year_formed: 2015, year_split: 2022 });
    const dusty = artist('Dusty Rooms', { bio: 'Garage-rock four-piece.', location: 'Bristol, UK', year_formed: 2020, photo_url: artSvg('Dusty Rooms', true) });

    // albums & singles (dates relative to today so "New Releases" always has content)
    const alb = (a, album, date, titles, themeSets) => titles.forEach((t, i) => track(a, t, { album, date, no: i + 1, themes: themeSets[i % themeSets.length], played: i === 0 ? iso(-90) : null }));
    alb(neon, 'Midnight Arcade', iso(-420), ['Last Train to Hove', 'Neon Rain', 'Static Hearts', 'Midnight Arcade'], [['Night drives', 'Nostalgia'], ['Rain'], ['Heartbreak'], ['Night drives']]);
    alb(neon, 'Golden Hour Machines', iso(-25), ['Sunset Protocol', 'Summer on Repeat', 'Candy Floss Skyline'], [['Summer'], ['Summer', 'Road trips'], ['Nostalgia']]);
    alb(lantern, 'Small Towns, Big Skies', iso(-700), ['Market Day', 'The Long Way Home', 'Chimney Smoke', 'Harvest Moon Rising', 'Rust and Rivers'], [['Growing up'], ['Road trips'], ['Nostalgia'], ['Love'], ['Rain', 'Heartbreak']]);
    alb(velvet, 'Feedback Loop', iso(-210), ['Overdrive', 'Fuzzbox Romance', 'Loud Enough'], [['Love'], ['Love', 'Heartbreak'], ['Protest']]);
    alb(marlowe, 'Tides', iso(-900), ['Salt on My Skin', 'Low Tide Lullaby', 'Harbour Lights'], [['Summer', 'Love'], ['Rain'], ['Night drives']]);
    alb(juniper, 'Wintering', iso(-55), ['First Frost', 'Wool and Wire', 'Bare Branches'], [['Rain', 'Nostalgia'], ['Growing up'], ['Heartbreak']]);
    alb(dusty, 'Basement Tapes Vol. 1', iso(-120), ['Rattle', 'Cheap Amp Blues'], [['Growing up'], ['Protest']]);
    // singles
    track(velvet, 'Static Summer', { date: iso(-9), themes: ['Summer'] });
    track(orbit, 'Signal From Europa', { date: iso(-14), themes: ['Space'] });
    track(orbit, 'Neural Sunrise', { date: iso(-200), themes: ['Space', 'Night drives'] });
    track(paper, 'Satellite Radio', { date: iso(-1500), themes: ['Nostalgia', 'Road trips'], played: iso(-20) });
    track(paper, 'Paper Planes at Dawn', { date: iso(-1500), themes: ['Growing up'], nd: false });
    track(marlowe, 'Rain Check (Demo)', { date: iso(-30), themes: ['Rain'], nd: false });
    track(juniper, 'Lantern in the Window', { date: iso(-5), themes: ['Love'] });
    track(dusty, 'Garage Door Sunrise', { date: iso(-3), themes: ['Summer'] });
    track(lantern, 'Wishing Well', { nd: true, only: true, art: false });          // greyed "in Navidrome only" example

    // favourites
    ['Neon Rain', 'The Long Way Home', 'Salt on My Skin', 'Signal From Europa'].forEach((t) => db.favourites.push(db.tracks.find((x) => x.title === t).id));

    // tour dates
    const td = (a, off, venue, city, status = 'new', createdOff = -30) => db.tourDates.push({ id: id(), artist_id: a.id, event_date: iso(off), venue, city, ticket_url: 'https://example.com/tickets', status, source: 'manual', created_at: nowIso(createdOff) });
    td(neon, 6, 'The Dome', 'Brighton', 'approved', -40); td(neon, 12, 'Roundhouse', 'London', 'new', -2); td(neon, 40, 'O2 Academy', 'Birmingham', 'applied', -2);
    td(lantern, 18, 'The Cluny', 'Newcastle', 'awaiting', -20); td(lantern, 19, 'Fruit', 'Hull', 'new', -20);
    td(velvet, 9, 'Gorilla', 'Manchester', 'new', -3); td(velvet, 70, 'Electric Ballroom', 'London', 'new', -3);
    td(marlowe, 25, 'Clwb Ifor Bach', 'Cardiff', 'approved', -50); td(juniper, 33, 'Sneaky Pete\'s', 'Edinburgh', 'denied', -10);
    td(dusty, -14, 'The Exchange', 'Bristol', 'approved', -60); td(dusty, 22, 'Rock City', 'Nottingham', 'new', -1);
    db.attending.push(db.tourDates[0].id);

    // PR
    const ag = (company, notes) => { const a = { id: id(), company, notes: notes || '' }; db.agencies.push(a); return a; };
    const ct = (agency, name, email, phone) => { const c = { id: id(), agency_id: agency.id, name, email, phone }; db.contacts.push(c); return c; };
    const light = ag('Lighthouse PR', 'Quick to reply, prefers email.'); const north = ag('Northbound Media', 'Handles most of the folk acts.');
    const sam = ct(light, 'Sam Rowe', 'sam@lighthouse.example', '+44 20 7946 0100'); ct(light, 'Priya Nair', 'priya@lighthouse.example', '');
    const jo = ct(north, 'Jo Kettle', 'jo@northbound.example', '+44 113 496 0000');
    db.links.push({ id: id(), artist_id: neon.id, agency_id: light.id, contact_id: sam.id, notes: '' });
    db.links.push({ id: id(), artist_id: velvet.id, agency_id: light.id, contact_id: null, notes: '' });
    db.links.push({ id: id(), artist_id: lantern.id, agency_id: north.id, contact_id: jo.id, notes: '' });
    db.links.push({ id: id(), artist_id: juniper.id, agency_id: north.id, contact_id: jo.id, notes: '' });

    // playlists
    const pl = (name, off, th) => { const p = { id: id(), name, show_date: iso(off), theme: th || '', created_at: nowIso() }; db.playlists.push(p); return p; };
    const it = (p, o) => db.items.push({ id: id(), playlist_id: p.id, position: db.items.filter((x) => x.playlist_id === p.id).length, ...o });
    const tid = (title) => db.tracks.find((x) => x.title === title).id;
    const p1 = pl('Friday Night Session', 3, 'Night drives');
    ['Last Train to Hove', 'Signal From Europa', 'Harbour Lights', 'Overdrive'].forEach((t) => it(p1, { item_type: 'track', track_id: tid(t) }));
    it(p1, { item_type: 'note', category: 'band_on_tour', note_title: 'Band On Tour — Neon Harbour', note_body: 'Mention the Brighton and London shows.', artist_id: neon.id });
    const p2 = pl('Autumn Warm-up', -10, 'Rain');
    ['Low Tide Lullaby', 'Rust and Rivers', 'First Frost', 'Satellite Radio', 'Neon Rain'].forEach((t) => it(p2, { item_type: 'track', track_id: tid(t) }));
    it(p2, { item_type: 'note', category: 'competition', note_title: 'Win tickets to Roundhouse', note_body: 'Text-in competition at 9pm.' });
    return db;
  }

  let db;
  try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { db = null; }
  if (!db || !db.tracks) db = seed();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* storage full / blocked */ } };
  const nextId = () => ++db.seq;

  // ---------- helpers that build the shapes the pages expect
  const artistOf = (id) => db.artists.find((a) => a.id === id) || {};
  const themesOf = (tid) => db.trackThemes.filter((x) => x.track_id === tid).map((x) => db.themes.find((t) => t.id === x.theme_id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const upcoming = (aid) => db.tourDates.filter((d) => d.artist_id === aid && d.event_date >= iso(0));
  const touringSoon = (aid) => db.tourDates.some((d) => d.artist_id === aid && d.event_date >= iso(0) && d.event_date <= iso(30));
  function shapeTrack(t) {
    const a = artistOf(t.artist_id);
    return { ...t, artist_name: a.name, is_ai_artist: !!a.is_ai_artist, themes: themesOf(t.id), is_favourite: db.favourites.includes(t.id),
      touring_soon: touringSoon(t.artist_id), on_navidrome: !!t.navidrome_song_id };
  }
  const shapeTour = (d) => { const a = artistOf(d.artist_id); return { ...d, artist_name: a.name, artist_photo_url: a.photo_url, attendee_count: db.attending.includes(d.id) ? 1 : 0, is_attending: db.attending.includes(d.id) }; };
  function findOrMakeArtist(name) {
    name = String(name || '').trim();
    let a = db.artists.find((x) => lc(x.name) === lc(name));
    if (!a) { a = { id: nextId(), name, bio: '', photo_url: null, location: '', year_formed: null, year_split: null, is_ai_artist: false, is_profile_complete: false }; db.artists.push(a); }
    return a;
  }
  function setThemes(tid, names) {
    db.trackThemes = db.trackThemes.filter((x) => x.track_id !== tid);
    [...new Set((names || []).map((n) => String(n).replace(/\s+/g, ' ').trim()).filter(Boolean))].forEach((n) => {
      let t = db.themes.find((x) => lc(x.name) === lc(n));
      if (!t) { t = { id: nextId(), name: n }; db.themes.push(t); }
      db.trackThemes.push({ track_id: tid, theme_id: t.id });
    });
  }
  function shapeAgency(ag) {
    const contacts = db.contacts.filter((c) => c.agency_id === ag.id);
    const artists = db.links.filter((l) => l.agency_id === ag.id).map((l) => ({ id: l.id, artist_id: l.artist_id, artist_name: artistOf(l.artist_id).name, contact_id: l.contact_id, contact_name: (db.contacts.find((c) => c.id === l.contact_id) || {}).name || null }));
    return { ...ag, contacts, artists };
  }
  function shapeItem(i) {
    if (i.item_type === 'track') {
      const t = db.tracks.find((x) => x.id === i.track_id); if (!t) return null;
      return { ...shapeTrack(t), id: i.id, track_id: t.id, item_type: 'track' };
    }
    const out = { id: i.id, item_type: 'note', category: i.category, note_title: i.note_title, note_body: i.note_body, artist_id: i.artist_id || null };
    if (i.artist_id && (i.category === 'band_on_tour' || i.category === 'new_tour_announcement')) out.note_tour_dates = upcoming(i.artist_id).map((d) => ({ event_date: d.event_date, venue: d.venue, city: d.city }));
    return out;
  }
  const orderedItems = (pid) => db.items.filter((i) => i.playlist_id === pid).sort((a, b) => a.position - b.position);

  // ---------- routes
  const R = [];
  const route = (method, re, fn) => R.push({ method, re: new RegExp('^' + re + '$'), fn });
  const ok = (data, status = 200) => ({ status, data });
  const err = (status, message) => ({ status, data: { error: message } });

  const prof = () => (db.profile = db.profile || { display_name: '', email: '', avatar_url: '', default_weeks: null });
  const sessionUser = () => ({ id: 'admin', username: 'admin', email: prof().email || 'admin', name: prof().display_name || 'admin', avatar_url: prof().avatar_url || null });
  route('GET', '/auth/session', () => ok({ user: sessionUser() }));
  route('POST', '/auth/login', () => ok({ user: sessionUser() }));
  route('POST', '/auth/logout', () => ({ status: 204 }));
  route('POST', '/auth/password', (q, b) => {
    if (!b.current_password) return err(400, 'Current password is wrong.');
    if (String(b.new_password || '').length < 8) return err(400, 'New password must be at least 8 characters.');
    return ok({ ok: true });   // demo only: nothing is stored
  });
  route('POST', '/auth/signout-everywhere', () => ok({ ok: true }));
  function profileData() {
    return { profile: { ...prof() }, stats: { tracks: db.tracks.length, artists: db.artists.length, playlists: db.playlists.length, tour_dates: db.tourDates.length, themes: db.themes.length, on_navidrome: db.tracks.filter((t) => t.navidrome_song_id).length },
      integrations: { navidrome: true, bandsintown: true, ticketmaster: false } };
  }
  route('GET', '/profile', () => ok(profileData()));
  route('PUT', '/profile', (q, b) => {
    const email = String(b.email || '').trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(400, 'That email address doesn’t look right.');
    Object.assign(prof(), { display_name: String(b.display_name || '').trim(), email, avatar_url: b.avatar_url || '', default_weeks: parseInt(b.default_weeks, 10) || null });
    save(); return ok(profileData());
  });

  route('GET', '/favourites', () => ok({ favourites: db.favourites.map((track_id) => ({ track_id })) }));
  route('POST', '/favourites', (q, b) => { if (!db.favourites.includes(b.track_id)) db.favourites.push(b.track_id); return ok({ ok: true }); });
  route('DELETE', '/favourites', (q, b) => { db.favourites = db.favourites.filter((x) => x !== b.track_id); return ok({ ok: true }); });
  route('GET', '/themes', () => ok({ themes: db.themes.slice().sort((a, b) => a.name.localeCompare(b.name)) }));

  route('POST', '/uploads', async (q, b) => {
    const f = b instanceof FormData ? b.get('file') : null;
    if (!f) return err(400, 'No file.');
    const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    return ok({ url });
  });

  // artists
  route('GET', '/artists', (q) => {
    let list = db.artists.slice();
    if (q.q) list = list.filter((a) => lc(a.name).includes(lc(q.q)));
    return ok({ artists: list.sort((a, b) => a.name.localeCompare(b.name)).map((a) => ({ ...a, track_count: db.tracks.filter((t) => t.artist_id === a.id).length, upcoming_tour_count: upcoming(a.id).length })) });
  });
  route('POST', '/artists', (q, b) => {
    if (!String(b.name || '').trim()) return err(400, 'Name is required.');
    if (db.artists.some((a) => lc(a.name) === lc(b.name))) return err(409, 'That artist already exists.');
    const a = findOrMakeArtist(b.name); a.bio = b.bio || ''; a.photo_url = b.photo_url || null; save(); return ok({ artist: a }, 201);
  });
  route('GET', '/artists/(\\d+)', (q, b, m) => {
    const a = db.artists.find((x) => x.id === +m[1]); if (!a) return err(404, 'Not found.');
    const tracks = db.tracks.filter((t) => t.artist_id === a.id).map(shapeTrack);
    const groups = new Map(); const singles = [];
    tracks.forEach((t) => { if (!t.album_name) singles.push(t); else { if (!groups.has(t.album_name)) groups.set(t.album_name, []); groups.get(t.album_name).push(t); } });
    const albums = [...groups.entries()].map(([album_name, ts]) => {
      ts.sort((x, y) => (x.disc_number || 1) - (y.disc_number || 1) || (x.track_number || 999) - (y.track_number || 999) || x.title.localeCompare(y.title));
      return { album_name, album_art_url: (ts.find((t) => t.album_art_url) || {}).album_art_url || null, release_date: ts.map((t) => t.release_date).filter(Boolean).sort()[0] || null, multiDisc: new Set(ts.map((t) => t.disc_number || 1)).size > 1, tracks: ts };
    }).sort((x, y) => String(y.release_date || '').localeCompare(String(x.release_date || '')));
    const pr = db.links.filter((l) => l.artist_id === a.id).map((l) => { const ag = db.agencies.find((x) => x.id === l.agency_id) || {}; const c = db.contacts.find((x) => x.id === l.contact_id) || {};
      return { id: l.id, agency_id: ag.id, agency_company: ag.company, contact_name: c.name || null, contact_email: c.email || null, contact_phone: c.phone || null, notes: l.notes || '' }; });
    return ok({ artist: a, albums, singles, tour_dates: upcoming(a.id).sort((x, y) => x.event_date.localeCompare(y.event_date)).map(shapeTour), pr_contacts: pr });
  });
  route('PUT', '/artists/(\\d+)', (q, b, m) => {
    const a = db.artists.find((x) => x.id === +m[1]); if (!a) return err(404, 'Not found.');
    ['name', 'bio', 'photo_url', 'location'].forEach((k) => { if (k in b) a[k] = b[k] || (k === 'name' ? a.name : null); });
    a.year_formed = b.year_formed ? +b.year_formed : null; a.year_split = b.year_split ? +b.year_split : null;
    a.is_ai_artist = !!b.is_ai_artist; a.is_profile_complete = !!b.is_profile_complete; save(); return ok({ artist: a });
  });
  route('DELETE', '/artists/(\\d+)', (q, b, m) => {
    const id = +m[1]; const tids = db.tracks.filter((t) => t.artist_id === id).map((t) => t.id);
    db.artists = db.artists.filter((a) => a.id !== id); db.tracks = db.tracks.filter((t) => t.artist_id !== id);
    db.trackThemes = db.trackThemes.filter((x) => !tids.includes(x.track_id)); db.favourites = db.favourites.filter((x) => !tids.includes(x));
    db.tourDates = db.tourDates.filter((d) => d.artist_id !== id); db.links = db.links.filter((l) => l.artist_id !== id);
    db.items = db.items.filter((i) => !(i.item_type === 'track' && tids.includes(i.track_id))); save(); return ok({ ok: true });
  });

  // tracks
  route('GET', '/tracks', (q) => {
    let list = db.tracks.map(shapeTrack);
    if (q.q) list = list.filter((t) => [t.title, t.artist_name, t.album_name].some((s) => lc(s).includes(lc(q.q))));
    if (q.theme_ids) { const ids = String(q.theme_ids).split(',').map(Number); list = list.filter((t) => t.themes.some((th) => ids.includes(th.id))); }
    if (q.navidrome_only) list = list.filter((t) => t.navidrome_song_id);
    list.sort((a, b) => a.artist_name.localeCompare(b.artist_name) || a.title.localeCompare(b.title));
    const limit = +q.limit || 50, start = +q.cursor || 0;
    const page = list.slice(start, start + limit);
    return ok({ tracks: page, nextCursor: start + limit < list.length ? start + limit : null });
  });
  function writeTrack(t, b) {
    t.title = String(b.title || '').trim(); const a = findOrMakeArtist(b.artist_name); t.artist_id = a.id;
    t.album_name = String(b.album_name || '').trim() || null; t.release_date = b.release_date || null;
    t.album_art_url = b.album_art_url || null; t.navidrome_only = false; setThemes(t.id, b.themes);
  }
  route('POST', '/tracks', (q, b) => {
    if (!String(b.title || '').trim() || !String(b.artist_name || '').trim()) return err(400, 'Title and artist are required.');
    const t = { id: nextId(), navidrome_song_id: null, navidrome_url: null, track_number: null, disc_number: null }; writeTrack(t, b); db.tracks.push(t); save(); return ok({ track: shapeTrack(t) }, 201);
  });
  route('POST', '/tracks/import', (q, b) => {
    let created = 0, duplicates = 0, skipped = 0; const errors = [];
    (b.rows || []).forEach((r, i) => {
      const title = (r.title || r.name || r.track_name || '').trim(), an = (r.artist_name || r.artist || '').trim();
      if (!title || !an) { skipped++; errors.push({ row: i, error: 'Missing title or artist' }); return; }
      const a = findOrMakeArtist(an);
      if (db.tracks.some((t) => t.artist_id === a.id && lc(t.title) === lc(title))) { duplicates++; return; }
      db.tracks.push({ id: nextId(), title, artist_id: a.id, album_name: r.album_name || null, album_art_url: r.album_art_url || null, release_date: r.release_date || null, navidrome_song_id: null, navidrome_url: null, navidrome_only: false, track_number: null, disc_number: null }); created++;
    });
    save(); return ok({ created, duplicates, skipped, errors });
  });
  route('POST', '/bulk', (q, b) => {
    const out = { created: 0, duplicates: 0, skipped: 0, autoArtists: 0, errors: [] };
    const st = (v) => String(v == null ? '' : v).trim();
    (b.rows || []).forEach((r, i) => {
      r = r || {};
      if (b.section === 'artists') {
        const name = st(r.name || r.artist_name); if (!name) { out.skipped++; return; }
        const ex = db.artists.find((a) => lc(a.name) === lc(name));
        if (ex) { out.duplicates++; ex.location = ex.location || r.location || ''; ex.year_formed = ex.year_formed || +r.year_formed || null; return; }
        db.artists.push({ id: nextId(), name, bio: r.bio || '', photo_url: r.photo_url || null, location: r.location || '', year_formed: +r.year_formed || null, year_split: +r.year_split || null, is_ai_artist: false, is_profile_complete: false }); out.created++;
      } else if (b.section === 'tracks') {
        const title = st(r.title), an = st(r.artist_name || r.artist); if (!title || !an) { out.skipped++; out.errors.push({ row: i + 1, error: 'Missing title or artist_name.' }); return; }
        const had = db.artists.some((a) => lc(a.name) === lc(an)); const a = findOrMakeArtist(an); if (!had) out.autoArtists++;
        let tr = db.tracks.find((x) => x.artist_id === a.id && lc(x.title) === lc(title));
        if (tr) out.duplicates++; else {
          tr = { id: nextId(), title, artist_id: a.id, album_name: r.album_name || null, album_art_url: r.album_art_url || null, release_date: r.release_date || null, navidrome_song_id: null, navidrome_url: null, navidrome_only: false, track_number: +r.track_number || null, disc_number: +r.disc_number || null };
          db.tracks.push(tr); out.created++;
        }
        const names = Array.isArray(r.themes) ? r.themes : String(r.themes || '').split(/[;|]/);
        names.map(st).filter(Boolean).forEach((n) => { let th = db.themes.find((x) => lc(x.name) === lc(n)); if (!th) { th = { id: nextId(), name: n }; db.themes.push(th); } if (!db.trackThemes.some((x) => x.track_id === tr.id && x.theme_id === th.id)) db.trackThemes.push({ track_id: tr.id, theme_id: th.id }); });
      } else if (b.section === 'tour_dates') {
        const an = st(r.artist_name || r.artist), d = st(r.event_date).slice(0, 10); if (!an || !d) { out.skipped++; return; }
        const a = findOrMakeArtist(an);
        if (db.tourDates.some((x) => x.artist_id === a.id && x.event_date === d && lc(x.venue || '') === lc(r.venue || ''))) { out.duplicates++; return; }
        db.tourDates.push({ id: nextId(), artist_id: a.id, event_date: d, venue: r.venue || null, city: r.city || null, ticket_url: r.ticket_url || null, status: r.status || 'new', source: r.source || null, created_at: new Date().toISOString() }); out.created++;
      } else if (b.section === 'pr_agencies') {
        const company = st(r.company || r.name); if (!company) { out.skipped++; return; }
        let ag = db.agencies.find((x) => lc(x.company) === lc(company));
        if (ag) out.duplicates++; else { ag = { id: nextId(), company, notes: r.notes || '' }; db.agencies.push(ag); out.created++; }
        (r.contacts || []).forEach((c) => { if (c.name && !db.contacts.some((x) => x.agency_id === ag.id && lc(x.name) === lc(c.name))) db.contacts.push({ id: nextId(), agency_id: ag.id, name: c.name, email: c.email || '', phone: c.phone || '' }); });
      } else if (b.section === 'artist_pr') {
        const a = db.artists.find((x) => lc(x.name) === lc(r.artist_name || r.artist || '')), ag = db.agencies.find((x) => lc(x.company) === lc(r.agency || ''));
        if (!a || !ag) { out.skipped++; out.errors.push({ row: i + 1, error: 'Unknown artist or agency.' }); return; }
        const c = r.contact ? db.contacts.find((x) => x.agency_id === ag.id && lc(x.name) === lc(r.contact)) : null;
        if (db.links.some((l) => l.artist_id === a.id && l.agency_id === ag.id && (l.contact_id || null) === (c ? c.id : null))) { out.duplicates++; return; }
        db.links.push({ id: nextId(), artist_id: a.id, agency_id: ag.id, contact_id: c ? c.id : null, notes: r.notes || '' }); out.created++;
      } else { out.skipped++; }
    });
    save(); return ok(out);
  });
  route('GET', '/bulk', () => {
    const an = (id) => (db.artists.find((a) => a.id === id) || {}).name;
    return ok({ accredihub_bundle: 1,
      artists: db.artists.map((a) => ({ name: a.name, bio: a.bio, photo_url: a.photo_url, location: a.location, year_formed: a.year_formed, year_split: a.year_split })),
      tracks: db.tracks.map((t) => ({ artist_name: an(t.artist_id), title: t.title, album_name: t.album_name, album_art_url: t.album_art_url, release_date: t.release_date, themes: db.trackThemes.filter((x) => x.track_id === t.id).map((x) => (db.themes.find((h) => h.id === x.theme_id) || {}).name) })),
      tour_dates: db.tourDates.map((d) => ({ artist_name: an(d.artist_id), event_date: d.event_date, venue: d.venue, city: d.city, ticket_url: d.ticket_url, status: d.status })),
      pr_agencies: db.agencies.map((g) => ({ company: g.company, notes: g.notes, contacts: db.contacts.filter((c) => c.agency_id === g.id).map((c) => ({ name: c.name, email: c.email, phone: c.phone })) })),
      artist_pr: db.links.map((l) => ({ artist_name: an(l.artist_id), agency: (db.agencies.find((g) => g.id === l.agency_id) || {}).company, contact: (db.contacts.find((c) => c.id === l.contact_id) || {}).name || null })) });
  });
  route('PUT', '/tracks/(\\d+)', (q, b, m) => { const t = db.tracks.find((x) => x.id === +m[1]); if (!t) return err(404, 'Not found.'); writeTrack(t, b); save(); return ok({ track: shapeTrack(t) }); });
  route('DELETE', '/tracks/(\\d+)', (q, b, m) => {
    const id = +m[1]; db.tracks = db.tracks.filter((t) => t.id !== id); db.trackThemes = db.trackThemes.filter((x) => x.track_id !== id);
    db.favourites = db.favourites.filter((x) => x !== id); db.items = db.items.filter((i) => !(i.item_type === 'track' && i.track_id === id)); save(); return ok({ ok: true });
  });

  // PR
  route('GET', '/pr-agencies', () => ok({ agencies: db.agencies.slice().sort((a, b) => a.company.localeCompare(b.company)).map(shapeAgency) }));
  route('POST', '/pr-agencies', (q, b) => {
    const company = String(b.company || '').trim(); if (!company) return err(400, 'Company is required.');
    let ag = db.agencies.find((a) => lc(a.company) === lc(company));
    if (!ag) { ag = { id: nextId(), company, notes: b.notes || '' }; db.agencies.push(ag); save(); }
    return ok({ agency: shapeAgency(ag) });
  });
  route('GET', '/pr-agencies/(\\d+)', (q, b, m) => { const ag = db.agencies.find((a) => a.id === +m[1]); return ag ? ok({ agency: shapeAgency(ag) }) : err(404, 'Not found.'); });
  route('PUT', '/pr-agencies/(\\d+)', (q, b, m) => { const ag = db.agencies.find((a) => a.id === +m[1]); if (!ag) return err(404, 'Not found.'); ag.company = b.company || ag.company; ag.notes = b.notes || ''; save(); return ok({ agency: shapeAgency(ag) }); });
  route('DELETE', '/pr-agencies/(\\d+)', (q, b, m) => { const id = +m[1]; db.agencies = db.agencies.filter((a) => a.id !== id); db.contacts = db.contacts.filter((c) => c.agency_id !== id); db.links = db.links.filter((l) => l.agency_id !== id); save(); return ok({ ok: true }); });
  route('POST', '/pr-contacts', (q, b) => {
    let c = db.contacts.find((x) => x.agency_id === +b.agency_id && lc(x.name) === lc(b.name));
    if (!c) { c = { id: nextId(), agency_id: +b.agency_id, name: b.name, email: b.email || '', phone: b.phone || '' }; db.contacts.push(c); } else { c.email = b.email || c.email; c.phone = b.phone || c.phone; }
    save(); return ok({ contact: c }, 201);
  });
  route('PUT', '/pr-contacts/(\\d+)', (q, b, m) => { const c = db.contacts.find((x) => x.id === +m[1]); if (!c) return err(404, 'Not found.'); Object.assign(c, { name: b.name, email: b.email || '', phone: b.phone || '' }); save(); return ok({ contact: c }); });
  route('DELETE', '/pr-contacts/(\\d+)', (q, b, m) => { const id = +m[1]; db.contacts = db.contacts.filter((c) => c.id !== id); db.links.forEach((l) => { if (l.contact_id === id) l.contact_id = null; }); save(); return ok({ ok: true }); });
  route('POST', '/artist-pr-contacts', (q, b) => {
    let l = db.links.find((x) => x.artist_id === +b.artist_id && x.agency_id === +b.agency_id);
    if (!l) { l = { id: nextId(), artist_id: +b.artist_id, agency_id: +b.agency_id }; db.links.push(l); }
    l.contact_id = b.contact_id ? +b.contact_id : null; l.notes = b.notes || ''; save(); return ok({ link: l }, 201);
  });
  route('PUT', '/artist-pr-contacts/(\\d+)', (q, b, m) => { const l = db.links.find((x) => x.id === +m[1]); if (!l) return err(404, 'Not found.'); l.agency_id = +b.agency_id; l.contact_id = b.contact_id ? +b.contact_id : null; l.notes = b.notes || ''; save(); return ok({ link: l }); });
  route('DELETE', '/artist-pr-contacts/(\\d+)', (q, b, m) => { db.links = db.links.filter((l) => l.id !== +m[1]); save(); return ok({ ok: true }); });

  // tour dates
  route('GET', '/tour-dates', (q) => {
    let list = db.tourDates.slice();
    if (q.from && q.to) list = list.filter((d) => d.event_date >= q.from && d.event_date <= q.to);
    else if (!q.all) list = list.filter((d) => d.event_date >= iso(0));
    if (q.status) list = list.filter((d) => d.status === q.status);
    return ok({ tour_dates: list.sort((a, b) => a.event_date.localeCompare(b.event_date)).map(shapeTour) });
  });
  route('POST', '/tour-dates', (q, b) => {
    if (!b.artist_id || !b.event_date) return err(400, 'Artist and date are required.');
    const d = { id: nextId(), artist_id: +b.artist_id, event_date: b.event_date, venue: b.venue || null, city: b.city || null, ticket_url: b.ticket_url || null, status: b.status || 'new', source: 'manual', created_at: nowIso() };
    db.tourDates.push(d); save(); return ok({ tour_date: shapeTour(d) }, 201);
  });
  route('PUT', '/tour-dates/(\\d+)', (q, b, m) => {
    const d = db.tourDates.find((x) => x.id === +m[1]); if (!d) return err(404, 'Not found.');
    ['artist_id', 'event_date', 'venue', 'city', 'ticket_url', 'status'].forEach((k) => { if (k in b) d[k] = k === 'artist_id' ? +b[k] : (b[k] || null); });
    d.status = d.status || 'new'; save(); return ok({ tour_date: shapeTour(d) });
  });
  route('DELETE', '/tour-dates/(\\d+)', (q, b, m) => { db.tourDates = db.tourDates.filter((d) => d.id !== +m[1]); db.attending = db.attending.filter((x) => x !== +m[1]); save(); return ok({ ok: true }); });
  route('POST', '/tour-dates/(\\d+)/attending', (q, b, m) => { if (!db.attending.includes(+m[1])) db.attending.push(+m[1]); save(); return ok({ ok: true }); });
  route('DELETE', '/tour-dates/(\\d+)/attending', (q, b, m) => { db.attending = db.attending.filter((x) => x !== +m[1]); save(); return ok({ ok: true }); });
  route('GET', '/tour-dates/discover', () => ok({ phase: 'idle', bandsintown_configured: true, ticketmaster_configured: false, cooldown_until: null, last_result: db.lastDiscovery || null }));
  route('POST', '/tour-dates/discover', () => {
    const picks = db.artists.filter((a) => !a.year_split).slice(0, 2); let found = 0;
    picks.forEach((a, i) => { db.tourDates.push({ id: nextId(), artist_id: a.id, event_date: iso(45 + i * 3 + Math.floor(Math.random() * 5)), venue: ['The Forum', 'Concorde 2'][i % 2], city: ['London', 'Brighton'][i % 2], ticket_url: 'https://example.com/tickets', status: 'new', source: 'bandsintown', created_at: nowIso() }); found++; });
    db.lastDiscovery = { totalFound: found, artistsScanned: db.artists.length }; save();
    return ok({ phase: 'idle', more: false, foundThisChunk: found, totalFound: found, artistsProcessed: db.artists.length, artistsTotal: db.artists.length, bandsintownConfigured: true, ticketmasterConfigured: false });
  });

  // navidrome (simulated)
  route('GET', '/navidrome/sync', () => ok({ phase: 'idle', last_result: { matched: db.tracks.filter((t) => t.navidrome_song_id).length, tracksChecked: db.tracks.length, librarySongs: db.tracks.length + 40 } }));
  route('POST', '/navidrome/sync', () => ok({ phase: 'idle' }));
  route('POST', '/navidrome/backfill-artwork', () => ok({ applied: 2, more: false }));

  // playlists
  route('GET', '/playlists', () => ok({ playlists: db.playlists.slice().sort((a, b) => String(b.show_date).localeCompare(String(a.show_date))).map((p) => { const its = db.items.filter((i) => i.playlist_id === p.id); return { ...p, track_count: its.filter((i) => i.item_type === 'track').length, note_count: its.filter((i) => i.item_type === 'note').length }; }) }));
  route('POST', '/playlists', (q, b) => { const p = { id: nextId(), name: String(b.name || '').trim(), show_date: b.show_date || null, theme: b.theme || '', created_at: nowIso() }; if (!p.name) return err(400, 'Name is required.'); db.playlists.push(p); save(); return ok({ playlist: p }, 201); });
  route('GET', '/playlists/(\\d+)', (q, b, m) => { const p = db.playlists.find((x) => x.id === +m[1]); return p ? ok({ playlist: p, items: orderedItems(p.id).map(shapeItem).filter(Boolean) }) : err(404, 'Not found.'); });
  route('PUT', '/playlists/(\\d+)', (q, b, m) => { const p = db.playlists.find((x) => x.id === +m[1]); if (!p) return err(404, 'Not found.'); p.name = b.name || p.name; p.show_date = b.show_date || null; p.theme = b.theme || ''; save(); return ok({ playlist: p }); });
  route('DELETE', '/playlists/(\\d+)', (q, b, m) => { const id = +m[1]; db.playlists = db.playlists.filter((p) => p.id !== id); db.items = db.items.filter((i) => i.playlist_id !== id); save(); return ok({ ok: true }); });
  route('POST', '/playlists/(\\d+)/items', (q, b, m) => {
    const pid = +m[1]; const position = db.items.filter((i) => i.playlist_id === pid).length; const base = { id: nextId(), playlist_id: pid, position, item_type: b.item_type };
    if (b.item_type === 'track') { base.track_id = +b.track_id; db.tracks.find((t) => t.id === base.track_id).last_played = iso(0); }
    else Object.assign(base, { category: b.category || null, note_title: b.note_title, note_body: b.note_body || '', artist_id: b.artist_id ? +b.artist_id : null });
    db.items.push(base); save(); return ok({ id: base.id }, 201);
  });
  route('DELETE', '/playlists/(\\d+)/items', (q, b, m) => { db.items = db.items.filter((i) => !(i.playlist_id === +m[1] && i.id === +b.item_id)); orderedItems(+m[1]).forEach((i, n) => { i.position = n; }); save(); return ok({ ok: true }); });
  route('PUT', '/playlists/(\\d+)/items', (q, b, m) => { (b.order || []).forEach((id, n) => { const i = db.items.find((x) => x.id === id); if (i) i.position = n; }); save(); return ok({ ok: true }); });

  route('GET', '/playlist-data', (q) => {
    const exclude = new Set(String(q.exclude || '').split(',').filter(Boolean).map(Number));
    const weeks = +q.weeks || 0; const cutoff = weeks ? iso(-weeks * 7) : null;
    let list = db.tracks.filter((t) => !exclude.has(t.id)).map(shapeTrack);
    if (cutoff) list = list.filter((t) => !t.last_played || t.last_played < cutoff);
    if (q.navidrome_only) list = list.filter((t) => t.navidrome_song_id);
    if (q.q) { const s = lc(q.q); list = list.filter((t) => [t.title, t.artist_name, t.album_name].some((x) => lc(x).includes(s)) || t.themes.some((th) => lc(th.name).includes(s))); }
    const recent = iso(-60); const out = { new_releases: [], touring_soon: [], favourites: [], others: [] };
    list.forEach((t) => { if (t.release_date && t.release_date >= recent) out.new_releases.push(t); else if (t.touring_soon) out.touring_soon.push(t); else if (t.is_favourite) out.favourites.push(t); else out.others.push(t); });
    return ok(out);
  });
  route('GET', '/note-bands', (q) => {
    const soon = (a) => db.tourDates.filter((d) => d.artist_id === a && d.event_date >= iso(0));
    if (q.artist_id) return ok({ tour_dates: soon(+q.artist_id).map((d) => ({ event_date: d.event_date, venue: d.venue, city: d.city })) });
    const ids = new Set(q.category === 'new_tour_announcement'
      ? db.tourDates.filter((d) => d.event_date >= iso(0) && d.created_at >= nowIso(-7)).map((d) => d.artist_id)
      : db.tourDates.filter((d) => d.event_date >= iso(0) && d.event_date <= iso(30)).map((d) => d.artist_id));
    return ok({ artists: db.artists.filter((a) => ids.has(a.id)).map((a) => ({ id: a.id, name: a.name })).sort((a, b) => a.name.localeCompare(b.name)) });
  });

  // ---------- fetch interception
  window.fetch = async function (input, init) {
    init = init || {};
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const m = url.match(/^\/api(\/[^?]*)(?:\?(.*))?$/);
    if (!m) return realFetch(input, init);
    const method = (init.method || 'GET').toUpperCase();
    const q = Object.fromEntries(new URLSearchParams(m[2] || ''));
    let body = init.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } } else if (!body) body = {};
    for (const r of R) {
      if (r.method !== method) continue;
      const mm = m[1].match(r.re);
      if (!mm) continue;
      const res = await r.fn(q, body, mm);
      if (res.status === 204) return new Response(null, { status: 204 });
      if (method !== 'GET') save();
      return new Response(JSON.stringify(res.data), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'Not available in the demo.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  };

  // ---------- demo banner
  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9999;background:#251240;border:1px solid #3a2358;color:#d6c9ea;font:12px system-ui,sans-serif;padding:8px 12px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.5);display:flex;gap:10px;align-items:center';
    bar.innerHTML = '<span>Demo — data stays in this browser</span><a href="#" style="color:#ff8fc0;font-weight:600;text-decoration:none">Reset</a>';
    bar.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); if (confirm('Reset all demo data to the original samples?')) { try { localStorage.removeItem(KEY); } catch (x) {} location.reload(); } });
    document.body.appendChild(bar);
  });
})();
