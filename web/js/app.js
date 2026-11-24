// Miles Traveled — pages, forms and actions.
import { $, esc, num, fmt, fmt1, isDate, yearOf, niceDate, addDays, daysBetween, hav, parseLL, groupBy, sum, uniq, pct, newId, sumBy, toast,
  cachedJson, arc, arcLines, splitDateline, wrapLng, simplify, onVisible, EARTH, MOON, LIGHT_MPS, SCHENGEN, CONTINENTS, MONTHS, TRIP_TYPES, SERIES, OTHER, ATLAS_ALIAS, CDN } from './util.js';
import { db, S, load, save, saveMany, remove, removeWhere, derive, hydrateImages, legEnds, orderLegs, isFlight, groundCountries, tripMiles, has, person, yearSlice, yearOfTrip, companions, schengenUsed } from './store.js';
import { odometer, countUp, globe, race, lineChart, fillStamps } from './fun.js';

const UI = { page: 'home', tripYear: 'All', tripType: 'All', tripWho: 'mine', tripQuery: '', storyQuery: '', storyPerson: '', statsYear: 'All', raceMetric: 'miles' };
const sheetStack = [];
let map = null, mapLayers = {}, earthDrawn = [], replayState = null;
const D = () => S.D, X = () => S.X;
const F = () => person(S.focus);                       // the profile being viewed
const P0 = id => X().person[id] || { id, name: id, kind: 'person' };

// ------------------------------------------------------------------ boot
async function boot() {
  if (!db) return setupNeeded();
  S.email = await db.email();
  // reload only when the sign-in state really flips (Supabase also fires SIGNED_IN on every load)
  db.onAuth(ev => { if ((ev === 'SIGNED_OUT' && S.email) || (ev === 'SIGNED_IN' && !S.email)) location.reload(); });
  if (!S.email) return loginPage();
  try { await load(); } catch (e) { $('#loading').innerHTML = `Could not load your data: ${esc(e.message)}<br><br><button class="btn" data-click="signOut">Sign out</button>`; return; }
  {
    if (db.kind === 'supabase' && !D().people.length) { $('#loading').innerHTML = `Signed in as ${esc(S.email)}, but this email isn't on the family list yet. Ask whoever set up the app to add you on the People page.<br><br><button class="btn" data-click="signOut">Sign out</button>`; return; }
  }
  $('#loading').style.display = 'none';
  document.body.classList.add('ready');
  go(location.hash.slice(1) || 'home');
}
function setupNeeded() {
  $('#loading').innerHTML = `<div class="login"><div class="postcard"><h2>Almost there</h2><p>Open <b>config.js</b> and paste your Supabase URL and anon key. The README walks through it.</p></div></div>`;
}
function loginPage() {
  $('#loading').style.display = 'none';
  const el = $('#page-login'); el.classList.add('on');
  el.innerHTML = `<div class="login"><div style="font-size:54px">🌍</div><h1>Miles Traveled</h1><p class="muted">Your family's trips, stories and maps.</p>
    <form class="postcard" id="loginF"><label>Your email</label><input type="email" name="email" required placeholder="you@example.com" autocomplete="email">
    <label>Password</label><input type="password" name="password" autocomplete="current-password" placeholder="Leave blank to get an email link instead">
    <button class="btn" style="width:100%;margin-top:12px">Sign in</button><p class="small muted" id="loginMsg"></p></form></div>`;
  $('#loginF').onsubmit = async e => {
    e.preventDefault();
    const email = e.target.email.value.trim(), pw = e.target.password.value;
    try {
      if (pw) { await db.signInPassword(email, pw); location.reload(); return; }
      await db.signIn(email); $('#loginMsg').textContent = `Check ${email} for a link. Open it on this device.`;
    } catch (err) { $('#loginMsg').textContent = /rate limit/i.test(err.message) ? 'Too many sign-in emails this hour. Use a password, or try again later.' : /invalid login/i.test(err.message) ? 'That email and password don\'t match.' : err.message; }
  };
  document.querySelector('.tabbar').style.display = 'none'; $('#fab').style.display = 'none';
}

// ------------------------------------------------------------------ navigation
function go(page) {
  if (!['home', 'map', 'trips', 'stories', 'people', 'stats'].includes(page)) page = 'home';
  if (UI.page === 'map' && page !== 'map') { stopReplay(); if ($('#mapWrap').classList.contains('fullscreen')) toggleMapFullscreen(false); }
  UI.page = page;
  history.replaceState(null, '', '#' + page);
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('on', p.id === 'page-' + page));
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.page === page));
  renderWho();
  renderPage();
  window.scrollTo(0, 0);
}
function renderPage() {
  ({ home: renderHome, map: renderMap, trips: renderTrips, stories: renderStories, people: renderPeople, stats: renderStats })[UI.page]();
  after($('#page-' + UI.page));
}
function after(root) { hydrateImages(root); fillStamps(root); root.querySelectorAll('.bar > i[data-w]').forEach(i => onVisible(i, () => i.style.width = i.dataset.w + '%')); }
function refresh() { renderWho(); if (sheetStack.length) showSheet(); renderPage(); }
function renderWho() {
  const fam = X().family;
  $('#whoBar').innerHTML = fam.length > 1 ? fam.map(p => `<button class="${p.id === S.focus ? 'on' : ''}" data-click="focus" data-arg="${esc(p.id)}" title="${esc(p.name)}">${avatar(p, 30)}</button>`).join('') : '';
  hydrateImages($('#whoBar'));
}

// ------------------------------------------------------------------ sheets (modal stack with back)
function openSheet(title, html, onMount) { sheetStack.push({ title, html, onMount }); showSheet(); }
function showSheet() {
  const top = sheetStack[sheetStack.length - 1];
  if (!top) { $('#sheet').classList.add('hidden'); document.body.style.overflow = ''; return; }
  $('#sheetTitle').textContent = typeof top.title === 'function' ? top.title() : top.title;
  $('#sheetBody').innerHTML = typeof top.html === 'function' ? top.html() : top.html;
  $('#sheetBack').style.visibility = sheetStack.length > 1 ? 'visible' : 'hidden';
  $('#sheet').classList.remove('hidden'); document.body.style.overflow = 'hidden';
  $('#sheet .sheet-card').scrollTop = 0;
  if (top.onMount) top.onMount($('#sheetBody'));
  after($('#sheetBody'));
}
function closeSheet() { sheetStack.pop(); showSheet(); }
function closeAll() { sheetStack.length = 0; showSheet(); }

