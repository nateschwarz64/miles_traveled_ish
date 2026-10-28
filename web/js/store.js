// Data: talks to Supabase (or an in-memory copy for testing) and derives every stat from the raw rows.
import { isDate, addDays, parseLL, groupBy, sum, uniq, hav, num, todayLocal, newId } from './util.js';

export const TABLES = ['people','homes','countries','places','airports','trips','legs','stays','stories','photos','documents','wishes','packing','packing_checks','layers','pins'];
export const KEY = { places: 'place', airports: 'code', countries: 'country' };
const keyOf = t => KEY[t] || 'id';

// ------------------------------------------------------------------ adapters
function supabaseAdapter(cfg) {
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  return {
    kind: 'supabase',
    async email() { const { data } = await sb.auth.getSession(); return data.session ? data.session.user.email : null; },
    async signIn(email) { check(await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } })); },
    async signInPassword(email, password) { check(await sb.auth.signInWithPassword({ email, password })); },
    async signOut() { await sb.auth.signOut(); },
    onAuth(fn) { sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') fn(ev); }); },
    async loadAll() {
      const out = {};
      await Promise.all(TABLES.map(async t => { out[t] = check(await sb.from(t).select('*').range(0, 19999)); }));
      return out;
    },
    async upsert(t, row) { return check(await sb.from(t).upsert(row).select().single()); },
    async upsertMany(t, rows) { if (rows.length) check(await sb.from(t).upsert(rows)); },
    async remove(t, id) { check(await sb.from(t).delete().eq(keyOf(t), id)); },
    async removeWhere(t, col, val) { check(await sb.from(t).delete().eq(col, val)); },
    async upload(path, blob) { check(await sb.storage.from('photos').upload(path, blob, { upsert: true, contentType: blob.type || 'image/jpeg' })); return path; },
    async removeFile(path) { await sb.storage.from('photos').remove([path]); },
    async sign(paths) {
      const data = check(await sb.storage.from('photos').createSignedUrls(paths, 60 * 60 * 24 * 7));
      const m = {}; data.forEach(d => { if (d.signedUrl) m[d.path] = d.signedUrl; }); return m;
    },
  };
}
// In-memory copy (used by the test harness, and for a quick look before Supabase is set up)
function localAdapter(seed) {
  const db = JSON.parse(JSON.stringify(seed)); TABLES.forEach(t => db[t] = db[t] || []);
  const files = {};
  return {
    kind: 'local',
    async email() { return (db.people.find(p => p.email) || {}).email || 'demo@example.com'; },
    async signIn() {}, async signOut() {}, onAuth() {},
    async loadAll() { return JSON.parse(JSON.stringify(db)); },
    async upsert(t, row) {
      const k = keyOf(t); if (!row[k]) row[k] = newId();
      const i = db[t].findIndex(r => r[k] === row[k]);
      const merged = Object.assign(i >= 0 ? db[t][i] : {}, row);
      if (i < 0) db[t].push(merged);
      return JSON.parse(JSON.stringify(merged));
    },
    async upsertMany(t, rows) { for (const r of rows) await this.upsert(t, r); },
    async remove(t, id) { const k = keyOf(t); db[t] = db[t].filter(r => r[k] !== id); },
    async removeWhere(t, col, val) { db[t] = db[t].filter(r => r[col] !== val); },
    async upload(path, blob) { files[path] = URL.createObjectURL(blob); return path; },
    async removeFile(path) { delete files[path]; },
    async sign(paths) { const m = {}; paths.forEach(p => { if (files[p]) m[p] = files[p]; }); return m; },
  };
}
const cfg = window.TRAVEL_CONFIG || {};
export const db = window.TRAVEL_LOCAL ? localAdapter(window.TRAVEL_LOCAL) : cfg.supabaseUrl ? supabaseAdapter(cfg) : null;

// ------------------------------------------------------------------ state
export const S = { D: null, X: null, me: null, focus: null, today: todayLocal() };

export async function load() {
  S.D = await db.loadAll();
  derive();
}
export async function save(table, row) {
  const saved = await db.upsert(table, row);
  const k = keyOf(table), list = S.D[table], i = list.findIndex(r => r[k] === saved[k]);
  if (i >= 0) list[i] = saved; else list.push(saved);
  derive();
  return saved;
}
export async function saveMany(table, rows) {
  await db.upsertMany(table, rows);
  const k = keyOf(table);
  rows.forEach(row => { const i = S.D[table].findIndex(r => r[k] === row[k]); if (i >= 0) S.D[table][i] = Object.assign(S.D[table][i], row); else S.D[table].push(row); });
  derive();
}
export async function remove(table, id) {
  await db.remove(table, id);
  const k = keyOf(table); S.D[table] = S.D[table].filter(r => r[k] !== id);
  derive();
}
export async function removeWhere(table, col, val) {
  await db.removeWhere(table, col, val);
  S.D[table] = S.D[table].filter(r => r[col] !== val);
  derive();
}

