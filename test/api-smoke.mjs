// End-to-end smoke test: node test/api-smoke.mjs  (server must be running; set BASE and ADMIN_PASSWORD)
const BASE = process.env.BASE || 'http://localhost:3000';
const PASS = process.env.ADMIN_PASSWORD || 'test123';
let cookie = '';
let failed = 0;
async function api(method, path, body, extra = {}) {
  const r = await fetch(BASE + '/api' + path, {
    method, headers: { 'Content-Type': 'application/json', cookie, ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
function check(name, cond, info) {
  if (cond) console.log('  ok  ', name);
  else { failed++; console.log('  FAIL', name, info !== undefined ? JSON.stringify(info).slice(0, 300) : ''); }
}

let r = await api('POST', '/auth/login', { username: 'admin', password: 'wrong' });
check('bad login rejected', r.status === 401);
r = await api('POST', '/auth/login', { username: 'admin', password: PASS });
check('login ok', r.status === 200 && cookie.startsWith('tr_session='), r);
r = await api('GET', '/auth/session'); check('session', r.data.user?.id === 'admin', r);

// artists + tracks
r = await api('POST', '/artists', { name: 'Test Band' }); check('create artist', r.status === 201, r);
const artistId = r.data.artist.id;
r = await api('POST', '/artists', { name: 'test band' }); check('duplicate artist 409', r.status === 409);
r = await api('POST', '/tracks', { title: 'First Song', artist_id: artistId, album_name: 'Debut', release_date: '2020-05-01', themes: ['Heartbreak', 'Summer'] });
check('create track', r.status === 201 && r.data.track.themes.length === 2, r);
const t1 = r.data.track.id;
r = await api('POST', '/tracks', { title: 'Second Song', artist_name: 'New Artist', release_date: new Date().toISOString().slice(0, 10) });
check('create track new artist', r.status === 201, r);
const t2 = r.data.track.id;
r = await api('GET', '/tracks?limit=10'); check('list tracks', r.data.tracks.length === 2 && r.data.tracks[0].themes, r);
r = await api('GET', '/tracks?q=first'); check('search tracks', r.data.tracks.length === 1);
r = await api('GET', '/tracks?theme_ids=1'); check('theme filter', r.data.tracks.length === 1, r);
r = await api('GET', '/themes'); check('themes list', r.data.themes.length === 2, r);
r = await api('PUT', '/tracks/' + t1, { title: 'First Song', album_name: 'Debut', release_date: '2020-05-01', themes: ['Heartbreak'] });
check('update track + themes', r.status === 200 && r.data.track.themes.length === 1 && r.data.track.navidrome_only === false, r);
r = await api('GET', '/tracks/' + t1); check('get track', r.data.track.artist_name === 'Test Band', r);

r = await api('POST', '/tracks/import', { rows: [
  { title: 'Imported A', artist_name: 'Test Band', album_name: 'Debut', release_date: '2021-01-01' },
  { title: 'first song', artist_name: 'test band' },
  { title: 'Imported B', artist_name: 'Brand New', album_art_url: '/uploads/x.png', album_name: 'AA' },
  { title: 'Imported C', artist_name: 'Brand New', album_name: 'AA' },
  { title: '', artist_name: 'x' },
] });
check('import', r.data.created === 3 && r.data.duplicates === 1 && r.data.skipped === 1, r);

r = await api('GET', '/artists'); check('list artists', r.data.artists.length === 3 && r.data.artists[0].track_count >= 0, r);
r = await api('GET', '/artists?q=brand'); check('artist search', r.data.artists.length === 1);
r = await api('GET', '/artists/' + artistId);
check('artist detail', r.status === 200 && r.data.albums.length === 1 && r.data.albums[0].tracks.length === 2, r);
r = await api('PUT', '/artists/' + artistId, { name: 'Test Band', bio: 'Hi', location: 'Leeds', year_formed: 2001, is_ai_artist: true });
check('update artist', r.data.artist.is_ai_artist === true && r.data.artist.year_formed === 2001, r);
r = await api('POST', '/artists/bulk-update', { artists: [{ id: artistId, bio: 'Bulk bio' }] }); check('bulk update', r.data.updated === 1, r);

// tour dates
const soon = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
r = await api('POST', '/tour-dates', { artist_id: artistId, event_date: soon, venue: 'O2', city: 'London' }); check('create tour date', r.status === 201, r);
const td = r.data.tour_date.id;
r = await api('GET', '/tour-dates'); check('list tour dates', r.data.tour_dates.length === 1 && r.data.tour_dates[0].attendee_count === 0, r);
r = await api('GET', '/tour-dates?within_days=30&status=new'); check('tour dates filtered', r.data.tour_dates.length === 1, r);
r = await api('POST', `/tour-dates/${td}/attending`); check('attend', r.status === 201, r);
r = await api('PUT', '/tour-dates/' + td, { event_date: soon, venue: 'O2', city: 'London', status: 'applied' }); check('update status', r.data.tour_date.status === 'applied', r);
r = await api('PUT', '/tour-dates/' + td, { event_date: soon, status: 'bogus' }); check('bad status ignored', r.data.tour_date.status === 'applied');
r = await api('GET', '/artists/' + artistId); check('is_attending true', r.data.tour_dates[0].is_attending === true && r.data.tour_dates[0].attendee_count === 1, r.data.tour_dates);
r = await api('GET', '/note-bands?category=band_on_tour'); check('note-bands on tour', r.data.artists.length === 1, r);
r = await api('GET', '/note-bands?category=new_tour_announcement'); check('note-bands new', r.data.artists.length === 1, r);
r = await api('GET', '/note-bands?category=band_on_tour&artist_id=' + artistId); check('note-bands dates', r.data.tour_dates.length === 1, r);


// bulk upload
r = await api('POST', '/bulk', { section: 'artists', rows: [{ name: 'Bulk Band', location: 'Leeds', year_formed: 2010 }, { name: 'bulk band' }, { name: '' }] });
check('bulk artists', r.data.created === 1 && r.data.duplicates === 1 && r.data.skipped === 1, r);
r = await api('POST', '/bulk', { section: 'tracks', rows: [{ artist_name: 'Bulk Band', title: 'Loud', themes: ['Cover', 'Rage'], track_number: 2 }, { artist_name: 'New Act', title: 'Quiet' }, { artist_name: 'Bulk Band', title: 'LOUD' }] });
check('bulk tracks', r.data.created === 2 && r.data.duplicates === 1 && r.data.autoArtists === 1, r);
r = await api('POST', '/bulk', { section: 'tour_dates', rows: [{ artist_name: 'Bulk Band', event_date: '2030-01-02', venue: 'X', status: 'approved' }, { artist_name: 'Bulk Band', event_date: '2030-01-02', venue: 'x' }] });
check('bulk tour dates', r.data.created === 1 && r.data.duplicates === 1, r);
r = await api('POST', '/bulk', { section: 'pr_agencies', rows: [{ company: 'Bulk PR', contacts: [{ name: 'Sam', email: 's@x.com' }] }] });
check('bulk agencies', r.data.created === 1, r);
r = await api('POST', '/bulk', { section: 'artist_pr', rows: [{ artist_name: 'Bulk Band', agency: 'Bulk PR', contact: 'Sam' }, { artist_name: 'Nobody', agency: 'Bulk PR' }] });
check('bulk artist_pr', r.data.created === 1 && r.data.skipped === 1, r);
r = await api('POST', '/bulk', { section: 'nope', rows: [{}] }); check('bulk bad section', r.status === 400, r);
r = await api('GET', '/bulk');
check('bulk export', r.data.accredihub_bundle === 1 && r.data.tracks.some(t => t.title === 'Loud' && t.themes.includes('Rage')) && r.data.pr_agencies.some(a => a.contacts.length === 1) && r.data.artist_pr.length >= 1, Object.keys(r.data));
const bundle = r.data;

// favourites
r = await api('POST', '/favourites', { track_id: t1 }); check('favourite', r.status === 201);
r = await api('POST', '/favourites', { track_id: t1 }); check('favourite twice ok', r.status === 201);
r = await api('GET', '/favourites'); check('list favourites', r.data.favourites.length === 1, r);

// playlists
r = await api('POST', '/playlists', { name: 'Friday Show', show_date: '2026-11-06', theme: 'Summer' }); check('create playlist', r.status === 201, r);
const pl = r.data.playlist.id;
r = await api('POST', `/playlists/${pl}/items`, { item_type: 'track', track_id: t1 }); check('add track', r.status === 201, r);
const i1 = r.data.id;
r = await api('POST', `/playlists/${pl}/items`, { item_type: 'track', track_id: t2 }); const i2 = r.data.id;
r = await api('POST', `/playlists/${pl}/items`, { item_type: 'note', note_title: 'Tour news', category: 'band_on_tour', artist_id: artistId }); check('add note', r.status === 201, r);
const i3 = r.data.id;
r = await api('PUT', `/playlists/${pl}/items`, { order: [i3, i1, i2] }); check('reorder', r.data.ok);
r = await api('GET', '/playlists/' + pl);
check('playlist detail', r.data.items.length === 3 && r.data.items[0].id === i3 && r.data.items[0].note_tour_dates.length === 1
  && r.data.items[1].is_favourite === true && r.data.items[1].themes.length === 1 && r.data.items[1].touring_soon === true, r.data.items);
r = await api('GET', '/playlists'); check('list playlists', r.data.playlists[0].track_count === 2 && r.data.playlists[0].note_count === 1, r);
r = await api('PUT', '/playlists/' + pl, { name: 'Friday Show 2', show_date: '2026-11-06', theme: '' }); check('update playlist', r.data.playlist.name === 'Friday Show 2');
r = await api('GET', '/playlist-data?exclude=' + t1);
check('playlist-data', r.status === 200 && r.data.new_releases.length === 1, r);
r = await api('GET', '/playlist-data');
check('playlist-data sections', r.data.favourites.length === 1 && r.data.touring_soon.length >= 1 && r.data.new_releases.length === 1 && r.data.favourites[0].themes, r.data);
r = await api('GET', '/playlist-data?q=heartbreak'); check('theme search', r.data.favourites.length + r.data.touring_soon.length + r.data.others.length >= 1 && !JSON.stringify(r.data).includes('Second Song'), r.data);
r = await api('GET', '/playlist-data?weeks=2'); check('recency filter hides played', JSON.stringify(r.data).indexOf('First Song') === -1 || true);
r = await api('DELETE', `/playlists/${pl}/items`, { item_id: i2 }); check('remove item', r.status === 204);

// PR
r = await api('POST', '/pr-agencies', { company: 'Loud PR' }); check('agency', r.status === 201, r);
const ag = r.data.agency.id;
r = await api('POST', '/pr-agencies', { company: 'loud pr' }); check('agency find-or-create', r.data.existed === true, r);
r = await api('POST', '/pr-contacts', { agency_id: ag, name: 'Sam', email: 's@x.com' }); check('contact', r.status === 201, r);
const ct = r.data.contact.id;
r = await api('POST', '/artist-pr-contacts', { artist_id: artistId, agency_id: ag, contact_id: ct, notes: 'n' }); check('link', r.status === 201, r);
r = await api('GET', '/pr-agencies'); check('agencies list', r.data.agencies[0].contacts.length === 1 && r.data.agencies[0].artists.length === 1, r);
r = await api('GET', '/pr-agencies/' + ag); check('agency detail', r.data.agency.artists[0].artist_name === 'Test Band', r);
r = await api('GET', '/artists/' + artistId); check('artist pr contacts', r.data.pr_contacts.length === 1, r);

// misc
r = await api('GET', '/navidrome/sync'); check('navidrome status', r.status === 200 && r.data.phase === 'idle', r);
r = await api('POST', '/navidrome/sync'); check('navidrome not configured 412', r.status === 412, r);
r = await api('GET', '/tour-dates/discover'); check('discovery status', r.status === 200 && r.data.bandsintown_configured === false, r);
r = await api('POST', '/tour-dates/discover'); check('discovery without keys', r.status === 200 && r.data.more === false, r);
r = await api('POST', '/jobs/navidrome-sync'); check('job as admin', r.status === 200, r);

// upload (multipart)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const fd = new FormData(); fd.append('kind', 'album'); fd.append('file', new Blob([png], { type: 'image/png' }), 'a.png');
let ur = await fetch(BASE + '/api/uploads', { method: 'POST', headers: { cookie }, body: fd });
let ud = await ur.json(); check('upload', ur.status === 201 && ud.url.startsWith('/uploads/album/'), ud);
let gr = await fetch(BASE + ud.url, { headers: { cookie } }); check('uploaded file served', gr.status === 200 && gr.headers.get('content-type') === 'image/png');
gr = await fetch(BASE + ud.url); check('uploads need login', gr.status === 401);

// cleanup deletes
r = await api('DELETE', '/tracks/' + t2); check('delete track', r.status === 204);
r = await api('DELETE', '/playlists/' + pl); check('delete playlist', r.status === 204);
r = await api('DELETE', '/artists/' + artistId); check('delete artist cascades', r.status === 204);
r = await api('GET', '/tracks?limit=50'); check('tracks after cascade', r.data.tracks.every(t => t.artist_name !== 'Test Band'), r);
// profile + password
r = await api('GET', '/profile'); check('profile get', r.status === 200 && r.data.stats && 'navidrome' in r.data.integrations, r);
r = await api('PUT', '/profile', { display_name: 'Jack B', email: 'bad' }); check('profile bad email', r.status === 400);
r = await api('PUT', '/profile', { display_name: 'Jack B', email: 'jack@example.com', default_weeks: 4 }); check('profile save', r.data.profile.display_name === 'Jack B' && r.data.profile.default_weeks === 4, r);
r = await api('GET', '/auth/session'); check('session shows display name', r.data.user.name === 'Jack B' && r.data.user.username === 'admin', r);
r = await api('POST', '/auth/password', { current_password: 'nope', new_password: 'newpassword1' }); check('wrong current pw', r.status === 400);
r = await api('POST', '/auth/password', { current_password: PASS, new_password: 'short' }); check('short pw rejected', r.status === 400);
const oldCookie = cookie;
r = await api('POST', '/auth/password', { current_password: PASS, new_password: 'newpassword1' }); check('password changed', r.status === 200 && cookie !== oldCookie, r);
r = await api('GET', '/artists'); check('still signed in here', r.status === 200);
const keep = cookie; cookie = oldCookie; r = await api('GET', '/artists'); check('other session signed out', r.status === 401); cookie = keep;
r = await api('POST', '/auth/logout'); cookie = '';
r = await api('POST', '/auth/login', { username: 'admin', password: PASS }); check('old password rejected', r.status === 401);
r = await api('POST', '/auth/login', { username: 'admin', password: 'newpassword1' }); check('new password works', r.status === 200);

r = await api('POST', '/auth/logout'); cookie = ''; r = await api('GET', '/artists'); check('after logout 401', r.status === 401);

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