// ------------------------------------------------------------------ render helpers
const initials = n => String(n || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
function personColor(p) { if (p.color) return p.color; let h = 0; for (const c of String(p.id)) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 45% 42%)`; }
function avatar(p, size = 28) {
  p = typeof p === 'string' ? P0(p) : p;
  const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * .4)}px;background:${personColor(p)}`;
  if (p.photo) return `<span class="av" style="${st}" title="${esc(p.name)}"><img data-path="${esc(p.photo)}" alt="${esc(p.name)}"></span>`;
  return `<span class="av" style="${st}" title="${esc(p.name)}">${p.kind === 'group' ? '👥' : esc(initials(p.name))}</span>`;
}
const faces = (ids, size = 24, max = 6) => ids && ids.length ? `<span class="faces">${ids.slice(0, max).map(id => avatar(id, size)).join('')}${ids.length > max ? `<span class="av" style="width:${size}px;height:${size}px;background:var(--muted)">+${ids.length - max}</span>` : ''}</span>` : '';
const statCard = (v, label, id) => `<div class="stat"><b ${id ? `id="${id}"` : ''}>${v}</b><span>${esc(label)}</span></div>`;
const img = (path, cls = '', attrs = '') => `<img data-path="${esc(path)}" class="${cls}" loading="lazy" ${attrs}>`;
function bars(rows, { onClick, f = fmt, color } = {}) {
  if (!rows.length) return '<div class="empty">Nothing yet</div>';
  const max = Math.max(...rows.map(r => r[1]));
  return `<div class="list bars">${rows.map(r => `<div class="item ${onClick ? 'tap' : ''}" ${onClick ? `data-click="${esc(onClick)}" data-arg="${esc(r[0])}"` : ''}>
    <div class="t" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r[0])}</div>
    <div class="bar"><i data-w="${pct(r[1], max)}" ${color ? `style="background:${color}"` : ''}></i></div><div class="s mono" style="text-align:right;min-width:60px">${f(r[1])}</div></div>`).join('')}</div>`;
}
function tripPeople(id) { return uniq((X().legsByTrip.get(id) || []).concat(X().staysByTrip.get(id) || []).flatMap(r => r.people || [])); }
function tripCard(t) {
  const miles = tripMiles(t.id), who = tripPeople(t.id).filter(p => P0(p).kind !== 'group');
  const cover = (X().photosByTrip.get(t.id) || [])[0];
  const est = t.date_confidence && t.date_confidence !== 'Exact' ? '<span class="chip gray">dates estimated</span>' : '';
  return `<div class="card tap row" data-click="trip" data-arg="${esc(t.id)}" style="align-items:stretch">
    ${cover ? `<div style="width:64px;flex:none">${img(cover.path, '', 'style="width:64px;height:64px;object-fit:cover;border-radius:8px"')}</div>` : ''}
    <div class="grow"><div class="row between" style="align-items:flex-start"><div class="grow"><div style="font-weight:700;font-family:var(--serif);font-size:16px">${esc(t.name)}</div>
      <div class="small muted">${esc(t.place || '')}${t.start_date ? ' · ' + niceDate(t.start_date) : ''}${tripDays(t) ? ' · ' + tripDays(t) + ' days' : ''}</div></div>
      <div style="text-align:right"><b class="mono">${fmt(miles)}</b><div class="tiny muted">miles</div></div></div>
    <div class="row wrap" style="margin-top:6px;gap:6px">${faces(who, 22)}${t.status === 'Planned' ? '<span class="chip warn">Planned</span>' : ''}${t.trip_type ? `<span class="chip gray">${esc(t.trip_type)}</span>` : ''}${est}
      <span class="small muted">${esc(tripCountries(t.id).join(', '))}</span></div></div></div>`;
}
const tripDays = t => isDate(t.start_date) && isDate(t.end_date) ? daysBetween(t.start_date, t.end_date) + 1 : 0;
function tripCountries(id) {
  const c = (X().staysByTrip.get(id) || []).map(s => X().countryOf(s.place)).concat((X().legsByTrip.get(id) || []).flatMap(groundCountries));
  return uniq(c.filter(x => x && x !== F().homeCountry));
}
function photoGrid(photos) { return photos.length ? `<div class="photos">${photos.map(p => img(p.path, '', `alt="${esc(p.caption || '')}" data-click="photo" data-arg="${esc(p.id)}"`)).join('')}</div>` : ''; }
function storyLL(s) {
  const stay = s.stay_id && D().stays.find(x => x.id === s.stay_id), leg = s.leg_id && D().legs.find(x => x.id === s.leg_id), trip = X().trip[s.trip_id];
  return X().ll[s.place] || (stay && X().ll[stay.place]) || (leg && X().ll[leg.to_place]) || (trip && X().ll[trip.place]) || null;
}
function storyCard(s, clip = true) {
  const t = X().trip[s.trip_id], leg = s.leg_id && D().legs.find(x => x.id === s.leg_id);
  const ph = D().photos.filter(p => p.story_id === s.id);
  const ll = storyLL(s);
  const where = [s.place, leg ? (leg.name || '') : '', t ? t.name : ''].filter(Boolean).join(' · ');
  return `<article class="postcard">
    <div class="stamp" ${ll ? `data-stamp="${ll.join(',')}"` : 'data-stamp=""'}></div>
    <div class="kicker">${niceDate(s.date) || 'Someday'}${where ? ' · ' + esc(where) : ''}</div>
    <h3 class="tap" data-click="story" data-arg="${esc(s.id)}">${esc(s.title || 'Untitled')}</h3>
    ${(s.people || []).length ? `<div class="row" style="gap:6px;margin:4px 0 8px">${faces(s.people, 26)}<span class="small muted">${esc(s.people.map(id => P0(id).name).join(', '))}</span></div>` : ''}
    <p class="story ${clip ? 'clip' : ''}">${esc(s.body)}</p>
    ${ph.length ? `<div class="polaroids">${ph.map(p => `<div class="polaroid" data-click="photo" data-arg="${esc(p.id)}">${img(p.path)}<div>${esc(p.caption || '')}</div></div>`).join('')}</div>` : ''}
    <div class="row between" style="clear:both"><div class="row wrap" style="gap:6px">${String(s.tags || '').split(',').filter(x => x.trim()).map(x => `<span class="chip gold">#${esc(x.trim())}</span>`).join('')}</div>
      <button class="icon small" data-click="editStory" data-arg="${esc(s.id)}" aria-label="Edit">✎</button></div></article>`;
}

// ------------------------------------------------------------------ HOME
function renderHome() {
  const el = $('#page-home'), P = F(), me = P0(S.focus), today = S.today;
  const laps = P.miles / EARTH, alerts = homeAlerts(P), otd = onThisDay(P), ms = milestones(P), hrs = nerd(P).hoursInAir;
  const recent = D().stories.filter(s => has(s, S.focus) || s.author === S.focus || (P.mine(s.trip_id))).sort((a, b) => String(b.date) < String(a.date) ? -1 : 1).slice(0, 2);
  const lastYear = String(Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 12 ? 1 : 0));
  el.innerHTML = `
    <div class="board">
      <canvas class="globe" id="homeGlobe"></canvas>
      <div class="lab">${esc(me.name)} · lifetime miles</div>
      <div class="flaps" id="odo"></div>
      <div class="sub">= <b id="lapCount">0</b> laps around Earth · ${P.miles >= MOON ? fmt1(P.miles / MOON) + '× to the Moon' : pct(P.miles, MOON) + '% to the Moon'}<br>${fmt(hrs)} hours in the air · ${P.visited.length} countries · ${P.states50.length}/50 states</div>
    </div>
    <button class="hero" data-click="imHere"><b>📍 I'm here</b><span>Log tonight's place from your location${P.current ? ' · ' + esc(P.current.name) : ''}</span></button>
    <div class="cta">
      <button data-click="replay"><b>▶ Replay my travels</b><span>Every flight and drive, in order, on the map</span></button>
      <button data-click="whereWasI"><b>🕰 Where was I?</b><span>Every night since ${esc(yearOf(P.nights[0] && P.nights[0].d) || 'the start')}, on a time slider</span></button>
      <button data-click="wrapped" data-arg="${lastYear}"><b>✨ ${lastYear} Wrapped</b><span>Your year, one tap at a time</span></button>
    </div>
    ${P.current ? `<div class="section"><h2>On a trip right now</h2></div>${tripCard(P.current)}` : ''}
    ${P.upcoming.length ? `<div class="section"><h2>Coming up</h2></div>${P.upcoming.slice(0, 2).map(u => `<div class="card tap row between" data-click="trip" data-arg="${esc(u.id)}"><div><b>${esc(u.name)}</b><div class="small muted">${niceDate(u.start_date)} · ${esc(u.place || '')}</div></div><div style="text-align:right"><b class="mono" style="font-size:22px">${daysBetween(today, u.start_date)}</b><div class="tiny muted">days to go</div></div></div>`).join('')}` : ''}
    ${alerts.map(a => `<div class="card alert ${a.click ? 'tap' : ''}" ${a.click ? `data-click="${a.click}"` : ''}>${a.html}</div>`).join('')}
    <div class="section"><h2>On this day</h2><span class="kicker">${niceDate(today, false)}</span></div>
    ${otd.length ? otd.slice(0, 4).map(o => `<div class="postcard tap" ${o.trip ? `data-click="trip" data-arg="${esc(o.trip)}"` : ''}><div class="kicker">${o.yearsAgo} year${o.yearsAgo === 1 ? '' : 's'} ago · ${o.year}</div><h3>${esc(o.title)}</h3><div class="small">${esc(o.sub)}</div>${o.photos && o.photos.length ? `<div class="polaroids">${o.photos.map(p => `<div class="polaroid">${img(p.path)}</div>`).join('')}</div>` : ''}</div>`).join('') : `<div class="card empty">Nothing on ${niceDate(today, false)} in past years. Yet.</div>`}
    <div class="section"><h2>Next milestones</h2></div>
    <div class="card">${ms.map(m => `<div style="margin:6px 0 14px"><div class="row between small"><b>${esc(m.label)}</b><span class="muted mono">${esc(m.note)}</span></div><div class="bar" style="margin-top:5px"><i data-w="${m.pct}"></i></div></div>`).join('')}</div>
    ${recent.length ? `<div class="section"><h2>Latest stories</h2><a href="#" data-click="go" data-arg="stories" class="small">All stories</a></div>${recent.map(s => storyCard(s)).join('')}` : `<div class="section"><h2>Stories</h2></div><div class="card tap" data-click="newStory"><b>✎ Write your first travel story</b><div class="small muted">The bus that broke down, the meal you still think about, the person you met on a layover. Tie it to any trip, flight, drive or place.</div></div>`}
    <div class="section"><h2>Badges</h2><a href="#" data-click="go" data-arg="stats" class="small">${badges(P).filter(b => b.done).length} earned</a></div>
    <div class="badges">${badges(P).filter(b => b.done).slice(-6).reverse().map(badgeHtml).join('')}</div>`;
  odometer($('#odo'), P.miles);
  countUp($('#lapCount'), laps, { dec: 1, dur: 2200 });
  globe($('#homeGlobe'), { size: 150, laps, routes: routeLines(P.flights.slice(-60)) });
}
function routeLines(legs) { return legs.map(legEnds).filter(([a, b]) => a && b).map(([a, b]) => [[a[1], a[0]], [b[1], b[0]]]); }

function homeAlerts(P) {
  const out = [], today = S.today;
  const lb = lastBackup();
  if (db.kind !== 'local' && (!lb || daysBetween(lb, today) > 30)) out.push({ html: `<b>💾 Time for a backup</b><div class="small">${lb ? 'Last one was ' + daysBetween(lb, today) + ' days ago' : 'No backup on this device yet'}. Tap to download your data.</div>`, click: 'exportJson' });
  D().documents.filter(d => d.person_id === S.focus && isDate(d.expires)).forEach(d => {
    const left = daysBetween(today, d.expires);
    if (left <= 180) out.push({ html: `<b>🛂 ${esc(d.type || 'Document')} ${left < 0 ? 'expired' : 'expires in ' + left + ' days'}</b><div class="small">${esc(d.name || '')} · ${niceDate(d.expires)}</div>`, click: 'more' });
  });
  const sch = schengenUsed(P, today);
  if (sch >= 60) out.push({ html: `<b>🇪🇺 Schengen: ${sch} of 90 days used</b><div class="small">in the last 180 days</div>`, click: 'more' });
  return out;
}
function onThisDay(P) {
  const md = S.today.slice(5), y0 = Number(S.today.slice(0, 4)), out = [];
  P.trips.forEach(t => {
    if (!isDate(t.start_date) || (t.date_confidence && t.date_confidence !== 'Exact')) return;
    const end = isDate(t.end_date) ? t.end_date : t.start_date;
    for (let y = Number(t.start_date.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
      const d = y + '-' + md;
      if (y < y0 && d >= t.start_date && d <= end) {
        const night = P.nights.find(n => n.d === d);
        out.push({ year: y, yearsAgo: y0 - y, title: t.name, sub: night ? 'That night you slept in ' + night.place : '', trip: t.id, photos: (X().photosByTrip.get(t.id) || []).slice(0, 4) });
      }
    }
  });
  P.legs.forEach(l => {
    const y = Number(String(l.date).slice(0, 4));
    if (isDate(l.date) && l.date.slice(5) === md && y < y0 && !out.some(o => o.trip === l.trip_id && o.year === y))
      out.push({ year: y, yearsAgo: y0 - y, title: l.name || `${l.from_place} → ${l.to_place}`, sub: `${l.mode}${l.miles ? ' · ' + fmt(l.miles) + ' mi' : ''}`, trip: l.trip_id });
  });
  D().stories.forEach(s => { const y = Number(String(s.date).slice(0, 4)); if (isDate(s.date) && s.date.slice(5) === md && y < y0 && (has(s, S.focus) || P.mine(s.trip_id))) out.push({ year: y, yearsAgo: y0 - y, title: '✎ ' + (s.title || 'A story'), sub: String(s.body || '').slice(0, 140), trip: s.trip_id }); });
  return out.sort((a, b) => b.year - a.year);
}

// ------------------------------------------------------------------ milestones, badges, nerd stats
function milestones(P) {
  const c = P.visited.length, s = P.states50.length, m = P.miles;
  const nextOf = (v, steps) => steps.find(x => x > v) || v + 1;
  const laps = Math.floor(m / EARTH) + 1, nc = nextOf(c, [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 195]), nm = Math.ceil((m + 1) / 50000) * 50000;
  return [
    { label: `${laps}× around the Earth`, note: `${fmt(laps * EARTH - m)} mi to go`, pct: pct(m - (laps - 1) * EARTH, EARTH) },
    { label: `${fmt(nm)} miles`, note: `${fmt(nm - m)} mi to go`, pct: pct(m - (nm - 50000), 50000) },
    { label: `To the Moon`, note: m >= MOON ? 'made it!' : `${fmt(MOON - m)} mi to go`, pct: pct(m, MOON) },
    { label: `${nc} countries`, note: `${nc - c} to go`, pct: pct(c, nc) },
    { label: 'All 50 states', note: `${50 - s} to go`, pct: pct(s, 50) },
    { label: 'All 7 continents', note: P.continents.length >= 7 ? 'done!' : `missing ${CONTINENTS.filter(x => !P.continents.includes(x)).join(', ')}`, pct: pct(P.continents.length, 7) },
  ];
}
function badges(P) {
  const c = P.visited.length, longest = Math.max(0, ...P.flights.map(l => num(l.miles)));
  const perTrip = P.trips.map(t => tripCountries(t.id).length), n = nerd(P);
  const b = (e, nm, d, done, prog) => ({ e, n: nm, d, done: !!done, prog });
  const stories = D().stories.filter(s => s.author === P.id || has(s, P.id)).length;
  return [
    b('🧳', 'First trip', 'Took a trip', P.trips.length), b('🛂', 'Stamped', 'A night abroad', P.nightsAbroad > 0),
    b('🌍', '5 countries', '', c >= 5, `${c}/5`), b('🗺️', '10 countries', '', c >= 10, `${c}/10`), b('🧭', '25 countries', '', c >= 25, `${c}/25`), b('🏆', '50 countries', '', c >= 50, `${c}/50`),
    b('🌐', '3 continents', '', P.continents.length >= 3), b('🌏', '5 continents', '', P.continents.length >= 5), b('🐧', 'All 7', 'continents', P.continents.length >= 7),
    b('🇺🇸', '10 states', 'Slept in', P.states50.length >= 10, `${P.states50.length}/10`), b('🦅', '25 states', '', P.states50.length >= 25, `${P.states50.length}/25`), b('🗽', 'All 50', 'states', P.states50.length >= 50, `${P.states50.length}/50`),
    b('🌎', 'Around the world', '24,901 mi', P.miles >= EARTH), b('🔁', '10 laps', '249,010 mi', P.miles >= EARTH * 10),
    b('🌕', 'To the Moon', '238,900 mi', P.miles >= MOON), b('💫', 'Half a million', 'miles', P.miles >= 5e5, `${fmt(P.miles / 1000)}k`), b('🚀', 'Millionaire', '1,000,000 mi', P.miles >= 1e6),
    b('✈️', '50 flights', '', P.flights.length >= 50), b('🛫', '100 flights', '', P.flights.length >= 100), b('🛬', '250 flights', '', P.flights.length >= 250, `${P.flights.length}/250`),
    b('🕰️', 'Long haul', '5,000+ mile flight', longest >= 5000), b('💺', 'Fancy', 'Flew first class', P.legs.some(l => l.class === 'First')),
    b('🧭', 'Equator', 'Crossed it', n.equator > 0), b('📅', 'Dateline', 'Crossed it', n.dateline > 0), b('🔤', 'Airport alphabet', '13 letters', n.letters.length >= 13, `${n.letters.length}/26`),
    b('🏠', 'Year abroad', '365 nights abroad', P.nightsAbroad >= 365), b('🧳', 'Expat', 'Lived abroad', P.homes.some(h => X().countryOf(h.place) && X().countryOf(h.place) !== 'United States')),
    b('🎒', 'Globetrotter', '5 countries, 1 trip', Math.max(0, ...perTrip) >= 5), b('🚗', 'Road warrior', '10,000 road mi', P.roadMiles >= 10000, `${fmt(P.roadMiles)}`),
    b('✍️', 'Storyteller', '10 stories', stories >= 10, `${stories}/10`), b('📸', 'Shutterbug', '50 photos', D().photos.length >= 50, `${D().photos.length}/50`),
  ];
}
const badgeHtml = x => `<div class="badge ${x.done ? '' : 'locked'}"><div class="e">${x.e}</div><div class="n">${esc(x.n)}</div><div class="d">${esc(x.done ? x.d : (x.prog || x.d))}</div></div>`;

function nerd(P) {
  if (S.cache['nerd:' + P.id]) return S.cache['nerd:' + P.id];
  const homeLL = X().ll[P.homeNow] || X().ll[(P.homes[0] || {}).place];
  let tz = 0, equator = 0, dateline = 0, meridian = 0, hours = 0;
  P.legs.forEach(l => {
    const [a, b] = legEnds(l); if (!a || !b) return;
    let dl = Math.abs(a[1] - b[1]); if (dl > 180) { dl = 360 - dl; dateline++; } else if (Math.sign(a[1]) !== Math.sign(b[1]) && a[1] && b[1]) meridian++;
    if (isFlight(l)) { tz += dl / 15; hours += num(l.miles) / 500 + 0.5; }
    if (Math.sign(a[0]) !== Math.sign(b[0])) equator++;
  });
  const placesBeen = uniq(P.nights.map(n => n.place).concat(P.legs.flatMap(l => [l.from_place, l.to_place]))).filter(p => X().ll[p]);
  const by = f => placesBeen.slice().sort((a, b) => f(X().ll[b]) - f(X().ll[a]))[0];
  const far = homeLL ? placesBeen.map(p => [p, hav(homeLL, X().ll[p])]).sort((a, b) => b[1] - a[1])[0] : null;
  const letters = uniq(P.flights.flatMap(l => [l.from_airport, l.to_airport]).filter(Boolean).map(c => c[0].toUpperCase())).sort();
  const dow = sumBy(P.legs.filter(l => isDate(l.date)), l => ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][new Date(l.date + 'T12:00').getDay()], () => 1)[0];
  const month = sumBy(P.legs.filter(l => isDate(l.date)), l => MONTHS[Number(l.date.slice(5, 7)) - 1], () => 1)[0];
  const first = P.legs.map(l => l.date).filter(isDate).sort()[0];
  const awayN = P.nights.filter(n => n.away).length;
  const r = { hoursInAir: hours, tz, equator, dateline, meridian, north: by(v => v[0]), south: by(v => -v[0]), east: by(v => v[1]), west: by(v => -v[1]), far, letters, dow, month, first, awayPct: P.nights.length ? awayN / P.nights.length * 100 : 0, awayN, homeLL };
  S.cache['nerd:' + P.id] = r;
  return r;
}

// ------------------------------------------------------------------ TRIPS
function renderTrips() {
  const el = $('#page-trips'), P = F();
  const list0 = UI.tripWho === 'family' ? D().trips : P.allTrips;
  const years = uniq(list0.map(yearOfTrip).filter(Boolean)).sort().reverse();
  const types = uniq(list0.map(t => t.trip_type).filter(Boolean));
  const q = UI.tripQuery.toLowerCase();
  const list = list0.filter(t => (UI.tripYear === 'All' || yearOfTrip(t) === UI.tripYear) && (UI.tripType === 'All' || t.trip_type === UI.tripType)
    && (!q || [t.name, t.place, t.organization, tripCountries(t.id).join(' '), tripPeople(t.id).map(id => P0(id).name).join(' ')].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => String(b.start_date || '') < String(a.start_date || '') ? -1 : 1);
  el.innerHTML = `<div class="row between"><h1>Trips</h1><button class="btn small" data-click="newTrip">+ New trip</button></div>
    <input type="search" id="tripSearch" placeholder="Search trips, places, countries, people" value="${esc(UI.tripQuery)}" style="margin:8px 0">
    ${X().family.length > 1 ? `<div class="seg" style="margin-bottom:6px">${[['mine', esc(P0(S.focus).name)], ['family', 'Whole family']].map(([k, v]) => `<button class="${UI.tripWho === k ? 'on' : ''}" data-click="tripWho" data-arg="${k}">${v}</button>`).join('')}</div>` : ''}
    <div class="seg" style="margin-bottom:6px">${['All'].concat(years).map(y => `<button class="${UI.tripYear === y ? 'on' : ''}" data-click="tripYear" data-arg="${y}">${y}</button>`).join('')}</div>
    ${types.length ? `<div class="seg" style="margin-bottom:10px">${['All'].concat(types).map(y => `<button class="${UI.tripType === y ? 'on' : ''}" data-click="tripType" data-arg="${esc(y)}">${esc(y === 'All' ? 'All types' : y)}</button>`).join('')}</div>` : ''}
    <div class="small muted mono" style="margin-bottom:8px">${list.length} trips · ${fmt(sum(list, t => tripMiles(t.id)))} miles</div>
    ${list.map(tripCard).join('') || '<div class="empty">No trips match.</div>'}`;
  const s = $('#tripSearch');
  s.oninput = () => { UI.tripQuery = s.value; const pos = s.selectionStart; renderTrips(); after($('#page-trips')); const n = $('#tripSearch'); n.focus(); n.setSelectionRange(pos, pos); };
}

function tripDetail(id) {
  if (!X().trip[id]) return toast('Trip not found', true);
  openSheet(() => (X().trip[id] || {}).name || 'Trip', () => tripHtml(id), body => {
    const box = body.querySelector('#tripMap'); if (!box) return;
    const m = L.map(box, { zoomControl: false, attributionControl: false, scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(m);
    const g = L.featureGroup().addTo(m);
    (X().legsByTrip.get(id) || []).forEach(l => { const [a, b] = legEnds(l); if (a && b) L.polyline(isFlight(l) ? arcLines(a, b) : splitDateline([a, b]), { color: isFlight(l) ? '#2a78d6' : '#eb6834', weight: 2.5, dashArray: isFlight(l) ? '5 5' : null }).addTo(g); });
    (X().staysByTrip.get(id) || []).forEach(s => { const ll = X().ll[s.place]; if (ll) L.circleMarker(ll, { radius: 5 + Math.min(10, Math.sqrt(daysBetween(s.arrive, s.leave)) * 2), color: '#c8402f', fillOpacity: .7 }).bindTooltip(s.place).addTo(g); });
    (X().pinsByTrip.get(id) || []).forEach(p => { const ll = parseLL(p.latlong); if (ll) L.circleMarker(ll, { radius: 3, color: '#1baf7a', fillOpacity: 1 }).bindTooltip(p.name).addTo(g); });
    if (g.getLayers().length) m.fitBounds(g.getBounds().pad(0.2)); else m.setView([30, 0], 1);
    setTimeout(() => m.invalidateSize(), 60);
  });
}
// ------------------------------------------------------------------ day by day
// A calendar of one trip: for every date, how you got around that day and where you slept that night.
// Tap a night to change where you slept (it splits and merges the stays for you); tap + Travel to add a drive or flight on that day.
// the little vehicle that moves along a leg in replays
const legEmoji = l => isFlight(l) ? '✈️' : ({ Car: '🚗', Train: '🚆', Boat: '⛴️', Bus: '🚌', Hike: '🥾' })[l.mode] || '🚗';
const legIcon = l => l.mode === 'Flight' ? '✈︎' : l.mode === 'Train' ? '🚆' : l.mode === 'Boat' ? '⛴' : l.mode === 'Hike' ? '🥾' : l.mode === 'Bus' ? '🚌' : '🚗';
function tripRange(id) {
  const t = X().trip[id] || {}, legs = X().legsByTrip.get(id) || [], stays = X().staysByTrip.get(id) || [];
  const ds = [t.start_date, t.end_date].concat(legs.map(l => l.date), stays.flatMap(s => [s.arrive, s.leave])).filter(isDate).sort();
  return ds.length ? [ds[0], ds[ds.length - 1]] : null;
}
// The stay for one night: this trip's first, then anyone else's of yours from another trip.
function nightStay(id, d) {
  const mine = s => s.arrive <= d && d < s.leave;
  const ts = (X().staysByTrip.get(id) || []).filter(mine);
  return ts.find(s => has(s, S.focus)) || ts[0] || D().stays.find(s => mine(s) && has(s, S.focus)) || null;
}
function dayByDay(id) {
  if (!tripRange(id)) return toast('Give the trip a start and end date first (Edit).', true);
  openSheet(() => `${(X().trip[id] || {}).name || 'Trip'} · day by day`, () => dayHtml(id), () => {
    // come back to the same day after editing one
    const c = $('#sheet .sheet-card'); if (UI.dayScroll && UI.dayScroll.id === id) c.scrollTop = UI.dayScroll.y;
  });
}
function dayHtml(id) {
  const t = X().trip[id]; if (!t) return '<div class="empty">This trip was deleted.</div>';
  const [a, b] = tripRange(id), legs = orderLegs(X().legsByTrip.get(id) || []), byDay = groupBy(legs.filter(l => isDate(l.date)), l => l.date);
  const undated = legs.filter(l => !isDate(l.date)), wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const legRow = l => `<div class="item tap" data-click="editLeg" data-arg="${esc(l.id)}"><div class="grow"><div class="t">${legIcon(l)} ${esc(l.name || `${l.from_place || '?'} → ${l.to_place || '?'}`)}</div>
    <div class="s">${l.miles ? fmt(l.miles) + ' mi' : 'no miles'}${l.date_confidence && /Estimated/.test(l.date_confidence) ? ' · estimated date' : ''}</div></div><span class="icon">✎</span></div>`;
  const rows = [];
  for (let d = a, n = 1; d <= b; d = addDays(d, 1), n++) {
    const st = nightStay(id, d), last = d === b, dl = byDay.get(d) || [];
    const other = st && st.trip_id !== id ? ` <span class="chip gray">${esc((X().trip[st.trip_id] || {}).name || 'other trip')}</span>` : '';
    const night = st ? `🛏 ${esc(st.place)}${st.confidence === 'In transit' ? ' <span class="chip gray">in transit</span>' : ''}${st.confidence === 'Estimated' ? ' <span class="chip gray">estimated</span>' : ''}${other}`
      : last ? '<span class="muted">🏠 Home (last day)</span>' : '<span class="muted">🛏 Not logged — tap to set</span>';
    const wd = wk[new Date(d + 'T12:00:00').getDay()];
    rows.push(`<div class="day-row"><div class="day-h"><b>${wd}, ${niceDate(d, false)}</b><span class="tiny muted">Day ${n}</span></div>
      <div class="card list">${dl.map(legRow).join('')}
        <div class="item tap day-night" data-click="dayNight" data-arg="${esc(id + '|' + d)}"><div class="grow">${night}</div><span class="icon">✎</span></div></div>
      <button class="btn small ghost day-add" data-click="dayLeg" data-arg="${esc(id + '|' + d)}">+ Travel on ${niceDate(d, false)}</button></div>`);
  }
  return `<p class="small muted">Tap a night to change where you slept. Tap a flight or drive to edit it, or add travel on any day. Changing a night splits or joins the stays for you.</p>
    <div class="row wrap" style="gap:8px;margin:8px 0"><button class="btn small ghost" data-click="dayExtend" data-arg="${esc(id + '|-1')}">+ Day before</button><button class="btn small ghost" data-click="dayExtend" data-arg="${esc(id + '|1')}">+ Day after</button></div>
    ${rows.join('')}
    ${undated.length ? `<div class="section"><h3>No date yet</h3></div><div class="card list">${undated.map(legRow).join('')}</div>` : ''}`;
}
// Where you were at the start of a day: the end of that day's last leg so far, else where you slept the night before.
function dayStart(id, d) {
  const dl = orderLegs((X().legsByTrip.get(id) || []).filter(l => l.date === d));
  if (dl.length && dl[dl.length - 1].to_place) return dl[dl.length - 1].to_place;
  const prev = nightStay(id, addDays(d, -1)); if (prev) return prev.place;
  const home = F().nights.find(n => n.d === addDays(d, -1)); return home ? home.place : '';
}
const keepDayScroll = id => { UI.dayScroll = { id, y: $('#sheet .sheet-card').scrollTop }; };
function dayLeg(arg) {
  const i = arg.lastIndexOf('|'), id = arg.slice(0, i), d = arg.slice(i + 1); keepDayScroll(id);
  legForm({ trip: id, title: `Travel on ${niceDate(d)}`, prefill: { mode: 'Car', date: d, from_place: dayStart(id, d) } });
}
function dayNight(arg) {
  const i = arg.lastIndexOf('|'), id = arg.slice(0, i), d = arg.slice(i + 1), st = nightStay(id, d); keepDayScroll(id);
  const guess = st ? st.place : ((X().legsByTrip.get(id) || []).filter(l => l.date === d).map(l => l.to_place).filter(Boolean).pop() || '');
  openSheet(`Night of ${niceDate(d)}`, `${datalists()}<form id="nightF">
    ${field({ k: 'place', label: 'Where you slept', value: guess, list: 'placesList', hint: placeHint })}
    <div class="two">${field({ k: 'nights', label: 'Nights in a row', type: 'number', value: 1 })}${field({ k: 'transit', label: 'Layover', type: 'check', text: 'In transit (never left the airport)', value: st && st.confidence === 'In transit' })}</div>
    <p class="tiny muted">Setting more than one night also changes the nights after this one. Stays on either side in the same place are joined into one.</p>
    <div class="row" style="margin-top:16px"><button class="btn grow">Save</button>${st ? `<button type="button" class="btn danger" id="nightClear">Not on the trip this night</button>` : ''}</div></form>`, body => {
    const f = body.querySelector('#nightF');
    const go = place => submit(async () => {
      const n = Math.max(1, Math.min(60, Math.round(num(f.querySelector('[name=nights]').value) || 1)));
      if (place != null) { checkPlace(place); if (!place) throw new Error('Pick a place.'); }
      await setNights(id, d, n, place, f.querySelector('[name=transit]').checked);
      toast('Saved'); closeSheet(); refresh();
    });
    f.onsubmit = e => { e.preventDefault(); go(f.querySelector('[name=place]').value.trim()); };
    const c = body.querySelector('#nightClear'); if (c) c.onclick = () => go(null);
  });
}
// Make nights d .. d+n-1 be `place` (or nobody's stay when place is null): trims or splits the stays that overlap,
// then joins the new nights onto a matching stay right before or after.
async function setNights(id, d, n, place, transit) {
  const end = addDays(d, n), cover = nightStay(id, d);
  let people = cover && cover.people && cover.people.length ? cover.people.slice() : tripPeople(id).filter(p => P0(p).kind !== 'group');
  if (!people.includes(S.focus)) people.push(S.focus);
  const share = s => (s.people || []).some(p => people.includes(p));
  const hit = D().stays.filter(s => s.arrive < end && d < s.leave && share(s));
  const ups = new Map(), dels = new Set();
  const copy = s => { const c = Object.assign({}, s); delete c.created_at; return c; };
  hit.forEach(s => {
    const left = s.arrive < d, right = s.leave > end;
    if (left) ups.set(s.id, Object.assign(copy(s), { leave: d }));
    if (right) { const r = Object.assign(copy(s), { arrive: end }); if (left) r.id = newId(); ups.set(r.id, r); }
    if (!left && !right) dels.add(s.id);
  });
  if (place) {
    const conf = transit ? 'In transit' : 'Logged', key = s => [s.place, s.trip_id || '', s.confidence === 'In transit', (s.people || []).slice().sort().join(',')].join('|');
    let rec = { id: newId(), trip_id: id, place, arrive: d, leave: end, people, confidence: conf };
    const pool = D().stays.filter(s => !dels.has(s.id)).map(s => ups.get(s.id) || s).concat([...ups.values()].filter(u => !D().stays.some(s => s.id === u.id)));
    const prev = pool.find(s => s.leave === d && key(s) === key(rec)), next = pool.find(s => s.arrive === end && key(s) === key(rec));
    if (prev) { rec = Object.assign(copy(prev), { leave: end }); }
    if (next) { rec.leave = next.leave; if (next.id !== rec.id) { dels.add(next.id); ups.delete(next.id); } }
    ups.set(rec.id, rec);
  }
  for (const x of dels) if (D().stays.some(s => s.id === x)) await remove('stays', x);
  if (ups.size) await saveMany('stays', [...ups.values()]);
}
function dayExtend(arg) {
  const i = arg.lastIndexOf('|'), id = arg.slice(0, i), k = +arg.slice(i + 1), t = X().trip[id], [a, b] = tripRange(id); keepDayScroll(id);
  submit(async () => {
    const rec = Object.assign({}, t); delete rec.created_at;
    if (k < 0) rec.start_date = addDays(a, -1); else rec.end_date = addDays(b, 1);
    if (!isDate(rec.end_date)) rec.end_date = b; if (!isDate(rec.start_date)) rec.start_date = a;
    await save('trips', rec); refresh();
  });
}
function tripHtml(id) {
  const t = X().trip[id]; if (!t) return '<div class="empty">This trip was deleted.</div>';
  const legs = (X().legsByTrip.get(id) || []).slice().sort((a, b) => String(a.date) < String(b.date) ? -1 : 1);
  const stays = (X().staysByTrip.get(id) || []).slice().sort((a, b) => a.arrive < b.arrive ? -1 : 1);
  const stories = X().storiesByTrip.get(id) || [], photos = X().photosByTrip.get(id) || [], pins = X().pinsByTrip.get(id) || [];
  const miles = sum(legs, l => l.miles), nightsN = sum(stays, s => daysBetween(s.arrive, s.leave));
  const cost = sum(legs, l => l.cost) + sum(stays, s => s.cost) + num(t.other_cost);
  const who = tripPeople(id);
  const pack = D().packing.filter(p => p.trip_type === 'Any' || p.trip_type === (t.trip_type || ''));
  const checked = new Set(D().packing_checks.filter(c => c.trip_id === id).map(c => c.item_id));
  return `<div class="small muted">${esc(t.place || '')} · ${t.start_date ? niceDate(t.start_date) + ' – ' + niceDate(t.end_date) : 'No dates'}${t.date_confidence && t.date_confidence !== 'Exact' ? ' (' + esc(t.date_confidence) + ')' : ''}</div>
    <div class="row wrap" style="gap:6px;margin:8px 0">${t.status && t.status !== 'Done' ? `<span class="chip warn">${esc(t.status)}</span>` : ''}${t.trip_type ? `<span class="chip">${esc(t.trip_type)}</span>` : ''}${t.organization ? `<span class="chip gray">${esc(t.organization)}</span>` : ''}</div>
    ${who.length ? `<div class="row wrap" style="gap:8px;margin:8px 0">${who.map(p => `<span class="row tap" style="gap:5px" data-click="person" data-arg="${esc(p)}">${avatar(p, 28)}<span class="small">${esc(P0(p).name)}</span></span>`).join('')}</div>` : ''}
    <div id="tripMap" style="height:220px;border-radius:12px;margin:10px 0;border:1px solid var(--line)"></div>
    <div class="grid" style="margin:10px 0">${statCard(fmt(miles), 'miles')}${statCard(tripDays(t) || '–', 'days')}${statCard(fmt(nightsN), 'nights logged')}${statCard(tripCountries(id).length, 'countries')}
      ${cost ? statCard('$' + fmt(cost), `$${fmt1(miles ? cost / miles : 0)}/mile · $${fmt(nightsN ? cost / nightsN : 0)}/night`) : ''}</div>
    ${t.notes ? `<p class="small muted">${esc(t.notes)}</p>` : ''}
    <div class="row wrap" style="gap:8px;margin:12px 0">
      <button class="btn small" data-click="editTrip" data-arg="${esc(id)}">Edit</button><button class="btn small" data-click="dayByDay" data-arg="${esc(id)}">📅 Day by day</button><button class="btn small ghost" data-click="newLeg" data-arg="${esc(id)}">+ Flight/drive</button>
      <button class="btn small ghost" data-click="newStay" data-arg="${esc(id)}">+ Stay</button><button class="btn small ghost" data-click="newStory" data-arg="${esc(id)}">+ Story</button><button class="btn small gold" data-click="flyover" data-arg="${esc(id)}">🎬 Fly this trip</button>
      <button class="btn small ghost" data-click="addPhotos" data-arg="${esc(id)}">+ Photos</button><button class="btn small ghost" data-click="mapTrip" data-arg="${esc(id)}">Big map</button></div>
    ${stories.length ? `<div class="section"><h3>Stories</h3></div>${stories.map(s => storyCard(s)).join('')}` : ''}
    ${photos.length ? `<div class="section"><h3>Photos</h3></div>${photoGrid(photos)}` : ''}
    <div class="section"><h3>Flights and drives (${legs.length})</h3></div>
    <div class="card list">${legs.map(l => `<div class="item"><div class="grow"><div class="t">${l.mode === 'Flight' ? '✈︎' : l.mode === 'Train' ? '🚆' : l.mode === 'Boat' ? '⛴' : l.mode === 'Hike' ? '🥾' : '🚗'} ${esc(l.name || (l.from_place + ' → ' + l.to_place))}${l.class === 'First' ? ' <span class="chip gold">First</span>' : ''}</div>
      <div class="s">${niceDate(l.date) || 'no date'} · ${l.miles ? fmt(l.miles) + ' mi' : 'no miles'}${l.same_day ? ' · day trip' : ''}</div></div>${faces((l.people || []).filter(p => p !== S.focus), 20, 3)}
      <button class="icon" title="Return trip" data-click="returnLeg" data-arg="${esc(l.id)}">⇄</button><button class="icon" title="Edit" data-click="editLeg" data-arg="${esc(l.id)}">✎</button></div>`).join('') || '<div class="empty">None yet</div>'}</div>
    <div class="section"><h3>Where you slept (${stays.length})</h3></div>
    <div class="card list">${stays.map(s => `<div class="item"><div class="grow"><div class="t">${esc(s.place)}</div><div class="s">${niceDate(s.arrive)} → ${niceDate(s.leave)} · ${daysBetween(s.arrive, s.leave)} night${daysBetween(s.arrive, s.leave) === 1 ? '' : 's'}${s.confidence === 'Estimated' ? ' · estimated' : ''}</div></div>
      <button class="icon" data-click="editStay" data-arg="${esc(s.id)}">✎</button></div>`).join('') || '<div class="empty">None yet</div>'}</div>
    ${pins.length ? `<div class="section"><h3>Google Earth pins (${pins.length})</h3></div><div class="card small">${uniq(pins.map(p => p.name)).slice(0, 50).map(esc).join(' · ')}</div>` : ''}
    ${t.status === 'Planned' || (t.start_date && t.start_date >= S.today) ? `<div class="section"><h3>Packing list</h3><span class="small muted">${checked.size}/${pack.length}</span></div>
    <div class="card">${pack.map(p => `<label class="check"><input type="checkbox" data-change="pack" data-trip="${esc(id)}" data-item="${esc(p.id)}" ${checked.has(p.id) ? 'checked' : ''}> ${esc(p.item)} <span class="tiny muted">${esc(p.category || '')}</span></label>`).join('')}</div>` : ''}
    <div style="margin-top:20px"><button class="btn small danger" data-click="deleteTrip" data-arg="${esc(id)}">Delete trip</button></div>`;
}

// ------------------------------------------------------------------ forms
function field(f) {
  const v = f.value == null ? '' : f.value, id = 'f_' + f.k.replace(/\W/g, '_');
  let input;
  if (f.type === 'select') input = `<select id="${id}" name="${esc(f.k)}">${f.options.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`; }).join('')}</select>`;
  else if (f.type === 'textarea') input = `<textarea id="${id}" name="${esc(f.k)}" placeholder="${esc(f.ph || '')}">${esc(v)}</textarea>`;
  else if (f.type === 'check') input = `<label class="check"><input type="checkbox" id="${id}" name="${esc(f.k)}" ${v === true ? 'checked' : ''}> ${esc(f.text || '')}</label>`;
  else input = `<input id="${id}" name="${esc(f.k)}" type="${f.type || 'text'}" value="${esc(v)}" ${f.list ? `list="${f.list}"` : ''} placeholder="${esc(f.ph || '')}" autocomplete="off">`;
  return `<div><label for="${id}">${esc(f.label)}</label>${input}${f.hint ? `<div class="tiny muted" style="margin-top:3px">${f.hint}</div>` : ''}</div>`;
}
function readForm(root) {
  const out = {};
  root.querySelectorAll('[name]').forEach(el => {
    if (el.closest('[data-skip]') || el.name === 'people') return;
    out[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value.trim() || null;
  });
  const pp = root.querySelectorAll('input[name=people]');
  if (pp.length) out.people = [...pp].filter(i => i.checked).map(i => i.value);
  return out;
}
// tap faces to say who was there; type a new name to add someone
function peoplePicker(selected = []) {
  const ids = uniq(selected.concat(X().family.map(p => p.id)).concat(companions(S.focus).slice(0, 14).map(c => c.id)));
  return `<label>Who was there</label><div class="pick" id="peoplePick">${ids.map(id => `<label>${avatar(id, 24)}<input type="checkbox" name="people" value="${esc(id)}" ${selected.includes(id) ? 'checked' : ''}>${esc(P0(id).name)}</label>`).join('')}</div>
    <div class="row" style="margin-top:6px" data-skip><input id="newPersonName" placeholder="Add someone else…" list="peopleList"><button type="button" class="btn small ghost" data-click="addPickPerson">Add</button></div>`;
}
async function addPickPerson() {
  const inp = $('#newPersonName'), name = inp.value.trim(); if (!name) return;
  let p = D().people.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!p) p = await save('people', { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) + '-' + newId().slice(0, 3), name, kind: /team|group|family/i.test(name) ? 'group' : 'person' });
  if (!$(`#peoplePick input[value="${CSS.escape(p.id)}"]`)) $('#peoplePick').insertAdjacentHTML('beforeend', `<label>${avatar(p, 24)}<input type="checkbox" name="people" value="${esc(p.id)}" checked>${esc(p.name)}</label>`);
  else $(`#peoplePick input[value="${CSS.escape(p.id)}"]`).checked = true;
  inp.value = ''; hydrateImages($('#peoplePick'));
}
function datalists() {
  return `<datalist id="placesList">${D().places.map(p => `<option value="${esc(p.place)}">`).join('')}</datalist>
    <datalist id="airportsList">${D().airports.map(a => `<option value="${esc(a.code)}">${esc(a.name)}</option>`).join('')}</datalist>
    <datalist id="peopleList">${D().people.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>`;
}
function tripOptions(blank = true) {
  const sorted = D().trips.slice().sort((a, b) => String(b.start_date || '') < String(a.start_date || '') ? -1 : 1);
  return (blank ? [['', '— none —']] : []).concat(sorted.map(t => [t.id, `${t.name} (${yearOfTrip(t) || '?'})`]));
}
function checkPlace(name) { if (name && !X().place[name]) throw new Error(`"${name}" isn't in your places yet. Pick one from the list, or add it with + New place.`); }
const placeHint = '<a href="#" data-click="newPlace">+ New place</a>';
async function submit(fn) { try { await fn(); } catch (err) { toast(err.message, true); } }
function overlapCheck(rec) {
  const clash = D().stays.find(s => s.id !== rec.id && (s.people || []).some(p => (rec.people || []).includes(p)) && s.arrive < rec.leave && rec.arrive < s.leave);
  if (clash) throw new Error(`That overlaps the ${clash.place} stay (${niceDate(clash.arrive)} – ${niceDate(clash.leave)}). Someone can only sleep in one place a night.`);
}

