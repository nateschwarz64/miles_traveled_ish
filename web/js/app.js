// Miles Traveled — pages, forms and actions.
import { $, esc, num, fmt, fmt1, isDate, yearOf, niceDate, addDays, daysBetween, hav, parseLL, groupBy, sum, uniq, pct, newId, sumBy, toast,
  cachedJson, arc, simplify, onVisible, EARTH, MOON, LIGHT_MPS, SCHENGEN, CONTINENTS, MONTHS, TRIP_TYPES, SERIES, OTHER, ATLAS_ALIAS, CDN } from './util.js';
import { db, S, load, save, saveMany, remove, removeWhere, derive, hydrateImages, legEnds, isFlight, groundCountries, tripMiles, has, person, yearSlice, yearOfTrip, companions, schengenUsed } from './store.js';
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
  if (UI.page === 'map' && page !== 'map') stopReplay();
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
    (X().legsByTrip.get(id) || []).forEach(l => { const [a, b] = legEnds(l); if (a && b) L.polyline(isFlight(l) ? arc(a, b) : [a, b], { color: isFlight(l) ? '#2a78d6' : '#eb6834', weight: 2.5, dashArray: isFlight(l) ? '5 5' : null }).addTo(g); });
    (X().staysByTrip.get(id) || []).forEach(s => { const ll = X().ll[s.place]; if (ll) L.circleMarker(ll, { radius: 5 + Math.min(10, Math.sqrt(daysBetween(s.arrive, s.leave)) * 2), color: '#c8402f', fillOpacity: .7 }).bindTooltip(s.place).addTo(g); });
    (X().pinsByTrip.get(id) || []).forEach(p => { const ll = parseLL(p.latlong); if (ll) L.circleMarker(ll, { radius: 3, color: '#1baf7a', fillOpacity: 1 }).bindTooltip(p.name).addTo(g); });
    if (g.getLayers().length) m.fitBounds(g.getBounds().pad(0.2)); else m.setView([30, 0], 1);
    setTimeout(() => m.invalidateSize(), 60);
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
      <button class="btn small" data-click="editTrip" data-arg="${esc(id)}">Edit</button><button class="btn small ghost" data-click="newLeg" data-arg="${esc(id)}">+ Flight/drive</button>
      <button class="btn small ghost" data-click="newStay" data-arg="${esc(id)}">+ Stay</button><button class="btn small ghost" data-click="newStory" data-arg="${esc(id)}">+ Story</button>
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
  return `<div class="row between" style="margin-bottom:8px"><b class="mono">${year}</b><select style="width:auto">${yrs.map(v => `<option ${v === String(year) ? 'selected' : ''}>${v}</option>`).join('')}</select></div>${html}</div>
    <div class="legend"><span><i style="background:var(--accent-soft)"></i>${esc(P.homeCountry)} (home)</span>${top.filter(c => used.has(c)).map(c => `<span><i style="background:${color(c)}"></i>${esc(c)}</span>`).join('')}${used.has('Other') ? `<span><i style="background:${OTHER}"></i>Other</span>` : ''}</div>`;
}
function records(P) {
  const out = [], trips = P.trips.map(t => { const legs = X().legsByTrip.get(t.id) || []; return { t, miles: sum(legs, l => l.miles), flights: legs.filter(isFlight).length, countries: tripCountries(t.id).length, days: tripDays(t) }; });
  const best = (a, f) => a.slice().sort((x, y) => f(y) - f(x))[0];
  const m = best(trips, x => x.miles); if (m) out.push({ label: 'Most miles in one trip', sub: m.t.name, value: fmt(m.miles) + ' mi' });
  const d = best(trips.filter(x => x.t.date_confidence === 'Exact'), x => x.days); if (d) out.push({ label: 'Longest trip', sub: d.t.name, value: d.days + ' days' });
  const c = best(trips, x => x.countries); if (c) out.push({ label: 'Most countries in one trip', sub: c.t.name, value: c.countries });
  const mt = best(trips, x => x.flights); if (mt) out.push({ label: 'Most flights in one trip', sub: mt.t.name, value: mt.flights });
  const st = best(P.stays, s => daysBetween(s.arrive, s.leave)); if (st) out.push({ label: 'Longest stay in one place', sub: `${st.place} · ${(X().trip[st.trip_id] || {}).name || ''}`, value: daysBetween(st.arrive, st.leave) + ' nights' });
  const lf = best(P.flights, l => num(l.miles)); if (lf) out.push({ label: 'Longest flight', sub: `${lf.name} · ${niceDate(lf.date)}`, value: fmt(lf.miles) + ' mi' });
  const rd = best(P.legs.filter(l => !isFlight(l)), l => num(l.miles)); if (rd) out.push({ label: 'Longest drive', sub: `${rd.name || rd.to_place} · ${niceDate(rd.date)}`, value: fmt(rd.miles) + ' mi' });
  const fy = sumBy(P.flights.filter(l => isDate(l.date)), l => l.date.slice(0, 4), () => 1)[0]; if (fy) out.push({ label: 'Most flights in a year', sub: fy[0], value: fy[1] });
  const my = sumBy(P.legs.filter(l => isDate(l.date)), l => l.date.slice(0, 4), l => l.miles)[0]; if (my) out.push({ label: 'Most miles in a year', sub: my[0], value: fmt(my[1]) + ' mi' });
  const ap = sumBy(P.flights.flatMap(l => [l.from_airport, l.to_airport]).filter(Boolean).map(x => ({ x })), o => o.x, () => 1)[0]; if (ap) out.push({ label: 'Most-used airport', sub: (X().airport[ap[0]] || {}).name || '', value: `${ap[0]} · ${ap[1]}×` });
  return out;
}
function topLists(P) {
  const routes = sumBy(P.flights.filter(l => l.from_airport && l.to_airport).map(l => ({ r: [l.from_airport, l.to_airport].sort().join(' ↔ ') })), o => o.r, () => 1).slice(0, 8);
  const longF = P.flights.slice().sort((a, b) => num(b.miles) - num(a.miles)).slice(0, 8).map(l => [`${l.name} · ${yearOf(l.date)}`, num(l.miles)]);
  const longR = P.legs.filter(l => !isFlight(l)).sort((a, b) => num(b.miles) - num(a.miles)).slice(0, 8).map(l => [`${l.name || l.to_place} · ${yearOf(l.date)}`, num(l.miles)]);
  const bigT = P.trips.map(t => [t.name, tripMiles(t.id)]).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const flightsY = sumBy(P.flights.filter(l => isDate(l.date)), l => l.date.slice(0, 4), () => 1).slice(0, 8);
  const fancy = P.flights.filter(l => l.class === 'First' || l.class === 'Business');
  const aps = sumBy(P.flights.flatMap(l => [l.from_airport, l.to_airport]).filter(Boolean).map(x => ({ x })), o => o.x, () => 1).slice(0, 10).map(([c, k]) => [`${c} · ${((X().airport[c] || {}).place || '').split(',')[0]}`, k]);
  return `<div class="card"><h3>Most common routes</h3>${bars(routes, { f: v => v + '×' })}</div>
    <div class="card"><h3>Longest flights</h3>${bars(longF, { f: v => fmt(v) + ' mi' })}</div>
    <div class="card"><h3>Longest drives</h3>${bars(longR, { f: v => fmt(v) + ' mi', color: 'var(--s2)' })}</div>
    <div class="card"><h3>Biggest trips</h3>${bars(bigT, { f: v => fmt(v) + ' mi' })}</div>
    <div class="card"><h3>Most flights in a year</h3>${bars(flightsY, { f: v => v + ' flights' })}</div>
    <div class="card"><h3>My airports</h3>${bars(aps, { f: v => v + '×' })}</div>
    ${fancy.length ? `<div class="card"><h3>💺 First class</h3><div class="list">${fancy.map(l => `<div class="item"><div class="grow">${esc(l.name)} <span class="s">${niceDate(l.date)}</span></div><span class="chip gold">${esc(l.class)}</span></div>`).join('')}</div></div>` : ''}`;
}
function streaks(P) {
  let bh = 0, ba = 0, h = 0, a = 0, he = '', ae = '';
  P.nights.forEach(n => { if (n.away) { a++; h = 0; if (a > ba) { ba = a; ae = n.d; } } else { h++; a = 0; if (h > bh) { bh = h; he = n.d; } } });
  const last = [...P.nights].reverse().find(n => n.away);
  const dated = P.trips.filter(t => isDate(t.start_date)).map(t => t.start_date).sort();
  let gap = 0, gEnd = '';
  for (let i = 1; i < dated.length; i++) { const g = daysBetween(dated[i - 1], dated[i]); if (g > gap) { gap = g; gEnd = dated[i]; } }
  const y0 = dated.length ? Number(dated[0].slice(0, 4)) : Number(S.today.slice(0, 4)), yrs = Number(S.today.slice(0, 4)) - y0 + 1;
  return [
    { label: 'Days since your last night away', value: last ? fmt(daysBetween(last.d, S.today)) : '–', sub: last ? `${last.place} · ${niceDate(last.d)}` : '' },
    { label: 'Longest stretch at home', value: fmt(bh) + ' nights', sub: he ? 'ending ' + niceDate(he) : '' },
    { label: 'Longest stretch away', value: fmt(ba) + ' nights', sub: ae ? 'ending ' + niceDate(ae) : '' },
    { label: 'Longest gap between trips', value: fmt(gap) + ' days', sub: gEnd ? 'until ' + niceDate(gEnd) : '' },
    { label: 'Trips per year', value: fmt1(P.trips.length / Math.max(1, yrs)), sub: `${P.trips.length} trips since ${y0}` },
  ];
}
function bucketList(P) {
  const w = D().wishes.filter(x => x.person_id === S.focus);
  return w.length ? `<div class="list">${w.map(x => `<div class="item"><div class="grow"><div class="t">${P.visited.includes(x.country) ? '✅' : '⭐'} ${esc(x.country)}</div><div class="s">${P.visited.includes(x.country) ? 'Been there now!' : esc(x.status || 'Want to go')}</div></div><button class="icon" data-click="deleteWish" data-arg="${esc(x.id)}">✕</button></div>`).join('')}</div>`
    : '<div class="empty">Add places you want to go. They glow gold on the map.</div>';
}
function countryDetail(name) {
  const P = F(), nights = P.nights.filter(n => n.country === name), places = sumBy(nights, n => n.place, () => 1);
  const trips = uniq(nights.map(n => n.trip).concat(P.legs.filter(l => [X().countryOf(l.from_place), X().countryOf(l.to_place)].includes(name)).map(l => l.trip_id)).filter(Boolean)).map(id => X().trip[id]).filter(Boolean);
  const ps = new Set(D().places.filter(p => p.country === name).map(p => p.place));
  const stories = D().stories.filter(s => ps.has(s.place)), photos = D().photos.filter(p => ps.has(p.place));
  const who = X().family.filter(p => person(p.id).visited.includes(name));
  openSheet(name, `<div class="grid">${statCard(fmt(nights.length), 'nights')}${statCard(trips.length, 'trips')}${statCard(niceDate(nights[0] && nights[0].d) || '–', 'first night')}${statCard(niceDate(nights.length ? nights[nights.length - 1].d : '') || '–', 'last night')}</div>
    ${SCHENGEN.includes(name) ? '<p><span class="chip">Schengen</span></p>' : ''}${who.length > 1 ? `<p class="row" style="gap:6px">${faces(who.map(p => p.id), 26)} <span class="small muted">family who've been</span></p>` : ''}
    <div class="section"><h3>Places</h3></div><div class="card">${bars(places, { onClick: 'place', f: v => v + ' n' })}</div>
    ${stories.length ? `<div class="section"><h3>Stories</h3></div>${stories.map(s => storyCard(s)).join('')}` : ''}${photos.length ? `<div class="section"><h3>Photos</h3></div>${photoGrid(photos)}` : ''}
    <div class="section"><h3>Trips</h3></div>${trips.map(tripCard).join('') || '<div class="small muted">Passed through only</div>'}`);
}
function placeDetail(name) {
  const p = X().place[name] || { place: name }, P = F(), nights = P.nights.filter(n => n.place === name);
  const trips = uniq(nights.map(n => n.trip).filter(Boolean)).map(id => X().trip[id]).filter(Boolean);
  const stories = D().stories.filter(s => s.place === name), photos = D().photos.filter(ph => ph.place === name), pins = D().pins.filter(x => x.place === name);
  openSheet(name, `<div class="small muted">${esc([p.city, p.state, p.country].filter(Boolean).join(', '))}</div>
    <div class="grid" style="margin:10px 0">${statCard(fmt(nights.length), 'nights')}${statCard(trips.length, 'trips')}${statCard(niceDate(nights[0] && nights[0].d) || '–', 'first night')}${statCard(niceDate(nights.length ? nights[nights.length - 1].d : '') || '–', 'last night')}</div>
    <div class="row wrap" style="gap:8px"><button class="btn small ghost" data-click="storyAtPlace" data-arg="${esc(name)}">+ Story here</button><button class="btn small ghost" data-click="photosAtPlace" data-arg="${esc(name)}">+ Photos</button><button class="btn small ghost" data-click="editPlace" data-arg="${esc(name)}">Edit place</button></div>
    ${stories.length ? `<div class="section"><h3>Stories</h3></div>${stories.map(s => storyCard(s)).join('')}` : ''}${photos.length ? `<div class="section"><h3>Photos</h3></div>${photoGrid(photos)}` : ''}
    ${trips.length ? `<div class="section"><h3>Trips</h3></div>${trips.map(tripCard).join('')}` : ''}
    ${pins.length ? `<div class="section"><h3>Google Earth pins here</h3></div><div class="card small">${uniq(pins.map(x => x.name)).map(esc).join(' · ')}</div>` : ''}`);
}

// ------------------------------------------------------------------ Wrapped
function wrapped(year) {
  const P = F(), me = P0(S.focus), Y = yearSlice(P, year);
  if (!Y.legs.length && !Y.nights.some(n => n.away)) return toast(`No travel logged for ${year} yet.`, true);
  const firsts = firstVisits(P).filter(([, d]) => d.slice(0, 4) === String(year)).map(([c]) => c);
  const top = Y.byPlace.filter(([p]) => p !== P.homeNow).slice(0, 5);
  const longest = Y.legs.slice().sort((a, b) => num(b.miles) - num(a.miles))[0];
  const comps = sumBy(Y.legs.flatMap(l => (l.people || []).filter(p => p !== S.focus && P0(p).kind !== 'group').map(p => ({ p, m: num(l.miles) }))), o => o.p, o => o.m).slice(0, 4);
  const story = D().stories.filter(s => yearOf(s.date) === String(year) && (has(s, S.focus) || P.mine(s.trip_id)))[0];
  const photo = D().photos.filter(p => yearOf(p.date) === String(year) && P.mine(p.trip_id));
  const away = Y.nights.filter(n => n.away).length;
  const slides = [
    { bg: '#1f2a44', html: `<div class="k">Miles Traveled presents</div><div class="big">${esc(year)}</div><p>${esc(me.name)}'s year in travel. Tap to continue.</p>` },
    { bg: '#2a78d6', html: `<div class="k">You traveled</div><div class="big" data-count="${Y.miles}">0</div><div class="mid">miles</div><p>That's ${fmt1(Y.miles / EARTH)} times around the Earth${Y.flights.length ? `, across ${Y.flights.length} flight${Y.flights.length === 1 ? '' : 's'}` : ''}.</p>` },
    { bg: '#c8402f', html: `<div class="k">You slept away from home</div><div class="big" data-count="${away}">0</div><div class="mid">nights</div><p>in ${Y.countries.length} countr${Y.countries.length === 1 ? 'y' : 'ies'}${Y.byState.length ? ` and ${Y.byState.length} US state${Y.byState.length === 1 ? '' : 's'}` : ''}.</p>` },
    firsts.length ? { bg: '#1baf7a', html: `<div class="k">Brand-new countries</div><div class="mid">${firsts.map(esc).join('<br>')}</div><p>First time ever. Welcome to the passport.</p>` } : null,
    top.length ? { bg: '#6250d6', html: `<div class="k">Your top places</div><div class="wlist">${top.map(([p, k], i) => `<div><span>${i + 1}</span>${esc(p.split(',')[0])} <small style="opacity:.7;font-weight:400">${k} n</small></div>`).join('')}</div>` } : null,
    longest ? { bg: '#eb6834', html: `<div class="k">Longest ${isFlight(longest) ? 'flight' : 'drive'}</div><div class="mid">${esc(longest.name || longest.to_place)}</div><div class="big" data-count="${num(longest.miles)}">0</div><p>miles on ${niceDate(longest.date)}.</p>` } : null,
    comps.length ? { bg: '#d55181', html: `<div class="k">Your travel crew</div><div class="wlist">${comps.map(([p, m]) => `<div>${avatar(p, 48)} ${esc(P0(p).name)} <small style="opacity:.75;font-weight:400">${fmt(m)} mi</small></div>`).join('')}</div>` } : null,
    story ? { bg: '#8a6a4f', html: `<div class="k">A story from ${esc(year)}</div><div class="mid">${esc(story.title || '')}</div><p style="font-family:var(--serif)">${esc(String(story.body || '').slice(0, 260))}${String(story.body || '').length > 260 ? '…' : ''}</p>` } : null,
    photo.length ? { bg: '#1b1d22', html: `<div class="k">Snapshots</div><div class="polaroids" style="justify-content:center">${photo.slice(0, 3).map(p => `<div class="polaroid">${img(p.path)}<div>${esc(p.caption || '')}</div></div>`).join('')}</div>` } : null,
    { bg: '#1f2a44', html: `<div class="k">Lifetime so far</div><div class="big">${fmt1(P.miles / EARTH)}×</div><div class="mid">around the Earth</div><p>${fmt(P.miles)} miles, ${P.visited.length} countries. See you in ${Number(year) + 1}. ✈︎</p>` },
  ].filter(Boolean);
  const box = $('#wrapped'); let i = 0, timer;
  const show = k => {
    i = Math.max(0, Math.min(slides.length - 1, k)); clearTimeout(timer);
    box.style.background = `radial-gradient(120% 90% at 20% 10%, ${slides[i].bg}, #0d1018)`;
    box.innerHTML = `<div class="bars">${slides.map((_, j) => `<i class="${j < i ? 'done' : j === i ? 'on' : ''}"><b></b></i>`).join('')}</div><button class="icon x" data-w="close">✕</button><div class="slide">${slides[i].html}</div>`;
    box.querySelectorAll('[data-count]').forEach(el => countUp(el, Number(el.dataset.count), { dur: 1600 }));
    hydrateImages(box);
    timer = setTimeout(() => i < slides.length - 1 ? show(i + 1) : null, 6000);
  };
  box.onclick = e => { if (e.target.closest('[data-w=close]')) { clearTimeout(timer); box.classList.add('hidden'); return; } show(e.clientX < innerWidth / 3 ? i - 1 : i + 1); };
  box.classList.remove('hidden'); show(0);
}

