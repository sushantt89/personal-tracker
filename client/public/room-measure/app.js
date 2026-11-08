"use strict";
try { if (/[?&]embed=tracker/.test(location.search)) document.documentElement.classList.add('embed'); } catch (e) {}
/* ---------- constants ---------- */
/* cls: open = opening measured to frame edges, point = measured to centre,
   round = round vent (diameter, measured to edge of opening), obst = obstacle with depth */
const KINDS = {
  door:      {name:'Door',          short:'D',  cls:'open',  w:870,  h:2080, floor:0,    color:'#b45309', group:'Openings'},
  window:    {name:'Window',        short:'W',  cls:'open',  w:1210, h:1210, floor:900,  color:'#0369a1', group:'Openings'},
  sliding:   {name:'Sliding door',  short:'SD', cls:'open',  w:2110, h:2110, floor:0,    color:'#7c3aed', group:'Openings'},
  power:     {name:'Power outlet',  short:'PP', cls:'point', w:115,  h:75,   floor:300,  color:'#dc2626', group:'Electrical'},
  switch:    {name:'Light switch',  short:'S',  cls:'point', w:75,   h:115,  floor:1100, color:'#e11d48', group:'Electrical'},
  tap:       {name:'Water point',   short:'H2O',cls:'point', w:60,   h:60,   floor:900,  color:'#047857', group:'Plumbing & gas'},
  drain:     {name:'Drain',         short:'DR', cls:'point', w:100,  h:100,  floor:400,  color:'#4d7c0f', group:'Plumbing & gas'},
  gas:       {name:'Gas point',     short:'G',  cls:'point', w:60,   h:60,   floor:500,  color:'#ca8a04', group:'Plumbing & gas'},
  vent:      {name:'Round vent',    short:'V',  cls:'round', w:150,  h:150,  floor:2100, color:'#0891b2', group:'Vents'},
  ac:        {name:'AC / grille vent', short:'AC', cls:'open', w:800, h:300, floor:2100, color:'#0e7490', group:'Vents'},
  column:    {name:'Column / pole', short:'COL',cls:'obst',  w:300,  h:2400, floor:0,    color:'#57534e', group:'Obstacles', depth:300},
  fireplace: {name:'Fireplace',     short:'FP', cls:'obst',  w:1200, h:1100, floor:0,    color:'#9a3412', group:'Obstacles', depth:400},
  obstacle:  {name:'Other obstacle',short:'OB', cls:'obst',  w:600,  h:900,  floor:0,    color:'#6b21a8', group:'Obstacles', depth:300},
};
const WALL_TYPES = ['Gyprock', 'Brick'];
const wallTypeSel = (attrs, val, def) => `<select ${attrs}><option value="" ${val ? '' : 'selected'}>Same as room (${esc(def)})</option>${WALL_TYPES.map(t => `<option ${t === val ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
const normType = t => !t ? '' : /brick/i.test(t) ? 'Brick' : 'Gyprock';
const STATUS = {existing:'Existing', new:'New (to install)', remove:'Remove', relocate:'Relocate to…'};
const DEDUCT = {door:1, window:1, sliding:1};
const UNITF = {mm:1, cm:10, m:1000};
const LS_KEY = 'roommeasure.v1', LS_CUR = 'roommeasure.current', LS_DEL = 'roommeasure.deleted', LS_NAV = 'roommeasure.nav';

/* ---------- state ---------- */
let screen = 'houses', curHouse = null, shapeEdit = false, selVtx = null, vdrag = null;
let rooms = [], cur = null, selWall = 0, selItem = null, mode = 'select', tab = 'plan', tombstones = [];
let store = null, dl = null;
const dirty = new Set(), writing = new Set();

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const letter = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

function room() { return rooms.find(r => r.id === cur); }
function fmt(mm, r = room()) {
  const u = r?.units || 'mm', v = mm / UNITF[u];
  if (u === 'mm') return String(Math.round(v));
  if (u === 'cm') return String(Math.round(v * 10) / 10);
  return String(Math.round(v * 1000) / 1000);
}
function fmtU(mm, r = room()) { return fmt(mm, r) + ' ' + (r?.units || 'mm'); }
function parse(val, r = room()) { const n = parseFloat(String(val).replace(',', '.')); return isNaN(n) ? null : n * UNITF[r?.units || 'mm']; }

/* ---------- model helpers ---------- */
function mkWall(length, turn, type) { return {id: uid('w'), length, turn, type: type || '', height: null, note: '', items: []}; }
function mkItem(kind, wall, centreAt, r) {
  const k = KINDS[kind], L = wall.length;
  let left = k.cls === 'open' ? centreAt - k.w / 2 : centreAt;
  left = k.cls === 'open' ? clamp(left, 0, Math.max(0, L - k.w)) : clamp(left, 0, L);
  const right = k.cls === 'open' ? L - left - k.w : L - left;
  const ref = left <= right ? 'L' : 'R';
  const it = {id: uid('i'), kind, label: '', ...(kind === 'door' ? {swing: 'in', hinge: 'L'} : {}), w: k.w, h: k.h, floor: k.floor, ref, dist: Math.round(ref === 'L' ? left : right), note: '', status: 'existing'};
  if (k.depth) it.depth = k.depth;
  if ((kind === 'ac' || kind === 'vent') && r) it.floor = Math.max(0, wallH(r, wall) - k.h - 100);
  if (kind === 'column' && r) it.h = wallH(r, wall);
  return it;
}
function newRoom(name, house) {
  const prev = house ? houseRooms(house.id).sort((a, b) => (b.updated || 0) - (a.updated || 0))[0] : null;
  const r = {id: uid('r'), name: name || ('Room ' + ((house ? houseRooms(house.id).length : rooms.length) + 1)), site: house ? house.address : '',
    houseId: house ? house.id : uid('h'), houseAddress: house ? house.address : '', units: prev ? prev.units : 'm', ceiling: prev ? prev.ceiling : 2400,
    floorType: prev ? prev.floorType : 'Carpet', wallType: prev ? prev.wallType : 'Gyprock', shape: 'rect', open: false, startHeading: 0,
    walls: [], created: Date.now(), updated: Date.now(), pristine: true};
  applyShape(r, 'rect', {w: 4000, d: 3500});
  return r;
}
function applyShape(r, shape, p) {
  r.shape = shape; r.open = false; r.startHeading = 0; r.ox = 0; r.oy = 0;
  const t = '';
  if (shape === 'square') r.walls = [0, 1, 2, 3].map(i => mkWall(p.s, i ? 90 : 0, t));
  else if (shape === 'rect') r.walls = [p.w, p.d, p.w, p.d].map((l, i) => mkWall(l, i ? 90 : 0, t));
  else if (shape === 'lshape') {
    const {a, b, c, d} = p; // a: full width, b: full depth, c: notch width, d: notch depth
    r.walls = [[a, 0], [b - d, 90], [c, 90], [d, -90], [a - c, 90], [b, 90]].map(([l, tu]) => mkWall(l, tu, t));
  } else if (shape === 'three') {
    r.open = true; r.startHeading = -90;
    r.walls = [[p.d, 0], [p.w, 90], [p.d, 90]].map(([l, tu]) => mkWall(l, tu, t));
  } else if (shape === 'custom') {
    r.walls = [mkWall(p.first || 3000, 0, t)];
    r.open = true;
  }
}
const wallH = (r, w) => (w.height != null && w.height > 0) ? w.height : r.ceiling;
const isPoint = it => KINDS[it.kind].cls === 'point';
function itemLeft(it, w) { return it.ref === 'L' ? it.dist : (isPoint(it) ? w.length - it.dist : w.length - it.dist - it.w); }
function setItemLeft(it, w, left) {
  left = isPoint(it) ? clamp(left, 0, w.length) : clamp(left, 0, Math.max(0, w.length - it.w));
  it.dist = Math.round(it.ref === 'L' ? left : (isPoint(it) ? w.length - left : w.length - left - it.w));
}
function targetLeft(it, w) { const t = it.to || {ref: it.ref, dist: it.dist}; return t.ref === 'L' ? t.dist : (isPoint(it) ? w.length - t.dist : w.length - t.dist - it.w); }
function setTargetLeft(it, w, left) {
  if (!it.to) it.to = {ref: it.ref, dist: it.dist, floor: it.floor};
  left = isPoint(it) ? clamp(left, 0, w.length) : clamp(left, 0, Math.max(0, w.length - it.w));
  it.to.dist = Math.round(it.to.ref === 'L' ? left : (isPoint(it) ? w.length - left : w.length - left - it.w));
}
function targetSides(it, w) { const l = targetLeft(it, w); return {left: l, right: isPoint(it) ? w.length - l : w.length - l - it.w}; }
function ensureTo(it, w) {
  if (it.to) return;
  const l = itemLeft(it, w), nl = isPoint(it) ? clamp(l + 400, 0, w.length) : clamp(l + 400, 0, Math.max(0, w.length - it.w));
  it.to = {ref: it.ref, dist: 0, floor: it.floor}; setTargetLeft(it, w, nl === l ? Math.max(0, l - 400) : nl);
}
function roomSize(r) {
  const g = geom(r); if (!g.segs.length) return {w: 0, l: 0};
  const xs = g.segs.flatMap(s => [s.x1, s.x2]), ys = g.segs.flatMap(s => [s.y1, s.y2]);
  const a = Math.max(...xs) - Math.min(...xs), b = Math.max(...ys) - Math.min(...ys);
  return {w: Math.round(Math.min(a, b)), l: Math.round(Math.max(a, b)), x: Math.round(a), y: Math.round(b)};
}
function sides(it, w) { const l = itemLeft(it, w); return {left: l, right: isPoint(it) ? w.length - l : w.length - l - it.w}; }

/* geometry: points of the walk, orientation, neighbours */
function geom(r) {
  const x0 = r.ox || 0, y0 = r.oy || 0;
  let x = x0, y = y0, h = r.startHeading || 0;
  const segs = [];
  r.walls.forEach((w, i) => {
    if (i > 0) h += Number(w.turn) || 0;
    const rad = h * Math.PI / 180, dx = Math.cos(rad), dy = Math.sin(rad);
    const x2 = x + dx * w.length, y2 = y + dy * w.length;
    segs.push({x1: x, y1: y, x2, y2, dx, dy, h});
    x = x2; y = y2;
  });
  let cw = true;
  if (!r.open && segs.length > 2) {
    let a = 0; segs.forEach(s => a += s.x1 * s.y2 - s.x2 * s.y1); cw = a >= 0;
  } else { const sum = r.walls.slice(1).reduce((a, w) => a + (Number(w.turn) || 0), 0); cw = sum >= 0; }
  const gap = segs.length ? Math.hypot(x - x0, y - y0) : 0;
  let area = 0; if (!r.open) { segs.forEach(s => area += s.x1 * s.y2 - s.x2 * s.y1); area = Math.abs(area) / 2; }
  return {segs, cw, gap, area, end: {x, y}, start: {x: x0, y: y0}};
}
/* corner points of the plan: closed room = one per wall, open room = walls + 1 */
function planPoints(r) {
  const g = geom(r), pts = g.segs.map(s => ({x: s.x1, y: s.y1}));
  if (r.open && g.segs.length) pts.push({x: g.end.x, y: g.end.y});
  return pts;
}
const normF = t => ((t + 540) % 360) - 180;
/* rebuild wall lengths and turns from corner points (walls array must already have the right count) */
function applyPoints(r, pts) {
  const closed = !r.open, n = closed ? pts.length : pts.length - 1, hs = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[closed ? (i + 1) % pts.length : i + 1];
    r.walls[i].length = Math.max(10, Math.hypot(b.x - a.x, b.y - a.y));
    hs.push(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI);
  }
  r.startHeading = hs[0] || 0;
  r.walls.forEach((w, i) => w.turn = i ? normF(hs[i] - hs[i - 1]) : 0);
  r.ox = pts[0].x; r.oy = pts[0].y; r.shape = 'custom';
  r.walls.forEach(w => w.items.forEach(it => { setItemLeft(it, w, itemLeft(it, w)); if (it.to) setTargetLeft(it, w, targetLeft(it, w)); }));
}
function walkPos(it, w, g, target) { const l = target ? targetLeft(it, w) : itemLeft(it, w), c = isPoint(it) ? l : l + it.w / 2; return g.cw ? c : w.length - c; }
function setWalkPos(it, w, g, p, target) { const c = g.cw ? p : w.length - p, l = isPoint(it) ? c : c - it.w / 2; if (target) setTargetLeft(it, w, l); else setItemLeft(it, w, l); }
/* add a corner in the middle of wall i */
function splitWall(r, i) {
  const g = geom(r), pts = planPoints(r), s = g.segs[i], w = r.walls[i], half = w.length / 2;
  const info = w.items.map(it => ({it, p: walkPos(it, w, g), tp: it.to ? walkPos(it, w, g, true) : null}));
  const nw = mkWall(half, 0, w.type); nw.height = w.height;
  pts.splice(i + 1, 0, {x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2});
  r.walls.splice(i + 1, 0, nw); w.items = [];
  applyPoints(r, pts);
  const g2 = geom(r);
  info.forEach(({it, p, tp}) => { const t = p < half ? w : nw, off = p < half ? 0 : half; t.items.push(it); setWalkPos(it, t, g2, p - off); if (tp != null) setWalkPos(it, t, g2, tp - off, true); });
}
/* remove corner k: the two walls meeting there become one (an open end corner removes its end wall) */
function removeCorner(r, k) {
  let pts = planPoints(r);
  const n = r.walls.length, gOld = {cw: geom(r).cw};
  if (r.open) {
    if (n <= 1) return false;
    if (k === 0) { pts.shift(); r.walls.shift(); applyPoints(r, pts); return true; }
    if (k === pts.length - 1) { pts.pop(); r.walls.pop(); applyPoints(r, pts); return true; }
  } else if (n <= 3) return false;
  const rot = !r.open && k === 0;
  if (rot) { pts.push(pts.shift()); r.walls.push(r.walls.shift()); k = pts.length - 1; }
  const a = r.walls[k - 1], b = r.walls[k], La = a.length, Lb = b.length;
  const info = [...a.items.map(it => ({it, p: walkPos(it, a, gOld), tp: it.to ? walkPos(it, a, gOld, true) : null})),
                ...b.items.map(it => ({it, p: La + walkPos(it, b, gOld), tp: it.to ? La + walkPos(it, b, gOld, true) : null}))];
  pts.splice(k, 1); r.walls.splice(k, 1); a.items = [];
  if (rot) { pts.unshift(pts.pop()); r.walls.unshift(r.walls.pop()); }
  applyPoints(r, pts);
  const g2 = geom(r), f = a.length / (La + Lb);
  info.forEach(({it, p, tp}) => { a.items.push(it); setWalkPos(it, a, g2, p * f); if (tp != null) setWalkPos(it, a, g2, tp * f, true); });
  return true;
}
/* where the "add wall from this corner" handle sits: just outside the corner */
function addFromPos(r, k, fs) {
  const pts = planPoints(r), n = pts.length, C = pts[k];
  const P = pts[r.open ? Math.max(0, k - 1) : (k - 1 + n) % n], N = pts[r.open ? Math.min(n - 1, k + 1) : (k + 1) % n];
  const nrm = (x, y) => { const d = Math.hypot(x, y) || 1; return {x: x / d, y: y / d}; };
  const u1 = nrm(C.x - P.x, C.y - P.y), u2 = nrm(C.x - N.x, C.y - N.y);
  let b = nrm(u1.x + u2.x, u1.y + u2.y); if (!isFinite(b.x) || Math.hypot(u1.x + u2.x, u1.y + u2.y) < 0.05) b = {x: -u1.y, y: u1.x};
  return {x: C.x + b.x * fs * 2, y: C.y + b.y * fs * 2};
}
/* new corner after corner k: a new wall runs from corner k to it, and the old wall continues from it */
function insertFrom(r, k, pos) {
  const pts = planPoints(r);
  pts.splice(k + 1, 0, {x: pos.x, y: pos.y});
  const nw = mkWall(1000, 0, ''); r.walls.splice(k, 0, nw);
  applyPoints(r, pts);
  return k + 1;
}
/* open room: add a wall off one end */
function extendRoom(r, atStart) {
  const pts = planPoints(r), g = geom(r), len = 1000;
  if (atStart) { const h = (g.segs[0].h - 90) * Math.PI / 180, p = pts[0]; pts.unshift({x: p.x - Math.cos(h) * len, y: p.y - Math.sin(h) * len}); r.walls.unshift(mkWall(len, 0, '')); }
  else { const h = (g.segs[g.segs.length - 1].h + 90) * Math.PI / 180, p = pts[pts.length - 1]; pts.push({x: p.x + Math.cos(h) * len, y: p.y + Math.sin(h) * len}); r.walls.push(mkWall(len, 0, '')); }
  applyPoints(r, pts);
}
/* open room: join the two ends (snapped together, or with a new wall) */
function closeRoom(r) {
  const pts = planPoints(r), a = pts[0], b = pts[pts.length - 1];
  if (Math.hypot(a.x - b.x, a.y - b.y) < 30 && r.walls.length >= 3) pts.pop();
  else r.walls.push(mkWall(1000, 0, ''));
  r.open = false; applyPoints(r, pts);
}
/* item rectangle on its wall (x from viewer's left, y from floor) */
function itemRect(it, w, target) {
  const l = target ? targetLeft(it, w) : itemLeft(it, w), f = target ? it.to.floor : it.floor;
  return isPoint(it) ? {x0: l - it.w / 2, x1: l + it.w / 2, y0: f - it.h / 2, y1: f + it.h / 2} : {x0: l, x1: l + it.w, y0: f, y1: f + it.h};
}
const rectsHit = (a, b, gap = 0) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;
function overlapsOf(it, w) { const a = itemRect(it, w); return w.items.filter(o => o !== it && (o.status || 'existing') !== 'remove' && rectsHit(a, itemRect(o, w))); }
/* nudge a new item sideways until it doesn't sit on top of another one */
function visRect(it, w, fs) { const q = itemRect(it, w); if (!isPoint(it)) return q; const cx = (q.x0 + q.x1) / 2, cy = (q.y0 + q.y1) / 2, hw = Math.max(it.w, fs * 1.6) / 2 + fs * 0.4, hh = Math.max(it.h, fs * 1.1) / 2 + fs * 0.3; return {x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh}; }
function placeFree(w, it) {
  const fs = Math.max(w.length, wallH(room(), w)) * 0.03;
  const base = itemLeft(it, w), step = 50, max = Math.ceil(w.length / step) + 1;
  for (let k = 0; k <= max; k++) for (const sg of [1, -1]) {
    if (k === 0 && sg < 0) continue;
    setItemLeft(it, w, base + sg * k * step);
    const a = visRect(it, w, fs);
    if (!w.items.some(o => o !== it && rectsHit(a, visRect(o, w, fs), 30))) return;
  }
  setItemLeft(it, w, base);
}
function neighbours(r, i, g) {
  const n = r.walls.length;
  const prev = r.open ? (i > 0 ? i - 1 : null) : (i - 1 + n) % n;
  const next = r.open ? (i < n - 1 ? i + 1 : null) : (i + 1) % n;
  return g.cw ? {left: prev, right: next} : {left: next, right: prev};
}
/* elevation x (from viewer's left) -> plan point */
function planPt(seg, g, L, x) { const t = g.cw ? x : L - x; return {x: seg.x1 + seg.dx * t, y: seg.y1 + seg.dy * t}; }