function tripForm(id) {
  const t = id ? X().trip[id] : { status: 'Planned' }, isNew = !id;
  const orgs = uniq(D().trips.map(x => x.organization).filter(Boolean));
  openSheet(isNew ? 'New trip' : 'Edit trip', `${datalists()}<datalist id="orgList">${orgs.map(o => `<option value="${esc(o)}">`).join('')}</datalist>
    <form id="tripF">${field({ k: 'name', label: 'Trip name', value: t.name, ph: 'Spring break in Morocco' })}
    ${field({ k: 'place', label: 'Main place', value: t.place, list: 'placesList', hint: placeHint })}
    <div class="two">${field({ k: 'start_date', label: 'Start', type: 'date', value: t.start_date })}${field({ k: 'end_date', label: 'End', type: 'date', value: t.end_date })}</div>
    <div class="two">${field({ k: 'trip_type', label: 'Type', type: 'select', options: [''].concat(TRIP_TYPES), value: t.trip_type })}${field({ k: 'status', label: 'Status', type: 'select', options: ['Planned', 'Done'], value: t.status || 'Done' })}</div>
    <div class="two">${field({ k: 'organization', label: 'Organization', value: t.organization, list: 'orgList' })}${field({ k: 'other_cost', label: 'Other cost ($)', type: 'number', value: t.other_cost })}</div>
    ${field({ k: 'date_confidence', label: 'Dates are', type: 'select', options: ['Exact', 'Estimated dates', 'Estimated length'], value: t.date_confidence || 'Exact' })}
    ${field({ k: 'notes', label: 'Notes', type: 'textarea', value: t.notes })}
    ${isNew ? `${peoplePicker([S.focus])}<p class="small muted" style="margin:4px 0 0">Only tick who actually went. A trip can be anyone's, it doesn't need ${esc(P0(S.focus).name)}.</p>
      <div class="section"><h3>Flights and drives</h3><button type="button" class="btn small ghost" data-click="addLegRow">+ Add</button></div><div id="legRows" data-skip></div>
      <div class="section"><h3>Where you'll sleep</h3><button type="button" class="btn small ghost" data-click="addStayRow">+ Add</button></div><div id="stayRows" data-skip></div>` : ''}
    <button class="btn" style="width:100%;margin-top:16px">${isNew ? 'Save trip' : 'Save changes'}</button></form>`, body => {
    body.querySelector('#tripF').onsubmit = e => { e.preventDefault(); submit(async () => {
      const rec = readForm(e.target), who = rec.people || [S.focus]; delete rec.people;
      checkPlace(rec.place);
      if (!rec.name) throw new Error('Give the trip a name.');
      if (rec.start_date && rec.end_date && rec.end_date < rec.start_date) throw new Error('The end is before the start.');
      if (isNew) {
        rec.id = newId();
        const legs = [...body.querySelectorAll('#legRows .leg-row')].map(r => legFromRow(r, rec.id, who)).filter(Boolean);
        const stays = [...body.querySelectorAll('#stayRows .leg-row')].map(r => readRow(r)).filter(s => s.place).map(s => { checkPlace(s.place); if (!s.arrive || !s.leave || s.leave <= s.arrive) throw new Error(`Check the dates for ${s.place}.`); const st = { id: newId(), trip_id: rec.id, place: s.place, arrive: s.arrive, leave: s.leave, cost: s.cost ? Number(s.cost) : null, people: who, confidence: 'Logged' }; overlapCheck(st); return st; });
        await save('trips', rec); if (legs.length) await saveMany('legs', legs); if (stays.length) await saveMany('stays', stays);
        toast('Trip saved'); closeAll(); refresh(); tripDetail(rec.id);
      } else { rec.id = id; await save('trips', rec); toast('Saved'); closeSheet(); refresh(); }
    }); };
  });
}
function readRow(r) { const o = {}; r.querySelectorAll('[data-k]').forEach(el => o[el.dataset.k] = el.value.trim()); return o; }
const legRowHtml = () => `<div class="leg-row"><select data-k="mode"><option>Flight</option><option>Car</option><option>Train</option><option>Bus</option><option>Boat</option><option>Hike</option></select>
  <input type="date" data-k="date"><input data-k="from" list="airportsList" placeholder="From: airport code or place"><input data-k="to" list="airportsList" placeholder="To"><input type="number" data-k="miles" placeholder="Miles (auto)"><button type="button" class="btn small ghost" data-click="removeRow">Remove</button></div>`;
const stayRowHtml = () => `<div class="leg-row"><input data-k="place" list="placesList" placeholder="Place" style="grid-column:1/-1"><input type="date" data-k="arrive" title="First night"><input type="date" data-k="leave" title="Morning you left"><input type="number" data-k="cost" placeholder="Cost ($)"><button type="button" class="btn small ghost" data-click="removeRow">Remove</button></div>`;
function endpoint(v, mode) {
  const code = String(v || '').toUpperCase(), a = X().airport[code];
  if (mode === 'Flight' && a) return { code, place: a.place, ll: parseLL(a.latlong) || X().ll[a.place] };
  if (X().place[v]) return { code: '', place: v, ll: X().ll[v] };
  return null;
}
function legFromRow(r, tripId, who) {
  const o = readRow(r); if (!o.from && !o.to) return null;
  const a = endpoint(o.from, o.mode), b = endpoint(o.to, o.mode);
  if (!a || !b) throw new Error(`${o.from} → ${o.to}: use an airport code from your list or one of your places.`);
  const auto = Math.round(hav(a.ll, b.ll) * (o.mode === 'Flight' ? 1 : 1.25));
  return { id: newId(), trip_id: tripId, mode: o.mode, date: o.date || null, from_place: a.place, to_place: b.place, from_airport: a.code || null, to_airport: b.code || null,
    from_text: a.code ? `${a.code} – ${X().airport[a.code].name}` : a.place, to_text: b.code ? `${b.code} – ${X().airport[b.code].name}` : b.place,
    miles: o.miles ? Number(o.miles) : auto, people: who, name: a.code && b.code ? `${a.code} → ${b.code}` : `To ${b.place.split(',')[0]}`, date_confidence: o.date ? 'Exact' : 'No date', same_day: false };
}

function legForm({ id, trip, prefill, title } = {}) {
  const l = id ? D().legs.find(x => x.id === id) : Object.assign({ mode: 'Flight', trip_id: trip || (F().current || {}).id || '', date: S.today, people: trip ? tripPeople(trip).filter(p => P0(p).kind !== 'group') : [S.focus] }, prefill || {});
  if (!l.people || !l.people.length) l.people = [S.focus];
  openSheet(id ? 'Edit flight or drive' : (title || 'New flight or drive'), `${datalists()}<form id="legF">
    <div class="two">${field({ k: 'mode', label: 'How', type: 'select', options: ['Flight', 'Car', 'Train', 'Bus', 'Boat', 'Hike'], value: l.mode })}${field({ k: 'trip_id', label: 'Trip', type: 'select', options: tripOptions(), value: l.trip_id })}</div>
    <div id="flightBits"><button type="button" class="btn small ghost" style="margin-top:10px" data-click="scanPass">📷 Scan a boarding pass</button>
      <div class="two">${field({ k: 'from_airport', label: 'From airport', value: l.from_airport, list: 'airportsList', ph: 'DEN' })}${field({ k: 'to_airport', label: 'To airport', value: l.to_airport, list: 'airportsList', ph: 'LGW' })}</div><div class="tiny muted" id="apHint"></div></div>
    <div class="two">${field({ k: 'from_place', label: 'From place', value: l.from_place, list: 'placesList' })}${field({ k: 'to_place', label: 'To place', value: l.to_place, list: 'placesList', hint: placeHint })}</div>
    <div class="two">${field({ k: 'date', label: 'Date', type: 'date', value: l.date })}${field({ k: 'miles', label: 'Miles', type: 'number', value: l.miles, hint: '<span id="milesHint"></span>' })}</div>
    ${peoplePicker(l.people)}
    <div class="two">${field({ k: 'name', label: 'Name', value: l.name, ph: 'DEN → LGW' })}${field({ k: 'flight_no', label: 'Flight number', value: l.flight_no, ph: 'UA 123' })}</div>
    <div class="two">${field({ k: 'class', label: 'Class', type: 'select', options: ['', 'Economy', 'Premium', 'Business', 'First'], value: l.class })}${field({ k: 'cost', label: 'Cost ($)', type: 'number', value: l.cost })}</div>
    ${field({ k: 'same_day', label: 'Day trip', type: 'check', text: 'Came back the same day (doesn\'t change where you slept)', value: l.same_day })}
    ${field({ k: 'notes', label: 'Notes', type: 'textarea', value: l.notes })}
    <div class="row" style="margin-top:16px"><button class="btn grow">Save</button>${id ? `<button type="button" class="btn ghost" data-click="returnLeg" data-arg="${esc(id)}">⇄ Return</button><button type="button" class="btn danger" data-click="deleteLeg" data-arg="${esc(id)}">Delete</button>` : ''}</div></form>`, body => {
    const f = body.querySelector('#legF'), g = n => f.querySelector(`[name="${n}"]`);
    const sync = () => {
      const mode = g('mode').value, fa = g('from_airport').value.toUpperCase(), ta = g('to_airport').value.toUpperCase();
      body.querySelector('#flightBits').style.display = mode === 'Flight' ? '' : 'none';
      if (mode === 'Flight') {
        [['from', fa], ['to', ta]].forEach(([side, c]) => { const a = X().airport[c]; if (a && !g(side + '_place').value) g(side + '_place').value = a.place || ''; });
        body.querySelector('#apHint').textContent = [fa, ta].filter(c => c.length === 3 && !X().airport[c]).map(c => `${c} is new and will be added to your airports.`).join(' ');
        if (fa && ta && !g('name').value) g('name').value = `${fa} → ${ta}`;
      }
      const ap = c => X().airport[c] && parseLL(X().airport[c].latlong);
      const a = (mode === 'Flight' && ap(fa)) || X().ll[g('from_place').value], b = (mode === 'Flight' && ap(ta)) || X().ll[g('to_place').value];
      const est = a && b ? Math.round(hav(a, b) * (mode === 'Flight' ? 1 : 1.25)) : 0;
      body.querySelector('#milesHint').innerHTML = est ? `Estimate ${fmt(est)} mi · <a href="#" id="useEst">use it</a>` : '';
      const u = body.querySelector('#useEst'); if (u) u.onclick = e => { e.preventDefault(); g('miles').value = est; };
      if (est && !g('miles').value && !id) g('miles').value = est;
    };
    f.addEventListener('input', sync); f.addEventListener('change', sync); sync();
    f.onsubmit = e => { e.preventDefault(); submit(async () => {
      const rec = readForm(f);
      checkPlace(rec.from_place); checkPlace(rec.to_place);
      if (!rec.from_place || !rec.to_place) throw new Error('Pick where it started and ended.');
      if (rec.mode !== 'Flight') { rec.from_airport = null; rec.to_airport = null; }
      for (const side of ['from', 'to']) {
        const code = rec[side + '_airport'] = rec[side + '_airport'] ? rec[side + '_airport'].toUpperCase() : null;
        if (code && !X().airport[code]) await save('airports', { code, name: code, place: rec[side + '_place'], latlong: (X().place[rec[side + '_place']] || {}).latlong || null });
        rec[side + '_text'] = code ? `${code} – ${(X().airport[code] || {}).name || code}` : rec[side + '_place'];
      }
      if (!rec.name) rec.name = rec.mode === 'Flight' && rec.from_airport ? `${rec.from_airport} → ${rec.to_airport}` : `To ${rec.to_place.split(',')[0]}`;
      rec.date_confidence = rec.date ? (l.date_confidence && l.date === rec.date ? l.date_confidence : 'Exact') : 'No date';
      rec.id = id || newId();
      await save('legs', rec); toast('Saved'); closeSheet(); refresh();
    }); };
  });
}

function stayForm({ id, trip, prefill } = {}) {
  const s = id ? D().stays.find(x => x.id === id) : Object.assign({ trip_id: trip || (F().current || {}).id || '', arrive: S.today, leave: addDays(S.today, 1), people: trip ? tripPeople(trip).filter(p => P0(p).kind !== 'group') : [S.focus] }, prefill || {});
  openSheet(id ? 'Edit stay' : 'Where you slept', `${datalists()}<form id="stayF">
    ${field({ k: 'place', label: 'Place', value: s.place, list: 'placesList', hint: placeHint })}
    <div class="two">${field({ k: 'arrive', label: 'First night', type: 'date', value: s.arrive })}${field({ k: 'leave', label: 'Morning you left', type: 'date', value: s.leave })}</div>
    <div class="two">${field({ k: 'trip_id', label: 'Trip', type: 'select', options: tripOptions(), value: s.trip_id })}${field({ k: 'cost', label: 'Cost ($)', type: 'number', value: s.cost })}</div>
    ${peoplePicker(s.people && s.people.length ? s.people : [S.focus])}
    ${field({ k: 'confidence', label: 'Dates are', type: 'select', options: ['Logged', 'From flights/drives', 'Estimated', 'Logged live'], value: s.confidence || 'Logged' })}
    ${field({ k: 'notes', label: 'Notes', type: 'textarea', value: s.notes })}
    <div class="row" style="margin-top:16px"><button class="btn grow">Save</button>${id ? `<button type="button" class="btn danger" data-click="deleteStay" data-arg="${esc(id)}">Delete</button>` : ''}</div></form>`, body => {
    const f = body.querySelector('#stayF');
    f.querySelector('[name=arrive]').addEventListener('change', e => { const lv = f.querySelector('[name=leave]'); if (!lv.value || lv.value <= e.target.value) lv.value = addDays(e.target.value, 1); });
    f.onsubmit = e => { e.preventDefault(); submit(async () => {
      const rec = readForm(f); checkPlace(rec.place);
      if (!rec.place) throw new Error('Pick a place.');
      if (!rec.leave || rec.leave <= rec.arrive) throw new Error('"Morning you left" must be after the first night.');
      rec.id = id || newId(); overlapCheck(rec);
      await save('stays', rec); toast('Saved'); closeSheet(); refresh();
    }); };
  });
}

async function reverseGeocode(lat, lon) {
  const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&accept-language=en&lat=${lat}&lon=${lon}`);
  const j = await r.json(), a = j.address || {};
  let country = a.country || ''; const alias = { 'United States of America': 'United States', 'South Korea': 'Korea, South', 'Myanmar': 'Myanmar (Burma)', 'Czech Republic': 'Czechia' };
  country = alias[country] || country;
  return { city: a.city || a.town || a.village || a.municipality || a.county || '', state: country === 'United States' ? (a.state || '') : '', country };
}
function placeForm({ id, prefill, after: then } = {}) {
  const p = id ? X().place[id] : Object.assign({}, prefill || {});
  const countries = D().countries.map(c => c.country).sort();
  openSheet(id ? 'Edit place' : 'New place', `<form id="placeF">
    <div class="two">${field({ k: 'city', label: 'City or town', value: p.city })}${field({ k: 'state', label: 'US state', value: p.state })}</div>
    ${field({ k: 'country', label: 'Country', type: 'select', options: [''].concat(countries), value: p.country })}
    ${field({ k: 'latlong', label: 'Map spot (lat, long)', value: p.latlong, ph: '38.83, -104.82', hint: '<a href="#" id="useHere">Use where I am now</a>' })}
    ${id ? '' : field({ k: 'place', label: 'Name (optional)', value: p.place, ph: 'Leave blank for "City, State" or "City, Country"' })}
    <button class="btn" style="width:100%;margin-top:16px">Save place</button></form>`, body => {
    const f = body.querySelector('#placeF');
    body.querySelector('#useHere').onclick = e => { e.preventDefault(); submit(async () => {
      const pos = await locate(); f.latlong.value = `${pos[0].toFixed(5)}, ${pos[1].toFixed(5)}`;
      const g = await reverseGeocode(pos[0], pos[1]);
      if (g.city && !f.city.value) f.city.value = g.city; if (g.state) f.state.value = g.state; if (countries.includes(g.country)) f.country.value = g.country;
    }); };
    f.onsubmit = e => { e.preventDefault(); submit(async () => {
      const rec = readForm(f);
      if (!rec.country) throw new Error('Pick a country.');
      if (rec.latlong && !parseLL(rec.latlong)) throw new Error('The map spot should look like 38.83, -104.82');
      if (rec.country !== 'United States') rec.state = null;
      rec.place = id || rec.place || [rec.city, rec.country === 'United States' ? rec.state : rec.country].filter(Boolean).join(', ');
      if (!id && X().place[rec.place]) throw new Error(`"${rec.place}" already exists.`);
      await save('places', rec); toast('Place saved'); closeSheet();
      if (then) then(rec.place); else refresh();
    }); };
  });
}