// ------------------------------------------------------------------ MAP
const mapOpts = { slept: true, routes: true, countries: false, states: false, year: 'All', trip: '', earth: {}, panelOpen: innerWidth > 640 };
function renderMap() {
  const panel = $('#mapPanel'), P = F();
  const years = uniq(P.nights.map(n => n.d.slice(0, 4))).sort().reverse();
  const folders = earthFolders();
  panel.className = 'map-panel' + (mapOpts.panelOpen ? '' : ' min');
  panel.innerHTML = `<div class="row between"><b>Layers</b><button class="icon small" data-click="mapPanel">${mapOpts.panelOpen ? '–' : '☰'}</button></div><div class="body">
    <button class="btn small gold" style="width:100%;margin:6px 0" data-click="replay">▶ Replay ${esc(P0(S.focus).name)}'s travels</button>
    <button class="btn small ghost" style="width:100%;margin:0 0 6px" data-click="whereWasI">🕰 Where was I?</button>
    <label><input type="checkbox" data-map="slept" ${mapOpts.slept ? 'checked' : ''}> Where I slept</label>
    <label><input type="checkbox" data-map="routes" ${mapOpts.routes ? 'checked' : ''}> Flights and drives</label>
    <label><input type="checkbox" data-map="countries" ${mapOpts.countries ? 'checked' : ''}> Countries by nights</label>
    <label><input type="checkbox" data-map="states" ${mapOpts.states ? 'checked' : ''}> US states</label>
    <select id="mapYear" style="margin-top:6px"><option value="All">All years</option>${years.map(y => `<option ${mapOpts.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select>
    <select id="mapTrip" style="margin-top:6px"><option value="">All trips</option>${tripOptions(false).filter(([v]) => P.mine(v)).map(([v, l]) => `<option value="${esc(v)}" ${mapOpts.trip === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    ${folders.length ? `<details ${Object.keys(mapOpts.earth).length ? 'open' : ''}><summary>Google Earth</summary><div class="row" style="gap:10px;margin:4px 0"><a href="#" data-click="earthAll">all</a><a href="#" data-click="earthNone">none</a></div>
      ${folders.map(f => `<label><input type="checkbox" data-earth="${esc(f)}" ${mapOpts.earth[f] ? 'checked' : ''}> ${esc(f)}</label>`).join('')}</details>` : ''}</div>`;
  panel.querySelectorAll('[data-map]').forEach(cb => cb.onchange = () => { mapOpts[cb.dataset.map] = cb.checked; drawMap(); });
  panel.querySelectorAll('[data-earth]').forEach(cb => cb.onchange = () => { if (cb.checked) mapOpts.earth[cb.dataset.earth] = true; else delete mapOpts.earth[cb.dataset.earth]; drawEarth(); });
  $('#mapYear').onchange = e => { mapOpts.year = e.target.value; drawMap(true); };
  $('#mapTrip').onchange = e => { mapOpts.trip = e.target.value; drawMap(true); };
  if (!map) {
    map = L.map('map', { worldCopyJump: true, zoomControl: false }).setView([30, 0], 2);
    L.control.zoom({ position: 'topleft' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap contributors' }).addTo(map);
  }
  setTimeout(() => map.invalidateSize(), 60);
  drawMap();
}
async function drawMap(fit) {
  if (!map) return;
  Object.values(mapLayers).forEach(l => map.removeLayer(l)); mapLayers = {};
  const P = F(), inY = d => mapOpts.year === 'All' || String(d || '').slice(0, 4) === mapOpts.year, inT = id => !mapOpts.trip || id === mapOpts.trip;
  const nights = P.nights.filter(n => inY(n.d) && (!mapOpts.trip || n.trip === mapOpts.trip));
  if (mapOpts.countries) {
    try {
      const topo = await cachedJson(CDN.world), counts = {}; nights.forEach(n => { if (n.country) counts[n.country] = (counts[n.country] || 0) + 1; });
      const max = Math.max(1, ...Object.values(counts)), visited = new Set(P.visited), airport = new Set(P.airportOnly), wish = new Set(D().wishes.filter(w => w.person_id === S.focus).map(w => w.country));
      mapLayers.countries = L.geoJSON(topojson.feature(topo, topo.objects.countries), {
        style: f => { const n = ATLAS_ALIAS[f.properties.name] || f.properties.name, c = counts[n] || 0, w = wish.has(n) && !visited.has(n);
          return { weight: w ? 2 : .5, color: w ? '#c98a12' : '#8899aa', fillColor: w ? '#e3bb5b' : c ? '#1f4e79' : visited.has(n) ? '#6fa0d8' : airport.has(n) ? '#b9b2a3' : '#cccccc', fillOpacity: w ? .45 : c ? .25 + .6 * Math.sqrt(c / max) : visited.has(n) ? .35 : airport.has(n) ? .3 : .05 }; },
        onEachFeature: (f, layer) => { const n = ATLAS_ALIAS[f.properties.name] || f.properties.name; layer.bindTooltip(`${esc(n)}: ${airport.has(n) ? 'airport only' : fmt(counts[n] || 0) + ' nights'}`); layer.on('click', () => X().continent[n] !== undefined && countryDetail(n)); },
      }).addTo(map);
    } catch (e) { toast('Could not load the countries map', true); }
  }
  if (mapOpts.states) {
    try {
      const topo = await cachedJson(CDN.us), counts = {}; nights.filter(n => n.country === 'United States').forEach(n => { const s = X().stateOf(n.place); if (s) counts[s] = (counts[s] || 0) + 1; });
      mapLayers.states = L.geoJSON(topojson.feature(topo, topo.objects.states), { style: f => ({ weight: .7, color: '#7a8a8c', fillColor: counts[f.properties.name] ? '#1f4e79' : '#eb6834', fillOpacity: counts[f.properties.name] ? .45 : .12 }), onEachFeature: (f, l) => l.bindTooltip(`${esc(f.properties.name)}: ${counts[f.properties.name] ? fmt(counts[f.properties.name]) + ' nights' : 'not yet'}`) }).addTo(map);
    } catch (e) { toast('Could not load the states map', true); }
  }
  if (mapOpts.routes) {
    const g = L.featureGroup();
    P.legs.filter(l => inY(l.date) && inT(l.trip_id)).forEach(l => {
      const [a, b] = legEnds(l); if (!a || !b || (a[0] === b[0] && a[1] === b[1])) return;
      L.polyline(isFlight(l) ? arc(a, b) : [a, b], { color: isFlight(l) ? '#2a78d6' : '#eb6834', weight: isFlight(l) ? 1.6 : 2.6, opacity: .7, dashArray: isFlight(l) ? '4 4' : null })
        .bindPopup(`<b>${esc(l.name || '')}</b><br>${niceDate(l.date)} · ${fmt(l.miles)} mi<br>${esc((X().trip[l.trip_id] || {}).name || '')}<br>${(l.people || []).filter(p => p !== S.focus).map(p => esc(P0(p).name)).join(', ')}`).addTo(g);
    });
    mapLayers.routes = g.addTo(map);
  }
  if (mapOpts.slept) {
    const counts = {}; nights.forEach(n => counts[n.place] = (counts[n.place] || 0) + 1);
    const g = L.featureGroup();
    Object.entries(counts).forEach(([p, n]) => {
      const ll = X().ll[p]; if (!ll) return;
      const home = P.homes.some(h => h.place === p);
      L.circleMarker(ll, { radius: Math.min(26, 4 + Math.sqrt(n) * 1.6), color: home ? '#1baf7a' : '#c8402f', weight: 1, fillColor: home ? '#1baf7a' : '#c8402f', fillOpacity: .5 })
        .bindPopup(`<b>${esc(p)}</b><br>${fmt(n)} night${n === 1 ? '' : 's'}<br><a href="#" data-click="place" data-arg="${esc(p)}">Open</a> · <a href="#" data-click="storyAtPlace" data-arg="${esc(p)}">+ Story</a>`).addTo(g);
    });
    mapLayers.slept = g.addTo(map);
  }
  if (fit) { const layers = [mapLayers.slept, mapLayers.routes].filter(Boolean), b = layers.length ? L.featureGroup(layers).getBounds() : null; if (b && b.isValid()) map.fitBounds(b.pad(.15)); }
  drawEarth();
}
function earthFolders() { return uniq(D().layers.flatMap(l => (l.geojson.features || []).map(f => f.properties.folder || l.name))); }
function drawEarth() {
  if (!map) return;
  earthDrawn.forEach(l => map.removeLayer(l)); earthDrawn = [];
  const on = Object.keys(mapOpts.earth); if (!on.length) return;
  const all = earthFolders();
  D().layers.forEach(layer => on.forEach(folder => {
    const feats = (layer.geojson.features || []).filter(f => (f.properties.folder || layer.name) === folder); if (!feats.length) return;
    const i = all.indexOf(folder), col = i < 8 ? ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'][i] : '#8a8576';
    earthDrawn.push(L.geoJSON({ type: 'FeatureCollection', features: feats }, {
      style: () => ({ color: col, weight: 2.5, opacity: .85 }),
      pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 4, color: '#fff', weight: 1, fillColor: col, fillOpacity: 1 }),
      onEachFeature: (f, l) => { const p = f.properties || {}; l.bindPopup(`<b>${esc(p.name || '')}</b><br><span class="small">${esc([p.folder, p.sub].filter(Boolean).join(' / '))}</span>${p.description ? '<br>' + esc(p.description).slice(0, 300) : ''}`); },
    }).addTo(map));
  }));
}

// Replay: every flight and drive in date order, drawn like a time-lapse
function startReplay() {
  if (UI.page !== 'map') { go('map'); setTimeout(startReplay, 300); return; }
  stopReplay();
  const P = F(), inY = d => mapOpts.year === 'All' || String(d || '').slice(0, 4) === mapOpts.year;
  const legs = P.legs.filter(l => isDate(l.date) && inY(l.date) && (!mapOpts.trip || l.trip_id === mapOpts.trip)).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.id).localeCompare(String(b.id))).map(l => ({ l, e: legEnds(l) })).filter(x => x.e[0] && x.e[1]);
  if (!legs.length) return toast('Nothing to replay yet.', true);
  Object.values(mapLayers).forEach(l => map.removeLayer(l)); mapLayers = {};
  const g = L.featureGroup().addTo(map), plane = L.marker(legs[0].e[0], { icon: L.divIcon({ className: 'plane-icon', html: '✈️', iconSize: [20, 20] }) }).addTo(g);
  const bar = $('#replayBar'); bar.classList.remove('hidden');
  bar.innerHTML = `<div class="grow"><b id="rpDate">—</b><div class="s" id="rpSub"></div></div><div style="text-align:right"><b id="rpMiles">0</b><div class="s">miles</div></div><button id="rpSpeed">1×</button><button id="rpStop">■</button>`;
  map.fitBounds(L.latLngBounds(legs.flatMap(x => x.e)).pad(.1));
  const st = replayState = { stop: false, speed: 1, miles: 0, countries: new Set() };
  $('#rpSpeed').onclick = () => { st.speed = st.speed === 1 ? 4 : st.speed === 4 ? 16 : 1; $('#rpSpeed').textContent = st.speed + '×'; };
  $('#rpStop').onclick = () => { stopReplay(); drawMap(); };
  let i = 0;
  const nextLeg = () => {
    if (st.stop) return;
    if (i >= legs.length) { $('#rpSub').textContent = `Done! ${legs.length} legs, ${st.countries.size} countries.`; return; }
    const { l, e: [a, b] } = legs[i++], pts = isFlight(l) ? arc(a, b, 40) : [a, b].map((p, k, arr) => p);
    const line = L.polyline([pts[0]], { color: isFlight(l) ? '#2a78d6' : '#eb6834', weight: 2, opacity: .85 }).addTo(g);
    groundCountries(l).forEach(c => st.countries.add(c));
    $('#rpDate').textContent = niceDate(l.date);
    $('#rpSub').textContent = `${l.name || l.to_place} · ${(X().trip[l.trip_id] || {}).name || ''} · ${st.countries.size} countries`;
    const dur = Math.max(160, Math.min(1400, 200 + Math.sqrt(num(l.miles)) * 12)) / st.speed, t0 = performance.now(), m0 = st.miles;
    const full = pts.length > 2 ? pts : Array.from({ length: 21 }, (_, k) => [a[0] + (b[0] - a[0]) * k / 20, a[1] + (b[1] - a[1]) * k / 20]);
    const tick = t => {
      if (st.stop) return;
      const k = Math.min(1, (t - t0) / dur), n = Math.max(1, Math.round(k * (full.length - 1)));
      line.setLatLngs(full.slice(0, n + 1)); plane.setLatLng(full[n]);
      st.miles = m0 + num(l.miles) * k; $('#rpMiles').textContent = fmt(st.miles);
      if (k < 1) requestAnimationFrame(tick); else setTimeout(nextLeg, 60 / st.speed);
    };
    requestAnimationFrame(tick);
  };
  nextLeg();
  mapLayers.replay = g;
}
// "Where was I?": scrub or play through every night since the first one. A glowing pin sits where you slept,
// a trail shows the last few places, dots light up as you first reach them, and the counters keep score.
function startWhereWasI() {
  if (UI.page !== 'map') { go('map'); setTimeout(startWhereWasI, 300); return; }
  stopReplay();
  const P = F(), nights = P.nights.filter(n => X().ll[n.place]);
  if (!nights.length) return toast('No nights logged yet.', true);
  Object.values(mapLayers).forEach(l => map.removeLayer(l)); mapLayers = {};
  // running totals as of each night
  const legs = P.legs.filter(l => isDate(l.date)).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const seen = new Set(), tot = [], changes = [], first = {};
  let li = 0, miles = 0, abroad = 0;
  nights.forEach((n, i) => {
    while (li < legs.length && legs[li].date <= n.d) { miles += num(legs[li].miles); groundCountries(legs[li]).forEach(c => seen.add(c)); li++; }
    if (n.country) seen.add(n.country);
    if (n.country && n.country !== P.homeCountry) abroad++;
    tot.push({ miles, abroad, countries: [...seen].filter(c => c !== P.homeCountry).length });
    if (!i || n.place !== nights[i - 1].place) changes.push(i);
    if (first[n.place] === undefined) first[n.place] = i;
  });
  const g = L.featureGroup().addTo(map);
  const dots = Object.keys(first).map(p => ({ p, i: first[p], on: null, m: L.circleMarker(X().ll[p], { radius: 4, color: '#fff', weight: 1, fillColor: '#eda100', fillOpacity: 1 }).bindTooltip(esc(p)) }));
  const trail = L.polyline([], { color: '#eda100', weight: 2.5, opacity: .8 }).addTo(g);
  const pin = L.marker(X().ll[nights[0].place], { icon: L.divIcon({ className: 'wwi-pin', html: '<span></span>', iconSize: [18, 18] }), zIndexOffset: 1000 }).addTo(g);
  map.fitBounds(L.latLngBounds(dots.map(d => X().ll[d.p])).pad(.1));
  const bar = $('#replayBar'); bar.classList.remove('hidden'); bar.classList.add('wwi');
  bar.innerHTML = `<div class="wwi-top"><div class="grow"><b id="wwDate">—</b><div class="s" id="wwSub"></div></div>
      <div class="wwi-stat"><b id="wwAbroad">0</b><div class="s">nights abroad</div></div><div class="wwi-stat"><b id="wwCountries">0</b><div class="s">countries</div></div><div class="wwi-stat"><b id="wwMiles">0</b><div class="s">miles</div></div></div>
    <div class="wwi-bottom"><button id="wwPlay">▶</button><input id="wwRange" type="range" min="0" max="${nights.length - 1}" value="0" aria-label="Date"><button id="wwSpeed">1×</button><button id="wwStop">■</button></div>`;
  const st = replayState = { stop: false, speed: 1, playing: false, pos: 0, last: -1 };
  const show = i => {
    if (i === st.last) return;
    const n = nights[i], t = tot[i], ll = X().ll[n.place], moved = st.last < 0 || nights[st.last].place !== n.place;
    st.last = i;
    pin.setLatLng(ll);
    dots.forEach(d => { const on = d.i <= i; if (on !== d.on) { d.on = on; on ? d.m.addTo(g) : g.removeLayer(d.m); } });
    // trail through the last 12 places, found from the list of nights where the place changed
    let lo = 0, hi = changes.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (changes[mid] <= i) lo = mid; else hi = mid - 1; }
    trail.setLatLngs(changes.slice(Math.max(0, lo - 11), lo + 1).map(k => X().ll[nights[k].place]));
    $('#wwDate').textContent = niceDate(n.d);
    const trip = n.trip && X().trip[n.trip];
    $('#wwSub').textContent = `${n.place}${n.away ? (trip ? ' · ' + trip.name : '') : ' · home'}${n.transit ? ' · in transit' : ''}`;
    $('#wwAbroad').textContent = fmt(t.abroad); $('#wwCountries').textContent = t.countries; $('#wwMiles').textContent = fmt(t.miles);
    $('#wwRange').value = i;
    if (moved && !map.getBounds().pad(-.1).contains(ll)) map.panTo(ll, { animate: true, duration: .6 });
  };
  const play = on => { st.playing = on; $('#wwPlay').textContent = on ? '❚❚' : '▶'; if (on) { st.t = performance.now(); requestAnimationFrame(tick); } };
  // nights per second: trips play slowly enough to follow, long stretches at home fly by
  const tick = t => {
    if (st.stop || !st.playing) return;
    const dt = Math.min(.1, (t - st.t) / 1000); st.t = t;
    const n = nights[Math.floor(st.pos)];
    st.pos += dt * st.speed * (n.away ? 5 : 60);
    if (st.pos >= nights.length - 1) { st.pos = nights.length - 1; show(st.pos); play(false); return; }
    show(Math.floor(st.pos));
    requestAnimationFrame(tick);
  };
  $('#wwRange').oninput = e => { st.pos = +e.target.value; show(st.pos); };
  $('#wwPlay').onclick = () => { if (st.pos >= nights.length - 1) st.pos = 0; play(!st.playing); };
  $('#wwSpeed').onclick = () => { st.speed = st.speed === 1 ? 4 : st.speed === 4 ? 16 : 1; $('#wwSpeed').textContent = st.speed + '×'; };
  $('#wwStop').onclick = () => { stopReplay(); drawMap(); };
  show(0);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) play(true);
  mapLayers.replay = g;
}
function stopReplay() { if (replayState) { replayState.stop = true; replayState = null; } const b = $('#replayBar'); if (b) { b.classList.add('hidden'); b.classList.remove('wwi'); } }