/* ---------- storage ---------- */
let localOK = true;
function saveLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(rooms)); localStorage.setItem(LS_CUR, cur || ''); localStorage.setItem(LS_NAV, JSON.stringify({screen, house: curHouse, tab})); localStorage.setItem(LS_DEL, JSON.stringify(tombstones)); localOK = true; }
  catch (e) { localOK = false; }
  return localOK;
}
const hhmm = () => new Date().toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
function loadLocal() {
  try { rooms = JSON.parse(localStorage.getItem(LS_KEY) || '[]') || []; cur = localStorage.getItem(LS_CUR); tombstones = JSON.parse(localStorage.getItem(LS_DEL) || '[]') || []; } catch (e) { rooms = []; }
  if (!Array.isArray(rooms)) rooms = [];
  rooms.forEach(migrate);
}
function houseRooms(hid) { return rooms.filter(r => r.houseId === hid); }
function houseList() {
  const m = new Map();
  rooms.forEach(r => {
    const h = m.get(r.houseId) || {id: r.houseId, address: '', rooms: [], updated: 0};
    h.rooms.push(r); h.updated = Math.max(h.updated, r.updated || 0); if (r.houseAddress) h.address = r.houseAddress;
    m.set(r.houseId, h);
  });
  return [...m.values()].sort((a, b) => b.updated - a.updated);
}
function house(hid = curHouse) { return houseList().find(h => h.id === hid); }
function migrate(r) {
  if (!r) return;
  if (!r.houseId) { const a = String(r.site || '').trim(); r.houseAddress = a || 'Unsorted rooms'; r.houseId = 'h-' + (a.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'unsorted'); }
  r.site = r.houseAddress;
  migrate2(r);
}
function migrate2(r) { if (!r) return; r.wallType = normType(r.wallType) || 'Gyprock'; (r.walls || []).forEach(w => w.type = normType(w.type)); }
let saveTimer = null;
function touch(r = room()) {
  if (!r) return;
  r.updated = Date.now(); delete r.pristine;
  dirty.add(r.id); const ok = saveLocal();
  if (store) setStatus('saving');
  else if (ok) setStatus('local', 'Saved on this device · ' + hhmm());
  else setStatus('err', 'Not saved — this browser blocks storage');
  clearTimeout(saveTimer); saveTimer = setTimeout(flushRemote, 700);
}
async function flushRemote() {
  if (!store) return;
  for (const id of [...dirty]) {
    if (writing.has(id)) continue;
    const r = rooms.find(x => x.id === id);
    dirty.delete(id);
    if (!r || r.pristine) continue;
    writing.add(id); setStatus('saving');
    try { await store.put(id, JSON.parse(JSON.stringify(r))); failCount = 0; }
    catch (e) {
      const code = e && e.code;
      if (code === 'quota_exceeded') setStatus('err', 'Account storage full — delete old rooms (still saved on this device)');
      else if (code === 'revoked' || code === 'invalid_argument') setStatus('err', localOK ? 'Saved on this device only' : 'Not saved');
      else { dirty.add(id); failCount++; setStatus('err', localOK ? 'Offline — saved on this device, will sync' : 'Offline — retrying'); setTimeout(flushRemote, Math.min(30000, 1500 * failCount) + Math.random() * 1000); }
    } finally { writing.delete(id); if (dirty.has(id) && !failCount) setTimeout(flushRemote, 400); }
  }
  if (!dirty.size && !writing.size && !failCount) setStatus('cloud', 'All changes saved · ' + hhmm());
}
let failCount = 0;
function flushNow() { clearTimeout(saveTimer); saveLocal(); flushRemote(); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); });
window.addEventListener('pagehide', flushNow);
window.addEventListener('blur', flushNow);
window.addEventListener('online', () => { failCount = 0; flushRemote(); });
setInterval(() => { if (dirty.size && !writing.size) flushRemote(); }, 15000);
function setStatus(s, msg) {
  const el = $('#status'); el.className = 'status' + (s === 'cloud' || s === 'saving' ? ' cloud' : s === 'err' ? ' err' : '');
  el.querySelector('span').textContent = msg || ({cloud: 'Saved to your account', saving: 'Saving…', local: 'Saved on this device', err: 'Save problem'}[s]);
}
/* Where rooms are kept besides this device: the claude.ai account (when opened as a Claude artifact)
   or the Personal Tracker server (when opened inside the tracker). Both expose list / put / del. */