function storyForm({ id, trip, prefill } = {}) {
  const s = id ? D().stories.find(x => x.id === id) : Object.assign({ date: S.today, trip_id: trip || (F().current || {}).id || '', people: [S.focus] }, prefill || {});
  const legOpts = t => [['', '— none —']].concat((X().legsByTrip.get(t) || []).map(l => [l.id, `${l.name || l.to_place} (${l.date || '?'})`]));
  const stayOpts = t => [['', '— none —']].concat((X().staysByTrip.get(t) || []).map(x => [x.id, `${x.place} (${x.arrive})`]));
  openSheet(id ? 'Edit story' : 'New story', `${datalists()}<form id="storyF">
    ${field({ k: 'title', label: 'Title', value: s.title, ph: 'The night the bus broke down' })}
    ${field({ k: 'body', label: 'The story', type: 'textarea', value: s.body, ph: 'What happened…' })}
    <div class="two">${field({ k: 'date', label: 'When', type: 'date', value: s.date })}${field({ k: 'place', label: 'Where', value: s.place, list: 'placesList' })}</div>
    ${peoplePicker(s.people || [])}
    <div class="two">${field({ k: 'trip_id', label: 'Trip', type: 'select', options: tripOptions(), value: s.trip_id })}<div id="legPick">${field({ k: 'leg_id', label: 'Flight or drive', type: 'select', options: legOpts(s.trip_id), value: s.leg_id })}</div></div>
    <div id="stayPick">${field({ k: 'stay_id', label: 'Stay', type: 'select', options: stayOpts(s.trip_id), value: s.stay_id })}</div>
    ${field({ k: 'tags', label: 'Tags', value: s.tags, ph: 'funny, food, ministry, lost' })}
    <label>Photos</label><input type="file" id="storyPhotos" accept="image/*" multiple data-skip>
    <div class="row" style="margin-top:16px"><button class="btn grow">Save story</button>${id ? `<button type="button" class="btn danger" data-click="deleteStory" data-arg="${esc(id)}">Delete</button>` : ''}</div></form>`, body => {
    const f = body.querySelector('#storyF');
    f.trip_id.addEventListener('change', e => { body.querySelector('#legPick').innerHTML = field({ k: 'leg_id', label: 'Flight or drive', type: 'select', options: legOpts(e.target.value) }); body.querySelector('#stayPick').innerHTML = field({ k: 'stay_id', label: 'Stay', type: 'select', options: stayOpts(e.target.value) }); });
    f.onsubmit = e => { e.preventDefault(); submit(async () => {
      const rec = readForm(f);
      if (!rec.body && !rec.title) throw new Error('Write something first.');
      checkPlace(rec.place);
      if (!rec.place && rec.stay_id) rec.place = (D().stays.find(x => x.id === rec.stay_id) || {}).place || null;
      rec.id = id || newId(); if (!id) rec.author = S.me ? S.me.id : null;
      await save('stories', rec);
      const files = body.querySelector('#storyPhotos').files;
      if (files.length) await uploadPhotos(files, { story_id: rec.id, trip_id: rec.trip_id, leg_id: rec.leg_id, stay_id: rec.stay_id, place: rec.place, date: rec.date, people: rec.people });
      toast('Story saved'); closeSheet(); refresh();
    }); };
  });
}