// ------------------------------------------------------------------ MORE (planning and tools)
function missingInfo() {
  const P = F(), g = [];
  g.push({ title: 'Trips with estimated or missing dates', items: P.trips.filter(t => (t.date_confidence && t.date_confidence !== 'Exact') || !isDate(t.start_date)).map(t => ({ label: t.name, sub: t.date_confidence || 'No dates', click: 'trip', arg: t.id })) });
  g.push({ title: 'Flights and drives with no trip', items: P.legs.filter(l => !l.trip_id).map(l => ({ label: l.name || l.id, sub: l.date || '', click: 'editLeg', arg: l.id })) });
  g.push({ title: 'Flights and drives with no miles', items: P.legs.filter(l => !num(l.miles) && !l.same_day).map(l => ({ label: l.name || l.id, sub: (X().trip[l.trip_id] || {}).name || '', click: 'editLeg', arg: l.id })) });
  g.push({ title: 'Flights and drives with no date', items: P.legs.filter(l => !isDate(l.date)).map(l => ({ label: l.name || l.id, sub: (X().trip[l.trip_id] || {}).name || '', click: 'editLeg', arg: l.id })) });
  g.push({ title: 'Estimated stays', items: P.stays.filter(s => s.confidence === 'Estimated').map(s => ({ label: s.place, sub: `${niceDate(s.arrive)} · ${(X().trip[s.trip_id] || {}).name || ''}`, click: 'editStay', arg: s.id })) });
  g.push({ title: 'Places with no map spot', items: D().places.filter(p => !parseLL(p.latlong)).map(p => ({ label: p.place, sub: '', click: 'editPlace', arg: p.place })) });
  g.push({ title: 'People with no photo', items: companions(S.focus).filter(c => !P0(c.id).photo && P0(c.id).kind !== 'group').map(c => ({ label: P0(c.id).name, sub: `${fmt(c.miles)} mi together`, click: 'person', arg: c.id })) });
  g.push({ title: 'Google Earth pins not matched to a place', items: D().pins.filter(p => !p.place).map(p => ({ label: p.name, sub: [p.folder, p.subfolder].filter(Boolean).join(' / '), click: 'pinToPlace', arg: p.id })) });
  return g.filter(x => x.items.length);
}
function moreSheet() {
  openSheet('Plan and tools', () => {
    const P = F(), today = S.today, used = schengenUsed(P, today), miss = missingInfo();
    const docs = D().documents.filter(d => d.person_id === S.focus);
    return `<div class="section" style="margin-top:4px"><h3>Planned trips</h3><button class="btn small" data-click="newTrip">+ Plan one</button></div>
    ${P.upcoming.map(t => `<div class="card tap row between" data-click="trip" data-arg="${esc(t.id)}"><div><b>${esc(t.name)}</b><div class="small muted">${niceDate(t.start_date)} – ${niceDate(t.end_date)}</div></div><b class="mono">${daysBetween(today, t.start_date)} d</b></div>`).join('') || '<div class="card empty">Nothing planned yet.</div>'}
    <div class="section"><h3>Passport and visas</h3><button class="btn small ghost" data-click="newDoc">+ Add</button></div>
    <div class="card list">${docs.map(d => { const left = isDate(d.expires) ? daysBetween(today, d.expires) : null; return `<div class="item tap" data-click="editDoc" data-arg="${esc(d.id)}"><div class="grow"><div class="t">${esc(d.type)} ${d.country ? '· ' + esc(d.country) : ''}</div><div class="s">${esc(d.name || '')} · expires ${niceDate(d.expires)}</div></div><span class="chip ${left !== null && left < 180 ? 'warn' : 'gray'}">${left === null ? '?' : left < 0 ? 'expired' : left + ' days'}</span></div>`; }).join('') || '<div class="empty">Add your passport and the home page warns you 6 months before it expires.</div>'}</div>
    <div class="section"><h3>Schengen 90/180</h3></div>
    <div class="card"><div class="row between"><div><b class="mono" style="font-size:20px">${used} of 90 days</b><div class="small muted">used in the 180 days up to today</div></div><span class="chip ${used >= 80 ? 'warn' : ''}">${90 - used} left</span></div>
      <div class="bar" style="margin:10px 0"><i style="width:${pct(used, 90)}%"></i></div><div class="small muted">Check a future trip:</div>
      <div class="two"><input type="date" id="schFrom"><input type="date" id="schTo"></div><select id="schCountry" style="margin-top:8px">${SCHENGEN.map(c => `<option>${c}</option>`).join('')}</select><div id="schOut" class="small" style="margin-top:8px"></div></div>
    <div class="section"><h3>Fill in the gaps</h3><span class="kicker">${miss.reduce((a, x) => a + x.items.length, 0)}</span></div>
    ${miss.map(x => `<details class="card"><summary><b>${esc(x.title)}</b> <span class="muted small">(${x.items.length})</span></summary><div class="list">${x.items.slice(0, 80).map(i => `<div class="item tap" data-click="${i.click}" data-arg="${esc(i.arg)}"><div class="grow"><div class="t">${esc(i.label)}</div><div class="s">${esc(i.sub)}</div></div>›</div>`).join('')}</div></details>`).join('') || '<div class="card empty">Nothing missing. Nice.</div>'}
    <div class="section"><h3>Packing lists</h3><button class="btn small ghost" data-click="newPackItem">+ Item</button></div>
    <div class="card">${['Any'].concat(TRIP_TYPES).map(tt => { const it = D().packing.filter(p => p.trip_type === tt); return it.length ? `<div style="margin-bottom:10px"><b class="small">${esc(tt === 'Any' ? 'Every trip' : tt)}</b><div class="row wrap" style="gap:6px;margin-top:4px">${it.map(p => `<span class="chip gray">${esc(p.item)} <a href="#" data-click="deletePack" data-arg="${esc(p.id)}" style="text-decoration:none">✕</a></span>`).join('')}</div></div>` : ''; }).join('')}</div>
    <div class="section"><h3>Google Earth</h3></div>
    <div class="card"><p class="small muted">Add a KML or KMZ from Google Earth. Its folders become map layers and its pins get matched to your places and trips.</p>
      <button class="btn small" data-click="importKml">Add a Google Earth file</button>
      <div class="list" style="margin-top:8px">${D().layers.map(l => `<div class="item"><div class="grow">🌍 ${esc(l.name)} <span class="s">${(l.geojson.features || []).length} features</span></div><button class="btn small danger" data-click="deleteLayer" data-arg="${esc(l.id)}">Remove</button></div>`).join('')}</div>
      ${D().pins.length ? `<p class="small">${D().pins.length} pins · ${D().pins.filter(p => p.place).length} matched to places · ${D().pins.filter(p => p.trip_id).length} to trips</p>` : ''}</div>
    <div class="section"><h3>Old app photos</h3></div>
    <div class="card"><p class="small muted">Pick the files from your old AppSheet folders (Trips_Images, Legs_Images…). Each one is matched to its trip or leg by file name.</p><button class="btn small ghost" data-click="importLegacy">Choose photos</button></div>
    <div class="section"><h3>Add to your lists</h3></div>
    <div class="row wrap" style="gap:8px"><button class="btn small ghost" data-click="newPlace">+ Place</button><button class="btn small ghost" data-click="newPerson">+ Person</button><button class="btn small ghost" data-click="newHome" data-arg="${esc(S.focus)}">+ Home</button></div>
    <div class="section"><h3>You</h3></div><div class="card small">Signed in as ${esc(S.email || '')}. <span class="tiny muted">App version 1.3</span> ${db.kind === 'local' ? '(test copy, nothing is saved)' : ''}<div class="row wrap" style="gap:8px;margin-top:10px"><button class="btn small ghost" data-click="exportJson">Download a backup</button><button class="btn small ghost" data-click="signOut">Sign out</button></div></div>`;
  }, body => {
    const P = F(), upd = () => {
      const a = body.querySelector('#schFrom').value, b = body.querySelector('#schTo').value, c = body.querySelector('#schCountry').value;
      if (!a || !b || b <= a) { body.querySelector('#schOut').textContent = ''; return; }
      const extra = []; for (let d = a; d < b; d = addDays(d, 1)) extra.push({ d, country: c });
      const peak = Math.max(...extra.map(e => e.d).concat(b).map(d => schengenUsed(P, d, extra)));
      body.querySelector('#schOut').innerHTML = peak > 90 ? `<b style="color:var(--bad)">Over the limit: up to ${peak} days in a 180-day window.</b>` : `OK: at most ${peak} of 90 days during that trip.`;
    };
    ['schFrom', 'schTo', 'schCountry'].forEach(i => body.querySelector('#' + i).onchange = upd);
  });
}
function docForm(id) {
  const d = id ? D().documents.find(x => x.id === id) : { type: 'Passport' };
  openSheet(id ? 'Edit document' : 'New document', `<form id="docF">${field({ k: 'type', label: 'Type', type: 'select', options: ['Passport', 'Visa', 'Residence permit', 'Global Entry', 'Driver license', 'Other'], value: d.type })}
    ${field({ k: 'name', label: 'Label', value: d.name, ph: 'My US passport' })}${field({ k: 'country', label: 'Country', value: d.country })}${field({ k: 'expires', label: 'Expires', type: 'date', value: d.expires })}
    ${field({ k: 'notes', label: 'Notes', type: 'textarea', value: d.notes, ph: 'No document numbers needed' })}
    <div class="row" style="margin-top:16px"><button class="btn grow">Save</button>${id ? `<button type="button" class="btn danger" data-click="deleteDoc" data-arg="${esc(id)}">Delete</button>` : ''}</div></form>`,
    body => body.querySelector('#docF').onsubmit = e => { e.preventDefault(); submit(async () => { const r = readForm(e.target); r.id = id || newId(); r.person_id = d.person_id || S.focus; await save('documents', r); closeSheet(); refresh(); }); });
}
function homeForm(pid) {
  openSheet('New home', `${datalists()}<form id="homeF">${field({ k: 'place', label: 'Home place', list: 'placesList', hint: placeHint })}${field({ k: 'from_date', label: 'Lived there from', type: 'date' })}<button class="btn" style="width:100%;margin-top:16px">Save</button></form>`,
    body => body.querySelector('#homeF').onsubmit = e => { e.preventDefault(); submit(async () => { const r = readForm(e.target); checkPlace(r.place); if (!r.place || !r.from_date) throw new Error('Add the place and the date.'); await save('homes', { id: newId(), person_id: pid, place: r.place, from_date: r.from_date }); closeSheet(); refresh(); }); });
}