// signed photo URLs, fetched in batches for every <img data-path> on screen
const signed = {};
export async function hydrateImages(root = document) {
  const imgs = [...root.querySelectorAll('img[data-path]:not([src])')];
  const need = uniq(imgs.map(i => i.dataset.path).filter(p => !signed[p]));
  if (need.length) { try { Object.assign(signed, await db.sign(need)); } catch (e) { /* offline: leave blank */ } }
  imgs.forEach(i => { if (signed[i.dataset.path]) i.src = signed[i.dataset.path]; });
}
export const signedUrl = p => signed[p];

// ------------------------------------------------------------------ derived indexes
export function derive() {
  const D = S.D, X = {};
  X.place = {}; D.places.forEach(p => X.place[p.place] = p);
  X.ll = {}; D.places.forEach(p => { const v = parseLL(p.latlong); if (v) X.ll[p.place] = v; });
  X.airport = {}; D.airports.forEach(a => X.airport[String(a.code).toUpperCase()] = a);
  X.trip = {}; D.trips.forEach(t => X.trip[t.id] = t);
  X.person = {}; D.people.forEach(p => X.person[p.id] = p);
  X.continent = {}; D.countries.forEach(c => X.continent[c.country] = c.continent);
  X.legsByTrip = groupBy(D.legs, l => l.trip_id || '');
  X.staysByTrip = groupBy(D.stays, s => s.trip_id || '');
  X.storiesByTrip = groupBy(D.stories, s => s.trip_id || '');
  X.photosByTrip = groupBy(D.photos, p => p.trip_id || '');
  X.pinsByTrip = groupBy(D.pins, p => p.trip_id || '');
  X.countryOf = p => (X.place[p] || {}).country || '';
  X.stateOf = p => (X.place[p] || {}).state || '';
  X.family = D.people.filter(p => p.kind === 'family');
  S.X = X;
  S.cache = {};
  const email = S.email && S.email.toLowerCase();
  S.me = D.people.find(p => p.email && p.email.toLowerCase() === email) || X.family[0] || D.people[0] || null;
  if (!S.focus || !X.person[S.focus]) S.focus = S.me ? S.me.id : null;
}

export const legEnds = l => {
  const X = S.X;
  const a = (l.mode === 'Flight' && X.airport[l.from_airport] && parseLL(X.airport[l.from_airport].latlong)) || X.ll[l.from_place];
  const b = (l.mode === 'Flight' && X.airport[l.to_airport] && parseLL(X.airport[l.to_airport].latlong)) || X.ll[l.to_place];
  return [a, b];
};
export const isFlight = l => l.mode === 'Flight';
export const tripMiles = id => sum(S.X.legsByTrip.get(id) || [], l => l.miles);
export const has = (row, pid) => (row.people || []).includes(pid);