// photos
async function shrink(file, max = 1800) {
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read ' + file.name)); i.src = url; });
    const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas');
    c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
  } finally { URL.revokeObjectURL(url); }
}
async function uploadPhotos(files, meta) {
  let n = 0;
  for (const file of files) {
    toast(`Uploading photo ${++n} of ${files.length}…`);
    const blob = await shrink(file), pid = newId();
    const path = await db.upload(`photos/${meta.trip_id || 'misc'}/${pid}.jpg`, blob);
    await save('photos', Object.assign({ id: pid, path, date: meta.date || new Date(file.lastModified).toISOString().slice(0, 10) }, meta));
  }
  toast(`${files.length} photo${files.length === 1 ? '' : 's'} added`);
}
function pickFiles(multiple, cb, accept = 'image/*') {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
  inp.onchange = () => inp.files.length && submit(() => cb(inp.files)); inp.click();
}
function photoViewer(id) {
  const p = D().photos.find(x => x.id === id); if (!p) return;
  const t = X().trip[p.trip_id];
  openSheet(p.caption || 'Photo', `${img(p.path, '', 'style="width:100%;border-radius:12px"')}<p class="small muted">${niceDate(p.date)}${t ? ' · ' + esc(t.name) : ''}${p.place ? ' · ' + esc(p.place) : ''}</p>
    <form id="capF">${field({ k: 'caption', label: 'Caption', value: p.caption })}<div class="row" style="margin-top:12px"><button class="btn grow">Save caption</button><button type="button" class="btn danger" data-click="deletePhoto" data-arg="${esc(id)}">Delete</button></div></form>`,
    body => body.querySelector('#capF').onsubmit = e => { e.preventDefault(); submit(async () => { await save('photos', { id, path: p.path, caption: e.target.caption.value.trim() }); closeSheet(); refresh(); }); });
}