// Google Earth import: folders become layers, pins get matched to places (≤50 km) and trips
function kmlToFeatures(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml'), out = [];
  const kid = (el, name) => [...el.children].find(c => c.localName === name);
  const walk = (el, path) => [...el.children].forEach(ch => {
    if (ch.localName === 'Folder' || ch.localName === 'Document') walk(ch, ch.localName === 'Folder' ? path.concat(((kid(ch, 'name') || {}).textContent || '').trim()) : path);
    else if (ch.localName === 'Placemark') {
      const props = { name: ((kid(ch, 'name') || {}).textContent || '').trim(), folder: path[0] || '', sub: path[1] || '', description: ((kid(ch, 'description') || {}).textContent || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 500) };
      [...ch.getElementsByTagName('Point')].forEach(pt => { const [lo, la] = ((pt.getElementsByTagName('coordinates')[0] || {}).textContent || '').trim().split(',').map(Number); if (isFinite(la) && isFinite(lo)) out.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [+lo.toFixed(5), +la.toFixed(5)] } }); });
      [...ch.getElementsByTagName('LineString')].forEach(ls => { const pts = ((ls.getElementsByTagName('coordinates')[0] || {}).textContent || '').trim().split(/\s+/).map(c => c.split(',').slice(0, 2).map(Number)).filter(p => p.every(isFinite)); if (pts.length > 1) out.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: simplify(pts, .005).map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]) } }); });
    }
  });
  walk(doc.documentElement, []);
  return out;
}
function matchPins(layerId, feats) {
  const touched = {};
  D().stays.forEach(s => (touched[s.place] = touched[s.place] || new Set()).add(s.trip_id));
  D().legs.forEach(l => [l.from_place, l.to_place].forEach(p => (touched[p] = touched[p] || new Set()).add(l.trip_id)));
  const words = s => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !['the', 'and', 'trip', 'from', 'airport'].includes(w)));
  return feats.filter(f => f.geometry.type === 'Point').map(f => {
    const [lo, la] = f.geometry.coordinates, pr = f.properties;
    let best = '', km = 1e9;
    D().places.forEach(p => { const ll = X().ll[p.place]; if (!ll) return; const k = hav([la, lo], ll) * 1.609; if (k < km) { km = k; best = p.place; } });
    const place = km <= 50 ? best : null;
    const sub = words(pr.sub), score = t => (t.map_group && t.map_group === pr.folder ? 2 : 0) + [...words(t.name + ' ' + (t.place || ''))].filter(w => sub.has(w)).length;
    const c = [...(touched[place] || [])].map(id => X().trip[id]).filter(Boolean).sort((a, b) => score(b) - score(a));
    const trip = c.length === 1 || (c.length > 1 && score(c[0]) > score(c[1])) ? c[0].id : null;
    return { id: newId(), layer_id: layerId, name: pr.name, folder: pr.folder, subfolder: pr.sub, latlong: `${la.toFixed(5)}, ${lo.toFixed(5)}`, notes: pr.description || null, place, trip_id: trip };
  });
}
async function importKml(file) {
  let text;
  if (/\.kmz$/i.test(file.name)) { const zip = await JSZip.loadAsync(file), k = Object.keys(zip.files).find(n => /\.kml$/i.test(n)); if (!k) throw new Error('No .kml inside that .kmz'); text = await zip.files[k].async('string'); }
  else text = await file.text();
  toast('Reading the Google Earth file…');
  const feats = kmlToFeatures(text); if (!feats.length) throw new Error('No pins or lines found in that file.');
  const layer = await save('layers', { id: newId(), name: file.name.replace(/\.km[lz]$/i, ''), geojson: { type: 'FeatureCollection', features: feats } });
  const pins = matchPins(layer.id, feats);
  await saveMany('pins', pins);
  toast(`${pins.length} pins: ${pins.filter(p => p.place).length} matched to places, ${pins.filter(p => p.trip_id).length} to trips`);
  refresh();
}
async function importLegacy(files) {
  const base = s => String(s || '').split('/').pop().toLowerCase();
  let n = 0, skipped = 0;
  for (const f of files) {
    const name = f.name.toLowerCase(), t = D().trips.find(x => base(x.photo) === name), l = D().legs.find(x => base(x.photo) === name);
    if (!t && !l) { skipped++; continue; }
    const blob = await shrink(f), pid = newId(), path = await db.upload(`legacy/${pid}-${f.name}`, blob);
    await save('photos', { id: pid, path, trip_id: t ? t.id : l.trip_id, leg_id: l ? l.id : null, date: l ? l.date : t.start_date, caption: l ? l.name : null, people: l ? l.people : [] });
    toast(`Imported ${++n}…`);
  }
  toast(`${n} old photos imported${skipped ? `, ${skipped} didn't match a trip or leg` : ''}`); refresh();
}
function pinToPlace(id) {
  const p = D().pins.find(x => x.id === id); if (!p) return;
  const ll = parseLL(p.latlong), go2 = pre => placeForm({ prefill: pre, after: async name => { await save('pins', Object.assign({}, p, { place: name })); showSheet(); } });
  if (!ll) return go2({ city: p.name });
  reverseGeocode(ll[0], ll[1]).then(g => go2({ city: g.city || p.name, state: g.state, country: g.country, latlong: p.latlong })).catch(() => go2({ city: p.name, latlong: p.latlong }));
}

// ------------------------------------------------------------------ add menu & actions
function addMenu() {
  openSheet('Add', `<div class="list">${[['imHere', '📍', "I'm here", 'Log tonight from your location'], ['newLeg', '✈︎', 'Flight or drive', 'Scan a boarding pass or pick places'], ['newStory', '✎', 'Story', 'Tie it to a trip, flight, stay or place'],
    ['newStay', '🛏️', 'Stay', 'Where you slept'], ['newTrip', '🧳', 'Trip', 'With its flights, drives and stays'], ['addPhotos', '📸', 'Photos', 'For the current trip'], ['newPerson', '☺', 'Person', 'Someone you travel with'], ['newPlace', '📌', 'Place', 'A new spot on your map']]
    .map(([c, e, t, s]) => `<div class="item tap" data-click="${c}" data-fresh="1"><span style="font-size:24px;width:34px;text-align:center">${e}</span><div class="grow"><div class="t">${t}</div><div class="s">${s}</div></div></div>`).join('')}</div>`);
}
async function confirmDel(table, id, what, cleanup) {
  if (!confirm(`Delete ${what}? This can't be undone.`)) return;
  await submit(async () => { if (cleanup) await cleanup(); await remove(table, id); toast('Deleted'); closeSheet(); refresh(); });
}
const ACTIONS = {
  go: a => { closeAll(); go(a); }, focus: a => { S.focus = a; closeAll(); go(UI.page); toast(`Viewing ${P0(a).name}'s travels`); },
  trip: a => tripDetail(a), place: a => placeDetail(a), country: a => countryDetail(a), photo: a => photoViewer(a), person: a => personDetail(a), story: a => storyDetail(a),
  more: () => moreSheet(), addMenu: () => addMenu(), imHere: () => { closeAll(); imHere(); },
  newTrip: () => tripForm(), editTrip: a => tripForm(a), newLeg: a => legForm({ trip: a }), editLeg: a => legForm({ id: a }),
  returnLeg: a => { const l = D().legs.find(x => x.id === a); if (l) legForm({ title: 'Return trip', trip: l.trip_id, prefill: { mode: l.mode, trip_id: l.trip_id, from_airport: l.to_airport, to_airport: l.from_airport, from_place: l.to_place, to_place: l.from_place, miles: l.miles, people: l.people, date: '', name: l.to_airport && l.from_airport ? `${l.to_airport} → ${l.from_airport}` : '' } }); },
  newStay: a => stayForm({ trip: a }), editStay: a => stayForm({ id: a }), newStory: a => storyForm({ trip: a }), editStory: a => storyForm({ id: a }),
  storyAtPlace: a => storyForm({ prefill: { place: a } }), newPlace: () => placeForm(), editPlace: a => placeForm({ id: a }), pinToPlace: a => pinToPlace(a),
  newPerson: () => personForm(), editPerson: a => personForm(a), addPickPerson: () => submit(addPickPerson), newHome: a => homeForm(a || S.focus),
  addPhotos: a => pickFiles(true, files => uploadPhotos(files, { trip_id: a || (F().current || {}).id || null, people: [S.focus] }).then(refresh)),
  photosAtPlace: a => pickFiles(true, files => uploadPhotos(files, { place: a }).then(refresh)),
  facePhoto: a => pickFiles(false, async files => { const blob = await shrink(files[0], 400), path = await db.upload(`faces/${a}-${Date.now()}.jpg`, blob); await save('people', Object.assign({}, X().person[a], { photo: path })); toast('Looking good'); refresh(); }),
  mapTrip: a => { closeAll(); mapOpts.trip = a; mapOpts.year = 'All'; go('map'); setTimeout(() => drawMap(true), 120); },
  replay: () => { closeAll(); startReplay(); }, whereWasI: () => { closeAll(); startWhereWasI(); }, wrapped: a => wrapped(a || S.today.slice(0, 4)),
  deleteTrip: a => { if ((X().legsByTrip.get(a) || []).length || (X().staysByTrip.get(a) || []).length) return toast('Delete or move its flights, drives and stays first.', true); confirmDel('trips', a, 'this trip').then(() => closeAll()); },
  deleteLeg: a => confirmDel('legs', a, 'this flight or drive'), deleteStay: a => confirmDel('stays', a, 'this stay'), deleteStory: a => confirmDel('stories', a, 'this story'),
  deletePhoto: a => { const p = D().photos.find(x => x.id === a); confirmDel('photos', a, 'this photo', () => db.removeFile(p.path)); },
  deleteDoc: a => confirmDel('documents', a, 'this document'), deletePerson: a => confirmDel('people', a, 'this person'), deleteHome: a => submit(async () => { await remove('homes', a); refresh(); }),
  deletePack: a => submit(async () => { await remove('packing', a); refresh(); }), deleteWish: a => submit(async () => { await remove('wishes', a); refresh(); }),
  deleteLayer: a => { if (confirm('Remove this Google Earth file and its pins?')) submit(async () => { await removeWhere('pins', 'layer_id', a); await remove('layers', a); refresh(); }); },
  importKml: () => pickFiles(false, files => importKml(files[0]), '.kml,.kmz'), importLegacy: () => pickFiles(true, importLegacy),
  newDoc: () => docForm(), editDoc: a => docForm(a),
  newPackItem: () => openSheet('Packing item', `<form id="pkF">${field({ k: 'item', label: 'Item' })}${field({ k: 'trip_type', label: 'For', type: 'select', options: [['Any', 'Every trip']].concat(TRIP_TYPES.map(t => [t, t])) })}${field({ k: 'category', label: 'Category', type: 'select', options: ['Documents', 'Clothes', 'Toiletries', 'Tech', 'Other'] })}<button class="btn" style="width:100%;margin-top:16px">Add</button></form>`,
    b => b.querySelector('#pkF').onsubmit = e => { e.preventDefault(); submit(async () => { const r = readForm(e.target); if (!r.item) return; r.id = newId(); await save('packing', r); closeSheet(); refresh(); }); }),
  addWish: () => openSheet('Bucket list', `<form id="wishF">${field({ k: 'country', label: 'Country', type: 'select', options: D().countries.map(c => c.country).sort() })}<button class="btn" style="width:100%;margin-top:16px">Add as "Want to go"</button></form>`,
    b => b.querySelector('#wishF').onsubmit = e => { e.preventDefault(); submit(async () => { await save('wishes', { id: newId(), person_id: S.focus, country: e.target.country.value, status: 'Want to go' }); closeSheet(); refresh(); }); }),
  tripYear: a => { UI.tripYear = a; renderPage(); }, tripWho: a => { UI.tripWho = a; UI.tripYear = 'All'; renderPage(); }, tripType: a => { UI.tripType = a; renderPage(); }, storyPerson: a => { UI.storyPerson = a; renderPage(); },
  statsYear: a => { UI.statsYear = a; renderPage(); window.scrollTo(0, 0); }, raceMetric: a => { UI.raceMetric = a; renderPage(); }, famMetric: a => { UI.famMetric = a; renderPage(); },
  mapPanel: () => { mapOpts.panelOpen = !mapOpts.panelOpen; renderMap(); },
  earthAll: () => { earthFolders().forEach(f => mapOpts.earth[f] = true); renderMap(); }, earthNone: () => { mapOpts.earth = {}; renderMap(); },
  scanPass: () => scanPass(),
  shareStays: a => submit(async () => { const st = sharedStays(a); await saveMany('stays', st.map(s => Object.assign({}, s, { people: uniq((s.people || []).concat(a)) }))); toast(`Added ${P0(a).name} to ${st.length} stays`); refresh(); }),
  addLegRow: () => $('#legRows').insertAdjacentHTML('beforeend', legRowHtml()), addStayRow: () => $('#stayRows').insertAdjacentHTML('beforeend', stayRowHtml()),
  removeRow: (a, el) => el.closest('.leg-row').remove(),
  exportJson: () => { const b = new Blob([JSON.stringify(S.D, null, 1)], { type: 'application/json' }), u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = `miles-traveled-${S.today}.json`; a.click(); URL.revokeObjectURL(u); },
  signOut: async () => { await db.signOut(); location.reload(); },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-click]'); if (!el) return;
  e.preventDefault();
  if (el.dataset.fresh) { sheetStack.length = 0; showSheet(); }
  const fn = ACTIONS[el.dataset.click]; if (fn) fn(el.dataset.arg, el);
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.change === 'pack') submit(async () => {
    const ex = D().packing_checks.find(c => c.trip_id === el.dataset.trip && c.item_id === el.dataset.item);
    if (el.checked && !ex) await save('packing_checks', { id: newId(), trip_id: el.dataset.trip, item_id: el.dataset.item });
    if (!el.checked && ex) await remove('packing_checks', ex.id);
  });
  if (el.closest('#timelineCard') && el.tagName === 'SELECT') { $('#timelineCard').innerHTML = timeline(F(), el.value); }
});
document.querySelectorAll('.tabbar button').forEach(b => b.onclick = () => go(b.dataset.page));
$('#sheetClose').onclick = closeAll; $('#sheetBack').onclick = closeSheet;
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeAll(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#wrapped').classList.contains('hidden')) $('#wrapped').classList.add('hidden'); else closeSheet(); } });

boot();