async function claudeStore() {
  if (!window.claude || !claude.use) return null;
  const [d, u, dls] = await Promise.all([claude.use('db'), claude.use('user'), claude.use('downloads')]);
  if (dls) dl = dls;
  if (!d || !u) return null;
  const id = await u.id(); if (!id) return null;
  const c = d.collection('data/users/' + id);
  return {
    name: 'your account',
    list: async () => (await c.get()).docs.filter(x => x.exists).map(x => x.data()),
    put: (rid, data) => c.doc(rid).set(data),
    del: rid => c.doc(rid).delete(),
  };
}
async function trackerStore() {
  if (window.claude) return null;
  const call = async (method, path, body) => {
    let res;
    try { res = await fetch('/api/room-measures' + path, {method, credentials: 'include', headers: body ? {'Content-Type': 'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined}); }
    catch (e) { throw {code: 'unavailable'}; }
    if (res.status === 401) throw {code: 'revoked', message: 'signed out'};
    if (res.status === 400 || res.status === 413) throw {code: 'invalid_argument'};
    if (!res.ok) throw {code: 'unavailable'};
    return res.headers.get('content-type')?.includes('json') ? res.json() : null;
  };
  try { await call('GET', ''); } catch (e) { if (e.code === 'revoked') setStatus('err', 'Sign in to the tracker to sync — saved on this device'); return null; }
  return {
    name: 'Personal Tracker',
    list: async () => ((await call('GET', '')).items || []),
    put: (rid, data) => call('PUT', '/' + encodeURIComponent(rid), {data}),
    del: rid => call('DELETE', '/' + encodeURIComponent(rid)),
  };
}
async function initCloud() {
  try {
    const st = (await claudeStore()) || (await trackerStore());
    if (!st) return;
    store = st;
    const remoteList = await Promise.race([st.list(), new Promise((_, rej) => setTimeout(() => rej({code: 'timeout'}), 10000))]);
    const remote = remoteList.filter(Boolean);
    let changed = false;
    for (const rr of remote) {
      if (!rr || !rr.id) continue;
      if (tombstones.includes(rr.id)) { st.del(rr.id).catch(() => {}); continue; }
      const li = rooms.findIndex(x => x.id === rr.id);
      const copy = JSON.parse(JSON.stringify(rr)); migrate(copy);
      if (li < 0) { rooms.push(copy); changed = true; }
      else if ((rr.updated || 0) > (rooms[li].updated || 0)) { rooms[li] = copy; changed = true; }
    }
    tombstones = [];
    const ids = new Set(remote.map(x => x && x.id));
    // drop an untouched starter room if the account already has rooms
    if (remote.length) { const before = rooms.length; rooms = rooms.filter(x => !(x.pristine && !ids.has(x.id))); if (rooms.length !== before) changed = true; }
    rooms.forEach(x => { if (!x.pristine && (!ids.has(x.id) || (remote.find(q => q.id === x.id)?.updated || 0) < (x.updated || 0))) dirty.add(x.id); });
    if (!room()) { cur = null; if (screen === 'room') screen = curHouse && house() ? 'house' : 'houses'; }
    if (screen === 'house' && !house()) screen = 'houses';
    saveLocal(); setStatus('cloud', 'Synced with ' + st.name);
    if (changed) { selWall = 0; selItem = null; renderAll(); }
    flushRemote();
  } catch (e) { setStatus('local', 'Saved on this device only'); }
}

/* ---------- modal & toast ---------- */
function ask(msg, yes = 'OK') {
  return new Promise(res => {
    $('#modalMsg').textContent = msg; $('#modalYes').textContent = yes; $('#modal').classList.add('on');
    $('#modalYes').classList.toggle('danger-btn', /remove|delete|replace/i.test(yes)); setTimeout(() => $('#modalNo').focus(), 0);
    const done = v => { $('#modal').classList.remove('on'); $('#modalYes').onclick = $('#modalNo').onclick = null; res(v); };
    $('#modalYes').onclick = () => done(true); $('#modalNo').onclick = () => done(false);
  });
}
let toastT; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }

/* ---------- SVG: plan ---------- */
function planSVG(r, opt = {}) {
  const g = geom(r);
  if (!g.segs.length) return '<div class="empty">Add walls in Room setup</div>';
  const xs = g.segs.flatMap(s => [s.x1, s.x2]), ys = g.segs.flatMap(s => [s.y1, s.y2]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const S = opt.frame ? opt.frame.S : Math.max(maxx - minx, maxy - miny, 1000), m = S * 0.17, fs = S * 0.045, wt = clamp(S * 0.014, 40, 160);
  const sg = g.cw ? 1 : -1; // interior side multiplier
  // wall letters and lengths sit outside the walls; push them apart so none overlap
  const labs = [];
  g.segs.forEach((s, i) => {
    const nx = s.dy * sg, ny = -s.dx * sg, mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2, txt = fmtU(r.walls[i].length, r);
    labs.push({i, kind: 't', txt, x: mx + nx * fs * 0.95, y: my + ny * fs * 0.95, r: Math.max(txt.length * fs * 0.62 * 0.55 / 2, fs * 0.4), nx, ny, ax: mx, ay: my, minN: fs * 0.95});
    labs.push({i, kind: 'l', x: mx + nx * fs * 2.1, y: my + ny * fs * 2.1, r: fs * 0.75, nx, ny, ax: mx, ay: my, minN: fs * 1.8});
  });
  // doors opening outward swing outside the walls: labels keep clear of them
  const obst = [];
  g.segs.forEach((sg2, i) => r.walls[i].items.forEach(it => { if (it.kind !== 'door' || it.swing !== 'out') return;
    const w2 = r.walls[i], nx2 = sg2.dy * sg, ny2 = -sg2.dx * sg, l2 = itemLeft(it, w2);
    const pa = planPt(sg2, g, w2.length, l2), pb = planPt(sg2, g, w2.length, l2 + it.w);
    obst.push({x: (pa.x + pb.x) / 2 + nx2 * it.w * 0.5, y: (pa.y + pb.y) / 2 + ny2 * it.w * 0.5, r: it.w * 0.72, pts: [pa, pb].map(q => ({x: q.x + nx2 * it.w, y: q.y + ny2 * it.w}))}); }));
  for (let it = 0; it < 80; it++) {
    let moved = false;
    labs.forEach(Q => obst.forEach(O => { const dx = Q.x - O.x, dy = Q.y - O.y, d = Math.hypot(dx, dy) || 0.01, need = Q.r + O.r;
      if (d < need) { moved = true; const tx = -Q.ny, ty = Q.nx, side = (dx * tx + dy * ty) >= 0 ? 1 : -1; // slide along the wall, away from the door
        Q.x += tx * side * fs * 0.25; Q.y += ty * side * fs * 0.25; } }));
    for (let a = 0; a < labs.length; a++) for (let b = a + 1; b < labs.length; b++) {
      const A = labs[a], B = labs[b], dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 0.01, need = A.r + B.r + fs * 0.15;
      if (d >= need) continue;
      moved = true;
      const push = (need - d) / 2 + fs * 0.02, ux = dx / d, uy = dy / d;
      if (A.i === B.i) { const L2 = A.kind === 'l' ? A : B; L2.x += L2.nx * push * 2; L2.y += L2.ny * push * 2; continue; }
      A.x -= ux * push; A.y -= uy * push; B.x += ux * push; B.y += uy * push;
      [A, B].forEach(Q => { const on = (Q.x - Q.ax) * Q.nx + (Q.y - Q.ay) * Q.ny; if (on < Q.minN) { Q.x += Q.nx * (Q.minN - on); Q.y += Q.ny * (Q.minN - on); } });
    }
    if (!moved) break;
  }
  let bx0 = minx - m, by0 = miny - m, bx1 = maxx + m, by1 = maxy + m;
  labs.forEach(q => { bx0 = Math.min(bx0, q.x - q.r - fs * 0.3); by0 = Math.min(by0, q.y - q.r - fs * 0.3); bx1 = Math.max(bx1, q.x + q.r + fs * 0.3); by1 = Math.max(by1, q.y + q.r + fs * 0.3); });
  obst.forEach(O => O.pts.forEach(q => { bx0 = Math.min(bx0, q.x - fs); by0 = Math.min(by0, q.y - fs); bx1 = Math.max(bx1, q.x + fs); by1 = Math.max(by1, q.y + fs); }));
  const vb = opt.frame ? opt.frame.vb : [bx0, by0, bx1 - bx0, by1 - by0];
  let o = `<svg xmlns="http://www.w3.org/2000/svg" font-family="system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif" viewBox="${vb.join(' ')}" data-s="${S}" ${opt.id ? `id="${opt.id}"` : ''}>`;
  o += `<defs><pattern id="hatchP" width="${wt * 1.2}" height="${wt * 1.2}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="${wt * 1.2}" height="${wt * 1.2}" fill="#fff"/><line x1="0" y1="0" x2="0" y2="${wt * 1.2}" stroke="#a8a29e" stroke-width="${wt * 0.25}"/></pattern></defs>`;
  o += `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="#fbfcfd"/>`;
  // floor fill
  if (!r.open) o += `<polygon points="${g.segs.map(s => s.x1 + ',' + s.y1).join(' ')}" fill="#eef2f7"/>`;
  // walls
  g.segs.forEach((s, i) => {
    const on = opt.sel === i;
    o += `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${on ? '#1f6feb' : '#2b3340'}" stroke-width="${wt}" stroke-linecap="square"/>`;
  });
  if (r.open && g.segs.length > 1) o += `<line x1="${g.end.x}" y1="${g.end.y}" x2="${g.start.x}" y2="${g.start.y}" stroke="#9aa3ae" stroke-width="${wt * 0.25}" stroke-dasharray="${wt} ${wt * 0.8}"/>`;
  if (!r.open && g.gap > 5) o += `<line x1="${g.end.x}" y1="${g.end.y}" x2="${g.start.x}" y2="${g.start.y}" stroke="#b42318" stroke-width="${wt * 0.4}" stroke-dasharray="${wt * 0.6} ${wt * 0.6}"/>`;
  // items (faded while editing the shape)
  if (opt.edit) o += `<g opacity=".3" pointer-events="none">`;
  const P = (x, y) => x + ',' + y;
  const lane = {}; // point markers that would touch on the same wall step further into the room
  r.walls.forEach(w => { const ends = []; w.items.filter(isPoint).map(it => ({it, x: itemLeft(it, w)})).sort((a, b) => a.x - b.x).forEach(({it, x}) => {
    let k = 0; while (ends[k] != null && x - ends[k] < fs * 1.05) k++; ends[k] = x; lane[it.id] = k; }); });
  g.segs.forEach((s, i) => {
    const w = r.walls[i], L = w.length, nx = -s.dy * sg, ny = s.dx * sg;
    w.items.forEach(it => {
      const k = KINDS[it.kind], sel = opt.selItem === it.id, st = it.status || 'existing';
      const c = st === 'remove' ? '#9aa3ae' : k.color, dash = st === 'new' ? ` stroke-dasharray="${wt * 0.5} ${wt * 0.3}"` : '';
      const l = itemLeft(it, w);
      o += `<g data-item="${it.id}" data-wall="${i}">`;
      if (k.cls !== 'point') {
        const a = planPt(s, g, L, l), b = planPt(s, g, L, l + it.w);
        if (k.cls === 'open' && it.kind !== 'ac') o += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#fbfcfd" stroke-width="${wt * 1.1}"/>`;
        if (it.kind === 'door') {
          // hinge on the left or right (as seen from inside), leaf swings into the room or outward
          const hp = it.hinge === 'R' ? b : a, jp = it.hinge === 'R' ? a : b, dir = it.swing === 'out' ? -1 : 1;
          const lx = hp.x + nx * dir * it.w, ly = hp.y + ny * dir * it.w;
          const cross = (lx - hp.x) * (jp.y - hp.y) - (ly - hp.y) * (jp.x - hp.x);
          o += `<line x1="${hp.x}" y1="${hp.y}" x2="${lx}" y2="${ly}" stroke="${c}" stroke-width="${wt * 0.35}"${dash}/>`;
          o += `<path d="M${lx} ${ly} A${it.w} ${it.w} 0 0 ${cross > 0 ? 1 : 0} ${jp.x} ${jp.y}" fill="none" stroke="${c}" stroke-width="${wt * 0.2}" stroke-dasharray="${wt * 0.5} ${wt * 0.3}"/>`;
        } else if (it.kind === 'window') {
          [-0.35, 0, 0.35].forEach(f => o += `<line x1="${a.x + nx * wt * f}" y1="${a.y + ny * wt * f}" x2="${b.x + nx * wt * f}" y2="${b.y + ny * wt * f}" stroke="${c}" stroke-width="${wt * 0.14}"${dash}/>`);
        } else if (it.kind === 'sliding') {
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, ex = (b.x - a.x) * 0.1, ey = (b.y - a.y) * 0.1;
          o += `<line x1="${a.x + nx * wt * 0.25}" y1="${a.y + ny * wt * 0.25}" x2="${mx + ex + nx * wt * 0.25}" y2="${my + ey + ny * wt * 0.25}" stroke="${c}" stroke-width="${wt * 0.3}"${dash}/>`;
          o += `<line x1="${mx - ex - nx * wt * 0.25}" y1="${my - ey - ny * wt * 0.25}" x2="${b.x - nx * wt * 0.25}" y2="${b.y - ny * wt * 0.25}" stroke="${c}" stroke-width="${wt * 0.3}"${dash}/>`;
        } else if (k.cls === 'round') {
          const rr = Math.max(it.w / 2, fs * 0.35), cx = (a.x + b.x) / 2 + nx * (wt * 0.5 + rr), cy = (a.y + b.y) / 2 + ny * (wt * 0.5 + rr);
          o += `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="#fff" stroke="${c}" stroke-width="${wt * 0.18}"${dash}/><text x="${cx}" y="${cy}" font-size="${fs * 0.4}" fill="${c}" text-anchor="middle" dominant-baseline="central" font-weight="700">V</text>`;
        } else { // ac grille or obstacle: box projecting into the room
          const dep = k.cls === 'obst' ? Math.max(it.depth || 0, wt * 0.6) : wt * 0.9, o0 = wt * 0.5;
          const q1 = P(a.x + nx * o0, a.y + ny * o0), q2 = P(b.x + nx * o0, b.y + ny * o0), q3 = P(b.x + nx * (o0 + dep), b.y + ny * (o0 + dep)), q4 = P(a.x + nx * (o0 + dep), a.y + ny * (o0 + dep));
          o += `<polygon points="${q1} ${q2} ${q3} ${q4}" fill="${k.cls === 'obst' ? 'url(#hatchP)' : '#fff'}" stroke="${c}" stroke-width="${wt * 0.18}"${dash}/>`;
          const mx = (a.x + b.x) / 2 + nx * (o0 + dep / 2), my = (a.y + b.y) / 2 + ny * (o0 + dep / 2);
          o += `<text x="${mx}" y="${my}" font-size="${fs * 0.5}" fill="${c}" text-anchor="middle" dominant-baseline="central" font-weight="700" paint-order="stroke" stroke="#fff" stroke-width="${fs * 0.12}">${k.short}</text>`;
        }
        if (st === 'remove') o += `<line x1="${a.x - nx * wt}" y1="${a.y - ny * wt}" x2="${b.x + nx * wt}" y2="${b.y + ny * wt}" stroke="#b42318" stroke-width="${wt * 0.25}"/><line x1="${b.x - nx * wt}" y1="${b.y - ny * wt}" x2="${a.x + nx * wt}" y2="${a.y + ny * wt}" stroke="#b42318" stroke-width="${wt * 0.25}"/>`;
        if (sel) o += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#1f6feb" stroke-opacity=".35" stroke-width="${wt * 2.2}"/>`;
        o += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="transparent" stroke-width="${wt * 3}"/>`;
      } else {
        const p = planPt(s, g, L, l), d = wt * 1.6 + (lane[it.id] || 0) * fs * 1.0, cx = p.x + nx * d, cy = p.y + ny * d, rr = fs * 0.45;
        if (sel) o += `<circle cx="${cx}" cy="${cy}" r="${rr * 1.7}" fill="#1f6feb" fill-opacity=".25"/>`;
        o += `<line x1="${p.x}" y1="${p.y}" x2="${cx}" y2="${cy}" stroke="${c}" stroke-width="${wt * 0.12}"/>`;
        o += `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="#fff" stroke="${c}" stroke-width="${wt * 0.18}"${dash}/>`;
        o += `<text x="${cx}" y="${cy}" font-size="${fs * (k.short.length > 2 ? 0.3 : 0.42)}" fill="${c}" text-anchor="middle" dominant-baseline="central" font-weight="700">${k.short}</text>`;
        if (st === 'remove') o += `<line x1="${cx - rr}" y1="${cy - rr}" x2="${cx + rr}" y2="${cy + rr}" stroke="#b42318" stroke-width="${wt * 0.2}"/><line x1="${cx + rr}" y1="${cy - rr}" x2="${cx - rr}" y2="${cy + rr}" stroke="#b42318" stroke-width="${wt * 0.2}"/>`;
        if (st === 'relocate' && it.to) {
          const tp = planPt(s, g, L, targetLeft(it, w)), tx = tp.x + nx * d, ty = tp.y + ny * d;
          o += `<line x1="${cx}" y1="${cy}" x2="${tx}" y2="${ty}" stroke="${c}" stroke-width="${wt * 0.12}" stroke-dasharray="${wt * 0.3} ${wt * 0.2}"/>`;
          o += `<circle cx="${tx}" cy="${ty}" r="${rr}" fill="#fff" stroke="${c}" stroke-width="${wt * 0.18}" stroke-dasharray="${wt * 0.3} ${wt * 0.2}"/><text x="${tx}" y="${ty}" font-size="${fs * 0.3}" fill="${c}" text-anchor="middle" dominant-baseline="central" font-weight="700">NEW</text>`;
        }
        o += `<circle cx="${cx}" cy="${cy}" r="${rr * 2}" fill="transparent"/>`;
      }
      o += `</g>`;
    });
  });
  if (opt.edit) o += `</g>`;
  // labels & lengths outside (positions worked out above)
  labs.forEach(q => {
    const on = opt.sel === q.i;
    if (q.kind === 'l') {
      o += `<g data-wall="${q.i}" style="cursor:pointer"><circle cx="${q.x}" cy="${q.y}" r="${fs * 0.75}" fill="${on ? '#1f6feb' : '#1c2430'}"/>`;
      o += `<text x="${q.x}" y="${q.y}" font-size="${fs * 0.8}" fill="#fff" text-anchor="middle" dominant-baseline="central" font-weight="700">${letter(q.i)}</text></g>`;
    } else {
      let ang = g.segs[q.i].h % 360; if (ang < 0) ang += 360; if (ang > 90 && ang < 270) ang -= 180;
      o += `<text x="${q.x}" y="${q.y}" font-size="${fs * 0.62}" fill="#4b5563" text-anchor="middle" dominant-baseline="central" transform="rotate(${ang} ${q.x} ${q.y})" paint-order="stroke" stroke="#fbfcfd" stroke-width="${fs * 0.15}">${q.txt}</text>`;
    }
  });
  // hit lines for walls
  if (opt.interactive && !opt.edit) g.segs.forEach((s, i) => o += `<line data-wall="${i}" x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="transparent" stroke-width="${wt * 3.5}"/>`);
  // centre info
  if (!r.open) {
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
    o += `<text x="${cx}" y="${cy - fs * 0.5}" font-size="${fs * 0.75}" fill="#1c2430" text-anchor="middle" font-weight="700">${esc(r.name)}</text>`;
    const rs = roomSize(r);
    o += `<text x="${cx}" y="${cy + fs * 0.5}" font-size="${fs * 0.55}" fill="#6b7380" text-anchor="middle">${fmt(rs.x, r)} × ${fmt(rs.y, r)} · ${(g.area / 1e6).toFixed(2)} m²</text>`;
    o += `<text x="${cx}" y="${cy + fs * 1.3}" font-size="${fs * 0.5}" fill="#6b7380" text-anchor="middle">${esc(r.floorType || '')} · Ceiling ${fmtU(r.ceiling, r)}</text>`;
  }
  if (opt.edit) {
    const pts = planPoints(r), hr = fs * 0.5;
    // selected corner: drag its + to draw a new wall from that corner
    const isEnd = k => r.open && (k === 0 || k === pts.length - 1);
    if (opt.selVtx != null && opt.selVtx < pts.length && !isEnd(opt.selVtx) && !opt.frame) {
      const k = opt.selVtx, a = addFromPos(r, k, fs);
      o += `<line x1="${pts[k].x}" y1="${pts[k].y}" x2="${a.x}" y2="${a.y}" stroke="#1f6feb" stroke-width="${wt * 0.2}" stroke-dasharray="${wt * 0.5} ${wt * 0.4}"/>`;
      o += `<g data-addfrom="${k}" style="cursor:copy"><circle cx="${a.x}" cy="${a.y}" r="${hr}" fill="#1f6feb"/><path d="M${a.x - hr * 0.5} ${a.y}h${hr}M${a.x} ${a.y - hr * 0.5}v${hr}" stroke="#fff" stroke-width="${wt * 0.3}"/><circle cx="${a.x}" cy="${a.y}" r="${hr * 1.8}" fill="transparent"/></g>`;
    }
    // open room: + beyond each end adds a wall there
    if (r.open) {
      const ext = (p, h, dir, key) => { const rad = h * Math.PI / 180, ex = p.x + Math.cos(rad) * dir * fs * 1.8, ey = p.y + Math.sin(rad) * dir * fs * 1.8;
        o += `<line x1="${p.x}" y1="${p.y}" x2="${ex}" y2="${ey}" stroke="#1f6feb" stroke-width="${wt * 0.2}" stroke-dasharray="${wt * 0.5} ${wt * 0.4}"/>`;
        o += `<g data-ext="${key}" style="cursor:copy"><circle cx="${ex}" cy="${ey}" r="${hr}" fill="#1f6feb"/><path d="M${ex - hr * 0.5} ${ey}h${hr}M${ex} ${ey - hr * 0.5}v${hr}" stroke="#fff" stroke-width="${wt * 0.3}"/><circle cx="${ex}" cy="${ey}" r="${hr * 1.8}" fill="transparent"/></g>`; };
      ext(pts[0], g.segs[0].h, -1, 'start'); ext(pts[pts.length - 1], g.segs[g.segs.length - 1].h, 1, 'end');
    }
    // draggable corners
    pts.forEach((p, k) => { const on = opt.selVtx === k, snapped = opt.snapStart && k === pts.length - 1;
      o += `<g data-vtx="${k}" style="cursor:grab"><circle cx="${p.x}" cy="${p.y}" r="${hr * (snapped ? 1.4 : 1)}" fill="${on || snapped ? '#1f6feb' : '#fff'}" stroke="#1f6feb" stroke-width="${wt * 0.3}"/><circle cx="${p.x}" cy="${p.y}" r="${hr * 2.2}" fill="transparent"/></g>`; });
  }
  return o + '</svg>';
}

/* ---------- SVG: elevation ---------- */
function dimH(x1, x2, y, label, c, fs, sw) {
  if (Math.abs(x2 - x1) < 1) return '';
  const t = fs * 0.35;
  return `<g stroke="${c}" stroke-width="${sw}"><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/><line x1="${x1}" y1="${y - t}" x2="${x1}" y2="${y + t}"/><line x1="${x2}" y1="${y - t}" x2="${x2}" y2="${y + t}"/></g>` +
    `<text x="${(x1 + x2) / 2}" y="${y - fs * 0.3}" font-size="${fs}" fill="${c}" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="${fs * 0.25}">${label}</text>`;
}
function dimV(x, y1, y2, label, c, fs, sw) {
  if (Math.abs(y2 - y1) < 1) return '';
  const t = fs * 0.35, my = (y1 + y2) / 2;
  return `<g stroke="${c}" stroke-width="${sw}"><line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/><line x1="${x - t}" y1="${y1}" x2="${x + t}" y2="${y1}"/><line x1="${x - t}" y1="${y2}" x2="${x + t}" y2="${y2}"/></g>` +
    `<text x="${x - fs * 0.35}" y="${my}" font-size="${fs}" fill="${c}" text-anchor="middle" transform="rotate(-90 ${x - fs * 0.35} ${my})" paint-order="stroke" stroke="#fff" stroke-width="${fs * 0.25}">${label}</text>`;
}
function elevSVG(r, wi, opt = {}) {
  const w = r.walls[wi]; if (!w) return '<div class="empty">No wall selected</div>';
  const g = geom(r), nb = neighbours(r, wi, g);
  const L = Math.max(w.length, 100), H = Math.max(wallH(r, w), 100), S = Math.max(L, H);
  const fs = S * 0.03, sw = S * 0.0018, m = S * 0.14;
  const Y = y => H - y; // floor at bottom
  const tw = (t, size) => String(t).length * size * 0.56; // rough text width
  let shapes = '', arrows = '';
  const vdims = [], hdims = [], labels = [], boxes = []; // boxes: drawn item rectangles in svg coords
  const draw = (it, l, floor, ghost) => {
    const k = KINDS[it.kind], st = it.status || 'existing', sel = opt.selItem === it.id;
    const bad = !ghost && st !== 'remove' && overlapsOf(it, w).length > 0;
    const c = (st === 'remove' || (st === 'relocate' && !ghost)) ? '#8b939e' : k.color;
    const dash = (ghost || st === 'new' || bad) ? ` stroke-dasharray="${fs * 0.5} ${fs * 0.3}"` : '';
    const swi = sw * (sel ? 5 : 2.5), stc = sel ? '#1f6feb' : bad ? '#b42318' : c;
    const tag = ghost ? 'new position' : st === 'new' ? 'new' : st === 'remove' ? 'remove' : '';
    let sh = `<g class="it" data-item="${it.id}"${ghost ? ' data-to="1"' : ''}>`;
    let cx, cy, top, bot, x0, x1;
    const t = ghost ? it.to : it, sd = ghost ? targetSides(it, w) : sides(it, w);
    if (k.cls === 'point') {
      cx = l; cy = Y(floor); const vw = Math.max(it.w, fs * 1.6), vh = Math.max(it.h, fs * 1.1);
      sh += `<rect x="${cx - vw / 2}" y="${cy - vh / 2}" width="${vw}" height="${vh}" rx="${fs * 0.2}" fill="#fff" stroke="${stc}" stroke-width="${swi}"${dash}/>`;
      sh += `<text x="${cx}" y="${cy}" font-size="${fs * (k.short.length > 2 ? 0.5 : 0.7)}" fill="${c}" text-anchor="middle" dominant-baseline="central" font-weight="700">${esc(k.short)}</text>`;
      sh += `<rect x="${cx - vw}" y="${cy - vh}" width="${vw * 2}" height="${vh * 2}" fill="transparent"/>`;
      top = cy - vh / 2; bot = cy + vh / 2; x0 = cx - vw / 2; x1 = cx + vw / 2;
      if (floor > 0) vdims.push({x: x1 + fs * 0.7, y: cy, label: fmt(floor, r), c});
      hdims.push(t.ref === 'L' ? {x1: 0, x2: cx, edge: cx, from: bot, label: fmt(sd.left, r), c} : {x1: cx, x2: L, edge: cx, from: bot, label: fmt(sd.right, r), c});
      const lines = [it.label, tag].filter(Boolean);
      if (lines.length) labels.push({cx, top, lines: lines.map(x => ({t: x, size: fs * 0.62, bold: false})), c, own: it.id});
    } else {
      x0 = l; x1 = l + it.w; bot = Y(floor); top = Y(floor + it.h); cx = (x0 + x1) / 2; cy = (top + bot) / 2;
      if (k.cls === 'round') {
        sh += `<circle cx="${cx}" cy="${cy}" r="${it.w / 2}" fill="#e0f2f4" stroke="${stc}" stroke-width="${swi}"${dash}/><circle cx="${cx}" cy="${cy}" r="${it.w * 0.3}" fill="none" stroke="${c}" stroke-width="${sw}"/>`;
        labels.push({cx, top, lines: [{t: `${it.label || 'Vent'} Ø${fmt(it.w, r)}`, size: fs * 0.7, bold: true}, ...(tag ? [{t: tag, size: fs * 0.6}] : [])], c, own: it.id});
      } else {
        const fill = k.cls === 'obst' ? 'url(#hatchE)' : it.kind === 'window' ? '#dbeefe' : it.kind === 'ac' ? '#e0f2f4' : it.kind === 'sliding' ? '#efe7fd' : '#fbefe2';
        sh += `<rect x="${x0}" y="${top}" width="${it.w}" height="${it.h}" fill="${fill}" stroke="${stc}" stroke-width="${swi}"${dash}/>`;
        if (it.kind === 'window') sh += `<line x1="${cx}" y1="${top}" x2="${cx}" y2="${bot}" stroke="${c}" stroke-width="${sw * 1.2}"/><line x1="${x0}" y1="${cy}" x2="${x1}" y2="${cy}" stroke="${c}" stroke-width="${sw * 1.2}" stroke-opacity=".5"/>`;
        if (it.kind === 'door') {
          // swing lines: point to the handle side; solid = opens towards you (into room), dashed = opens away (outward)
          const hx = it.hinge === 'R' ? x1 : x0, lxh = it.hinge === 'R' ? x0 : x1, out = it.swing === 'out';
          sh += `<path d="M${hx} ${top} L${lxh} ${cy} L${hx} ${bot}" fill="none" stroke="${c}" stroke-width="${sw * 1.2}" stroke-opacity=".7"${out ? ` stroke-dasharray="${fs * 0.35} ${fs * 0.25}"` : ''}/>`;
          sh += `<circle cx="${lxh + (it.hinge === 'R' ? 1 : -1) * Math.min(it.w * 0.1, 80)}" cy="${Y(floor + Math.min(1000, it.h * 0.5))}" r="${fs * 0.25}" fill="${c}"/>`;
        }
        if (it.kind === 'sliding') sh += `<line x1="${cx}" y1="${top}" x2="${cx}" y2="${bot}" stroke="${c}" stroke-width="${sw * 1.5}"/>`;
        if (it.kind === 'ac') for (let q = 1; q < 4; q++) sh += `<line x1="${x0 + it.w * 0.08}" y1="${top + it.h * q / 4}" x2="${x1 - it.w * 0.08}" y2="${top + it.h * q / 4}" stroke="${c}" stroke-width="${sw}"/>`;
        const name = (it.label || k.name) + (it.kind === 'door' ? (it.swing === 'out' ? ' · opens out' : ' · opens in') : ''), size = `${fmt(it.w, r)} × ${fmt(it.h, r)}${k.cls === 'obst' && it.depth ? ' × ' + fmt(it.depth, r) : ''}`;
        const lines = [{t: name + (tag ? ' · ' + tag : ''), size: fs * 0.75, bold: true}, {t: size, size: fs * 0.7}];
        const fits = lines.every(q => tw(q.t, q.size) < it.w * 0.92) && it.h > fs * 2.6;
        if (fits) { const ty = top + Math.min(it.h * 0.35, fs * 1.4); lines.forEach((q, n) => sh += `<text x="${cx}" y="${ty + n * fs}" font-size="${q.size}" fill="${c}" text-anchor="middle" ${q.bold ? 'font-weight="700"' : ''} paint-order="stroke" stroke="#fff" stroke-width="${fs * 0.2}">${esc(q.t)}</text>`); }
        else { if (tw(k.short, fs * 0.6) < it.w * 0.9 && it.h > fs) sh += `<text x="${cx}" y="${cy}" font-size="${fs * 0.6}" fill="${c}" text-anchor="middle" dominant-baseline="central" font-weight="700">${k.short}</text>`;
          labels.push({cx, top, lines, c, own: it.id}); }
      }
      if (st === 'remove' && !ghost) sh += `<line x1="${x0}" y1="${top}" x2="${x1}" y2="${bot}" stroke="#b42318" stroke-width="${sw * 3}"/><line x1="${x1}" y1="${top}" x2="${x0}" y2="${bot}" stroke="#b42318" stroke-width="${sw * 3}"/>`;
      if (floor > 0) vdims.push({x: x0 + Math.min(it.w * 0.25, fs * 1.6), y: bot, label: fmt(floor, r), c});
      hdims.push(t.ref === 'L' ? {x1: 0, x2: x0, edge: x0, from: bot, label: fmt(sd.left, r), c} : {x1: x1, x2: L, edge: x1, from: bot, label: fmt(sd.right, r), c});
    }
    if (st === 'remove' && !ghost && k.cls === 'point') sh += `<line x1="${x0}" y1="${top}" x2="${x1}" y2="${bot}" stroke="#b42318" stroke-width="${sw * 3}"/><line x1="${x1}" y1="${top}" x2="${x0}" y2="${bot}" stroke="#b42318" stroke-width="${sw * 3}"/>`;
    sh += `</g>`; shapes += sh;
    boxes.push({x0, x1, y0: top, y1: bot, own: it.id});
    return {cx, cy};
  };
  w.items.forEach(it => {
    const from = draw(it, itemLeft(it, w), it.floor, false);
    if ((it.status || 'existing') === 'relocate' && it.to) {
      const to = draw(it, targetLeft(it, w), it.to.floor, true), c = KINDS[it.kind].color;
      arrows += `<line x1="${from.cx}" y1="${from.cy}" x2="${to.cx}" y2="${to.cy}" stroke="${c}" stroke-width="${sw * 2}" stroke-dasharray="${fs * 0.4} ${fs * 0.25}" marker-end="url(#arrowE)" style="color:${c}"/>`;
    }
  });
  // floor heights: vertical dimension lines, moved sideways so no two touch
  let dimsOut = '';
  const usedX = [];
  vdims.sort((a, b) => a.x - b.x).forEach(d => {
    let x = d.x; while (usedX.some(u => Math.abs(u - x) < fs * 1.15)) x += fs * 1.15;
    usedX.push(x); dimsOut += dimV(x, H, d.y, d.label, d.c, fs * 0.75, sw);
  });
  // distances to the side walls: dimension strings below the floor, one row per clash
  const base = H + fs * 2.0, rowH = fs * 1.45, rows = [];
  hdims.sort((a, b) => Math.abs(a.x2 - a.x1) - Math.abs(b.x2 - b.x1)).forEach(d => {
    if (Math.abs(d.x2 - d.x1) < 1) return;
    const mid = (d.x1 + d.x2) / 2, half = tw(d.label, fs * 0.75) / 2 + fs * 0.3;
    const iv = [Math.min(d.x1, d.x2, mid - half), Math.max(d.x1, d.x2, mid + half)];
    let k = 0; while ((rows[k] || []).some(o => iv[0] < o[1] + fs * 0.2 && o[0] < iv[1] + fs * 0.2)) k++;
    (rows[k] = rows[k] || []).push(iv);
    const y = base + k * rowH;
    dimsOut += `<line x1="${d.edge}" y1="${d.from}" x2="${d.edge}" y2="${y + fs * 0.3}" stroke="${d.c}" stroke-width="${sw * 0.8}" stroke-dasharray="${fs * 0.25} ${fs * 0.2}" opacity=".7"/>`;
    dimsOut += dimH(d.x1, d.x2, y, d.label, d.c, fs * 0.75, sw);
  });
  const below = base + Math.max(rows.length - 1, 0) * rowH + fs * 1.6;
  // labels that don't fit inside their item go above it, moved up until they touch nothing
  let labOut = '';
  const placed = [];
  labels.forEach(lb => {
    const h = lb.lines.length * fs * 0.95, wdt = Math.max(...lb.lines.map(q => tw(q.t, q.size))) + fs * 0.4;
    let yb = lb.top - fs * 0.35; // baseline of the last line
    const hit = yy => { const bx = {x0: lb.cx - wdt / 2, x1: lb.cx + wdt / 2, y0: yy - h, y1: yy + fs * 0.15};
      return placed.some(p => rectsHit(bx, p)) || boxes.some(p => p.own !== lb.own && rectsHit(bx, p)); };
    let tries = 0; while (hit(yb) && tries < 12) { yb -= fs * 0.9; tries++; }
    placed.push({x0: lb.cx - wdt / 2, x1: lb.cx + wdt / 2, y0: yb - h, y1: yb + fs * 0.15});
    lb.lines.forEach((q, n) => labOut += `<text x="${lb.cx}" y="${yb - (lb.lines.length - 1 - n) * fs * 0.95}" font-size="${q.size}" fill="${lb.c}" text-anchor="middle" ${q.bold ? 'font-weight="700"' : ''} paint-order="stroke" stroke="#fff" stroke-width="${fs * 0.22}">${esc(q.t)}</text>`);
  });
  const topY = Math.min(-m, ...placed.map(p => p.y0 - fs * 2.2));
  const vb = [-m * 1.2, topY, L + m * 2.4, below + fs * 2.2 - topY];
  let o = `<svg xmlns="http://www.w3.org/2000/svg" font-family="system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif" viewBox="${vb.join(' ')}" ${opt.id ? `id="${opt.id}"` : ''}>`;
  o += `<defs><pattern id="hatchE" width="${fs}" height="${fs}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="${fs}" height="${fs}" fill="#f5f5f4"/><line x1="0" y1="0" x2="0" y2="${fs}" stroke="#a8a29e" stroke-width="${sw * 2}"/></pattern><marker id="arrowE" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>`;
  o += `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="#fbfcfd"/>`;
  o += `<rect x="0" y="0" width="${L}" height="${H}" fill="#f3f4f1" stroke="#2b3340" stroke-width="${sw * 2}"/>`;
  o += `<rect x="${-m * 0.4}" y="${H}" width="${L + m * 0.8}" height="${fs * 0.6}" fill="#d9dde3"/>`;
  o += `<line x1="${-m * 0.4}" y1="${H}" x2="${L + m * 0.4}" y2="${H}" stroke="#2b3340" stroke-width="${sw * 5}"/>`;
  o += dimH(0, L, topY + fs * 1.6, `Wall ${letter(wi)} · ${fmtU(w.length, r)}`, '#1c2430', fs * 1.05, sw * 1.2);
  o += dimV(-m * 0.55, 0, H, `Height ${fmtU(H, r)}`, '#1c2430', fs, sw * 1.2);
  o += shapes + arrows + dimsOut + labOut;
  const nbl = i => i == null ? 'open end' : 'Wall ' + letter(i);
  o += `<text x="0" y="${below}" font-size="${fs * 0.9}" fill="#6b7380">◀ ${nbl(nb.left)}</text>`;
  o += `<text x="${L}" y="${below}" font-size="${fs * 0.9}" fill="#6b7380" text-anchor="end">${nbl(nb.right)} ▶</text>`;
  const mid = `${w.type || r.wallType || ''}${r.floorType ? ' · Floor: ' + r.floorType : ''}`;
  if (tw(mid, fs * 0.8) < L - tw('◀ Wall X', fs * 0.9) * 2 - fs) o += `<text x="${L / 2}" y="${below}" font-size="${fs * 0.8}" fill="#6b7380" text-anchor="middle">${esc(mid)}</text>`;
  if (!w.items.length && opt.interactive) o += `<text x="${L / 2}" y="${H / 2}" font-size="${fs}" fill="#9aa3ae" text-anchor="middle">No items yet — add one below or tap the wall on the plan</text>`;
  return o + '</svg>';
}

/* ---------- render ---------- */
function renderRoomSel() {
  const h = house(), sep = '<span class="sep">›</span>';
  let c = `<a data-go="houses">Houses</a>`;
  if (screen !== 'houses' && h) c += sep + `<a data-go="house" title="${esc(h.address)}">${esc(h.address || 'House')}</a>`;
  if (screen === 'room' && h) c += sep + `<select id="roomSel" aria-label="Room">${h.rooms.map(r => `<option value="${r.id}" ${r.id === cur ? 'selected' : ''}>${esc(r.name || 'Untitled')}</option>`).join('')}<option value="__new">+ Add room…</option></select>`;
  $('#crumbs').innerHTML = c;
}
const ICON_HOUSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/></svg>';
const ICON_ROOM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 12h6M14 4v6"/></svg>';
const ago = t => { if (!t) return ''; const d = new Date(t); return d.toLocaleDateString([], {day: 'numeric', month: 'short'}) + ' ' + d.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'}); };
function renderHouses() {
  const hs = houseList();
  $('#houseList').innerHTML = hs.length ? hs.map(h => `<div class="li" data-house="${esc(h.id)}"><div class="ic">${ICON_HOUSE}</div><div class="grow"><div class="t">${esc(h.address || 'No address')}</div><div class="s">${h.rooms.length} room${h.rooms.length === 1 ? '' : 's'} · ${esc(h.rooms.map(r => r.name).slice(0, 4).join(', '))}${h.rooms.length > 4 ? '…' : ''}</div></div><div class="s">${ago(h.updated)}</div></div>`).join('')
    : '<div class="empty">No houses yet — enter an address above to start.</div>';
}
function renderHouse() {
  const h = house(); if (!h) { screen = 'houses'; return renderAll(); }
  const ai = $('#houseAddr'); if (document.activeElement !== ai) ai.value = h.address;
  const area = h.rooms.reduce((a, r) => a + (r.open ? 0 : geom(r).area), 0);
  $('#houseStats').innerHTML = `<span>Rooms <b>${h.rooms.length}</b></span><span>Measured floor area <b>${(area / 1e6).toFixed(2)} m²</b></span><span>Last change <b>${ago(h.updated)}</b></span>`;
  $('#roomList').innerHTML = h.rooms.slice().sort((a, b) => (a.created || 0) - (b.created || 0)).map(r => {
    const rs = roomSize(r), n = r.walls.reduce((a, w) => a + w.items.length, 0);
    return `<div class="li" data-openroom="${r.id}"><div class="ic">${ICON_ROOM}</div><div class="grow"><div class="t">${esc(r.name || 'Untitled')}</div><div class="s">${fmt(rs.x, r)} × ${fmt(rs.y, r)} ${r.units} · ${r.walls.length} walls · ${n} item${n === 1 ? '' : 's'} · ceiling ${fmtU(r.ceiling, r)}</div></div><button class="btn sm danger" data-delroom="${r.id}" title="Delete room">✕</button></div>`;
  }).join('');
}
function openRoom(id, t = 'setup') { cur = id; const r = room(); if (!r) return; curHouse = r.houseId; screen = 'room'; tab = t; selWall = 0; selItem = null; saveLocal(); renderAll(); window.scrollTo(0, 0); }
function goHouse(hid) { curHouse = hid; screen = house(hid) ? 'house' : 'houses'; saveLocal(); renderAll(); window.scrollTo(0, 0); }
async function removeRoom(r) {
  const last = houseRooms(r.houseId).length === 1;
  if (!(await ask(`Delete “${r.name}” and all its measurements?${last ? ' It is the only room, so the house will be removed too.' : ''}`, 'Delete'))) return false;
  rooms = rooms.filter(x => x.id !== r.id); dirty.delete(r.id);
  if (store) store.del(r.id).catch(() => { tombstones.push(r.id); saveLocal(); }); else tombstones.push(r.id);
  if (cur === r.id) cur = null;
  saveLocal(); return true;
}
const SHAPES = {
  square: {name: 'Square', svg: '<rect x="12" y="6" width="32" height="32"/>'},
  rect:   {name: 'Rectangle', svg: '<rect x="4" y="9" width="48" height="26"/>'},
  lshape: {name: 'L-shape', svg: '<path d="M6 6h44v18H28v14H6z"/>'},
  three:  {name: '3 walls', svg: '<path d="M8 38V6h40v32"/><path d="M8 38h40" stroke-dasharray="3 3" stroke-width="1.2"/>'},
  custom: {name: 'Custom', svg: '<path d="M6 30l8-22 22 4 14 14-10 12H16z"/>'},
};
let shapePick = null;
function renderSetup() {
  const r = room(); if (!r) return;
  $$('[data-room]').forEach(el => {
    const k = el.dataset.room;
    el.value = k === 'ceiling' ? fmt(r.ceiling) : (r[k] ?? '');
  });
  $$('.u').forEach(e => e.textContent = r.units);
  const sp = shapePick || r.shape;
  $('#shapes').innerHTML = Object.entries(SHAPES).map(([k, s]) => `<div class="shape ${sp === k ? 'on' : ''}" data-shape="${k}"><svg viewBox="0 0 56 44" fill="#eef2f7" stroke="#1c2430" stroke-width="2.2">${s.svg}</svg><div>${s.name}</div></div>`).join('');
  const u = r.units, inp = (id, label, v) => `<label class="f">${label}<div class="unit-in"><input id="${id}" type="number" inputmode="decimal" step="any" value="${fmt(v)}"><span>${u}</span></div></label>`;
  let si = '';
  if (sp === 'square') si = inp('sp_s', 'Side length', 3500);
  else if (sp === 'rect') si = inp('sp_w', 'Width (walls A & C)', 4000) + inp('sp_d', 'Depth (walls B & D)', 3500);
  else if (sp === 'lshape') si = inp('sp_a', 'Overall width', 5000) + inp('sp_b', 'Overall depth', 4500) + inp('sp_c', 'Cut-out width', 2000) + inp('sp_d', 'Cut-out depth', 1800);
  else if (sp === 'three') si = inp('sp_w', 'Back wall (B)', 3000) + inp('sp_d', 'Side walls (A & C)', 2500);
  else if (sp === 'custom') si = inp('sp_f', 'First wall (A)', 3000);
  $('#shapeInputs').innerHTML = `<div class="fields">${si}</div><div class="row" style="margin-top:10px"><button class="btn primary" id="applyShape">Create ${SHAPES[sp].name} room</button>${sp === 'custom' ? '<span class="note">Then add each wall below with its length and turn.</span>' : ''}</div>`;
  // wall table
  const turnOpts = [[90, 'Right 90°'], [-90, 'Left 90°'], [0, 'Straight'], [45, 'Right 45°'], [-45, 'Left 45°'], [135, 'Right 135°'], [-135, 'Left 135°']];
  $('#wallTable').innerHTML = `<tr><th>Wall</th><th>Length (${u})</th><th>Turn from previous</th><th>Wall type</th><th>Height (${u})</th><th></th></tr>` +
    r.walls.map((w, i) => {
      const t = Number(w.turn) || 0, known = turnOpts.some(o => o[0] === t);
      return `<tr><td><span class="lbl">${letter(i)}</span></td>
      <td><input type="number" inputmode="decimal" step="any" data-wi="${i}" data-wf="length" value="${fmt(w.length)}"></td>
      <td>${i === 0 ? '<span class="note">start</span>' : `<div class="row" style="flex-wrap:nowrap"><select data-wi="${i}" data-wf="turnSel">${turnOpts.map(o => `<option value="${o[0]}" ${o[0] === t ? 'selected' : ''}>${o[1]}</option>`).join('')}<option value="c" ${known ? '' : 'selected'}>Custom</option></select><input type="number" step="any" style="width:84px" data-wi="${i}" data-wf="turn" value="${t}" title="degrees, + = right"></div>`}</td>
      <td>${wallTypeSel(`data-wi="${i}" data-wf="type"`, w.type, r.wallType)}</td>
      <td><input type="number" inputmode="decimal" step="any" data-wi="${i}" data-wf="height" value="${w.height ? fmt(w.height) : ''}" placeholder="${fmt(r.ceiling)}"></td>
      <td><button class="btn sm danger" data-delwall="${i}" title="Remove wall">✕</button></td></tr>`;
    }).join('');
  $('#openRoom').checked = !!r.open;
  renderClosure();
}
function renderClosure() {
  const r = room(), g = geom(r);
  const rs = roomSize(r);
  $('#closureWarn').innerHTML = `<p class="note" style="margin:10px 0 0">Overall room size: <b>${fmtU(rs.x)} × ${fmtU(rs.y)}</b> (width × length) · ceiling ${fmtU(r.ceiling)}${r.open ? '' : ` · floor area ${(g.area / 1e6).toFixed(2)} m²`}</p>` + ((!r.open && r.walls.length > 2 && g.gap > 5)
    ? `<div class="warn">The walls don't meet up — there is a ${fmtU(g.gap)} gap between the end of the last wall and the start of wall A. <button class="btn sm" id="fixClose">Adjust last wall to close</button><button class="btn sm" id="addClose">Add closing wall</button></div>` : '');
}
function renderTools() {
  const t = [['select', 'Select', '#1c2430'], ...Object.entries(KINDS).map(([k, v]) => [k, v.name, v.color])];
  const groups = {}; Object.entries(KINDS).forEach(([k, v]) => (groups[v.group] = groups[v.group] || []).push([k, v]));
  const btn = (k, n, c, attr, on) => `<button class="btn sm tool ${on ? 'on' : ''}" ${attr}="${k}"><span class="dot" style="background:${c}"></span>${n}</button>`;
  const editBtn = `<button class="btn sm tool ${shapeEdit ? 'on' : ''}" data-shapeedit="1">✏️ ${shapeEdit ? 'Done editing shape' : 'Edit shape'}</button>`;
  $('#planTools').innerHTML = shapeEdit ? editBtn : editBtn + `<button class="btn sm tool ${mode === 'select' ? 'on' : ''}" data-mode="select">☝ Select</button>` +
    Object.entries(groups).map(([g, list]) => `<div class="tool-group"><small>${g}</small>${list.map(([k, v]) => btn(k, v.name, v.color, 'data-mode', mode === k)).join('')}</div>`).join('');
  t.length;
  $('#planHint').textContent = shapeEdit ? 'Drag a corner to reshape. To add a wall, tap a corner and drag its blue + to where the new wall should go (the old wall then continues from the new corner). On an open room, drag the + at either end to add a wall there, or drag one end onto the other to join them. Tap a corner to delete it below.'
    : mode === 'select' ? 'Tap a wall to open it. Pick an item above, then tap where it is on a wall to mark it.' : `Tap the wall where the ${KINDS[mode].name.toLowerCase()} is.`;
  renderShapeBar();
  $('#addItemTools').innerHTML = Object.entries(groups).map(([g, list]) => `<div class="tool-group"><small>${g}</small>${list.map(([k, v]) => btn(k, '+ ' + v.name, v.color, 'data-add', false)).join('')}</div>`).join('');
}
function renderShapeBar() {
  const r = room(), bar = $('#shapeBar'); if (!bar) return;
  if (!shapeEdit || !r) { bar.innerHTML = ''; return; }
  const n = r.walls.length, pts = planPoints(r);
  let h = '';
  if (selVtx != null && selVtx < pts.length) h += `<button class="btn sm danger" data-sb="delvtx">Delete selected corner</button>`;
  if (r.open && n >= 2) h += `<button class="btn sm" data-sb="close">Join the two ends</button>`;
  if (!r.open && n > 3) h += `<button class="btn sm" data-sb="open">Leave wall ${letter(selWall)} open</button>`;
  h += `<span class="note">${r.open ? 'Open room' : 'Closed room'} · ${n} wall${n === 1 ? '' : 's'}</span>`;
  bar.innerHTML = h;
}
function renderWallPanel() {
  const r = room(); const w = r.walls[selWall];
  $('#wallChips').innerHTML = r.walls.map((x, i) => `<button class="chip ${i === selWall ? 'on' : ''}" data-chip="${i}">${letter(i)}</button>`).join('');
  if (!w) { $('#wallFields').innerHTML = ''; $('#itemList').innerHTML = ''; return; }
  const u = r.units;
  $('#wallFields').innerHTML = `<div class="fields" style="margin-top:10px">
    <label class="f">Wall ${letter(selWall)} length<div class="unit-in"><input type="number" inputmode="decimal" step="any" data-pf="length" value="${fmt(w.length)}"><span>${u}</span></div></label>
    <label class="f">Height<div class="unit-in"><input type="number" inputmode="decimal" step="any" data-pf="height" value="${w.height ? fmt(w.height) : ''}" placeholder="${fmt(r.ceiling)} (ceiling)"><span>${u}</span></div></label>
    <label class="f">Wall type${wallTypeSel('data-pf="type"', w.type, r.wallType)}</label>
    <label class="f">Notes<input data-pf="note" value="${esc(w.note)}" placeholder="optional"></label>
  </div><div class="row" style="justify-content:space-between;margin-top:8px"><div class="stats" id="wallStats" style="margin-top:0"></div>${r.walls.length > 1 ? `<button class="btn sm danger" id="delWallBtn">🗑 Delete wall ${letter(selWall)}</button>` : ''}</div>`;
  renderItems();
  renderWallStats();
}
const doorSwing = it => it.kind === 'door' ? `opens ${it.swing === 'out' ? 'outward' : 'into room'}, hinge ${it.hinge === 'R' ? 'right' : 'left'}` : '';
const itemTitle = it => KINDS[it.kind].name + (it.kind === 'door' ? ` (${doorSwing(it)})` : '');
function itemLabels(it) {
  const k = KINDS[it.kind];
  if (k.cls === 'point') return {floor: 'Floor → centre', dist: 'Side wall → centre'};
  if (k.cls === 'round') return {w: 'Diameter', floor: 'Floor → bottom of opening', dist: 'Side wall → edge'};
  if (k.cls === 'obst') return {w: 'Width', h: 'Height', depth: 'Depth (sticks out)', floor: 'Floor → bottom', dist: 'Side wall → edge'};
  if (it.kind === 'ac') return {w: 'Width', h: 'Height', floor: 'Floor → bottom', dist: 'Side wall → edge'};
  return {w: 'Width incl. frame', h: 'Height incl. frame', floor: 'Floor → bottom of frame', dist: 'Side wall → frame'};
}
function kindOptions(sel) {
  const groups = {};
  Object.entries(KINDS).forEach(([k, v]) => (groups[v.group] = groups[v.group] || []).push([k, v]));
  return Object.entries(groups).map(([g, list]) => `<optgroup label="${g}">${list.map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v.name}</option>`).join('')}</optgroup>`).join('');
}
function renderItems() {
  const r = room(), w = r.walls[selWall], u = r.units;
  if (!w) return;
  const num = (id, f, label, v) => `<label class="f">${label}<div class="unit-in"><input type="number" inputmode="decimal" step="any" data-ii="${id}" data-if="${f}" value="${fmt(v)}"><span>${u}</span></div></label>`;
  $('#itemList').innerHTML = w.items.length ? w.items.map(it => {
    const k = KINDS[it.kind], lb = itemLabels(it), st = it.status || 'existing';
    let f = '';
    if (lb.w) f += num(it.id, 'w', lb.w, it.w);
    if (lb.h) f += num(it.id, 'h', lb.h, it.h);
    if (lb.depth) f += num(it.id, 'depth', lb.depth, it.depth || 0);
    f += num(it.id, 'floor', lb.floor, it.floor);
    f += `<label class="f wide">${lb.dist}<div class="unit-in"><span class="seg"><button data-ii="${it.id}" data-ref="L" class="${it.ref === 'L' ? 'on' : ''}" title="Measured from left side wall">◀ L</button><button data-ii="${it.id}" data-ref="R" class="${it.ref === 'R' ? 'on' : ''}" title="Measured from right side wall">R ▶</button></span><input type="number" inputmode="decimal" step="any" data-ii="${it.id}" data-if="dist" value="${fmt(it.dist)}"><span>${u}</span></div></label>`;
    let reloc = '';
    if (st === 'relocate' && it.to) {
      reloc = `<div class="reloc"><b>New position</b><div class="fields" style="margin-top:6px">
        ${num(it.id, 'tfloor', lb.floor, it.to.floor)}
        <label class="f wide">${lb.dist}<div class="unit-in"><span class="seg"><button data-ii="${it.id}" data-tref="L" class="${it.to.ref === 'L' ? 'on' : ''}">◀ L</button><button data-ii="${it.id}" data-tref="R" class="${it.to.ref === 'R' ? 'on' : ''}">R ▶</button></span><input type="number" inputmode="decimal" step="any" data-ii="${it.id}" data-if="tdist" value="${fmt(it.to.dist)}"><span>${u}</span></div></label>
      </div><div class="nearest" data-tnear="${it.id}"></div></div>`;
    }
    return `<div class="item ${selItem === it.id ? 'sel' : ''}" style="--c:${k.color}" data-card="${it.id}">
      <div class="item-h"><select data-ii="${it.id}" data-if="kind">${kindOptions(it.kind)}</select>
      <select data-ii="${it.id}" data-if="status" class="status-sel s-${st}">${Object.entries(STATUS).map(([sk, sv]) => `<option value="${sk}" ${sk === st ? 'selected' : ''}>${sv}</option>`).join('')}</select>
      <input data-ii="${it.id}" data-if="label" value="${esc(it.label)}" placeholder="Label (e.g. W1, double GPO)">
      <button class="btn sm danger" data-delitem="${it.id}" title="Delete">✕</button></div>
      <div class="fields">${f}</div>
      ${it.kind === 'door' ? `<div class="row" style="margin-top:8px;gap:14px">
        <span class="note">Opens</span><span class="seg"><button data-ii="${it.id}" data-swing="in" class="${it.swing !== 'out' ? 'on' : ''}">Into room</button><button data-ii="${it.id}" data-swing="out" class="${it.swing === 'out' ? 'on' : ''}">Outward</button></span>
        <span class="note">Hinge</span><span class="seg"><button data-ii="${it.id}" data-hinge="L" class="${it.hinge !== 'R' ? 'on' : ''}">◀ Left</button><button data-ii="${it.id}" data-hinge="R" class="${it.hinge === 'R' ? 'on' : ''}">Right ▶</button></span>
        <span class="note">(as seen from inside the room)</span></div>` : ''}
      <div class="nearest" data-near="${it.id}"></div>
      ${reloc}
      <input data-ii="${it.id}" data-if="note" value="${esc(it.note || '')}" placeholder="Notes (e.g. 2 gang, hot & cold, cap-off)" style="width:100%;margin-top:8px">
    </div>`;
  }).join('') : '<div class="empty">Nothing on this wall yet.</div>';
  updateNear();
}
function updateNear() {
  const r = room(), w = r.walls[selWall]; if (!w) return;
  const g = geom(r), nb = neighbours(r, selWall, g), nm = i => i == null ? 'open end' : 'Wall ' + letter(i);
  w.items.forEach(it => {
    const el = document.querySelector(`[data-near="${it.id}"]`); if (!el) return;
    const s = sides(it, w), bad = s.left < -0.5 || s.right < -0.5;
    el.innerHTML = `◀ ${fmtU(s.left)} to ${nm(nb.left)} &nbsp;·&nbsp; ${fmtU(s.right)} to ${nm(nb.right)} ▶` +
      (isPoint(it) ? '' : ` &nbsp;·&nbsp; top at ${fmtU(it.floor + it.h)}`) + (bad ? ' <b style="color:#b42318">— doesn\'t fit on this wall</b>' : '') +
      ((it.status || 'existing') !== 'remove' && overlapsOf(it, w).length ? ` <b style="color:#b42318">⚠ overlaps ${overlapsOf(it, w).map(o => esc(o.label || KINDS[o.kind].name)).join(', ')}</b>` : '');
    const te = document.querySelector(`[data-tnear="${it.id}"]`);
    if (te && it.to) { const t = targetSides(it, w); te.innerHTML = `◀ ${fmtU(t.left)} to ${nm(nb.left)} &nbsp;·&nbsp; ${fmtU(t.right)} to ${nm(nb.right)} ▶ &nbsp;·&nbsp; ${fmtU(it.to.floor)} from floor`; }
  });
}
function renderWallStats() {
  const r = room(), w = r.walls[selWall], el = $('#wallStats'); if (!w || !el) return;
  const gross = w.length * wallH(r, w) / 1e6, op = w.items.filter(i => DEDUCT[i.kind]).reduce((a, i) => a + i.w * i.h, 0) / 1e6;
  const cnt = {}; w.items.forEach(i => cnt[i.kind] = (cnt[i.kind] || 0) + 1);
  el.innerHTML = `<span>Wall area <b>${gross.toFixed(2)} m²</b></span><span>Openings <b>${op.toFixed(2)} m²</b></span><span>Net <b>${(gross - op).toFixed(2)} m²</b></span>` +
    Object.entries(cnt).map(([k, n]) => `<span>${KINDS[k].name}: <b>${n}</b></span>`).join('');
}
function renderRoomStats() {
  const r = room(), g = geom(r);
  const per = r.walls.reduce((a, w) => a + w.length, 0);
  const wallA = r.walls.reduce((a, w) => a + w.length * wallH(r, w), 0) / 1e6;
  const op = r.walls.reduce((a, w) => a + w.items.filter(i => DEDUCT[i.kind]).reduce((b, i) => b + i.w * i.h, 0), 0) / 1e6;
  const rs = roomSize(r);
  $('#roomStats').innerHTML = `<span>Room <b>${fmt(rs.x)} × ${fmt(rs.y)} ${r.units}</b></span>` + (r.open ? '' : `<span>Floor area <b>${(g.area / 1e6).toFixed(2)} m²</b></span>`) +
    `<span>Wall run <b>${fmtU(per)}</b></span><span>Ceiling <b>${fmtU(r.ceiling)}</b></span><span>Walls <b>${r.walls.length}</b></span><span>Net wall area <b>${(wallA - op).toFixed(2)} m²</b></span>`;
}
function renderDrawings() {
  const r = room(); if (!r) return;
  $('#plan').innerHTML = planSVG(r, {sel: selWall, selItem, interactive: true, id: 'planSvg', edit: shapeEdit, selVtx, frame: vdrag && vdrag.moved ? vdrag.frame : null, snapStart: vdrag && vdrag.snap});
  $('#elev').innerHTML = elevSVG(r, selWall, {selItem, interactive: true, id: 'elevSvg'});
  renderRoomStats(); renderWallStats(); updateNear();
  if (tab === 'setup') renderClosure();
}
function renderReport() {
  const r = room(); if (!r) return;
  $('#report').innerHTML = reportHTML(r);
}
function reportHTML(r) {
  const g = geom(r);
  const rs = roomSize(r);
  let h = `<p class="note">${esc(r.site || '')}${r.site ? ' · ' : ''}Room ${fmtU(rs.x, r)} × ${fmtU(rs.y, r)} · Ceiling ${fmtU(r.ceiling, r)} · Floor: ${esc(r.floorType || '—')} · Walls: ${esc(r.wallType || '—')}${r.open ? '' : ` · Floor area ${(g.area / 1e6).toFixed(2)} m²`}</p>`;
  h += `<div class="svgbox" style="max-width:720px">${planSVG(r, {})}</div>`;
  r.walls.forEach((w, i) => {
    const nb = neighbours(r, i, g), nm = j => j == null ? 'open end' : 'Wall ' + letter(j);
    h += `<div class="report-wall"><h3 style="color:#1c2430;font-size:15px;text-transform:none;letter-spacing:0">Wall ${letter(i)} — ${fmtU(w.length, r)} × ${fmtU(wallH(r, w), r)} · ${esc(w.type || r.wallType || '')}${w.note ? ' · ' + esc(w.note) : ''}</h3>`;
    h += `<div class="svgbox" style="max-width:900px">${elevSVG(r, i, {})}</div>`;
    if (w.items.length) {
      h += `<table class="rt"><tr><th>Item</th><th>Status</th><th>Size</th><th>Floor →</th><th>From ${nm(nb.left)}</th><th>From ${nm(nb.right)}</th><th>New position</th><th>Notes</th></tr>`;
      w.items.forEach(it => { const sd = sides(it, w), k = KINDS[it.kind], st = it.status || 'existing';
        const size = k.cls === 'point' ? '—' : k.cls === 'round' ? 'Ø ' + fmt(it.w, r) : fmt(it.w, r) + ' × ' + fmt(it.h, r) + (k.cls === 'obst' && it.depth ? ' × ' + fmt(it.depth, r) + ' deep' : '') + (k.cls === 'open' && it.kind !== 'ac' ? ' (incl. frame)' : '');
        const ref = k.cls === 'point' ? ' (centre)' : k.cls === 'open' && it.kind !== 'ac' ? ' (frame)' : ' (bottom)';
        let np = '—'; if (st === 'relocate' && it.to) { const t = targetSides(it, w); np = `${fmt(t.left, r)} from ${nm(nb.left)}, ${fmt(t.right, r)} from ${nm(nb.right)}, ${fmt(it.to.floor, r)} from floor`; }
        h += `<tr><td>${esc(itemTitle(it))}${it.label ? ' — ' + esc(it.label) : ''}</td><td>${STATUS[st].replace('…', '')}</td><td>${size}</td><td>${fmt(it.floor, r)}${ref}</td><td>${fmt(sd.left, r)}</td><td>${fmt(sd.right, r)}</td><td>${np}</td><td>${esc(it.note || '')}</td></tr>`; });
      h += `</table>`;
    } else h += `<p class="note">No openings or fixtures.</p>`;
    h += `</div>`;
  });
  return h + `<p class="note" style="margin-top:12px">All measurements in ${r.units}. Doors and windows measured including frame, to the frame edges. Outlets, switches, water, drain and gas points measured to centre. Vents measured to the bottom edge of the opening.</p>`;
}
function renderTabs() {
  $$('nav.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $$('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + tab));
}
function renderAll() {
  if (screen === 'room' && !room()) screen = house() ? 'house' : 'houses';
  if (screen === 'house' && !house()) screen = 'houses';
  renderRoomSel();
  $('nav.tabs').style.display = screen === 'room' ? '' : 'none';
  if (screen !== 'room') {
    $$('.view').forEach(v => v.classList.toggle('on', v.id === (screen === 'houses' ? 'v-houses' : 'v-house')));
    if (screen === 'houses') renderHouses(); else renderHouse();
    return;
  }
  const r = room(); if (selWall >= r.walls.length) selWall = Math.max(0, r.walls.length - 1);
  renderTabs(); renderTools();
  if (tab === 'setup') renderSetup();
  if (tab === 'plan') { renderWallPanel(); }
  if (tab === 'report') renderReport();
  renderDrawings();
}

/* ---------- events ---------- */
$('nav.tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; tab = b.dataset.tab; shapePick = null; renderAll(); try { location.hash = tab; } catch (x) {} });
$('#crumbs').addEventListener('click', e => { const a = e.target.closest('[data-go]'); if (!a) return; if (a.dataset.go === 'houses') { screen = 'houses'; saveLocal(); renderAll(); } else goHouse(curHouse); });
$('#crumbs').addEventListener('change', e => {
  if (e.target.id !== 'roomSel') return;
  if (e.target.value === '__new') { goHouse(curHouse); setTimeout(() => $('#nrName').focus(), 50); return; }
  openRoom(e.target.value, tab);
});
function addRoom(h, name) { const r = newRoom(name.trim(), h); delete r.pristine; rooms.push(r); touch(r); openRoom(r.id, 'setup'); toast(`“${r.name}” added — choose its shape`); }
$('#newHouseForm').addEventListener('submit', e => {
  e.preventDefault();
  const addr = $('#nhAddr').value.trim(); if (!addr) { $('#nhAddr').focus(); return; }
  addRoom({id: uid('h'), address: addr}, $('#nhRoom').value || 'Room 1');
  $('#nhAddr').value = ''; $('#nhRoom').value = '';
});
$('#houseList').addEventListener('click', e => { const li = e.target.closest('[data-house]'); if (li) goHouse(li.dataset.house); });
$('#newRoomForm').addEventListener('submit', e => { e.preventDefault(); const h = house(); if (!h) return; addRoom(h, $('#nrName').value); $('#nrName').value = ''; });
$('#roomList').addEventListener('click', async e => {
  const d = e.target.closest('[data-delroom]');
  if (d) { const r = rooms.find(x => x.id === d.dataset.delroom); if (r && await removeRoom(r)) renderAll(); return; }
  const li = e.target.closest('[data-openroom]'); if (li) openRoom(li.dataset.openroom, 'plan');
});
let addrTimer;
$('#houseAddr').addEventListener('input', e => {
  const v = e.target.value, hid = curHouse;
  clearTimeout(addrTimer);
  addrTimer = setTimeout(() => { if (!v.trim()) return; houseRooms(hid).forEach(r => { r.houseAddress = v.trim(); r.site = r.houseAddress; touch(r); }); renderRoomSel(); }, 500);
});
$('#delHouse').addEventListener('click', async () => {
  const h = house(); if (!h) return;
  if (!(await ask(`Delete ${h.address} and all ${h.rooms.length} room(s) in it? This can't be undone.`, 'Delete house'))) return;
  h.rooms.forEach(r => { dirty.delete(r.id); if (store) store.del(r.id).catch(() => { tombstones.push(r.id); saveLocal(); }); else tombstones.push(r.id); });
  rooms = rooms.filter(r => r.houseId !== h.id); cur = null; screen = 'houses'; saveLocal(); renderAll(); toast('House deleted');
});
$('#dupRoom').addEventListener('click', () => {
  const r = JSON.parse(JSON.stringify(room())); r.id = uid('r'); r.name += ' (copy)'; r.walls.forEach(w => { w.id = uid('w'); w.items.forEach(i => i.id = uid('i')); });
  r.created = Date.now(); rooms.push(r); cur = r.id; touch(); renderAll(); toast('Room duplicated');
});
$('#delRoom').addEventListener('click', async () => {
  const r = room(); if (!r) return;
  if (await removeRoom(r)) { screen = house() ? 'house' : 'houses'; saveLocal(); renderAll(); }
});

// room fields
$('#v-setup').addEventListener('input', e => {
  const el = e.target, r = room();
  if (el.dataset.room) {
    const k = el.dataset.room;
    if (k === 'ceiling') { const v = parse(el.value); if (v != null && v > 0) r.ceiling = v; }
    else if (k !== 'units') r[k] = el.value;
    touch(); renderDrawings(); if (k === 'name' || k === 'site') renderRoomSel();
    return;
  }
  if (el.dataset.wi != null) {
    const w = r.walls[+el.dataset.wi], f = el.dataset.wf;
    if (f === 'length') { const v = parse(el.value); if (v != null && v > 0) setLength(r, +el.dataset.wi, v, true); }
    else if (f === 'turn') { const v = parseFloat(el.value); if (!isNaN(v)) { w.turn = v; r.shape = 'custom'; } }
    else if (f === 'type') w.type = el.value;
    else if (f === 'height') { const v = parse(el.value); w.height = v && v > 0 ? v : null; }
    touch(); renderDrawings();
  }
});
$('#v-setup').addEventListener('change', e => {
  const el = e.target, r = room();
  if (el.dataset.room === 'units') { r.units = el.value; touch(); renderAll(); return; }
  if (el.dataset.room === 'wallType') { renderSetup(); return; }
  if (el.dataset.wf === 'turnSel' && el.value !== 'c') { r.walls[+el.dataset.wi].turn = +el.value; r.shape = 'custom'; touch(); renderSetup(); renderDrawings(); return; }
  if (el.dataset.wf === 'length' && (r.shape === 'rect' || r.shape === 'square')) renderSetup();
  if (el.id === 'openRoom') { r.open = el.checked; touch(); renderSetup(); renderDrawings(); }
});
$('#v-setup').addEventListener('click', async e => {
  const r = room();
  const sh = e.target.closest('[data-shape]'); if (sh) { shapePick = sh.dataset.shape; renderSetup(); return; }
  if (e.target.id === 'applyShape') {
    const sp = shapePick || r.shape, gv = id => parse($('#' + id)?.value);
    const hasItems = r.walls.some(w => w.items.length);
    if (hasItems && !(await ask('Creating a new shape replaces all walls and removes the doors, windows and fixtures already marked. Continue?', 'Replace walls'))) return;
    const p = {s: gv('sp_s'), w: gv('sp_w'), d: gv('sp_d'), a: gv('sp_a'), b: gv('sp_b'), c: gv('sp_c'), first: gv('sp_f')};
    if (sp === 'lshape' && !(p.c < p.a && p.d < p.b)) { toast('Cut-out must be smaller than the overall size'); return; }
    for (const k of {square: ['s'], rect: ['w', 'd'], lshape: ['a', 'b', 'c', 'd'], three: ['w', 'd'], custom: ['first']}[sp]) if (!(p[k] > 0)) { toast('Enter all the sizes first'); return; }
    applyShape(r, sp, p); shapePick = null; selWall = 0; selItem = null; touch(); renderAll(); toast(`${SHAPES[sp].name} created — walls ${r.walls.map((_, i) => letter(i)).join(', ')}`);
    return;
  }
  if (e.target.id === 'addWall') {
    const last = r.walls[r.walls.length - 1];
    r.walls.push(mkWall(last ? last.length : 3000, r.walls.length ? 90 : 0, '')); r.shape = 'custom'; touch(); renderSetup(); renderDrawings(); return;
  }
  const dw = e.target.closest('[data-delwall]');
  if (dw) {
    const i = +dw.dataset.delwall, w = r.walls[i];
    if (r.walls.length <= 1) { toast('A room needs at least one wall'); return; }
    if (!(await ask(deleteMsg(r, i), 'Delete wall'))) return;
    deleteWall(r, i); selWall = 0; selItem = null; touch(); renderSetup(); renderDrawings(); toast('Wall deleted'); return;
  }
  if (e.target.id === 'fixClose' || e.target.id === 'addClose') {
    const g = geom(r);
    if (e.target.id === 'addClose') {
      const v = {x: g.start.x - g.end.x, y: g.start.y - g.end.y}, hd = Math.atan2(v.y, v.x) * 180 / Math.PI;
      let t = hd - g.segs[g.segs.length - 1].h; t = ((t + 540) % 360) - 180;
      r.walls.push(mkWall(Math.round(Math.hypot(v.x, v.y)), Math.round(t * 10) / 10, ''));
    } else {
      const n = r.walls.length, p = g.segs[n - 2];
      const v = {x: g.start.x - p.x2, y: g.start.y - p.y2}, hd = Math.atan2(v.y, v.x) * 180 / Math.PI;
      let t = hd - p.h; t = ((t + 540) % 360) - 180;
      r.walls[n - 1].length = Math.round(Math.hypot(v.x, v.y)); r.walls[n - 1].turn = Math.round(t * 10) / 10;
    }
    r.shape = 'custom'; touch(); renderSetup(); renderDrawings(); toast('Shape closed');
  }
});
const normAng = t => { t = ((t + 540) % 360) - 180; return Math.round(t * 10) / 10; };
/* Delete wall i. In a closed room the gap it leaves becomes the open side, so the other walls keep their positions. */
function deleteWall(r, i) {
  const n = r.walls.length; if (n <= 1) return;
  const g = geom(r);
  if (!r.open) {
    const order = [...Array(n).keys()].map(j => (i + 1 + j) % n);
    const hs = order.map(j => g.segs[j].h);
    const nw = order.map(j => r.walls[j]);
    nw.forEach((w, j) => w.turn = j === 0 ? 0 : normAng(hs[j] - hs[j - 1]));
    r.startHeading = hs[0]; r.ox = g.segs[order[0]].x1; r.oy = g.segs[order[0]].y1; nw.pop(); r.walls = nw; r.open = true;
  } else if (i === 0) { r.startHeading = g.segs[1].h; r.ox = g.segs[1].x1; r.oy = g.segs[1].y1; r.walls.splice(0, 1); r.walls[0].turn = 0; }
  else if (i === n - 1) r.walls.pop();
  else { const t = Number(r.walls[i].turn) || 0; r.walls.splice(i, 1); r.walls[i].turn = normAng((Number(r.walls[i].turn) || 0) + t); }
  r.shape = 'custom';
}
function deleteMsg(r, i) {
  const w = r.walls[i], n = r.walls.length, items = w.items.length ? ` Its ${w.items.length} item(s) will be removed too.` : '';
  if (!r.open) return `Delete wall ${letter(i)}?${items} That side of the room becomes open (dashed line) and the remaining walls are re-lettered ${letter(0)}–${letter(n - 2)}.`;
  if (i === 0 || i === n - 1) return `Delete wall ${letter(i)}?${items}`;
  return `Delete wall ${letter(i)}?${items} It's in the middle, so the walls either side will be joined and re-lettered.`;
}
function setLength(r, i, v, linked) {
  r.walls[i].length = v;
  if (linked && r.shape === 'rect' && r.walls.length === 4) r.walls[(i + 2) % 4].length = v;
  if (linked && r.shape === 'square' && r.walls.length === 4) r.walls.forEach(w => w.length = v);
}

// plan tools
$('#planTools').addEventListener('click', e => {
  if (e.target.closest('[data-shapeedit]')) { shapeEdit = !shapeEdit; selVtx = null; mode = 'select'; renderTools(); renderDrawings(); return; }
  const b = e.target.closest('[data-mode]'); if (!b) return; mode = b.dataset.mode === mode ? 'select' : b.dataset.mode; renderTools(); });
function afterShapeChange(msg) { touch(); if (selWall >= room().walls.length) selWall = 0; renderShapeBar(); renderWallPanel(); renderDrawings(); if (msg) toast(msg); }
$('#shapeBar').addEventListener('click', async e => {
  const b = e.target.closest('[data-sb]'); if (!b) return; const r = room();
  if (b.dataset.sb === 'delvtx') {
    const pts = planPoints(r), endCorner = r.open && (selVtx === 0 || selVtx === pts.length - 1);
    const w = endCorner ? r.walls[selVtx === 0 ? 0 : r.walls.length - 1] : null;
    if (!(await ask(endCorner ? `Delete this end corner? Wall ${letter(selVtx === 0 ? 0 : r.walls.length - 1)}${w.items.length ? ` and its ${w.items.length} item(s)` : ''} will be removed.` : 'Delete this corner? The two walls meeting here become one straight wall (their items are kept).', 'Delete corner'))) return;
    if (!removeCorner(r, selVtx)) { toast(r.open ? 'A room needs at least one wall' : 'A closed room needs at least 3 walls'); return; }
    selVtx = null; afterShapeChange('Corner deleted');
  } else if (b.dataset.sb === 'close') { closeRoom(r); selVtx = null; afterShapeChange('Ends joined — the room is closed'); }
  else if (b.dataset.sb === 'open') {
    if (!(await ask(deleteMsg(r, selWall), 'Delete wall'))) return;
    deleteWall(r, selWall); selWall = 0; selVtx = null; afterShapeChange('Wall removed — that side is open');
  }
});
// drag corners
$('#plan').addEventListener('pointerdown', e => {
  if (!shapeEdit) return;
  const svg = $('#planSvg'), r = room(), af = e.target.closest('[data-addfrom]'), ex = e.target.closest('[data-ext]');
  if (af || ex) {
    const frame = {vb: svg.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number), S: +svg.dataset.s}, ctm = svg.getScreenCTM().inverse();
    let k;
    if (af) { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const q = pt.matrixTransform(ctm); k = insertFrom(r, +af.dataset.addfrom, q); }
    else { extendRoom(r, ex.dataset.ext === 'start'); k = ex.dataset.ext === 'start' ? 0 : planPoints(r).length - 1; }
    selVtx = k; touch();
    vdrag = {k, pts: planPoints(r), frame, ctm, sx: e.clientX, sy: e.clientY, moved: false, snap: false, created: true};
    $('#plan').innerHTML = planSVG(r, {sel: selWall, interactive: true, id: 'planSvg', edit: true, selVtx: k, frame});
    e.preventDefault(); return;
  }
  const v = e.target.closest('[data-vtx]'); if (!v) return;
  vdrag = {k: +v.dataset.vtx, pts: planPoints(r), frame: {vb: svg.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number), S: +svg.dataset.s}, ctm: svg.getScreenCTM().inverse(), sx: e.clientX, sy: e.clientY, moved: false, snap: false};
  e.preventDefault();
});
window.addEventListener('pointermove', e => {
  if (!vdrag) return;
  if (!vdrag.moved && Math.hypot(e.clientX - vdrag.sx, e.clientY - vdrag.sy) < 5) return;
  vdrag.moved = true;
  const svg = $('#planSvg'), pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const q = pt.matrixTransform(vdrag.ctm), r = room(), P = vdrag.pts, k = vdrag.k, n = P.length, S = vdrag.frame.S, tol = S * 0.025;
  let x = Math.round(q.x / 10) * 10, y = Math.round(q.y / 10) * 10;
  const nbs = r.open ? [k - 1, k + 1].filter(j => j >= 0 && j < n) : [(k - 1 + n) % n, (k + 1) % n];
  nbs.forEach(j => { if (Math.abs(x - P[j].x) < tol) x = P[j].x; if (Math.abs(y - P[j].y) < tol) y = P[j].y; });
  vdrag.snap = false;
  if (r.open && n >= 4 && (k === n - 1 || k === 0)) { const o = P[k === 0 ? n - 1 : 0]; if (Math.hypot(x - o.x, y - o.y) < S * 0.05) { x = o.x; y = o.y; vdrag.snap = true; } }
  P[k] = {x, y};
  applyPoints(r, P);
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; $('#plan').innerHTML = planSVG(room(), {sel: selWall, interactive: true, id: 'planSvg', edit: true, selVtx: vdrag ? vdrag.k : selVtx, frame: vdrag ? vdrag.frame : null, snapStart: vdrag && vdrag.snap}); });
});
window.addEventListener('pointerup', () => {
  if (!vdrag) return;
  const d = vdrag; vdrag = null; const r = room();
  if (!d.moved) { selVtx = d.k; if (d.created) afterShapeChange('Wall added — drag its new corner into place'); else { renderShapeBar(); renderDrawings(); } return; }
  if (d.snap) { closeRoom(r); afterShapeChange('Ends joined — the room is closed'); return; }
  afterShapeChange();
});
function svgPoint(svg, e) { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); }
$('#plan').addEventListener('click', e => {
  const svg = $('#planSvg'); if (!svg) return;
  if (shapeEdit) {
    if (!e.target.closest('[data-vtx],[data-addfrom],[data-ext]')) { selVtx = null; renderShapeBar(); renderDrawings(); }
    return;
  }
  const r = room(), g = geom(r), p = svgPoint(svg, e);
  // item hit (select mode)
  const itG = e.target.closest('[data-item]');
  if (mode === 'select' && itG) { selWall = +itG.dataset.wall; selItem = itG.dataset.item; renderWallPanel(); renderDrawings(); scrollToCard(); return; }
  // nearest wall
  let best = null;
  g.segs.forEach((s, i) => {
    const L = r.walls[i].length || 1, t = clamp(((p.x - s.x1) * s.dx + (p.y - s.y1) * s.dy), 0, L);
    const qx = s.x1 + s.dx * t, qy = s.y1 + s.dy * t, d = Math.hypot(p.x - qx, p.y - qy);
    if (!best || d < best.d) best = {i, t, d};
  });
  if (!best) return;
  const xs = g.segs.flatMap(s => [s.x1, s.x2]), ys = g.segs.flatMap(s => [s.y1, s.y2]);
  const S = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1000);
  const onLabel = e.target.closest('[data-wall]');
  if (best.d > S * 0.12 && !onLabel) return;
  if (onLabel && mode === 'select') best.i = +onLabel.dataset.wall;
  if (mode === 'select') { selWall = best.i; selItem = null; renderWallPanel(); renderDrawings(); return; }
  const w = r.walls[best.i], L = w.length, x = g.cw ? best.t : L - best.t;
  const it = mkItem(mode, w, x, r); placeFree(w, it); w.items.push(it);
  selWall = best.i; selItem = it.id; mode = 'select';
  touch(); renderTools(); renderWallPanel(); renderDrawings(); scrollToCard();
  toast(`${KINDS[it.kind].name} added to wall ${letter(best.i)} — enter its measurements`);
});
function scrollToCard() { const c = selItem && document.querySelector(`[data-card="${selItem}"]`); if (c && window.innerWidth < 1000) c.scrollIntoView({behavior: 'smooth', block: 'center'}); }

// wall panel
$('#wallChips').addEventListener('click', e => { const b = e.target.closest('[data-chip]'); if (!b) return; selWall = +b.dataset.chip; selItem = null; renderWallPanel(); renderDrawings(); });
$('#addItemTools').addEventListener('click', e => {
  const b = e.target.closest('[data-add]'); if (!b) return;
  const r = room(), w = r.walls[selWall]; if (!w) return;
  const it = mkItem(b.dataset.add, w, w.length / 2, r); placeFree(w, it); w.items.push(it); selItem = it.id;
  touch(); renderItems(); renderDrawings();
  const inp = document.querySelector(`[data-card="${it.id}"] [data-if="w"]`); inp && inp.focus();
});
$('#wallCard').addEventListener('input', e => {
  const el = e.target, r = room(), w = r.walls[selWall]; if (!w) return;
  if (el.dataset.pf) {
    const f = el.dataset.pf;
    if (f === 'length') { const v = parse(el.value); if (v != null && v > 0) setLength(r, selWall, v, true); }
    else if (f === 'height') { const v = parse(el.value); w.height = v && v > 0 ? v : null; }
    else w[f] = el.value;
    touch(); renderDrawings(); return;
  }
  if (el.dataset.ii) {
    const it = w.items.find(x => x.id === el.dataset.ii); if (!it) return;
    const f = el.dataset.if;
    if (f === 'label' || f === 'note') it[f] = el.value;
    else if (f === 'kind' || f === 'status') return;
    else { const v = parse(el.value); if (v == null || v < 0) return;
      if (f === 'w' || f === 'h') { if (v <= 0) return; it[f] = v; if (KINDS[it.kind].cls === 'round') it.h = it.w; }
      else if (f === 'tdist') { ensureTo(it, w); it.to.dist = v; }
      else if (f === 'tfloor') { ensureTo(it, w); it.to.floor = v; }
      else it[f] = v; }
    selItem = it.id; touch(); renderDrawings();
  }
});
$('#wallCard').addEventListener('change', e => {
  const el = e.target, r = room(), w = r.walls[selWall]; if (!w) return;
  if (el.dataset.if === 'kind') { const it = w.items.find(x => x.id === el.dataset.ii); const was = isPoint(it); const left = itemLeft(it, w); it.kind = el.value;
    const k = KINDS[it.kind]; if (was !== isPoint(it) || k.cls === 'round' || k.cls === 'obst') { it.w = k.w; it.h = k.h; if (k.depth) it.depth = k.depth; setItemLeft(it, w, left); }
    touch(); renderItems(); renderDrawings(); }
  if (el.dataset.if === 'status') { const it = w.items.find(x => x.id === el.dataset.ii); it.status = el.value; if (el.value === 'relocate') ensureTo(it, w); selItem = it.id; touch(); renderItems(); renderDrawings(); }
  if (el.dataset.pf === 'length' && (r.shape === 'rect' || r.shape === 'square')) toast(r.shape === 'square' ? 'All 4 walls updated (square)' : `Opposite wall ${letter((selWall + 2) % 4)} updated too`);
});
$('#wallCard').addEventListener('click', async e => {
  const r = room(), w = r.walls[selWall]; if (!w) return;
  const rb = e.target.closest('[data-ref]');
  if (rb) { const it = w.items.find(x => x.id === rb.dataset.ii); const left = itemLeft(it, w); it.ref = rb.dataset.ref; setItemLeft(it, w, left); touch(); renderItems(); renderDrawings(); return; }
  if (e.target.closest('#delWallBtn')) {
    if (!(await ask(deleteMsg(r, selWall), 'Delete wall'))) return;
    deleteWall(r, selWall); selWall = 0; selItem = null; touch(); renderWallPanel(); renderDrawings(); toast('Wall deleted'); return;
  }
  const sw_ = e.target.closest('[data-swing],[data-hinge]');
  if (sw_) { const it = w.items.find(x => x.id === sw_.dataset.ii); if (!it) return; if (sw_.dataset.swing) it.swing = sw_.dataset.swing; else it.hinge = sw_.dataset.hinge; selItem = it.id; touch(); renderItems(); renderDrawings(); return; }
  const tb = e.target.closest('[data-tref]');
  if (tb) { const it = w.items.find(x => x.id === tb.dataset.ii); const left = targetLeft(it, w); it.to.ref = tb.dataset.tref; setTargetLeft(it, w, left); touch(); renderItems(); renderDrawings(); return; }
  const db_ = e.target.closest('[data-delitem]');
  if (db_) {
    const it = w.items.find(x => x.id === db_.dataset.delitem); if (!it) return;
    const name = KINDS[it.kind].name + (it.label ? ` “${it.label}”` : '');
    if (!(await ask(`Remove ${name} from wall ${letter(selWall)}? Its measurements will be deleted.`, 'Remove'))) return;
    w.items = w.items.filter(x => x.id !== db_.dataset.delitem); if (selItem === db_.dataset.delitem) selItem = null; touch(); renderItems(); renderDrawings(); return; }
  const card = e.target.closest('[data-card]');
  if (card && selItem !== card.dataset.card) { selItem = card.dataset.card; $$('.item').forEach(c => c.classList.toggle('sel', c.dataset.card === selItem)); renderDrawings(); }
});

// drag items in elevation
let drag = null, raf = 0;
$('#elev').addEventListener('pointerdown', e => {
  const g = e.target.closest('.it'); if (!g) return;
  const svg = $('#elevSvg'), r = room(), w = r.walls[selWall], it = w.items.find(x => x.id === g.dataset.item); if (!it) return;
  const p = svgPoint(svg, e);
  const ghost = g.dataset.to === '1' && it.to;
  drag = {it, w, ghost, sx: p.x, sy: p.y, left: ghost ? targetLeft(it, w) : itemLeft(it, w), floor: ghost ? it.to.floor : it.floor, moved: false, ctm: svg.getScreenCTM().inverse()};
  selItem = it.id; e.preventDefault();
});
window.addEventListener('pointermove', e => {
  if (!drag) return;
  const pt = $('#elevSvg').createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const p = pt.matrixTransform(drag.ctm);
  const dx = p.x - drag.sx, dy = -(p.y - drag.sy);
  if (!drag.moved && Math.hypot(dx, dy) < 15) return;
  drag.moved = true;
  const r = room(), snap = r.units === 'mm' ? 5 : 10, H = wallH(r, drag.w);
  const maxF = isPoint(drag.it) ? H : Math.max(0, H - drag.it.h), nf = clamp(Math.round((drag.floor + dy) / snap) * snap, 0, maxF);
  if (drag.ghost) { setTargetLeft(drag.it, drag.w, Math.round((drag.left + dx) / snap) * snap); drag.it.to.floor = nf; }
  else { setItemLeft(drag.it, drag.w, Math.round((drag.left + dx) / snap) * snap); drag.it.floor = nf; }
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderDrawings(); syncCard(drag?.it); });
});
window.addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.moved) { touch(); syncCard(d.it); }
  $$('.item').forEach(c => c.classList.toggle('sel', c.dataset.card === selItem));
  renderDrawings();
  if (!d.moved) scrollToCard();
});
function syncCard(it) {
  if (!it) return;
  const c = document.querySelector(`[data-card="${it.id}"]`); if (!c) return;
  c.querySelector('[data-if=floor]').value = fmt(it.floor);
  c.querySelector('[data-if=dist]').value = fmt(it.dist);
  if (it.to) { const a = c.querySelector('[data-if=tfloor]'), b = c.querySelector('[data-if=tdist]'); if (a) a.value = fmt(it.to.floor); if (b) b.value = fmt(it.to.dist); }
}

