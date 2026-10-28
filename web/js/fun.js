// The fun stuff: departure-board odometer, spinning globe, people race, animated line charts, postcard stamps.
import { esc, fmt, fmt1, cachedJson, CDN, EARTH, onVisible } from './util.js';

// ------------------------------------------------------------------ split-flap odometer
export function odometer(el, value, { digits } = {}) {
  const s = Math.round(value).toLocaleString('en-US');
  const target = digits ? s.padStart(digits, ' ') : s;
  el.innerHTML = [...target].map(c => `<span class="flap ${c === ',' ? 'sep' : ''}">${c === ',' ? ',' : '0'}</span>`).join('');
  const flaps = [...el.children];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  flaps.forEach((f, i) => {
    const want = target[i]; if (want === ',' || want === ' ') { f.textContent = want; return; }
    if (reduce) { f.textContent = want; return; }
    let n = 0; const spins = 8 + i * 3 + Number(want);
    const t = setInterval(() => {
      f.textContent = n % 10; f.classList.remove('flip'); void f.offsetWidth; f.classList.add('flip');
      if (++n > spins) { clearInterval(t); f.textContent = want; }
    }, 70);
  });
}
export function countUp(el, to, { dur = 1400, dec = 0, suffix = '' } = {}) {
  const t0 = performance.now();
  const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = (dec ? fmt1(to * e) : fmt(to * e)) + suffix; if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// ------------------------------------------------------------------ globe with a plane doing laps
export async function globe(canvas, { size = 150, laps = 1, routes = [] } = {}) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr; canvas.height = size * dpr; canvas.style.width = canvas.style.height = size + 'px';
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  let land;
  try { const topo = await cachedJson(CDN.world110); land = topojson.feature(topo, topo.objects.land); } catch (e) { land = null; }
  const proj = d3.geoOrthographic().scale(size / 2 - 4).translate([size / 2, size / 2]).clipAngle(90);
  const path = d3.geoPath(proj, ctx);
  const css = getComputedStyle(document.documentElement);
  const ocean = '#2b5aa8', landC = '#f3d36b', routeC = 'rgba(255,255,255,.55)';
  let rot = 0, plane = 0, alive = true;
  const frac = laps % 1;
  const frame = () => {
    if (!alive || !canvas.isConnected) return;
    rot += 0.25; plane += 1.2;
    proj.rotate([rot, -18, 0]);
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = ocean; ctx.fill();
    ctx.beginPath(); path(d3.geoGraticule10()); ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = .6; ctx.stroke();
    if (land) { ctx.beginPath(); path(land); ctx.fillStyle = landC; ctx.fill(); }
    if (routes.length) { ctx.beginPath(); routes.forEach(r => path({ type: 'LineString', coordinates: r })); ctx.strokeStyle = routeC; ctx.lineWidth = .8; ctx.stroke(); }
    // the plane flies a tilted great circle; its trail shows the fraction of the current lap
    const lon = (plane % 360) - 180, trail = [];
    for (let i = 0; i <= 60; i++) trail.push([lon - i * (frac * 360 / 60), 12 * Math.sin((lon - i * frac * 6) * Math.PI / 180)]);
    ctx.beginPath(); path({ type: 'LineString', coordinates: trail }); ctx.strokeStyle = '#c8402f'; ctx.lineWidth = 2; ctx.stroke();
    const p = proj([lon, 12 * Math.sin(lon * Math.PI / 180)]);
    const vis = d3.geoDistance([lon, 0], [-rot, 18]) < Math.PI / 2;
    if (p && vis) { ctx.font = '16px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('✈️', p[0], p[1]); }
    requestAnimationFrame(frame);
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { plane = 90; rot = 100; frame(); alive = false; } else frame();
  return () => alive = false;
}

// ------------------------------------------------------------------ bar chart race with faces
// frames: [{ label, rows: [{ id, name, value, face, color }] }]
export function race(el, frames, { top = 8, unit = 'mi', ms = 1100, autoplay = true } = {}) {
  if (!frames.length) { el.innerHTML = '<div class="empty">Add people to your flights and drives to start the race.</div>'; return; }
  const H = 40;
  el.innerHTML = `<div class="row between" style="margin-bottom:8px"><div class="seg"><button class="on" data-r="play">▶ Play</button><button data-r="end">Jump to now</button></div><span class="tiny muted mono" data-r="label"></span></div>
    <div class="race" style="height:${top * H + 8}px"><div class="ryear"></div></div>`;
  const box = el.querySelector('.race'), yearEl = box.querySelector('.ryear'), rows = {};
  let i = 0, timer = null;
  const show = k => {
    const f = frames[k]; yearEl.textContent = f.label;
    const sorted = f.rows.filter(r => r.value > 0).sort((a, b) => b.value - a.value);
    const max = sorted.length ? sorted[0].value : 1;
    const shown = new Set(sorted.slice(0, top).map(r => r.id));
    sorted.slice(0, top).forEach((r, rank) => {
      let row = rows[r.id];
      if (!row) {
        row = document.createElement('div'); row.className = 'rrow';
        row.innerHTML = `<div class="rname">${esc(r.name)}</div>${r.face}<div class="rbar" style="background:${r.color}"></div><div class="rval"></div>`;
        row.style.transform = `translateY(${top * H}px)`; row.style.opacity = 0;
        box.appendChild(row); rows[r.id] = row; void row.offsetWidth;
      }
      row.style.opacity = 1; row.style.transform = `translateY(${rank * H}px)`;
      row.querySelector('.rbar').style.width = `calc((100% - 210px) * ${r.value / max})`;
      row.querySelector('.rval').textContent = fmt(r.value) + ' ' + unit;
    });
    Object.entries(rows).forEach(([id, row]) => { if (!shown.has(id)) { row.style.opacity = 0; row.style.transform = `translateY(${top * H}px)`; } });
    el.querySelector('[data-r=label]').textContent = `${k + 1}/${frames.length}`;
  };
  const play = () => {
    const btn = el.querySelector('[data-r=play]');
    if (timer) { clearInterval(timer); timer = null; btn.textContent = '▶ Play'; return; }
    if (i >= frames.length - 1) i = 0;
    btn.textContent = '❚❚ Pause';
    show(i);
    timer = setInterval(() => { if (!el.isConnected) return clearInterval(timer); i++; show(i); if (i >= frames.length - 1) { clearInterval(timer); timer = null; btn.textContent = '↺ Replay'; } }, ms);
  };
  el.querySelector('[data-r=play]').onclick = play;
  el.querySelector('[data-r=end]').onclick = () => { if (timer) { clearInterval(timer); timer = null; el.querySelector('[data-r=play]').textContent = '↺ Replay'; } i = frames.length - 1; show(i); };
  show(0);
  if (autoplay) onVisible(el, () => { if (!timer && i === 0) play(); });
}

// ------------------------------------------------------------------ animated cumulative line chart
// series: [{ name, color, points: [[Date, value]] }], refs: [{ y, label }]
export function lineChart(el, series, { height = 220, refs = [], yFmt = fmt, step = false, unit = '' } = {}) {
  const pts = series.flatMap(s => s.points);
  if (!pts.length) { el.innerHTML = '<div class="empty">Not enough data yet.</div>'; return; }
  el.classList.add('chart');
  const W = Math.max(300, el.clientWidth || 600), H = height, m = { t: 12, r: 14, b: 26, l: 52 };
  const x = d3.scaleTime().domain(d3.extent(pts, p => p[0])).range([m.l, W - m.r]);
  const ymax = d3.max(pts, p => p[1]);
  const y = d3.scaleLinear().domain([0, ymax * 1.05]).nice().range([H - m.b, m.t]);
  const svg = d3.create('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img');
  svg.append('g').attr('class', 'grid').selectAll('line').data(y.ticks(4)).join('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', d => y(d)).attr('y2', d => y(d));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(W < 500 ? 5 : 8).tickSizeOuter(0));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickFormat(yFmt).tickSize(0)).call(g => g.select('.domain').remove());
  let lastRef = Infinity;
  refs.filter(r => r.y <= y.domain()[1]).forEach(r => {
    if (lastRef - y(r.y) < 16) return; lastRef = y(r.y);
    svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(r.y)).attr('y2', y(r.y)).attr('stroke', 'var(--gold)').attr('stroke-dasharray', '4 4').attr('stroke-width', 1);
    svg.append('text').attr('x', m.l + 4).attr('y', y(r.y) - 4).attr('fill', 'var(--muted)').attr('font-size', 11).attr('font-family', 'var(--mono)').text(r.label);
  });
  const line = d3.line().x(p => x(p[0])).y(p => y(p[1])).curve(step ? d3.curveStepAfter : d3.curveMonotoneX);
  const paths = series.map(s => svg.append('path').attr('d', line(s.points)).attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', 2.2).attr('stroke-linejoin', 'round'));
  series.forEach(s => { const last = s.points[s.points.length - 1]; if (last && series.length > 1) svg.append('text').attr('x', x(last[0]) - 4).attr('y', y(last[1]) - 6).attr('text-anchor', 'end').attr('font-size', 11).attr('fill', 'var(--text)').text(s.name); });
  // hover crosshair
  const cross = svg.append('line').attr('y1', m.t).attr('y2', H - m.b).attr('stroke', 'var(--muted)').attr('stroke-width', 1).style('opacity', 0);
  const dots = series.map(s => svg.append('circle').attr('r', 4).attr('fill', s.color).attr('stroke', 'var(--card)').attr('stroke-width', 2).style('opacity', 0));
  el.innerHTML = ''; el.appendChild(svg.node());
  const tip = document.createElement('div'); tip.className = 'tip'; tip.style.display = 'none'; el.appendChild(tip);
  const bis = d3.bisector(p => p[0]).right;
  svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b).attr('fill', 'transparent')
    .on('pointermove', ev => {
      const [mx] = d3.pointer(ev), t = x.invert(mx);
      const lines = [];
      series.forEach((s, k) => { const j = Math.max(0, bis(s.points, t) - 1), p = s.points[j]; if (!p) return; dots[k].attr('cx', x(p[0])).attr('cy', y(p[1])).style('opacity', 1); lines.push(`${series.length > 1 ? esc(s.name) + ': ' : ''}${yFmt(p[1])}${unit}`); });
      cross.attr('x1', mx).attr('x2', mx).style('opacity', 1);
      const r = el.getBoundingClientRect(), sv = svg.node().getBoundingClientRect();
      tip.style.display = 'block'; tip.style.left = (mx / W * sv.width) + 'px'; tip.style.top = (m.t / H * sv.height + 10) + 'px';
      tip.innerHTML = `<b>${d3.timeFormat('%b %Y')(t)}</b><br>${lines.join('<br>')}`;
    })
    .on('pointerleave', () => { cross.style('opacity', 0); dots.forEach(d => d.style('opacity', 0)); tip.style.display = 'none'; });
  // draw-in animation when it scrolls into view
  paths.forEach(p => { const L = p.node().getTotalLength ? p.node().getTotalLength() : 0; p.attr('stroke-dasharray', `${L} ${L}`).attr('stroke-dashoffset', L); });
  onVisible(el, () => paths.forEach(p => p.transition().duration(1800).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0)));
}

