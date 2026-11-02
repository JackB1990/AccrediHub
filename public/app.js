// AccrediHub shared client helpers: API wrapper, sidebar shell, small utils.
window.SR = (function () {
  const API = '/api';

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    let body = opts.body;
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const res = await fetch(API + path, { method: opts.method || 'GET', headers, body, credentials: 'same-origin' });
    if (res.status === 401 && !/^\/auth\//.test(path)) {
      location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || ('Request failed (' + res.status + ')'));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function fmtDate(d) {
    if (!d) return '';
    const dt = new Date(d + (String(d).length <= 10 ? 'T00:00:00' : ''));
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function fmtDateShort(d) {
    if (!d) return '';
    const dt = new Date(d + (String(d).length <= 10 ? 'T00:00:00' : ''));
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // Show-note categories: shared label + colour-coded pill class so every
  // page (Playlist Builder, Playlist view) renders notes the same way.
  const NOTE_CATEGORY_LABELS = {
    new_tour_announcement: 'New Tour Announcement',
    band_on_tour: 'Band On Tour',
    news: 'News',
    competition: 'Competition',
    show_feature: 'Show Feature',
  };
  const NOTE_CATEGORY_PILL_CLASS = {
    new_tour_announcement: 'pill-success',
    band_on_tour: 'pill-info',
    news: 'pill-accent',
    competition: 'pill-warning',
    show_feature: 'pill-feature',
  };
  const NOTE_CATEGORY_BOX_CLASS = {
    new_tour_announcement: 'note-box-success',
    band_on_tour: 'note-box-info',
    news: 'note-box-accent',
    competition: 'note-box-warning',
    show_feature: 'note-box-feature',
  };
  function noteCategoryLabel(c) { return NOTE_CATEGORY_LABELS[c] || c || ''; }
  function noteCategoryPillClass(c) { return NOTE_CATEGORY_PILL_CLASS[c] || 'pill-theme'; }
  function noteCategoryBoxClass(c) { return NOTE_CATEGORY_BOX_CLASS[c] || ''; }

  function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function toast(msg) {
    let el = document.getElementById('sr-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sr-toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 2600);
  }

  const svg = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
  const NAV_ICONS = {
    songs: svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
    artists: svg('<path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    builder: svg('<path d="M11 3h10v18H11z"/><path d="M3 3v18"/><path d="M3 9h4"/><path d="M3 15h4"/>'),
    playlists: svg('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'),
    pr: svg('<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>'),
    tourdates: svg('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'),
    calendar: svg('<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/>'),
  };

  const LOGO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

  function sidebarHtml(active) {
    const link = (key, href, label) =>
      '<a href="' + href + '" class="nav-link' + (active === key ? ' active' : '') + '">' + NAV_ICONS[key] + '<span>' + label + '</span></a>';
    return (
      '<a class="brand" href="/index.html"><img class="brand-logo" src="/logo.png" alt="AccrediHub — Bands / PR / Press Accreditation"></a>' +
      '<div class="nav-section-label">Library</div>' +
      link('songs', '/index.html', 'All Songs') +
      link('artists', '/artists.html', 'Artists') +
      '<div class="nav-section-label">Promotion</div>' +
      link('pr', '/pr-agents.html', 'PR Agents') +
      link('tourdates', '/calendar.html', 'Tour Dates') +
      '<div class="nav-section-label">Radio Shows</div>' +
      link('builder', '/playlist-builder.html', 'Playlist Builder') +
      link('playlists', '/playlists.html', 'Previous Playlists') +
      '<div class="sidebar-foot" id="sr-user-chip"></div>'
    );
  }

  async function getUser() {
    try {
      const r = await fetch('/api/auth/session', { credentials: 'same-origin' });
      const s = await r.json();
      return (s && s.user) || null;
    } catch (e) { return null; }
  }

  // Every page is a static file, so it always loads for an anonymous visitor.
  // Call this first in each page's init() and stop if it returns null.
  async function requireAuth() {
    const u = await getUser();
    if (u) return u;
    location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
    return null;
  }

  async function mountSidebar(active, user) {
    const mount = document.getElementById('sidebar');
    if (!mount) return;
    mount.innerHTML = sidebarHtml(active);
    const u = user || (await getUser());
    const chip = document.getElementById('sr-user-chip');
    if (chip && u) {
      chip.innerHTML =
        '<a href="/profile.html" class="user-chip' + (active === 'profile' ? ' active' : '') + '" title="Your profile"><div class="user-avatar"></div>' +
        '<span class="sr-uname" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span></a>' +
        '<div class="signout-btn" id="sr-signout">Sign out</div>';
      const name = u.name || u.email || 'admin';
      const av = chip.querySelector('.user-avatar');
      if (u.avatar_url) { av.style.backgroundImage = 'url(' + u.avatar_url + ')'; av.style.backgroundSize = 'cover'; av.style.backgroundPosition = 'center'; }
      else av.textContent = initials(name);
      chip.querySelector('.sr-uname').textContent = name;
      document.getElementById('sr-signout').addEventListener('click', async () => {
        try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) {}
        location.href = '/login.html';
      });
    }
  }

  return { api, fmtDate, fmtDateShort, initials, debounce, toast, requireAuth, mountSidebar, noteCategoryLabel, noteCategoryPillClass, noteCategoryBoxClass };
})();