/* ---------- exports: PDF and CSV ---------- */
function safeName(s) { return (s || 'room').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'room'; }
async function saveFile(filename, data, mime) {
  if (dl) {
    try { await dl.save({filename, data}); toast('Saved ' + filename); }
    catch (e) { if (e?.code !== 'declined') toast('Could not save the file'); }
    return;
  }
  try {
    const blob = data instanceof Blob ? data : new Blob([data], {type: mime});
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000); toast('Downloaded ' + filename);
  } catch (e) { toast('Could not download the file'); }
}
function csvRows(r) {
  const rows = [['House', 'Room', 'Wall', 'Wall length', 'Wall height', 'Wall type', 'Item', 'Label', 'Status', 'Width / diameter', 'Height', 'Depth', 'Floor to bottom/centre', 'From left wall', 'From right wall', 'New: from left wall', 'New: from right wall', 'New: from floor', 'Notes']];
  r.walls.forEach((w, i) => {
    if (!w.items.length) rows.push([r.houseAddress || '', r.name, letter(i), fmt(w.length, r), fmt(wallH(r, w), r), w.type || r.wallType, '', '', '', '', '', '', '', '', '', '', '', '', w.note]);
    w.items.forEach(it => { const sd = sides(it, w), st = it.status || 'existing', t = st === 'relocate' && it.to ? targetSides(it, w) : null;
      rows.push([r.houseAddress || '', r.name, letter(i), fmt(w.length, r), fmt(wallH(r, w), r), w.type || r.wallType, itemTitle(it), it.label, STATUS[st].replace('…', ''), isPoint(it) ? '' : fmt(it.w, r), isPoint(it) || KINDS[it.kind].cls === 'round' ? '' : fmt(it.h, r), it.depth ? fmt(it.depth, r) : '', fmt(it.floor, r), fmt(sd.left, r), fmt(sd.right, r), t ? fmt(t.left, r) : '', t ? fmt(t.right, r) : '', t ? fmt(it.to.floor, r) : '', it.note]); });
  });
  return rows;
}
$('#dlCsv').addEventListener('click', () => {
  const r = room(), q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  saveFile(safeName((r.houseAddress ? r.houseAddress + ' ' : '') + r.name) + '-measurements.csv', '﻿' + csvRows(r).map(rw => rw.map(q).join(',')).join('\r\n'), 'text/csv');
});