// ------------------------------------------------------------------ I'm here
function locate() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Location isn\'t available on this device.'));
    navigator.geolocation.getCurrentPosition(p => res([p.coords.latitude, p.coords.longitude]), e => rej(new Error('Could not get your location: ' + e.message)), { enableHighAccuracy: true, timeout: 15000 });
  });
}
async function imHere() {
  let pos = null;
  try { toast('Finding you…'); pos = await locate(); } catch (e) { toast(e.message, true); }
  const near = pos ? D().places.filter(p => X().ll[p.place]).map(p => ({ p: p.place, km: hav(pos, X().ll[p.place]) * 1.609 })).sort((a, b) => a.km - b.km).slice(0, 5) : [];
  const best = near[0] && near[0].km < 25 ? near[0].p : '';
  const P = F(), tonight = P.nights.find(n => n.d === S.today && n.away);
  openSheet("I'm here", `${datalists()}<p class="small muted">${pos ? `You're at ${pos[0].toFixed(4)}, ${pos[1].toFixed(4)}.` : 'Pick where you are.'} ${tonight ? `Tonight is already logged in <b>${esc(tonight.place)}</b>; saving changes it.` : ''}</p>
    <form id="hereF">${field({ k: 'place', label: 'Tonight I\'m sleeping in', value: best, list: 'placesList' })}
    ${near.length ? `<div class="row wrap" style="gap:6px;margin-top:8px">${near.map(n => `<button type="button" class="btn small ghost" data-pick="${esc(n.p)}">${esc(n.p)} · ${fmt(n.km)} km</button>`).join('')}</div>` : ''}
    <div style="margin-top:8px"><a href="#" id="hereNew">${pos ? 'Not listed? Make a new place right here' : '+ New place'}</a></div>
    ${field({ k: 'trip_id', label: 'Trip', type: 'select', options: tripOptions(), value: (P.current || {}).id || '' })}
    ${peoplePicker(P.current ? tripPeople(P.current.id).filter(p => P0(p).kind !== 'group') : [S.focus])}
    <button class="btn" style="width:100%;margin-top:16px">Log tonight</button></form>`, body => {
    const f = body.querySelector('#hereF');
    body.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => f.place.value = b.dataset.pick);
    body.querySelector('#hereNew').onclick = e => { e.preventDefault(); submit(async () => {
      let pre = {};
      if (pos) { pre.latlong = `${pos[0].toFixed(5)}, ${pos[1].toFixed(5)}`; try { Object.assign(pre, await reverseGeocode(pos[0], pos[1])); } catch (err) { /* type it */ } }
      placeForm({ prefill: pre, after: name => { showSheet(); const i = $('#hereF [name=place]'); if (i) i.value = name; } });
    }); };
    f.onsubmit = e => { e.preventDefault(); submit(async () => {
      const rec = readForm(f); if (!rec.place) throw new Error('Pick a place.'); checkPlace(rec.place);
      const who = rec.people && rec.people.length ? rec.people : [S.focus], today = S.today, tomorrow = addDays(today, 1);
      // extend yesterday's stay in the same place, otherwise start a new one; trim anything already covering tonight
      for (const st of D().stays.filter(s => s.arrive <= today && today < s.leave && (s.people || []).some(p => who.includes(p)))) {
        if (st.place === rec.place) { toast('Tonight is already logged there'); closeAll(); return; }
        if (st.arrive === today) await remove('stays', st.id); else await save('stays', Object.assign({}, st, { leave: today }));
      }
      const y = D().stays.find(s => s.leave === today && s.place === rec.place && (s.people || []).some(p => who.includes(p)));
      if (y) await save('stays', Object.assign({}, y, { leave: tomorrow }));
      else await save('stays', { id: newId(), trip_id: rec.trip_id, place: rec.place, arrive: today, leave: tomorrow, people: who, confidence: 'Logged live' });
      toast(`Logged tonight in ${rec.place}`); closeAll(); refresh();
    }); };
  });
}

// ------------------------------------------------------------------ boarding pass scan
function parseBCBP(s) {
  s = String(s || ''); if (!/^M[1-4]/.test(s) || s.length < 58) return null;
  const jd = parseInt(s.slice(44, 47), 10), cls = s.slice(47, 48);
  let date = '';
  if (jd > 0 && jd < 367) {
    // the pass doesn't carry a year: take the latest one that's no more than 30 days ahead
    const y = Number(S.today.slice(0, 4)), lim = addDays(S.today, 30);
    date = [y + 1, y, y - 1].map(yy => addDays(`${yy}-01-01`, jd - 1)).find(d => d <= lim) || '';
  }
  const clsMap = { F: 'First', A: 'First', P: 'First', J: 'Business', C: 'Business', D: 'Business', I: 'Business', Z: 'Business', W: 'Premium' };
  return { from: s.slice(30, 33).trim(), to: s.slice(33, 36).trim(), carrier: s.slice(36, 39).trim(), flight: s.slice(39, 44).trim().replace(/^0+/, ''), date, cls: clsMap[cls] || 'Economy' };
}
function scanPass() {
  let stop = () => {};
  const done = txt => {
    const r = parseBCBP(txt); if (!r) return toast("That doesn't look like a boarding pass barcode.", true);
    stop(); closeSheet();
    const f = $('#legF'); if (!f) return;
    const set = (n, v) => { const el = f.querySelector(`[name="${n}"]`); if (v && el) el.value = v; };
    set('mode', 'Flight'); set('from_airport', r.from); set('to_airport', r.to); set('date', r.date); set('class', r.cls); set('name', `${r.from} → ${r.to}`); set('flight_no', `${r.carrier} ${r.flight}`);
    f.dispatchEvent(new Event('change')); toast(`Scanned ${r.carrier}${r.flight} ${r.from} → ${r.to}`);
  };
  const legState = $('#legF') ? readForm($('#legF')) : null;
  openSheet('Scan boarding pass', `<p class="small muted">Point the camera at the barcode, or pick a photo or screenshot of it.</p><video class="scan" id="scanVid" playsinline muted></video>
    <input type="file" accept="image/*" id="scanFile" style="margin-top:10px"><label>Or paste the barcode text</label><input id="scanText" placeholder="M1DOE/JOHN …"><button class="btn small" id="scanUse" style="margin-top:8px">Use text</button>`, body => {
    const ZX = window.ZXing;
    const reader = ZX ? new ZX.BrowserMultiFormatReader(new Map([[ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.PDF_417, ZX.BarcodeFormat.AZTEC, ZX.BarcodeFormat.QR_CODE, ZX.BarcodeFormat.DATA_MATRIX]], [ZX.DecodeHintType.TRY_HARDER, true]])) : null;
    body.querySelector('#scanUse').onclick = () => done(body.querySelector('#scanText').value);
    body.querySelector('#scanFile').onchange = async e => { const file = e.target.files[0]; if (!file || !reader) return; const url = URL.createObjectURL(file); try { done((await reader.decodeFromImageUrl(url)).getText()); } catch (err) { toast('No barcode found in that image.', true); } };
    if (reader && navigator.mediaDevices) { try { reader.decodeFromVideoDevice(undefined, body.querySelector('#scanVid'), res => { if (res) done(res.getText()); }); stop = () => { try { reader.reset(); } catch (e) { /* */ } }; } catch (err) { toast('Camera not available', true); } }
    const top = sheetStack[sheetStack.length - 1]; const prev = sheetStack[sheetStack.length - 2];
    // keep what was typed in the leg form when we come back to it
    if (prev && legState) { const om = prev.onMount; prev.onMount = b => { om(b); const f = b.querySelector('#legF'); Object.entries(legState).forEach(([k, v]) => { if (f[k] && typeof v === 'string' && !f[k].value) f[k].value = v; }); prev.onMount = om; }; }
    $('#sheetClose').addEventListener('click', () => stop(), { once: true }); $('#sheetBack').addEventListener('click', () => stop(), { once: true });
    void top;
  });
}

// ------------------------------------------------------------------ STORIES
function renderStories() {
  const el = $('#page-stories'), q = UI.storyQuery.toLowerCase();
  const list = D().stories.filter(s => (!UI.storyPerson || has(s, UI.storyPerson) || s.author === UI.storyPerson)
    && (!q || [s.title, s.body, s.place, s.tags, (X().trip[s.trip_id] || {}).name, (s.people || []).map(id => P0(id).name).join(' ')].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => String(b.date) < String(a.date) ? -1 : 1);
  const tellers = uniq(D().stories.flatMap(s => (s.people || []).concat(s.author || [])).filter(Boolean)).slice(0, 20);
  const byYear = groupBy(list, s => yearOf(s.date) || 'Someday');
  el.innerHTML = `<div class="row between"><h1>Stories</h1><button class="btn small" data-click="newStory">+ Story</button></div>
    <p class="small muted">Hang a story on any trip, flight, drive, stay or place, and tag who was there. It shows up on their profile too.</p>
    <input type="search" id="storySearch" placeholder="Search stories, people, tags" value="${esc(UI.storyQuery)}" style="margin:6px 0 8px">
    ${tellers.length ? `<div class="seg" style="margin-bottom:12px"><button class="${!UI.storyPerson ? 'on' : ''}" data-click="storyPerson" data-arg="">Everyone</button>${tellers.map(id => `<button class="${UI.storyPerson === id ? 'on' : ''}" data-click="storyPerson" data-arg="${esc(id)}">${avatar(id, 18)} ${esc(P0(id).name)}</button>`).join('')}</div>` : ''}
    ${[...byYear.entries()].map(([y, ss]) => `<div class="section"><h2>${esc(y)}</h2><span class="kicker">${ss.length} stor${ss.length === 1 ? 'y' : 'ies'}</span></div>${ss.map(s => storyCard(s)).join('')}`).join('') ||
      `<div class="postcard"><h3>No stories yet</h3><p class="story">Start with the one you tell at dinner. The craziest border crossing, the flight that got diverted, the kid who taught you a card game in Tangier…</p><button class="btn" data-click="newStory">Write the first one</button></div>`}`;
  const s = $('#storySearch');
  s.oninput = () => { UI.storyQuery = s.value; const pos = s.selectionStart; renderStories(); after($('#page-stories')); const n = $('#storySearch'); n.focus(); n.setSelectionRange(pos, pos); };
}
function storyDetail(id) { const s = D().stories.find(x => x.id === id); if (s) openSheet(s.title || 'Story', () => { const x = D().stories.find(y => y.id === id); return x ? storyCard(x, false) : ''; }); }

// ------------------------------------------------------------------ PEOPLE
function raceFrames(pid, metric) {
  const comps = companions(pid).filter(c => P0(c.id).kind !== 'group' || metric !== 'faces');
  if (!comps.length) return [];
  const legs = person(pid).legs.filter(l => isDate(l.date)), years = uniq(legs.map(l => l.date.slice(0, 4))).sort();
  const order = comps.map(c => c.id), colorOf = id => { const i = order.indexOf(id); return i < 7 ? SERIES[i] : OTHER; };
  const totals = {}, tripsSeen = {};
  return years.map(y => {
    legs.filter(l => l.date.slice(0, 4) === y).forEach(l => (l.people || []).filter(o => o !== pid && X().person[o]).forEach(o => {
      if (metric === 'trips') { const k = o + '|' + l.trip_id; if (l.trip_id && !tripsSeen[k]) { tripsSeen[k] = 1; totals[o] = (totals[o] || 0) + 1; } }
      else totals[o] = (totals[o] || 0) + (metric === 'legs' ? 1 : num(l.miles));
    }));
    return { label: y, rows: Object.entries(totals).map(([id, value]) => ({ id, name: P0(id).name, value, face: avatar(id, 30), color: colorOf(id) })) };
  });
}
function familyFrames(metric) {
  const fam = X().family; if (fam.length < 2) return [];
  const all = fam.flatMap(p => person(p.id).legs.filter(l => isDate(l.date)));
  const years = uniq(all.map(l => l.date.slice(0, 4))).sort(), totals = {};
  return years.map(y => {
    fam.forEach((p, i) => {
      const P = person(p.id);
      if (metric === 'countries') { const seen = new Set(P.nights.filter(n => n.d.slice(0, 4) <= y).map(n => n.country).concat(P.legs.filter(l => String(l.date) <= y + '-12-31').flatMap(groundCountries)).filter(Boolean)); totals[p.id] = seen.size; }
      else totals[p.id] = (totals[p.id] || 0) + sum(P.legs.filter(l => String(l.date).slice(0, 4) === y), l => l.miles);
    });
    return { label: y, rows: fam.map((p, i) => ({ id: p.id, name: p.name, value: totals[p.id] || 0, face: avatar(p, 30), color: i < 7 ? SERIES[i] : OTHER })) };
  });
}
function renderPeople() {
  const el = $('#page-people'), me = P0(S.focus), comps = companions(S.focus);
  const fam = X().family, people = comps.filter(c => P0(c.id).kind !== 'group'), groups = comps.filter(c => P0(c.id).kind === 'group');
  el.innerHTML = `<div class="row between"><h1>People</h1><button class="btn small" data-click="newPerson">+ Person</button></div>
    <div class="section"><h2>Who ${esc(me.name)} travels with</h2></div>
    <div class="card"><div class="seg" style="margin-bottom:10px">${[['miles', 'Miles together'], ['trips', 'Trips together'], ['legs', 'Flights & drives']].map(([k, l]) => `<button class="${UI.raceMetric === k ? 'on' : ''}" data-click="raceMetric" data-arg="${k}">${l}</button>`).join('')}</div><div id="race"></div>
      <p class="tiny muted" style="margin:8px 0 0">Cumulative ${UI.raceMetric === 'miles' ? 'miles' : UI.raceMetric} with each person, year by year. Add faces by tapping someone below.</p></div>
    ${fam.length > 1 ? `<div class="section"><h2>Family leaderboard</h2></div><div class="card"><div class="seg" style="margin-bottom:10px"><button class="${UI.famMetric !== 'countries' ? 'on' : ''}" data-click="famMetric" data-arg="miles">Miles</button><button class="${UI.famMetric === 'countries' ? 'on' : ''}" data-click="famMetric" data-arg="countries">Countries</button></div><div id="famRace"></div></div>
      <div class="card"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr class="muted"><th style="text-align:left">Who</th><th>Miles</th><th>Countries</th><th>States</th><th>Continents</th><th>Nights away</th></tr></thead><tbody>
      ${fam.map(p => { const Q = person(p.id); return `<tr class="tap" data-click="person" data-arg="${esc(p.id)}" style="border-top:1px dashed var(--line)"><td style="padding:6px 0">${avatar(p, 26)} ${esc(p.name)}</td><td class="mono" style="text-align:center">${fmt(Q.miles)}</td><td class="mono" style="text-align:center">${Q.visited.length}</td><td class="mono" style="text-align:center">${Q.states50.length}</td><td class="mono" style="text-align:center">${Q.continents.length}</td><td class="mono" style="text-align:center">${fmt(Q.nights.filter(n => n.away).length)}</td></tr>`; }).join('')}</tbody></table></div>
      <div class="section"><h2>Who's been where</h2></div><div class="card list">${uniq(fam.flatMap(p => person(p.id).visited)).sort().map(c => `<div class="item tap" data-click="country" data-arg="${esc(c)}"><div class="grow">${esc(c)}</div>${faces(fam.filter(p => person(p.id).visited.includes(c)).map(p => p.id), 22, 8)}</div>`).join('')}</div>` :
      `<div class="card"><b>👨‍👩‍👧 Family profiles</b><p class="small muted">Tap someone below and mark them as family. They get their own map, stats and Wrapped, a login with their email, and you can race each other on miles and countries.</p></div>`}
    <div class="section"><h2>Travel companions</h2><span class="kicker">${people.length}</span></div>
    <div class="people-grid">${people.map(c => `<div class="person" data-click="person" data-arg="${esc(c.id)}">${avatar(c.id, 64)}<div class="n">${esc(P0(c.id).name)}</div><div class="s mono">${fmt(c.miles)} mi · ${c.trips} trip${c.trips === 1 ? '' : 's'}</div></div>`).join('') || '<div class="empty">Tag people on flights and drives to see them here.</div>'}</div>
    ${groups.length ? `<div class="section"><h2>Teams and groups</h2></div><div class="card list">${groups.map(c => `<div class="item tap" data-click="person" data-arg="${esc(c.id)}">${avatar(c.id, 32)}<div class="grow"><div class="t">${esc(P0(c.id).name)}</div><div class="s">${c.trips} trips · since ${yearOf(c.first) || '?'}</div></div><b class="mono">${fmt(c.miles)} mi</b></div>`).join('')}</div>` : ''}
    ${fam.filter(p => p.id !== S.focus).length ? '' : ''}`;
  race($('#race'), raceFrames(S.focus, UI.raceMetric), { unit: UI.raceMetric === 'miles' ? 'mi' : UI.raceMetric === 'trips' ? 'trips' : 'legs' });
  if (fam.length > 1) race($('#famRace'), familyFrames(UI.famMetric || 'miles'), { unit: UI.famMetric === 'countries' ? 'countries' : 'mi', top: fam.length });
}

function personDetail(id) {
  openSheet(() => P0(id).name, () => personHtml(id), body => {
    const sp = body.querySelector('#yearsTogether'); if (!sp) return;
    const c = companions(S.focus).find(x => x.id === id); if (!c) return;
    const yrs = Object.keys(c.years).sort(); if (yrs.length < 2) return;
    let tot = 0; lineChart(sp, [{ name: 'Miles together', color: 'var(--s1)', points: yrs.map(y => [new Date(+y, 11, 31), tot += c.years[y]]) }], { height: 160, unit: ' mi' });
  });
}
function personHtml(id) {
  const p = X().person[id]; if (!p) return '<div class="empty">Removed.</div>';
  const isMe = id === S.focus, c = companions(S.focus).find(x => x.id === id);
  const legs = D().legs.filter(l => has(l, id) && has(l, S.focus));
  const trips = uniq(legs.map(l => l.trip_id).filter(Boolean)).map(t => X().trip[t]).filter(Boolean).sort((a, b) => String(b.start_date) < String(a.start_date) ? -1 : 1);
  const countries = uniq(legs.flatMap(groundCountries).concat(D().stays.filter(s => has(s, id) && has(s, S.focus)).map(s => X().countryOf(s.place))).filter(Boolean));
  const stories = D().stories.filter(s => has(s, id) || s.author === id), photos = D().photos.filter(ph => has(ph, id) || (ph.trip_id && trips.some(t => t.id === ph.trip_id))).slice(0, 12);
  const Q = p.kind === 'family' ? person(id) : null;
  const longest = legs.slice().sort((a, b) => num(b.miles) - num(a.miles))[0];
  return `<div class="row" style="gap:16px;align-items:center">${avatar(p, 92)}<div class="grow"><h2 style="margin:0">${esc(p.name)}</h2>
      <div class="small muted">${p.kind === 'family' ? 'Family' : p.kind === 'group' ? 'Group' : 'Travel companion'}${p.email ? ' · ' + esc(p.email) : ''}</div>
      <div class="row wrap" style="gap:6px;margin-top:8px"><button class="btn small ghost" data-click="facePhoto" data-arg="${esc(id)}">📷 ${p.photo ? 'Change' : 'Add'} photo</button><button class="btn small ghost" data-click="editPerson" data-arg="${esc(id)}">Edit</button>
      ${p.kind === 'family' && id !== S.focus ? `<button class="btn small gold" data-click="focus" data-arg="${esc(id)}">View as ${esc(p.name)}</button>` : ''}</div></div></div>
    ${Q ? `<div class="section"><h3>${esc(p.name)}'s travel</h3></div><div class="grid">${statCard(fmt(Q.miles), 'miles')}${statCard(Q.visited.length, 'countries')}${statCard(Q.states50.length + '/50', 'states')}${statCard(fmt1(Q.miles / EARTH) + '×', 'around the Earth')}</div>` : ''}
    ${!isMe && c ? `<div class="section"><h3>With ${esc(P0(S.focus).name)}</h3></div>
      <div class="grid">${statCard(fmt(c.miles), 'miles together')}${statCard(c.trips, 'trips together')}${statCard(c.legs, 'flights & drives')}${statCard(countries.length, 'countries together')}</div>
      <p class="small">First trip together ${niceDate(c.first) || '?'}; most recent ${niceDate(c.last) || '?'}.${longest ? ` Longest ride together: ${esc(longest.name || '')}, ${fmt(longest.miles)} mi.` : ''}${countries.length ? ` Countries: ${esc(countries.join(', '))}.` : ''}</p>
      <div id="yearsTogether"></div>` : ''}
    ${stories.length ? `<div class="section"><h3>Stories</h3></div>${stories.map(s => storyCard(s)).join('')}` : ''}
    ${photos.length ? `<div class="section"><h3>Photos</h3></div>${photoGrid(photos)}` : ''}
    ${trips.length ? `<div class="section"><h3>Trips together (${trips.length})</h3></div>${trips.map(tripCard).join('')}` : ''}
    ${p.kind === 'family' && id !== S.focus && sharedStays(id).length ? `<div class="card"><b>Fill in ${esc(p.name)}'s nights</b><p class="small muted">${sharedStays(id).length} of ${esc(P0(S.focus).name)}'s stays are on trips you took together but don't list ${esc(p.name)} yet.</p><button class="btn small" data-click="shareStays" data-arg="${esc(id)}">Add ${esc(p.name)} to those stays</button></div>` : ''}
    ${p.kind === 'family' ? `<div class="section"><h3>Homes</h3><button class="btn small ghost" data-click="newHome" data-arg="${esc(id)}">+ Home</button></div>
      <div class="card list">${D().homes.filter(h => h.person_id === id).sort((a, b) => a.from_date < b.from_date ? -1 : 1).map(h => `<div class="item"><div class="grow"><div class="t">${esc(h.place)}</div><div class="s">from ${niceDate(h.from_date)}</div></div><button class="icon" data-click="deleteHome" data-arg="${esc(h.id)}">✕</button></div>`).join('') || '<div class="empty">Add where they lived so nights at home count.</div>'}</div>` : ''}`;
}
function sharedStays(id) {
  const trips = new Set(D().legs.filter(l => has(l, id) && l.trip_id).map(l => l.trip_id));
  return D().stays.filter(s => trips.has(s.trip_id) && has(s, S.focus) && !has(s, id));
}
function personForm(id) {
  const p = id ? X().person[id] : { kind: 'person' };
  openSheet(id ? 'Edit person' : 'New person', `<form id="personF">${field({ k: 'name', label: 'Name', value: p.name })}
    ${field({ k: 'kind', label: 'Who they are', type: 'select', options: [['family', 'Family (own profile and login)'], ['person', 'Travel companion'], ['group', 'Team or group']], value: p.kind })}
    ${field({ k: 'email', label: 'Email (family only, for signing in)', type: 'email', value: p.email })}
    ${field({ k: 'birthday', label: 'Birthday', type: 'date', value: p.birthday })}
    ${field({ k: 'notes', label: 'Notes', type: 'textarea', value: p.notes })}
    <div class="row" style="margin-top:16px"><button class="btn grow">Save</button>${id && id !== (S.me || {}).id ? `<button type="button" class="btn danger" data-click="deletePerson" data-arg="${esc(id)}">Delete</button>` : ''}</div></form>`, body => {
    body.querySelector('#personF').onsubmit = e => { e.preventDefault(); submit(async () => {
      const rec = readForm(e.target); if (!rec.name) throw new Error('Add a name.');
      if (rec.kind !== 'family') rec.email = rec.email || null;
      rec.id = id || rec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) + '-' + newId().slice(0, 3);
      await save('people', rec); toast('Saved'); closeSheet(); refresh();
    }); };
  });
}

// ------------------------------------------------------------------ STATS
function renderStats() {
  const el = $('#page-stats'), P = F(), me = P0(S.focus);
  const years = uniq(P.nights.map(n => n.d.slice(0, 4)).concat(P.legs.map(l => yearOf(l.date)))).filter(Boolean).sort().reverse();
  const y = UI.statsYear, Y = yearSlice(P, y), n = nerd(P);
  const recs = records(P), cost = sum(P.legs, l => l.cost) + sum(P.stays, s => s.cost);
  el.innerHTML = `<h1>${y === 'All' ? esc(me.name) + "'s stats" : esc(y) + ' in review'}</h1>
    <div class="seg" style="margin:8px 0 12px">${['All'].concat(years).map(v => `<button class="${y === v ? 'on' : ''}" data-click="statsYear" data-arg="${v}">${v === 'All' ? 'All time' : v}</button>`).join('')}</div>
    <div class="grid">${statCard(fmt(Y.miles), 'miles')}${statCard(Y.flights.length, 'flights')}${statCard(Y.trips.length, 'trips')}${statCard(Y.countries.length, y === 'All' && P.airportOnly.length ? `countries visited (+${P.airportOnly.length} airport only)` : 'countries visited')}${statCard(fmt(Y.abroad), 'nights abroad')}${statCard(Y.byState.length, 'US states slept in')}
      ${y === 'All' ? statCard(fmt1(P.daysAbroad / 7), `weeks abroad (${fmt1(P.daysAbroad / 365.25)} years)`) : ''}
      ${y === 'All' && P.homeAirport ? statCard(P.homeAirportFlights, `flights in/out of ${esc(P.homeAirport)}`) : ''}
      ${y === 'All' && cost ? statCard('$' + fmt(cost), 'logged costs') : ''}</div>
    ${y !== 'All' ? `<button class="btn gold" style="width:100%;margin-top:12px" data-click="wrapped" data-arg="${esc(y)}">✨ Play ${esc(y)} Wrapped</button>` : ''}
    ${y === 'All' ? `
    <div class="section"><h2>Miles over time</h2><span class="kicker">dashed lines = laps of Earth</span></div><div class="card"><div id="milesChart"></div></div>
    <div class="section"><h2>Countries collected</h2></div><div class="card"><div id="countryChart"></div></div>
    <div class="section"><h2>Passport</h2><span class="kicker">${P.visited.length} countries${P.airportOnly.length ? ` + ${P.airportOnly.length} airport only` : ''}</span></div><div class="card"><div class="passport">${passport(P)}</div></div>` : ''}
    <div class="section"><h2>Where you slept</h2><span class="kicker">each square is a night</span></div><div class="card" id="timelineCard">${timeline(P, y === 'All' ? S.today.slice(0, 4) : y)}</div>
    <div class="section"><h3>Nights away, by country</h3><span class="kicker">home not shown</span></div><div class="card">${bars(Y.byCountry.filter(r => r[0] !== P.homeCountry).slice(0, 20), { onClick: 'country', f: v => fmt(v) + ' n' })}</div>
    <div class="section"><h3>Nights away, by US state</h3></div><div class="card">${bars(Y.byState.filter(r => r[0] !== X().stateOf(P.homeNow)).slice(0, 20), { f: v => fmt(v) + ' n' })}</div>
    <div class="section"><h3>Nights away, by place</h3></div><div class="card">${bars(Y.byPlace.filter(r => !P.homes.some(h => h.place === r[0])).slice(0, 20), { onClick: 'place', f: v => fmt(v) + ' n' })}</div>
    ${y === 'All' ? `
    <div class="section"><h2>Nerd corner</h2><span class="kicker">🤓</span></div>
    <div class="nerd">
      ${nerdCard(fmt(n.hoursInAir) + ' h', 'in the air', `${fmt1(n.hoursInAir / 24)} days strapped to a seat (at 500 mph plus taxiing)`)}
      ${nerdCard(fmt(n.tz), 'time zones crossed', 'Every flight\'s longitude change ÷ 15°')}
      ${nerdCard(fmt1(P.miles / LIGHT_MPS) + ' s', 'at light speed', `Light would cover your ${fmt(P.miles)} miles in ${fmt1(P.miles / LIGHT_MPS)} seconds`)}
      ${n.far ? nerdCard(fmt(n.far[1]) + ' mi', 'farthest from home', `${esc(n.far[0])}. That's ${pct(n.far[1], 12450)}% of the way to the point on the exact opposite side of Earth.`) : ''}
      ${nerdCard(n.equator, 'equator crossings', `Plus ${n.dateline} over the International Date Line and ${n.meridian} over the prime meridian`)}
      ${nerdCard(fmt1(n.awayPct) + '%', 'of nights away', `${fmt(n.awayN)} of ${fmt(P.nights.length)} nights since ${yearOf(P.nights[0] && P.nights[0].d)}`)}
      ${nerdCard(fmt(P.flights.length ? P.flightMiles / P.flights.length : 0) + ' mi', 'average flight', `${P.flights.length} flights, ${fmt(P.flightMiles)} miles`)}
      ${n.dow ? nerdCard(esc(n.dow[0]), 'favorite travel day', `${n.dow[1]} flights and drives. Busiest month: ${n.month ? esc(n.month[0]) : '?'}`) : ''}
      ${nerdCard([n.north, n.south].map(x => esc((x || '').split(',')[0])).join(' ↕ '), 'northernmost ↕ southernmost', [n.east, n.west].map(x => esc((x || '').split(',')[0])).join(' ↔ ') + ' east to west')}
      <div class="card"><b>${n.letters.length}/26</b><div class="s">airport alphabet: first letters of airports used</div><div class="mono" style="margin-top:6px;letter-spacing:3px;font-size:15px">${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c => n.letters.includes(c) ? `<b style="display:inline;font-size:15px;color:var(--accent-2)">${c}</b>` : `<span style="opacity:.25">${c}</span>`).join('')}</div></div>
    </div>
    <div class="section"><h2>Badges</h2><span class="kicker">${badges(P).filter(b => b.done).length} of ${badges(P).length}</span></div><div class="badges">${badges(P).map(badgeHtml).join('')}</div>
    <div class="section"><h2>Continents</h2><span class="kicker">${P.continents.length}/7</span></div>
    <div class="card list">${CONTINENTS.map(c => { const k = P.visited.filter(v => X().continent[v] === c).length; return `<div class="item"><div class="grow">${P.continents.includes(c) ? '✅' : '⬜'} ${c}</div><div class="s mono">${k} countr${k === 1 ? 'y' : 'ies'}</div></div>`; }).join('')}</div>
    <div class="section"><h2>Records</h2></div><div class="card list">${recs.map(r => `<div class="item"><div class="grow"><div class="t">${esc(r.label)}</div><div class="s">${esc(r.sub)}</div></div><b class="mono">${esc(r.value)}</b></div>`).join('')}</div>
    <div class="section"><h2>Top lists</h2></div>${topLists(P)}
    <div class="section"><h2>Streaks and gaps</h2></div><div class="card list">${streaks(P).map(r => `<div class="item"><div class="grow"><div class="t">${esc(r.label)}</div><div class="s">${esc(r.sub || '')}</div></div><b class="mono">${esc(r.value)}</b></div>`).join('')}</div>
    <div class="section"><h3>Miles by trip type</h3></div><div class="card">${bars(sumBy(P.trips, t => t.trip_type || 'Other', t => tripMiles(t.id)), { f: v => fmt(v) + ' mi' })}</div>
    ${P.trips.some(t => t.organization) ? `<div class="section"><h3>Miles by organization</h3></div><div class="card">${bars(sumBy(P.trips.filter(t => t.organization), t => t.organization, t => tripMiles(t.id)), { f: v => fmt(v) + ' mi' })}</div>` : ''}
    <div class="section"><h2>Bucket list</h2><button class="btn small ghost" data-click="addWish">+ Country</button></div><div class="card">${bucketList(P)}</div>` : ''}`;
  if (y === 'All') {
    const legs = P.legs.filter(l => isDate(l.date)).sort((a, b) => a.date < b.date ? -1 : 1);
    let tot = 0; const pts = legs.map(l => [new Date(l.date + 'T12:00'), tot += num(l.miles)]);
    lineChart($('#milesChart'), [{ name: 'Miles', color: 'var(--s1)', points: pts }], { refs: [1, 2, 3, 4, 5, 10, 15, 20, 30, 40].map(k => ({ y: k * EARTH, label: `${k}× Earth` })), yFmt: v => v >= 1000 ? fmt(v / 1000) + 'k' : fmt(v), unit: ' mi' });
    const first = firstVisits(P); let c = 0;
    lineChart($('#countryChart'), [{ name: 'Countries', color: 'var(--s2)', points: first.map(([, d]) => [new Date(d + 'T12:00'), ++c]) }], { step: true, height: 180, unit: ' countries' });
  }
}
const nerdCard = (big, label, sub) => `<div class="card"><b>${big}</b><div class="t" style="font-weight:600">${label}</div><div class="s">${sub}</div></div>`;
function firstVisits(P) {
  const m = {};
  P.nights.forEach(n => { if (n.country && (!m[n.country] || n.d < m[n.country])) m[n.country] = n.d; });
  P.legs.filter(l => isDate(l.date)).forEach(l => groundCountries(l).forEach(c => { if (c && (!m[c] || l.date < m[c])) m[c] = l.date; }));
  return Object.entries(m).sort((a, b) => a[1] < b[1] ? -1 : 1);
}
function passport(P) {
  const first = firstVisits(P), nights = {}; P.nights.forEach(n => nights[n.country] = (nights[n.country] || 0) + 1);
  const cols = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s7)', 'var(--s8)', 'var(--s6)'];
  const layover = P.airportOnly.map(c => `<div class="pstamp" data-click="country" data-arg="${esc(c)}" style="color:var(--muted);border-style:dashed;opacity:.6">${esc(c)}<small>airport only</small></div>`).join('');
  return first.map(([c, d], i) => `<div class="pstamp" data-click="country" data-arg="${esc(c)}" style="color:${cols[i % cols.length]}">${esc(c)}<small>${niceDate(d)} · ${fmt(nights[c] || 0)} n</small></div>`).join('') + layover;
}
function timeline(P, year) {
  const top = yearSlice(P, 'All').byCountry.map(r => r[0]).filter(c => c !== P.homeCountry).slice(0, 7);
  const color = c => !c ? 'var(--line)' : c === P.homeCountry ? 'var(--accent-soft)' : top.includes(c) ? SERIES[top.indexOf(c)] : OTHER;
  const byD = {}; P.nights.forEach(n => byD[n.d] = n);
  const used = new Set();
  let html = '<div class="cal">';
  for (let m = 1; m <= 12; m++) {
    html += `<span class="m">${MONTHS[m - 1]}</span>`;
    for (let d = 1; d <= 31; d++) {
      const ds = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, ok = new Date(ds + 'T00:00Z').toISOString().slice(0, 10) === ds, n = byD[ds];
      if (n && n.country && n.country !== P.homeCountry) used.add(top.includes(n.country) ? n.country : 'Other');
      html += ok ? `<i title="${ds}${n ? ': ' + esc(n.place) : ''}" style="background:${n ? color(n.country) : 'transparent'}"></i>` : '<i style="background:transparent"></i>';
    }
  }
  const yrs = uniq(P.nights.map(n => n.d.slice(0, 4))).reverse();
  return `<div class="row between" style="margin-bottom:8px"><b class="mono">${year}</b><select style="width:auto">${yrs.map(v => `<option ${v === String(year) ? 'selected' : ''}>${v}</option>`).join('')}</select></div>${html}</d