// Everything about one person's travel, cached until the data changes.
export function person(pid) {
  if (S.cache[pid]) return S.cache[pid];
  const D = S.D, X = S.X, today = S.today;
  const legs = D.legs.filter(l => has(l, pid));
  const stays = D.stays.filter(s => has(s, pid));
  const homes = D.homes.filter(h => h.person_id === pid).sort((a, b) => a.from_date < b.from_date ? -1 : 1);
  const starts = stays.map(s => s.arrive).concat(legs.map(l => l.date)).concat(homes.map(h => h.from_date)).filter(isDate).sort();
  let start = starts[0] || today;
  if (homes.length && stays.length) start = [stays.map(s => s.arrive).sort()[0], legs.map(l => l.date).filter(isDate).sort()[0]].filter(Boolean).sort()[0] || start;
  const byDay = {};
  stays.filter(s => isDate(s.arrive) && isDate(s.leave)).forEach(s => { for (let d = s.arrive; d < s.leave && d <= today; d = addDays(d, 1)) byDay[d] = s; });
  const nights = [];
  let hi = 0;
  for (let d = start; d <= today; d = addDays(d, 1)) {
    while (hi + 1 < homes.length && homes[hi + 1].from_date <= d) hi++;
    const home = homes.length && homes[hi].from_date <= d ? homes[hi].place : '';
    const s = byDay[d];
    const place = s ? s.place : home;
    if (!place) continue;
    nights.push({ d, place, home, away: !!s && s.place !== home, trip: s ? s.trip_id || '' : '', country: X.countryOf(place) });
  }
  const homeNow = homes.length ? homes[homes.length - 1].place : '';
  const homeCountry = X.countryOf(homeNow) || (nights.length ? mode(nights.map(n => n.country)) : 'United States');
  const tripIds = uniq(legs.map(l => l.trip_id).concat(stays.map(s => s.trip_id)).filter(Boolean));
  const trips = tripIds.map(id => X.trip[id]).filter(Boolean);
  const flights = legs.filter(isFlight);
  const miles = sum(legs, l => l.miles), flightMiles = sum(flights, l => l.miles);
  const nightCountries = uniq(nights.map(n => n.country).filter(Boolean));
  const legCountries = uniq(legs.flatMap(l => [X.countryOf(l.from_place), X.countryOf(l.to_place)]).filter(Boolean));
  const visited = uniq(nightCountries.concat(legCountries));
  const states = uniq(nights.filter(n => n.country === 'United States').map(n => X.stateOf(n.place)).filter(Boolean));
  const P = {
    id: pid, legs, stays, homes, nights, homeNow, homeCountry, trips, flights, miles, flightMiles, roadMiles: miles - flightMiles,
    visited, visitedAbroad: visited.filter(c => c !== homeCountry), sleptAbroad: nightCountries.filter(c => c !== homeCountry),
    nightsAbroad: nights.filter(n => n.country && n.country !== homeCountry).length,
    states, states50: states.filter(s => s !== 'District of Columbia'),
    continents: uniq(visited.map(c => X.continent[c]).filter(Boolean)),
  };
  const mine = new Set(tripIds);
  const lonely = D.trips.filter(t => !(X.legsByTrip.get(t.id) || []).length && !(X.staysByTrip.get(t.id) || []).length);
  const allMine = trips.concat(lonely);
  P.current = allMine.filter(t => isDate(t.start_date) && t.start_date <= today && (!isDate(t.end_date) || t.end_date >= today)).sort((a, b) => a.start_date < b.start_date ? 1 : -1)[0] || null;
  P.upcoming = allMine.filter(t => isDate(t.start_date) && t.start_date > today).sort((a, b) => a.start_date < b.start_date ? -1 : 1);
  P.allTrips = allMine;
  P.mine = id => mine.has(id);
  S.cache[pid] = P;
  return P;
}
function mode(arr) { const m = {}; let best = '', n = 0; arr.forEach(x => { if (!x) return; m[x] = (m[x] || 0) + 1; if (m[x] > n) { n = m[x]; best = x; } }); return best; }

// Year (or lifetime) slice of a person
export function yearSlice(P, year) {
  const inYear = d => year === 'All' || String(d || '').slice(0, 4) === String(year);
  const X = S.X;
  const nights = P.nights.filter(n => inYear(n.d));
  const legs = P.legs.filter(l => inYear(l.date));
  const count = key => { const m = {}; nights.forEach(n => { const k = key(n); if (k) m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  return {
    nights, legs, miles: sum(legs, l => l.miles), flights: legs.filter(isFlight),
    trips: year === 'All' ? P.trips : P.trips.filter(t => yearOfTrip(t) === String(year)),
    byCountry: count(n => n.country), byState: count(n => n.country === 'United States' ? X.stateOf(n.place) : ''), byPlace: count(n => n.place),
    abroad: nights.filter(n => n.country && n.country !== P.homeCountry).length,
    countries: uniq(nights.map(n => n.country).concat(legs.flatMap(l => [X.countryOf(l.from_place), X.countryOf(l.to_place)])).filter(Boolean)),
  };
}
export const yearOfTrip = t => String(t.start_date || '').slice(0, 4);

// Who someone traveled with: every other person on their legs
export function companions(pid) {
  const m = {};
  person(pid).legs.forEach(l => (l.people || []).filter(x => x !== pid).forEach(o => {
    const c = m[o] || (m[o] = { id: o, miles: 0, legs: 0, trips: new Set(), first: '', last: '', years: {} });
    c.miles += num(l.miles); c.legs++; if (l.trip_id) c.trips.add(l.trip_id);
    if (isDate(l.date)) { if (!c.first || l.date < c.first) c.first = l.date; if (!c.last || l.date > c.last) c.last = l.date; const y = l.date.slice(0, 4); c.years[y] = (c.years[y] || 0) + num(l.miles); }
  }));
  return Object.values(m).filter(c => S.X.person[c.id]).map(c => Object.assign(c, { trips: c.trips.size })).sort((a, b) => b.miles - a.miles);
}

// Schengen 90/180: a day counts if that night or the night before was in a Schengen country
import { SCHENGEN } from './util.js';
export function schengenUsed(P, asOf, extra) {
  const c = {}; P.nights.forEach(n => c[n.d] = n.country); (extra || []).forEach(n => c[n.d] = n.country);
  let used = 0;
  for (let d = addDays(asOf, -179); d <= asOf; d = addDays(d, 1)) if (SCHENGEN.includes(c[d]) || SCHENGEN.includes(c[addDays(d, -1)])) used++;
  return used;
}
export { hav };