let jsPDFp = null;
function loadJsPDF() {
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  return jsPDFp = jsPDFp || new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = 'vendor/jspdf.umd.min.js';
    sc.onload = () => window.jspdf ? res(window.jspdf.jsPDF) : rej(new Error('jsPDF missing'));
    sc.onerror = () => { jsPDFp = null; rej(new Error('Could not load the PDF tool')); };
    document.head.appendChild(sc);
  });
}
async function svgToJpeg(svgStr, pxW) {
  const svg = new DOMParser().parseFromString(svgStr, 'image/svg+xml').documentElement;
  const vb = svg.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number), ratio = vb[3] / vb[2];
  const W = pxW, H = Math.round(pxW * ratio);
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
  const img = new Image();
  await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H);
  return {data: c.toDataURL('image/jpeg', 0.9), ratio};
}
async function buildPDF(r) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({unit: 'mm', format: 'a4', orientation: 'portrait'});
  const PW = 210, PH = 297, M = 12, CW = PW - 2 * M, u = r.units;
  let y = M;
  const g = geom(r), rs = roomSize(r);
  const need = h => { if (y + h > PH - M - 6) { doc.addPage(); y = M; } };
  const text = (t, x, size = 10, style = 'normal', color = [28, 36, 48]) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); doc.text(String(t), x, y); };
  const table = (cols, rows) => {
    const lh = 3.6, pad = 1.4;
    const header = () => {
      need(8); doc.setFillColor(240, 242, 245); doc.rect(M, y, CW, 6.5, 'F'); let x = M;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.6); doc.setTextColor(60, 66, 76);
      cols.forEach(c => { doc.text(doc.splitTextToSize(c.h, c.w - 2 * pad)[0], x + pad, y + 4.3); x += c.w; }); y += 6.5;
    };
    header();
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6);
    rows.forEach(row => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6);
      const cells = row.map((v, i) => doc.splitTextToSize(String(v ?? ''), cols[i].w - 2 * pad));
      const h = Math.max(...cells.map(c => c.length)) * lh + 2 * pad;
      if (y + h > PH - M - 6) { doc.addPage(); y = M; header(); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6); }
      let x = M; doc.setTextColor(28, 36, 48);
      cells.forEach((c, i) => { doc.text(c, x + pad, y + pad + 2.6); x += cols[i].w; });
      doc.setDrawColor(226, 229, 234); doc.line(M, y + h, M + CW, y + h); y += h;
    });
    y += 3;
  };
  // header
  y += 4; text(r.name || 'Room', M, 18, 'bold'); y += 6;
  if (r.houseAddress) { text(r.houseAddress, M, 10, 'normal', [107, 115, 128]); y += 5; }
  text(`Measured ${new Date(r.updated || Date.now()).toLocaleDateString()}  ·  all measurements in ${u}`, M, 8.5, 'normal', [107, 115, 128]); y += 6;
  const facts = [['Room size (W × L)', `${fmt(rs.x, r)} × ${fmt(rs.y, r)} ${u}`], ['Ceiling height', fmtU(r.ceiling, r)], ['Floor type', r.floorType || '—'], ['Wall type', r.wallType || '—'],
    ['Floor area', r.open ? '— (open)' : (g.area / 1e6).toFixed(2) + ' m2'], ['Walls', String(r.walls.length) + (r.open ? ' (open side)' : '')]];
  const fw = CW / 3;
  facts.forEach((f, i) => { const x = M + (i % 3) * fw, yy = y + Math.floor(i / 3) * 10;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(107, 115, 128); doc.text(f[0], x, yy);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(28, 36, 48); doc.text(f[1], x, yy + 4.6); });
  y += 22;
  // plan
  const plan = await svgToJpeg(planSVG(r, {}), 1600);
  let pw = CW, ph = pw * plan.ratio; if (ph > 150) { ph = 150; pw = ph / plan.ratio; }
  need(ph + 8); text('Floor plan', M, 11, 'bold'); y += 3;
  doc.addImage(plan.data, 'JPEG', M + (CW - pw) / 2, y, pw, ph); doc.setDrawColor(226, 229, 234); doc.rect(M, y, CW, ph); y += ph + 6;
  // wall summary
  need(16); text('Walls', M, 11, 'bold'); y += 3;
  table([{h: 'Wall', w: 18}, {h: `Length (${u})`, w: 30}, {h: `Height (${u})`, w: 30}, {h: 'Wall type', w: 34}, {h: 'Items', w: 74}],
    r.walls.map((w, i) => { const cnt = {}; w.items.forEach(it => cnt[KINDS[it.kind].name] = (cnt[KINDS[it.kind].name] || 0) + 1);
      return [letter(i), fmt(w.length, r), fmt(wallH(r, w), r), w.type || r.wallType, Object.entries(cnt).map(([k, n]) => `${n} × ${k}`).join(', ') || '—']; }));
  // each wall
  for (let i = 0; i < r.walls.length; i++) {
    const w = r.walls[i], nb = neighbours(r, i, g), nm = j => j == null ? 'open end' : 'wall ' + letter(j);
    const el = await svgToJpeg(elevSVG(r, i, {}), 1600);
    let ew = CW, eh = ew * el.ratio; if (eh > 100) { eh = 100; ew = eh / el.ratio; }
    need(eh + 14 + (w.items.length ? 14 : 0));
    text(`Wall ${letter(i)}`, M, 13, 'bold');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(107, 115, 128);
    doc.text(`${fmtU(w.length, r)} long × ${fmtU(wallH(r, w), r)} high  ·  ${w.type || r.wallType}${w.note ? '  ·  ' + w.note : ''}`, M + 22, y);
    y += 3;
    doc.addImage(el.data, 'JPEG', M + (CW - ew) / 2, y, ew, eh); doc.setDrawColor(226, 229, 234); doc.rect(M, y, CW, eh); y += eh + 4;
    if (w.items.length) {
      table([{h: 'Item', w: 34}, {h: 'Status', w: 18}, {h: 'Size', w: 30}, {h: 'From floor', w: 20}, {h: 'From ' + nm(nb.left), w: 22}, {h: 'From ' + nm(nb.right), w: 22}, {h: 'New position / notes', w: 40}],
        w.items.map(it => { const sd = sides(it, w), k = KINDS[it.kind], st = it.status || 'existing';
          const size = k.cls === 'point' ? '—' : k.cls === 'round' ? 'Ø ' + fmt(it.w, r) : fmt(it.w, r) + ' × ' + fmt(it.h, r) + (k.cls === 'obst' && it.depth ? ' × ' + fmt(it.depth, r) + ' deep' : '') + (k.cls === 'open' && it.kind !== 'ac' ? ' incl. frame' : '');
          const ref = k.cls === 'point' ? ' (centre)' : k.cls === 'open' && it.kind !== 'ac' ? ' (frame)' : ' (bottom)';
          let extra = [];
          if (st === 'relocate' && it.to) { const t = targetSides(it, w); extra.push(`Move to: ${fmt(t.left, r)} from ${nm(nb.left)}, ${fmt(t.right, r)} from ${nm(nb.right)}, ${fmt(it.to.floor, r)} from floor`); }
          if (it.note) extra.push(it.note);
          return [itemTitle(it) + (it.label ? ' — ' + it.label : ''), STATUS[st].replace(' to…', '').replace('…', ''), size, fmt(it.floor, r) + ref, fmt(sd.left, r), fmt(sd.right, r), extra.join('\n') || '—']; }));
    } else { text('No openings, fixtures or obstacles on this wall.', M, 8.5, 'normal', [107, 115, 128]); y += 6; }
  }
  // notes + page numbers
  need(12);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(107, 115, 128);
  doc.text(doc.splitTextToSize('Doors and windows are measured including frame, to the frame edges. Outlets, switches, water, drain and gas points are measured to their centre. Vents are measured to the bottom edge of the opening. Left / right is as seen standing inside the room facing the wall.', CW), M, y + 3);
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) { doc.setPage(p); doc.setFontSize(7.5); doc.setTextColor(150, 156, 165); doc.text(`${r.name || 'Room'} — page ${p} of ${n}`, PW - M, PH - 6, {align: 'right'}); }
  return doc.output('blob');
}
$('#dlPdf').addEventListener('click', async e => {
  const btn = e.currentTarget, r = room(); btn.disabled = true; const old = btn.textContent; btn.textContent = 'Making PDF…';
  try { const blob = await buildPDF(r); await saveFile(safeName((r.houseAddress ? r.houseAddress + ' ' : '') + r.name) + '-measurements.pdf', blob, 'application/pdf'); }
  catch (err) { toast('Could not make the PDF'); console.error(err); }
  finally { btn.disabled = false; btn.textContent = old; }
});

/* ---------- boot ---------- */
loadLocal();
rooms = rooms.filter(r => !r.pristine);
try { const n = JSON.parse(localStorage.getItem(LS_NAV) || 'null'); if (n) { screen = n.screen || 'houses'; curHouse = n.house || null; if (['setup', 'plan', 'report'].includes(n.tab)) tab = n.tab; } } catch (e) {}
if (room()) curHouse = curHouse || room().houseId; else if (screen === 'room') screen = 'houses';
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (screen === 'room' && ['setup', 'plan', 'report'].includes(h) && h !== tab) { tab = h; renderAll(); } });
renderAll();
initCloud();
