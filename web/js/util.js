// Small helpers shared by every page.
export const EARTH = 24901, MOON = 238900, LIGHT_MPS = 186282;
export const SCHENGEN = ['Austria','Belgium','Bulgaria','Croatia','Czechia','Denmark','Estonia','Finland','France','Germany','Greece',
  'Hungary','Iceland','Italy','Latvia','Liechtenstein','Lithuania','Luxembourg','Malta','Netherlands','Norway','Poland',
  'Portugal','Romania','Slovakia','Slovenia','Spain','Sweden','Switzerland'];
export const CONTINENTS = ['North America','South America','Europe','Africa','Asia','Oceania','Antarctica'];
export const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const TRIP_TYPES = ['Missions', 'Family', 'Work', 'Fun', 'Other'];
// fixed categorical order (validated palette); anything past 7 folds into "other"
export const SERIES = ['var(--s1)','var(--s2)','var(--s3)','var(--s4)','var(--s5)','var(--s6)','var(--s7)','var(--s8)'];
export const OTHER = 'var(--s-other)';
export const ATLAS_ALIAS = { 'United States of America':'United States', 'eSwatini':'Eswatini', 'Dem. Rep. Congo':'Congo, Democratic Republic of',
  'Congo':'Congo, Republic of the', 'South Korea':'Korea, South', 'North Korea':'Korea, North', 'Myanmar':'Myanmar (Burma)',
  'Macedonia':'North Macedonia', 'Bosnia and Herz.':'Bosnia-Herzegovina', 'Central African Rep.':'Central African Republic',
  'Dominican Rep.':'Dominican Republic', 'Eq. Guinea':'Equatorial Guinea', 'S. Sudan':'South Sudan', 'Solomon Is.':'Solomon Islands',
  'W. Sahara':'Western Sahara', 'Timor-Leste':'East Timor', 'Cabo Verde':'Cape Verde', 'Hong Kong':'China, Hong Kong', 'Macao':'China, Macau',
  'Palestine':'West Bank / Gaza', 'Vatican':'Vatican City', 'São Tomé and Principe':'São Tomé and Príncipe', 'Antigua and Barb.':'Antigua and Barbuda',
  'St. Kitts and Nevis':'Saint Kitts and Nevis', 'St. Vin. and Gren.':'St Vincent and Grenadines', 'Fr. Polynesia':'French Polynesia',
  'Falkland Is.':'Falkland Islands', 'Faeroe Is.':'Faroe Islands', 'Cayman Is.':'Cayman Islands', 'Curaçao':'Curacao', 'Kiribati':'Kiribati (Gilbert)',
  'Marshall Is.':'Marshall Islands', 'Micronesia':'Micronesia, Federated States', 'N. Mariana Is.':'Northern Mariana Islands',
  'Turks and Caicos Is.':'Turks and Caicos Islands', 'U.S. Virgin Is.':'Virgin Islands (U.S.)', 'British Virgin Is.':'British Virgin Islands',
  'Cook Is.':'Cook Islands', 'Pitcairn Is.':'Pitcairn Islands', 'St. Pierre and Miquelon':'Saint Pierre and Miquelon', 'Wallis and Futuna Is.':'Wallis and Futuna Islands' };
export const CDN = { world: 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json', world110: 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json', us: 'https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json' };

export const $ = s => document.querySelector(s);
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
export const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
export const fmt = n => Math.round(num(n)).toLocaleString();
export const fmt1 = n => (Math.round(num(n) * 10) / 10).toLocaleString();
export const isDate = s => /^\d{4}-\d\d-\d\d$/.test(String(s || ''));
export const yearOf = s => isDate(s) ? s.slice(0, 4) : '';
export function niceDate(s, withYear = true) { if (!isDate(s)) return ''; const [y, m, d] = s.split('-').map(Number); return `${MONTHS[m - 1]} ${d}${withYear ? ', ' + y : ''}`; }
export function toD(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
export const fromD = d => d.toISOString().slice(0, 10);
export function addDays(s, n) { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return fromD(d); }
export const daysBetween = (a, b) => Math.round((toD(b) - toD(a)) / 86400000);
export function todayLocal() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function hav(a, b) {
  if (!a || !b) return 0;
  const R = 3958.8, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function parseLL(s) { const p = String(s || '').split(',').map(Number); return p.length === 2 && p.every(isFinite) && (p[0] || p[1]) ? p : null; }
export function groupBy(arr, f) { const m = new Map(); arr.forEach(x => { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return m; }
export const sum = (arr, f) => arr.reduce((a, x) => a + num(f(x)), 0);
export const uniq = a => [...new Set(a)];
export const pct = (a, b) => b ? Math.min(100, Math.round(a / b * 100)) : 0;
export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), b => b.toString(16).padStart(2, '0')).join('');
export function sumBy(arr, kf, vf) { const m = {}; arr.forEach(x => { const k = kf(x); if (k == null || k === '') return; m[k] = (m[k] || 0) + num(vf(x)); }); return Object.entries(m).sort((a, b) => b[1] - a[1]); }
export function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : '');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.className = 'toast hidden', bad ? 6000 : 2800);
}
const _cache = {};
export function cachedJson(url) { if (!_cache[url]) _cache[url] = fetch(url).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); return _cache[url]; }
// great-circle arc points [lat, lon] that stay continuous across the dateline
export function arc(a, b, n = 32) {
  const r = Math.PI / 180, [la1, lo1] = [a[0] * r, a[1] * r], [la2, lo2] = [b[0] * r, b[1] * r];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
  if (d < 0.01) return [a, b];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2), y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2), z = A * Math.sin(la1) + B * Math.sin(la2);
    pts.push([Math.atan2(z, Math.sqrt(x * x + y * y)) / r, Math.atan2(y, x) / r]);
  }
  for (let i = 1; i < pts.length; i++) { while (pts[i][1] - pts[i - 1][1] > 180) pts[i][1] -= 360; while (pts[i][1] - pts[i - 1][1] < -180) pts[i][1] += 360; }
  return pts;
}
// Douglas–Peucker on [x, y] pairs
export function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-12;
  let dmax = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) { const dd = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / L; if (dd > dmax) { dmax = dd; idx = i; } }
  if (dmax <= eps) return [a, b];
  return simplify(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(pts.slice(idx), eps));
}
// run fn once when el scrolls into view (charts animate as you reach them)
export function onVisible(el, fn) {
  if (!el) return;
  if (!('IntersectionObserver' in window)) return fn();
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); fn(); } }, { threshold: 0.25 });
  io.observe(el);
}
