// iTunes Search API artwork lookup (public, no key needed).
//
// Strategy, in order:
//   1. If we know the album name, find that ALBUM first (via a song search for
//      "<artist> <album>"), then fetch the album's real tracklist and find our
//      track inside it.
//   2. Otherwise fall back to a plain song search, preferring a result whose
//      title matches, then whose album matches, avoiding live/deluxe/remix cuts.
//   3. The artist name is sanity-checked throughout.

export function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function fuzzyIncludes(a, b) {
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function stripFeatureCredit(title) {
  return title.replace(/\s*[[(]\s*(feat\.?|ft\.?|with)\s+[^)\]]*[)\]]/gi, '').trim();
}

async function itunesGet(url) {
  const r = await fetch(url, { timeout_ms: 8000 });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return r.json();
}

function upgradeArtwork(url100) {
  return url100 ? url100.replace(/\d+x\d+bb(?=\.\w+$)/, '600x600bb') : null;
}

export async function searchArtwork({ title, artist, album }) {
  title = (title || '').trim().slice(0, 200);
  artist = (artist || '').trim().slice(0, 200);
  album = (album || '').trim().slice(0, 200);
  if (!title) return { found: false, error: 'title is required.' };

  const searchTitle = stripFeatureCredit(title) || title;
  const wantTitle = normalize(searchTitle);
  const wantArtist = normalize(artist);

  // --- Strategy 1: find the album, then read its real tracklist ---
  if (album) {
    const albumTerm = [artist, album].filter(Boolean).join(' ');
    const albumUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(albumTerm)}&entity=song&limit=25`;
    const albumSearchData = await itunesGet(albumUrl);
    let albumSongResults = Array.isArray(albumSearchData.results) ? albumSearchData.results : [];

    if (artist) {
      const filtered = albumSongResults.filter((a) => fuzzyIncludes(normalize(a.artistName), wantArtist));
      if (filtered.length) albumSongResults = filtered;
    }
    const wantAlbum = normalize(album);
    const albumHit = albumSongResults.find((a) => fuzzyIncludes(normalize(a.collectionName), wantAlbum));

    if (albumHit) {
      const tracksUrl = `https://itunes.apple.com/lookup?id=${albumHit.collectionId}&entity=song&limit=200`;
      const trackData = await itunesGet(tracksUrl);
      const tracks = (Array.isArray(trackData.results) ? trackData.results : []).filter((t) => t.wrapperType === 'track');

      const trackHit = tracks.find((t) => fuzzyIncludes(normalize(t.trackName), wantTitle));
      if (trackHit && trackHit.artworkUrl100) {
        return {
          found: true,
          term: albumTerm,
          matchedBy: 'album_lookup',
          artworkUrl: upgradeArtwork(trackHit.artworkUrl100),
          matchedTrack: trackHit.trackName,
          matchedArtist: trackHit.artistName,
          matchedAlbum: albumHit.collectionName,
        };
      }
    }
  }

  // --- Strategy 2: plain song search ---
  const term = [artist, searchTitle].filter(Boolean).join(' ');
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=25`;
  const data = await itunesGet(url);
  let results = Array.isArray(data.results) ? data.results : [];

  if (artist) {
    const artistFiltered = results.filter((r2) => fuzzyIncludes(normalize(r2.artistName), wantArtist));
    if (artistFiltered.length) results = artistFiltered;
  }

  const titleMatches = results.filter((r2) => fuzzyIncludes(normalize(r2.trackName), wantTitle));

  let match = null;
  let matchedBy = null;

  if (titleMatches.length) {
    if (album) {
      const wantAlbum = normalize(album);
      match = titleMatches.find((r2) => fuzzyIncludes(normalize(r2.collectionName), wantAlbum));
      if (match) matchedBy = 'title_and_album_match';
    }
    if (!match) {
      const altPattern = /\b(live|deluxe|remix|edit|remaster|acoustic|demo)\b/i;
      const plain = titleMatches.find((r2) => !altPattern.test(r2.collectionName || ''));
      match = plain || titleMatches[0];
      matchedBy = 'title_match';
    }
  } else if (results.length) {
    match = results[0];
    matchedBy = 'no_title_match_fallback';
  }

  if (!match || !match.artworkUrl100) return { found: false, term };

  return {
    found: true,
    term,
    matchedBy,
    artworkUrl: upgradeArtwork(match.artworkUrl100),
    matchedTrack: match.trackName,
    matchedArtist: match.artistName,
    matchedAlbum: match.collectionName,
  };
}