// ------------------------------------------------------------------ postcard stamp: tiny world map with a dot
let worldPath = null;
export async function stampSvg(ll) {
  const W = 180, H = 100;
  if (!worldPath) {
    try {
      const topo = await cachedJson(CDN.world110);
      const proj = d3.geoNaturalEarth1().fitSize([W, H], { type: 'Sphere' });
      worldPath = { d: d3.geoPath(proj)(topojson.feature(topo, topo.objects.land)), proj };
    } catch (e) { worldPath = { d: '', proj: d3.geoNaturalEarth1().fitSize([W, H], { type: 'Sphere' }) }; }
  }
  const p = ll ? worldPath.proj([ll[1], ll[0]]) : null;
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><rect width="${W}" height="${H}" fill="var(--accent-soft)"/><path d="${worldPath.d}" fill="var(--s-other)"/>${p ? `<circle cx="${p[0]}" cy="${p[1]}" r="9" fill="var(--red)" opacity=".25"/><circle cx="${p[0]}" cy="${p[1]}" r="4" fill="var(--red)" stroke="var(--card)" stroke-width="1.5"/>` : ''}</svg>`;
}
export async function fillStamps(root = document) {
  const els = [...root.querySelectorAll('[data-stamp]')];
  for (const s of els) { const v = s.dataset.stamp.split(',').map(Number); s.innerHTML = await stampSvg(v.length === 2 && v.every(isFinite) ? v : null); s.removeAttribute('data-stamp'); }
}
export { EARTH };
