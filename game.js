"use strict";
// Local adaptation of Arterial by Anthony Ellis. Original: arterial-original.html.
const EDIT = {grid: false, drawMode: 'straight'};
const SIDEBAR_TEXT_SIZE_KEY = 'arterial-sidebar-text-size';
let sidebarTextLarge = false;
try { sidebarTextLarge = localStorage.getItem(SIDEBAR_TEXT_SIZE_KEY) === 'large'; } catch (_) {}
let theme = 'light';
try { theme = localStorage.getItem('arterial-theme') === 'dark' ? 'dark' : 'light'; } catch (_) {}
document.documentElement.dataset.theme = theme;
/* ═══════════════════════════════════════════════════════════════════════════
   ARTERIAL — City Traffic Simulator  (V5)
   ───────────────────────────────────────────────────────────────────────────
   A dependency-free city builder whose gameplay *is* traffic engineering.
   Zone land, lay a road network, and watch a microscopic traffic model decide
   whether your city breathes or chokes. Nothing here is a sprite or a tile:
   every vehicle is integrated against a parametric rail, every junction is
   arbitrated, every trip is routed.

   Architecture
   ────────────
   §1  Math & road spec   Vec2, seeded RNG, quadratic Bézier `Path` with an
                          arc-length LUT; the road-type registry that drives
                          lane counts, widths, medians and speed limits.
   §2  Road graph         Node/Edge authoring layer → Lane/Connector simulation
                          layer. An N-lane road emits N directed lanes per
                          direction; every junction synthesises turn-lane
                          connectors (right turns from the kerb lane, lefts
                          from the median lane, through movements lane-to-lane)
                          plus a precomputed conflict matrix.
   §3  Roundabouts        Not a special case in the simulator: converting a
                          junction rewrites the graph into a one-way ring of
                          nodes, so lanes, routing, IDM and arbitration all
                          work unchanged.
   §4  Routing            Travel-time search in lane space. Lane changes are
                          weighted transitions, so a route can say "be in the
                          left lane by the time you reach that junction".
   §5  Vehicles           Intelligent Driver Model longitudinally, MOBIL
                          laterally, with mandatory merges toward the lane the
                          route requires and explicit continuous manoeuvres
                          whose source and target both account for occupancy.
   §6  Junctions          Signal / stop / yield / priority-road control,
                          reservation-based right-of-way against the conflict
                          matrix, priority for ring traffic, and clear exits.
   §7  City               Zone painting, buildings that develop on their own
                          where there is road access, level up when their trips
                          are served quickly and abandon when they are not.
                          RCI demand, population, jobs, happiness. No failure.
   §8  Camera / render    Matrix pan-zoom, day-night cycle, road markings,
                          debug overlay.
   §9  Loop               Fixed 60 Hz integration decoupled from rAF with
                          render-side interpolation.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────────  §1  CONFIG  ───────────────────────────── */

const CFG = {
  WORLD_UNITS_PER_METRE: 3, // display scale: 11-unit lane ≈ 3.7 m; saves retain world units
  WORLD_W: 4800, WORLD_H: 3200,

  LANE_W: 11,               // width of a single traffic lane
  CAR_L: 15, CAR_W: 8,
  TRUCK_L: 24, TRUCK_W: 9.5,

  // Intelligent Driver Model  (px, px/s, px/s²)
  IDM_A: 95, IDM_B: 135, IDM_T: 0.9, IDM_S0: 6, IDM_DELTA: 4,
  A_LAT: 1100,              // lateral accel budget → curve speed cap √(a·R)
  LOOKAHEAD: 280,

  // MOBIL lane changing
  MOBIL_P: 0.22,            // politeness
  MOBIL_TH: 12,             // switching threshold (px/s²)
  MOBIL_BSAFE: 190,         // max deceleration we may impose on a new follower
  KEEP_RIGHT: 6,            // bias toward the kerb lane (px/s²)
  CHANGE_CD: 1.4,           // seconds between lane changes
  CHANGE_TIME: 0.85,        // seconds of lateral travel

  // junctions
  CONFLICT_R: 10.5,        // truck width + 1px clearance; less than lane spacing
  STOPLINE: 2,
  GREEN_TIME: 8.5, AMBER_TIME: 1.2,
  BOX_CLEAR: 10,
  YIELD_LOOK: 78,           // how far up a priority lane a yielding car looks
  STOP_V: 7,                // must be slower than this to clear a stop sign

  // city
  CELL: 34,                 // zoning grid resolution
  BUILD_EVERY: 0.85,        // seconds between development attempts
  ROAD_NEAR: 34, ROAD_FAR: 96,   // a cell needs a road within this band
  MAX_CARS: 240,
  TRIP_R: 58,               // seconds between trips from a level-1 home
  TRIP_I: 105,               // seconds between freight runs from a level-1 plant
  VISIT_TIME: 3.0,
  DAY_LENGTH: 240,          // seconds per in-game day
  LEVEL_UP: 0.72, LEVEL_DOWN: 0.3,  // service score thresholds
  ABANDON_TIME: 45,         // seconds of starvation before a building dies
};

const LW = CFG.LANE_W;
let trafficDiagnostics = TrafficDiagnostics.createRecorder();
let diagnosticStartedAt = 0;

/* Road types. `lanes` is per direction. Everything downstream — geometry,
   capacity, connector rules, rendering, cost — reads from this table. */
const ROADS = {
  STREET:  { key:'STREET',  name:'Street',    lanes:1, oneway:false, median:0,   speed:  92, cost:1.0,  surf:'#2b3446', mark:'dash' },
  AVENUE:  { key:'AVENUE',  name:'Avenue',    lanes:2, oneway:false, median:5,   speed: 128, cost:2.4,  surf:'#303b50', mark:'median' },
  HIGHWAY: { key:'HIGHWAY', name:'Highway',   lanes:3, oneway:false, median:9,   speed: 186, cost:4.4,  surf:'#354158', mark:'median' },
  ONEWAY:  { key:'ONEWAY',  name:'One-way',   lanes:2, oneway:true,  median:0,   speed: 112, cost:1.7,  surf:'#2e394f', mark:'arrow' },
  ONEWAY_SINGLE: { key:'ONEWAY_SINGLE', name:'One-way single', lanes:1, oneway:true, median:0, speed:112, cost:1.7, surf:'#2e394f', mark:'arrow' },
  RING:    { key:'RING',    name:'Roundabout',lanes:1, oneway:true,  median:0,   speed:  62, cost:0.0,  surf:'#303b50', mark:'arrow' },
};
const ROAD_ORDER = ['STREET', 'AVENUE', 'ONEWAY', 'ONEWAY_SINGLE', 'HIGHWAY'];

function roadHalfWidth(spec) {
  return spec.oneway ? (spec.lanes * LW) / 2 + 3 : spec.median + spec.lanes * LW + 3;
}
/** Lateral offset of lane `idx` (0 = kerb/right lane, n-1 = median lane). */
function laneOffset(spec, idx) {
  const base = spec.oneway ? -(spec.lanes * LW) / 2 : spec.median;
  return base + (spec.lanes - 1 - idx + 0.5) * LW;
}

/* ─────────────────────────────  math  ───────────────────────────── */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const fmtT = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const V = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
  mul: (a, k) => ({ x: a.x * k, y: a.y * k }),
  mix: (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }),
  len: a => Math.hypot(a.x, a.y),
  dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
  dist2: (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2,
  norm: a => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; },
  rn: a => ({ x: -a.y, y: a.x }),          // right-hand normal (screen y-down)
  dot: (a, b) => a.x * b.x + a.y * b.y,
  cross: (a, b) => a.x * b.y - a.y * b.x,
};

function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** mulberry32 — reproducible maps make bugs reproducible. */
function makeRNG(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lineX(p, d, q, e) {
  const den = V.cross(d, e);
  if (Math.abs(den) < 1e-6) return null;
  const t = V.cross(V.sub(q, p), e) / den;
  return { x: p.x + d.x * t, y: p.y + d.y * t };
}

function segClosest(p, a, b) {
  const ab = V.sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y;
  const t = l2 < 1e-9 ? 0 : clamp(V.dot(V.sub(p, a), ab) / l2, 0, 1);
  const c = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return { d: V.dist(p, c), t, c };
}

function segX(a, b, c, d) {
  const s1 = V.cross(V.sub(b, a), V.sub(c, a));
  const s2 = V.cross(V.sub(b, a), V.sub(d, a));
  const s3 = V.cross(V.sub(d, c), V.sub(a, c));
  const s4 = V.cross(V.sub(d, c), V.sub(b, c));
  return (s1 > 0) !== (s2 > 0) && (s3 > 0) !== (s4 > 0);
}

/* ───────────────────  Path — quadratic Bézier rail  ───────────────────
   Every drivable surface is one of these: a straight is just a Bézier whose
   control point sits on the chord, so lanes, bends, turn arcs and roundabout
   rings all share a single set of kinematics.

   The arc-length LUT is what makes the motion honest — advancing `s` by v·dt
   covers the same ground on a straight as in the tightest part of a curve. */

class Path {
  constructor(p0, p1, p2) { this.p0 = p0; this.p1 = p1; this.p2 = p2; this._lut(); }
  static line(a, b) { return new Path(a, V.mix(a, b, 0.5), b); }

  point(t) {
    const u = 1 - t, a = u * u, b = 2 * u * t, c = t * t;
    return { x: a * this.p0.x + b * this.p1.x + c * this.p2.x,
             y: a * this.p0.y + b * this.p1.y + c * this.p2.y };
  }
  deriv(t) {
    const u = 1 - t;
    return { x: 2 * (u * (this.p1.x - this.p0.x) + t * (this.p2.x - this.p1.x)),
             y: 2 * (u * (this.p1.y - this.p0.y) + t * (this.p2.y - this.p1.y)) };
  }
  tangent(t) {
    let d = this.deriv(t);
    if (Math.abs(d.x) < 1e-7 && Math.abs(d.y) < 1e-7) d = V.sub(this.p2, this.p0);
    return V.norm(d);
  }
  _lut() {
    const N = Path.LUT_N;
    this.lut = new Float64Array(N + 1);
    let prev = this.point(0), acc = 0;
    for (let i = 1; i <= N; i++) {
      const p = this.point(i / N);
      acc += Math.hypot(p.x - prev.x, p.y - prev.y);
      this.lut[i] = acc; prev = p;
    }
    this.length = Math.max(acc, 1e-4);
  }
  tAt(s) {
    const L = this.lut, N = Path.LUT_N;
    if (s <= 0) return 0;
    if (s >= this.length) return 1;
    let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= s) lo = m; else hi = m; }
    const seg = L[hi] - L[lo];
    return (lo + (seg < 1e-9 ? 0 : (s - L[lo]) / seg)) / N;
  }
  pos(s) { return this.point(this.tAt(s)); }
  dir(s) { return this.tangent(this.tAt(s)); }

  sub(t0, t1) {
    const left = (p0, p1, p2, t) => {
      const a = V.mix(p0, p1, t), b = V.mix(p1, p2, t);
      return [p0, a, V.mix(a, b, t)];
    };
    const right = (p0, p1, p2, t) => {
      const a = V.mix(p0, p1, t), b = V.mix(p1, p2, t);
      return [V.mix(a, b, t), b, p2];
    };
    let [a0, a1, a2] = left(this.p0, this.p1, this.p2, t1);
    const tt = t1 < 1e-9 ? 0 : t0 / t1;
    [a0, a1, a2] = right(a0, a1, a2, tt);
    return new Path(a0, a1, a2);
  }
  trim(sStart, sEnd) {
    const usable = this.length - sStart - sEnd;
    if (usable < 6) {                       // degenerate: keep a sliver
      const c = this.length / 2, h = Math.max(3, this.length * 0.15);
      return this.sub(this.tAt(c - h), this.tAt(c + h));
    }
    return this.sub(this.tAt(sStart), this.tAt(this.length - sEnd));
  }
  /** Parallel offset: shift endpoints along their normals and re-derive the
      control point from the intersection of the offset tangents. */
  offset(d) {
    if (Math.abs(d) < 1e-6) return new Path(this.p0, this.p1, this.p2);
    const t0 = this.tangent(0), t1 = this.tangent(1);
    const n0 = V.rn(t0), n1 = V.rn(t1);
    const q0 = V.add(this.p0, V.mul(n0, d));
    const q2 = V.add(this.p2, V.mul(n1, d));
    let q1 = lineX(q0, t0, q2, t1);
    if (!q1 || !isFinite(q1.x) || V.dist(q1, this.p1) > 600) {
      q1 = V.add(this.p1, V.mul(V.norm(V.add(n0, n1)), d));
    }
    return new Path(q0, q1, q2);
  }
  radius(t = 0.5) {
    const d = this.deriv(t);
    const dd = { x: 2 * (this.p2.x - 2 * this.p1.x + this.p0.x),
                 y: 2 * (this.p2.y - 2 * this.p1.y + this.p0.y) };
    const den = Math.abs(V.cross(d, dd));
    return den < 1e-6 ? Infinity : Math.pow(d.x * d.x + d.y * d.y, 1.5) / den;
  }
  /** Nearest arc position to a world point (coarse sample + refine). */
  nearest(p) {
    let bs = 0, bd = Infinity;
    const N = 16;
    for (let i = 0; i <= N; i++) {
      const s = this.length * i / N;
      const d = V.dist2(this.pos(s), p);
      if (d < bd) { bd = d; bs = s; }
    }
    let step = this.length / N / 2;
    for (let k = 0; k < 11; k++) {
      for (const c of [bs - step, bs + step]) {
        const s = clamp(c, 0, this.length);
        const d = V.dist2(this.pos(s), p);
        if (d < bd) { bd = d; bs = s; }
      }
      step /= 2;
    }
    // Solve the nearest point on the quadratic after the coarse search.
    // A fixed arc-step search alone loses precision as roads get longer.
    let t=this.tAt(bs);
    const dd={x:2*(this.p2.x-2*this.p1.x+this.p0.x),y:2*(this.p2.y-2*this.p1.y+this.p0.y)};
    for(let k=0;k<6;k++) {
      const delta=V.sub(this.point(t),p),d=this.deriv(t),den=V.dot(d,d)+V.dot(delta,dd);
      if(Math.abs(den)<1e-10) break;
      const next=clamp(t-V.dot(delta,d)/den,0,1);
      if(Math.abs(t-next)<1e-12) {t=next;break;}
      t=next;
    }
    const distance=V.dist2(this.point(t),p);
    if(distance<=bd) {
      const index=Math.min(Path.LUT_N-1,Math.floor(t*Path.LUT_N)),fraction=t*Path.LUT_N-index;
      bs=lerp(this.lut[index],this.lut[index+1],fraction);bd=distance;
    }
    return { s: bs, d: Math.sqrt(bd) };
  }
  stroke(ctx) {
    ctx.moveTo(this.p0.x, this.p0.y);
    ctx.quadraticCurveTo(this.p1.x, this.p1.y, this.p2.x, this.p2.y);
  }
}
Path.LUT_N = 22;

/* ─────────────────────────  §2  ROAD GRAPH  ─────────────────────────
   Authoring layer: Nodes and Edges — what the player draws.
   Simulation layer: Lanes and Connectors — a directed rail network.
   An N-lane road emits N directed Lanes per direction; every Node synthesises
   the legal turn movements between them as Connectors. Both are `Track`s, so a
   car crossing a junction runs exactly the same integration code as one on a
   straight.                                                                  */

let _id = 0, _ringSeq = 0;
const uid = () => ++_id;

class Track {
  constructor(path) {
    this.id = uid();
    this.path = path;
    this.length = path.length;
    this.vehicles = [];      // rebuilt and sorted by `s` every tick
    this.load = 0;           // smoothed occupancy → routing cost + heat map
  }
  pos(s) { return this.path.pos(clamp(s, 0, this.length)); }
  dir(s) { return this.path.dir(clamp(s, 0, this.length)); }
  leaderAfter(s, skip) {
    const a = this.vehicles;
    for (let i = 0; i < a.length; i++) if (a[i] !== skip && a[i].owner !== skip && a[i].s > s) return a[i];
    return null;
  }
  followerBefore(s, skip) {
    const a = this.vehicles;
    for (let i = a.length - 1; i >= 0; i--) if (a[i] !== skip && a[i].owner !== skip && a[i].s <= s) return a[i];
    return null;
  }
  firstVehicle() { return this.vehicles.length ? this.vehicles[0] : null; }
}

class Lane extends Track {
  constructor(edge, forward, idx, path) {
    super(path);
    this.kind = 'LANE';
    this.edge = edge;
    this.forward = forward;
    this.idx = idx;
    this.from = forward ? edge.n1 : edge.n2;
    this.to = forward ? edge.n2 : edge.n1;
    this.offset = laneOffset(edge.spec, idx);
    const r = path.radius(0.5);
    this.speedLimit = Math.min(edge.spec.speed, isFinite(r) ? Math.sqrt(CFG.A_LAT * r) : Infinity);
    this.buildings = [];     // developed lots that use this lane as their kerb
  }
  get siblings() { return this.forward ? this.edge.fwd : this.edge.bwd; }
}

class Connector extends Track {
  constructor(node, fromLane, toLane, path, turn) {
    super(path);
    this.kind = 'CONN';
    this.node = node;
    this.fromLane = fromLane;
    this.toLane = toLane;
    this.from = node; this.to = node;
    this.turn = turn;
    this.conflicts = [];
    this.conflictZones = new Map();
    // ring traffic outranks everything; otherwise the wider road has priority
    this.priority = fromLane.edge.type === 'RING' ? 3 : fromLane.edge.spec.lanes;
    const r = path.radius(0.5);
    this.speedLimit = Math.max(26, Math.min(fromLane.edge.spec.speed * 0.75,
      isFinite(r) ? Math.sqrt(CFG.A_LAT * r) : Infinity));
  }
}

function removeTrackOccupant(track, vehicle) {
  if (!track || !track.vehicles) return;
  let index;
  while ((index = track.vehicles.indexOf(vehicle)) >= 0) track.vehicles.splice(index, 1);
}

function insertTrackOccupant(track, vehicle) {
  if (!track || !track.vehicles || !vehicle || vehicle.dead ||
      vehicle.phase === 'VISIT' || vehicle.phase === 'ENTER') return;
  if (!track.vehicles.includes(vehicle)) track.vehicles.push(vehicle);
  track.vehicles.sort((a, b) => a.s - b.s);
}

function transferTrackOccupant(vehicle, from, to) {
  if (from !== to) removeTrackOccupant(from, vehicle);
  insertTrackOccupant(to, vehicle);
}

class GNode {
  constructor(x, y) {
    this.id = uid();
    this.x = x; this.y = y;
    this.edges = [];
    this.preSorting = {};
    this.lanesIn = []; this.lanesOut = [];
    this.connectors = [];
    this.connMap = new Map();
    this.occ = new Map();            // connectorId → cars claiming it
    this.signal = null;
    this.control = 'YIELD';          // SIGNAL | STOP | YIELD | PRIORITY
    this.priorityEdges = new Set();
    this.laneRules = [];
    this.r = 14;
    this.isRing = false;
    this.ringId = 0;
    this.born = 0;
  }
  get pos() { return { x: this.x, y: this.y }; }
  get degree() { return this.edges.length; }
}

class Edge {
  constructor(n1, n2, type, bend) {
    this.id = uid();
    this.n1 = n1; this.n2 = n2;
    this.type = type || 'STREET';
    this.bend = bend || 0;
    this.isBridge = false;
    this.fwd = []; this.bwd = [];
    this.born = 0;
  }
  get spec() { return ROADS[this.type]; }
  get halfWidth() { return roadHalfWidth(this.spec); }
  get width() { return this.halfWidth * 2; }
  get lanes() { return this.bwd.length ? this.fwd.concat(this.bwd) : this.fwd; }
  other(n) { return n === this.n1 ? this.n2 : this.n1; }
  groupFrom(n) { return n === this.n1 ? this.fwd : this.bwd; }
  get chord() { return V.dist(this.n1.pos, this.n2.pos); }

  build() {
    const a = this.n1.pos, b = this.n2.pos;
    const mid = V.mix(a, b, 0.5);
    const nrm = V.rn(V.norm(V.sub(b, a)));
    const ctrl = { x: mid.x + nrm.x * this.bend * 2, y: mid.y + nrm.y * this.bend * 2 };
    this.centre = new Path(a, ctrl, b);
    const back = new Path(b, ctrl, a);
    const sp = this.spec;
    this.fwd = []; this.bwd = [];
    for (let i = 0; i < sp.lanes; i++) {
      this.fwd.push(new Lane(this, true, i,
        this.centre.offset(laneOffset(sp, i)).trim(this.n1.r, this.n2.r)));
    }
    if (!sp.oneway) {
      for (let i = 0; i < sp.lanes; i++) {
        this.bwd.push(new Lane(this, false, i,
          back.offset(laneOffset(sp, i)).trim(this.n2.r, this.n1.r)));
      }
    }
    buildPreSorting(this);
    this.buildMarkings();
  }

  /** Offset paths for road markings are geometry, not per-frame work: build
      them once here instead of re-deriving an arc-length LUT every frame. */
  buildMarkings() {
    const sp = this.spec, n = sp.lanes;
    const dividers = [], medians = [], rails = [];
    const base = sp.oneway ? -(n * LW) / 2 : sp.median;
    for (const sign of sp.oneway ? [1] : [1, -1]) {
      for (let k = 1; k < n; k++) dividers.push(this.centre.offset((base + k * LW) * sign));
    }
    if (sp.mark === 'median') for (const s of [-1, 1]) medians.push(this.centre.offset(s * (sp.median - 0.6)));
    if (this.isBridge) for (const s of [-1, 1]) rails.push(this.centre.offset(s * (this.halfWidth + 1.5)));
    this.marks = { dividers: dividers.map((p,i)=>preSortingDivider(this,p,i<n-1)), medians, rails };
  }
  get cost() { return this.centre ? this.centre.length * this.spec.cost : 0; }
}

/* ───────────────  turn-lane rules  ───────────────
   Which inbound lane may feed which outbound lane. Right turns come off the
   kerb lane, lefts off the median lane, and through movements map lane for
   lane (collapsing onto the outermost lane when the road narrows). This is
   what makes multi-lane roads behave like roads instead of wide streets. */

function lanePairs(nIn, nOut, turn) {
  const out = [];
  const push = (a, b) => {
    a = clamp(a, 0, nIn - 1); b = clamp(b, 0, nOut - 1);
    if (!out.some(p => p[0] === a && p[1] === b)) out.push([a, b]);
  };
  if (turn > 0.45) {                       // right turn (screen-space clockwise)
    push(0, 0);
    if (nIn >= 3 && nOut >= 2) push(1, 1);
  } else if (turn < -0.45) {                // left turn
    push(nIn - 1, nOut - 1);
    if (nIn >= 3 && nOut >= 2) push(nIn - 2, nOut - 2);
  } else {                                  // through
    for (let i = 0; i < nIn; i++) push(i, Math.min(i, nOut - 1));
  }
  return out;
}

function laneDescriptor(lane) {
  return { edgeId: lane.edge.id, forward: lane.forward, lane: lane.idx };
}

function sameLaneDescriptor(descriptor, lane) {
  return !!descriptor && descriptor.edgeId === lane.edge.id &&
    descriptor.forward === lane.forward && descriptor.lane === lane.idx;
}

function laneRuleFor(node, lane) {
  return node.laneRules.find(rule => rule.fromEdgeId === lane.edge.id &&
    rule.fromForward === lane.forward && rule.fromLane === lane.idx) || null;
}

function approachGroups(lanes) {
  const m = new Map();
  for (const l of lanes) {
    const k = l.edge.id + ':' + (l.forward ? 1 : 0);
    let g = m.get(k);
    if (!g) m.set(k, g = { edge: l.edge, forward: l.forward, lanes: [] });
    g.lanes.push(l);
  }
  for (const g of m.values()) g.lanes.sort((a, b) => a.idx - b.idx);
  return [...m.values()];
}

function buildConnectors(node) {
  node.connectors = [];
  node.connMap.clear();
  node.lanesIn = []; node.lanesOut = [];
  for (const e of node.edges) {
    for (const l of e.lanes) {
      if (l.to === node) node.lanesIn.push(l);
      if (l.from === node && !l.pocket) node.lanesOut.push(l);
    }
  }
  NET.pruneLaneRules(node);
  const inG = approachGroups(node.lanesIn);
  const outG = approachGroups(node.lanesOut);
  const deadEnd = node.degree <= 1;

  for (const gi of inG) {
    const li0 = gi.lanes[0];
    const d0 = li0.path.tangent(1);
    const h0 = Math.atan2(d0.y, d0.x);
    for (const go of outG) {
      if (gi.edge === go.edge && !deadEnd) continue;      // no mid-network U-turns
      const lo0 = go.lanes[0];
      const d1 = lo0.path.tangent(0);
      const turn = angDiff(h0, Math.atan2(d1.y, d1.x));
      const ordinary = gi.lanes.filter(l => !l.pocket);
      const pockets = gi.lanes.filter(l => l.pocket);
      const side = turn < -.45 ? 'left' : turn > .45 ? 'right' : null;
      const pocket = pockets.find(l => l.pocket === side);
      if (pocket && !laneRuleFor(node, pocket)) {
        makeConnector(node, pocket, side === 'left' ? go.lanes[go.lanes.length - 1] : go.lanes[0], turn);
      }
      for (const [ia, ib] of pocket ? [] : lanePairs(ordinary.length, go.lanes.length, turn)) {
        const fromLane = gi.lanes[ia];
        if (!laneRuleFor(node, fromLane)) makeConnector(node, fromLane, go.lanes[ib], turn);
      }
      for (const fromLane of gi.lanes) {
        const rule = laneRuleFor(node, fromLane);
        if (!rule) continue;
        for (const target of rule.to) {
          const toLane = go.lanes.find(lane => sameLaneDescriptor(target, lane));
          if (toLane) makeConnector(node, fromLane, toLane, turn);
        }
      }
    }
  }
  computeConflicts(node);
  buildSignal(node);
}

function connectorPath(li, lo) {
  const p0 = li.path.p2, t0 = li.path.tangent(1);
  const p2 = lo.path.p0, t1 = lo.path.tangent(0);
  let c;
  if (V.dot(t0, t1) < -0.55) {                            // near reversal: loop it
    c = V.add(V.mix(p0, p2, 0.5), V.mul(t0, Math.max(V.dist(p0, p2), 20) * 0.8));
  } else {
    c = lineX(p0, t0, p2, t1);
    if (!c || V.dot(V.sub(c, p0), t0) <= 0 || V.dot(V.sub(p2, c), t1) <= 0 ||
        V.dist(c, p0) > 500) c = V.mix(p0, p2, 0.5);
  }
  return new Path(p0, c, p2);
}

function makeConnector(node, li, lo, turn) {
  const conn = new Connector(node, li, lo, connectorPath(li, lo), turn);
  node.connectors.push(conn);
  node.connMap.set(li.id + '>' + lo.id, conn);
}

function conflictPathDirections(points) {
  return points.map((p, i) => {
    const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
    return Math.atan2(after.y - before.y, after.x - before.x);
  });
}

function pairedConflictZones(a, b, pointsA, pointsB, directionsA = null, directionsB = null, vehicleClass = 'TRUCK') {
  const cols = pointsB.length;
  const cells = new Uint8Array(pointsA.length * cols);
  const halfLength = (vehicleClass === 'CAR' ? CFG.CAR_L : CFG.TRUCK_L) / 2;
  const halfWidth = (vehicleClass === 'CAR' ? CFG.CAR_W : CFG.TRUCK_W) / 2;
  directionsA = directionsA || conflictPathDirections(pointsA);
  directionsB = directionsB || conflictPathDirections(pointsB);
  const footprintsMayOverlap = (pa, angleA, pb, angleB) => {
    // The nearest samples can shift each center by 1.5 units along its rail.
    // Only their relative cross-track projection needs extra envelope; a
    // parallel pair absorbs that shift inside the vehicles' longitudinal axes.
    const clearance = 0.25 + 3 * Math.abs(Math.sin(angleA - angleB));
    const ua = { x: Math.cos(angleA), y: Math.sin(angleA) };
    const va = { x: -ua.y, y: ua.x };
    const ub = { x: Math.cos(angleB), y: Math.sin(angleB) };
    const vb = { x: -ub.y, y: ub.x };
    const dx = pb.x - pa.x, dy = pb.y - pa.y;
    for (const axis of [ua, va, ub, vb]) {
      const distance = Math.abs(dx * axis.x + dy * axis.y);
      const radiusA = halfLength * Math.abs(ua.x * axis.x + ua.y * axis.y) +
        halfWidth * Math.abs(va.x * axis.x + va.y * axis.y);
      const radiusB = halfLength * Math.abs(ub.x * axis.x + ub.y * axis.y) +
        halfWidth * Math.abs(vb.x * axis.x + vb.y * axis.y);
      if (distance > radiusA + radiusB + clearance) return false;
    }
    return true;
  };
  const active = [];
  for (let i = 0; i < pointsA.length; i++) for (let j = 0; j < pointsB.length; j++) {
    if (!footprintsMayOverlap(pointsA[i], directionsA[i], pointsB[j], directionsB[j])) continue;
    const cell = i * cols + j;
    cells[cell] = 1;
    active.push(cell);
  }
  if (!active.length) return [];

  const visited = new Uint8Array(cells.length);
  const stepA = a.length / Math.max(pointsA.length - 1, 1);
  const stepB = b.length / Math.max(pointsB.length - 1, 1);
  const zones = [];
  for (const first of active) {
    if (visited[first]) continue;
    visited[first] = 1;
    const queue = [first];
    let minI = pointsA.length, maxI = -1, minJ = pointsB.length, maxJ = -1;
    for (let k = 0; k < queue.length; k++) {
      const cell = queue[k], i = Math.floor(cell / cols), j = cell % cols;
      minI = Math.min(minI, i); maxI = Math.max(maxI, i);
      minJ = Math.min(minJ, j); maxJ = Math.max(maxJ, j);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (di === 0 && dj === 0) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || ni >= pointsA.length || nj < 0 || nj >= pointsB.length) continue;
        const next = ni * cols + nj;
        if (!cells[next] || visited[next]) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    zones.push({
      start: clamp((minI - 0.5) * stepA, 0, a.length),
      end: clamp((maxI + 0.5) * stepA, 0, a.length),
      otherStart: clamp((minJ - 0.5) * stepB, 0, b.length),
      otherEnd: clamp((maxJ + 0.5) * stepB, 0, b.length),
    });
  }
  return zones.sort((x, y) => x.start - y.start);
}

function connectorPathGeometry(conn) {
  const pts = [];
  const S = Math.max(8, Math.ceil(conn.length / 3));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i <= S; i++) {
    const p = conn.path.pos(conn.length * i / S);
    pts.push(p);
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  const R = Math.hypot(CFG.TRUCK_L, CFG.TRUCK_W) / 2 + 1;
  return {
    conn, pts,
    box: { x0: x0 - R, y0: y0 - R, x1: x1 + R, y1: y1 + R },
  };
}

function connectorPathsConflict(a, b) {
  if (a.conn.toLane === b.conn.toLane) return true;
  const A = a.box, B = b.box;
  if (A.x1 < B.x0 || B.x1 < A.x0 || A.y1 < B.y0 || B.y1 < A.y0) return false;
  return pairedConflictZones(a.conn, b.conn, a.pts, b.pts).length > 0;
}

/** Conflict intervals include crossings, merges and the shared departure
    prefix where movements from one inbound lane have not separated yet. */
function computeConflicts(node) {
  const cs = node.connectors;
  for (const c of cs) { c.conflicts = []; c.conflictZones = new Map(); c.conflictZonesByVehiclePair = new Map(); }
  const R = CFG.CONFLICT_R;
  const pts = cs.map(c => {
    const a = [];
    const S = Math.max(8, Math.ceil(c.length / 3));
    for (let i = 0; i <= S; i++) a.push(c.path.pos(c.length * i / S));
    return a;
  });
  const directions = pts.map(conflictPathDirections);
  const box = pts.map(a => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of a) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const bodyRadius = Math.hypot(CFG.TRUCK_L, CFG.TRUCK_W) / 2 + 1;
    return { x0: x0 - bodyRadius, y0: y0 - bodyRadius, x1: x1 + bodyRadius, y1: y1 + bodyRadius };
  });
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j];
      const A = box[i], B = box[j];
      if (A.x1 < B.x0 || B.x1 < A.x0 || A.y1 < B.y0 || B.y1 < A.y0) continue;
      const carZones = pairedConflictZones(a, b, pts[i], pts[j], directions[i], directions[j], 'CAR');
      const truckZones = pairedConflictZones(a, b, pts[i], pts[j], directions[i], directions[j], 'TRUCK');
      if (a.toLane === b.toLane) {
        if (!carZones.length) carZones.push({ start: 0, end: a.length, otherStart: 0, otherEnd: b.length });
        if (!truckZones.length) truckZones.push({ start: 0, end: a.length, otherStart: 0, otherEnd: b.length });
      }
      if (carZones.length || truckZones.length) {
        a.conflicts.push(b); b.conflicts.push(a);
        const attachIds = zones => zones.map((z, zoneId) => ({ ...z, zoneId }));
        const reverseZones = zones => zones.map((z, zoneId) => ({
          zoneId, start: z.otherStart, end: z.otherEnd,
          otherStart: z.start, otherEnd: z.end,
        })).sort((x, y) => x.start - y.start);
        a.conflictZones.set(b, attachIds(truckZones.length ? truckZones : carZones));
        b.conflictZones.set(a, reverseZones(truckZones.length ? truckZones : carZones));
        a.conflictZonesByVehiclePair.set(b, { CAR: carZones, TRUCK: truckZones });
        b.conflictZonesByVehiclePair.set(a, {
          CAR: reverseZones(carZones), TRUCK: reverseZones(truckZones),
        });
      }
    }
  }
}

/** Preserve the legacy approach map while coloring movements into compatible
    phases. Opposing through movements share a phase; geometric conflicts do not. */
function buildSignal(node) {
  if (node.control !== 'SIGNAL' || node.degree < 3) { node.signal = null; return; }
  const prev = node.signal;
  const group = new Map();
  let ref = null;
  for (const approach of approachGroups(node.lanesIn)) {
    const direction = approach.lanes[0].dir(approach.lanes[0].length);
    const axis = ((Math.atan2(direction.y, direction.x) % Math.PI) + Math.PI) % Math.PI;
    if (ref === null) ref = axis;
    let difference = Math.abs(axis - ref);
    difference = Math.min(difference, Math.PI - difference);
    const phase = difference < Math.PI / 4 ? 0 : 1;
    for (const lane of approach.lanes) group.set(lane.id, phase);
  }
  const movementGroup = new Map();
  const movements = node.connectors.slice().sort((a, b) =>
    Math.abs(a.turn) - Math.abs(b.turn) || a.fromLane.id - b.fromLane.id || a.id - b.id);
  let movementPhases = 0;
  for (const conn of movements) {
    const used = new Set(conn.conflicts.map(other => movementGroup.get(other.id))
      .filter(phase => phase !== undefined));
    let phase = 0;
    while (used.has(phase)) phase++;
    movementGroup.set(conn.id, phase);
    movementPhases = Math.max(movementPhases, phase + 1);
  }
  const phases = Math.max(2, new Set(group.values()).size || 1, movementPhases);
  node.signal = {
    group, movementGroup, phases,
    idx: prev ? prev.idx % phases : 0,
    timer: prev ? prev.timer : rng() * CFG.GREEN_TIME,
    amber: false,
  };
}

function nodeRadius(n) {
  let hw = 11;
  for (const e of n.edges) {
    const pockets=n.preSorting[e.id];
    hw = Math.max(hw, e.halfWidth + (pockets ? (pockets.left ? LW : 0)+(pockets.right ? LW : 0) : 0));
  }
  // ring nodes stay tight, otherwise a wide arm would over-trim the ring itself
  if (n.isRing) return clamp(hw * 0.7 + 2, 9, 24);
  return clamp(hw * 1.12 + 3 + Math.max(0, n.degree - 2) * 2.2, 13, 78);
}

/* ─────────────────────────  network mutation  ───────────────────────── */

const NET = {
  nodes: [], edges: [],

  addNode(x, y) {
    const n = new GNode(x, y);
    n.born = W ? W.time : 0;
    this.nodes.push(n);
    return n;
  },

  findEdge(a, b) {
    return this.edges.find(e => (e.n1 === a && e.n2 === b) || (e.n1 === b && e.n2 === a));
  },

  canConnect(a, b, type) {
    if (a === b || this.findEdge(a, b)) return false;
    const spec = ROADS[type] || ROADS.STREET;
    const need = nodeRadius(a) + nodeRadius(b) + roadHalfWidth(spec) + 16;
    return V.dist(a.pos, b.pos) > Math.max(need, 46);
  },

  addEdge(a, b, type = 'STREET', bend = 0) {
    if (a === b || this.findEdge(a, b)) return null;
    for(const n of [a,b]) if(!this.nodes.includes(n)) this.nodes.push(n);
    const e = new Edge(a, b, type, bend);
    e.born = W ? W.time : 0;
    this.edges.push(e);
    a.edges.push(e); b.edges.push(e);
    e.isBridge = crossesWater(a.pos, b.pos);
    this.rebuildAround([a, b]);
    return e;
  },

  removeEdge(e) {
    const i = this.edges.indexOf(e);
    if (i < 0) return;
    const endpoints = [e.n1, e.n2];
    this.edges.splice(i, 1);
    for (const n of endpoints) delete n.preSorting[e.id];
    for (const n of endpoints) n.priorityEdges.delete(e.id);
    e.n1.edges.splice(e.n1.edges.indexOf(e), 1);
    e.n2.edges.splice(e.n2.edges.indexOf(e), 1);
    for (const n of endpoints) {
      if (n.control === 'PRIORITY' && (n.priorityEdges.size === 0 || n.degree < 3)) {
        n.control = 'YIELD'; n.priorityEdges.clear();
      }
    }
    const dead = new Set(e.lanes.map(l => l.id));
    for (const b of CITY.buildings) if (b.edge === e) b.edge = null;
    for (const v of W.cars) {
      if (v.track && dead.has(v.track.id)) v.dead = true;
      else if (v.route && v.route.some(t => dead.has(t.id))) v.needsReroute = true;
    }
    this.rebuildAround([e.n1, e.n2]);
    this.prune();
  },

  setType(e, type) {
    if (e.type === 'RING' || type === 'RING') return;
    e.type = type;
    if (Math.abs(e.bend) > e.chord * 0.4) e.bend = Math.sign(e.bend) * e.chord * 0.4;
    this.rebuildAround([e.n1, e.n2]);
    this.reattachAll();
  },

  reverseOneWay(e) {
    if (!e || !ROADS[e.type] || !ROADS[e.type].oneway || e.type === 'RING') return false;
    [e.n1, e.n2] = [e.n2, e.n1];
    e.bend = -e.bend;
    this.rebuildAround([e.n1, e.n2]);
    this.reattachAll();
    return true;
  },

  /** Recompute node radii, rebuild affected edge geometry, then resynthesise
      the connector sets of every node those edges touch. */
  rebuildAround(nodes) {
    const seed = new Set(nodes);
    for (const n of seed) prunePreSorting(n);
    for (const n of seed) n.r = nodeRadius(n);
    const edges = new Set();
    for (const n of seed) for (const e of n.edges) edges.add(e);
    for (const e of edges) e.build();
    const all = new Set(seed);
    for (const e of edges) { all.add(e.n1); all.add(e.n2); }
    // A short approach may discard its pockets while rebuilding. Restore the
    // smaller junction radius immediately instead of leaving a widened gap.
    const corrected=[...all].filter(n=>n.r!==nodeRadius(n));
    if(corrected.length) {
      for(const n of corrected) {n.r=nodeRadius(n);for(const e of n.edges)edges.add(e);}
      for(const e of edges) {e.build();all.add(e.n1);all.add(e.n2);}
    }
    for (const n of all) buildConnectors(n);
    this.dirty = true;
  },

  rebuildAll() {
    for (const n of this.nodes) prunePreSorting(n);
    for (const n of this.nodes) n.r = nodeRadius(n);
    for (const e of this.edges) e.build();
    if(this.nodes.some(n=>n.r!==nodeRadius(n))) {
      for(const n of this.nodes)n.r=nodeRadius(n);
      for(const e of this.edges)e.build();
    }
    for (const n of this.nodes) buildConnectors(n);
    this.dirty = true;
  },

  prune() {
    const gone = this.nodes.filter(n => n.degree === 0);
    if (!gone.length) return;
    const set = new Set(gone);
    this.nodes = this.nodes.filter(n => !set.has(n));
  },

  connector(inLane, outLane) {
    return inLane.to.connMap.get(inLane.id + '>' + outLane.id) || null;
  },

  pruneLaneRules(node) {
    node.laneRules = node.laneRules.filter(rule => {
      const fromLane = node.lanesIn.find(lane => rule.fromEdgeId === lane.edge.id &&
        rule.fromForward === lane.forward && rule.fromLane === lane.idx);
      if (!fromLane) return false;
      rule.to = rule.to.filter(target => node.lanesOut.some(lane => sameLaneDescriptor(target, lane)) &&
        target.edgeId !== rule.fromEdgeId);
      return rule.to.length > 0;
    });
  },

  toggleLaneConnection(node, fromLane, toLane) {
    if (!node || node.isRing || node.degree < 3 || !node.lanesIn.includes(fromLane) ||
        !node.lanesOut.includes(toLane) || fromLane.edge === toLane.edge) {
      return { ok: false, msg: 'Choose an incoming and outgoing lane at a regular junction' };
    }
    const current = laneRuleFor(node, fromLane);
    const destinations = current
      ? current.to.map(target => ({ ...target }))
      : node.connectors.filter(connector => connector.fromLane === fromLane)
        .map(connector => laneDescriptor(connector.toLane));
    const target = laneDescriptor(toLane);
    const index = destinations.findIndex(item => item.edgeId === target.edgeId &&
      item.forward === target.forward && item.lane === target.lane);
    if (index >= 0) {
      if (destinations.length === 1) return { ok: false, msg: 'Keep at least one exit for this lane' };
      destinations.splice(index, 1);
    } else {
      destinations.push(target);
    }
    const rule = {
      fromEdgeId: fromLane.edge.id,
      fromForward: fromLane.forward,
      fromLane: fromLane.idx,
      to: destinations,
    };
    if (current) node.laneRules[node.laneRules.indexOf(current)] = rule;
    else node.laneRules.push(rule);
    buildConnectors(node);
    markReroute();
    return { ok: true, added: index < 0 };
  },

  resetLaneConnections(node, fromLane) {
    if (!node || !fromLane) return false;
    const index = node.laneRules.findIndex(rule => rule.fromEdgeId === fromLane.edge.id &&
      rule.fromForward === fromLane.forward && rule.fromLane === fromLane.idx);
    if (index < 0) return false;
    node.laneRules.splice(index, 1);
    buildConnectors(node);
    markReroute();
    return true;
  },

  /** Insert a junction partway along a road, splitting it into two. */
  splitEdge(e, s) {
    if (e.type === 'RING') return null;
    const t = e.centre.tAt(clamp(s, 20, e.centre.length - 20));
    const p = e.centre.point(t);
    const left = e.centre.sub(0, t), right = e.centre.sub(t, 1);
    const bendOf = path => {
      const mid = V.mix(path.p0, path.p2, 0.5);
      const nrm = V.rn(V.norm(V.sub(path.p2, path.p0)));
      return V.dot(V.sub(path.p1, mid), nrm) / 2;
    };
    const n1 = e.n1, n2 = e.n2, type = e.type;
    const pockets1=n1.preSorting[e.id],pockets2=n2.preSorting[e.id];
    const priorityAtN1 = n1.control === 'PRIORITY' ? new Set(n1.priorityEdges) : null;
    const priorityAtN2 = n2.control === 'PRIORITY' ? new Set(n2.priorityEdges) : null;
    const laneRulesAtN1 = n1.laneRules.map(rule => ({ ...rule, to: rule.to.map(target => ({ ...target })) }));
    const laneRulesAtN2 = n2.laneRules.map(rule => ({ ...rule, to: rule.to.map(target => ({ ...target })) }));
    const b1 = bendOf(left), b2 = bendOf(right);
    this.removeEdge(e);
    // removeEdge prunes isolated endpoints; splitting must keep both in the graph.
    for (const n of [n1, n2]) if (!this.nodes.includes(n)) this.nodes.push(n);
    const mid = this.addNode(p.x, p.y);
    mid.control = 'YIELD';
    const e1 = this.addEdge(n1, mid, type, b1);
    const e2 = this.addEdge(mid, n2, type, b2);
    if(pockets1 && e1) n1.preSorting[e1.id]={...pockets1};
    if(pockets2 && e2) n2.preSorting[e2.id]={...pockets2};
    if (!e1 && !e2) { this.prune(); return null; }
    const restorePriority = (node, previous, replacement) => {
      if (!previous) return;
      node.priorityEdges = new Set([...previous].filter(id => id !== e.id));
      if (previous.has(e.id) && replacement) node.priorityEdges.add(replacement.id);
      if (node.degree >= 3 && node.priorityEdges.size) node.control = 'PRIORITY';
      else { node.control = 'YIELD'; node.priorityEdges.clear(); }
    };
    restorePriority(n1, priorityAtN1, e1);
    restorePriority(n2, priorityAtN2, e2);
    const transferLaneRules = (node, previous, replacement) => {
      node.laneRules = previous.map(rule => ({
        ...rule,
        fromEdgeId: rule.fromEdgeId === e.id && replacement ? replacement.id : rule.fromEdgeId,
        to: rule.to.filter(target => target.edgeId !== e.id || replacement)
          .map(target => target.edgeId === e.id && replacement
            ? { ...target, edgeId: replacement.id }
            : { ...target }),
      })).filter(rule => rule.fromEdgeId !== e.id && rule.to.length > 0);
    };
    transferLaneRules(n1, laneRulesAtN1, e1);
    transferLaneRules(n2, laneRulesAtN2, e2);
    this.rebuildAround([n1, n2]);
    this.reattachAll();
    return mid;
  },

  reattachAll() {
    CITY.clearRoadOverlaps();
    CITY.reattachDirty = true;
  },

  /* ── roundabouts: a graph rewrite, not a simulation special case ── */

  makeRoundabout(node, R) {
    if (node.isRing || node.degree < 3) return false;
    const cx = node.x, cy = node.y;
    const arms = node.edges.map(e => {
      const o = e.other(node);
      const ref = e.centre ? e.centre.pos(e.n1 === node ? Math.min(40, e.centre.length) : Math.max(0, e.centre.length - 40)) : o.pos;
      return { e, a: Math.atan2(ref.y - cy, ref.x - cx) };
    }).sort((p, q) => p.a - q.a);

    const ringId = ++_ringSeq;
    const slots = [];        // {angle, arm|null}
    const k = arms.length;
    for (let i = 0; i < k; i++) {
      slots.push({ a: arms[i].a, arm: arms[i].e });
      // subdivide long spans so each quadratic stays a good circular arc
      const next = i + 1 < k ? arms[i + 1].a : arms[0].a + TAU;
      const span = next - arms[i].a;
      const m = Math.max(1, Math.ceil(span / 1.5));
      for (let j = 1; j < m; j++) slots.push({ a: arms[i].a + span * j / m, arm: null });
    }

    const rn = slots.map(s => {
      const n = this.addNode(cx + Math.cos(s.a) * R, cy + Math.sin(s.a) * R);
      n.isRing = true; n.ringId = ringId; n.control = 'YIELD';
      return n;
    });

    // rewire each arm onto its ring node
    slots.forEach((s, i) => {
      if (!s.arm) return;
      const e = s.arm;
      if (e.n1 === node) e.n1 = rn[i]; else e.n2 = rn[i];
      node.edges.splice(node.edges.indexOf(e), 1);
      rn[i].edges.push(e);
    });

    // one-way ring edges, circulating counter-clockwise on screen
    const m = slots.length;
    for (let i = 0; i < m; i++) {
      const j = (i - 1 + m) % m;
      let sweep = slots[i].a - slots[j].a;
      while (sweep <= 0) sweep += TAU;
      const A = rn[i].pos, B = rn[j].pos;
      const mid = V.mix(A, B, 0.5);
      const dir = V.norm(V.sub(B, A));
      const outward = V.norm({ x: mid.x - cx, y: mid.y - cy });
      const mag = R * (1 / Math.cos(sweep / 2) - Math.cos(sweep / 2)) / 2;
      const bend = Math.sign(V.dot(V.rn(dir), outward) || 1) * mag;
      this.addEdge(rn[i], rn[j], 'RING', bend);
    }

    const idx = this.nodes.indexOf(node);
    if (idx >= 0) this.nodes.splice(idx, 1);
    W.rings.set(ringId, { cx, cy, R, nodes: rn, hw: roadHalfWidth(ROADS.RING) });
    this.rebuildAround(rn);
    this.reattachAll();
    for (const c of W.cars) c.needsReroute = true;
    return true;
  },

  removeRoundabout(ringId) {
    const ring = W.rings.get(ringId);
    if (!ring) return false;
    const rset = new Set(ring.nodes);
    const ringEdges = this.edges.filter(e => e.type === 'RING' && rset.has(e.n1) && rset.has(e.n2));
    const arms = this.edges.filter(e => e.type !== 'RING' && (rset.has(e.n1) || rset.has(e.n2)));
    for (const e of ringEdges) this.removeEdge(e);
    const hub = this.addNode(ring.cx, ring.cy);
    hub.control = 'SIGNAL';
    for (const e of arms) {
      if (rset.has(e.n1)) { e.n1.edges.splice(e.n1.edges.indexOf(e), 1); e.n1 = hub; }
      else { e.n2.edges.splice(e.n2.edges.indexOf(e), 1); e.n2 = hub; }
      hub.edges.push(e);
    }
    this.nodes = this.nodes.filter(n => !rset.has(n));
    W.rings.delete(ringId);
    this.rebuildAround([hub]);
    this.prune();
    this.reattachAll();
    for (const c of W.cars) c.needsReroute = true;
    return true;
  },

  cycleControl(node) {
    if (node.isRing) return;
    const order = ['SIGNAL', 'STOP', 'YIELD'];
    node.priorityEdges.clear();
    node.control = order[(order.indexOf(node.control) + 1) % order.length];
    buildSignal(node);
  },
};

function togglePriorityArm(node, edge) {
  if (node.control !== 'PRIORITY') {
    node.priorityEdges.clear();
    node.control = 'PRIORITY';
  }
  if (node.priorityEdges.has(edge.id)) node.priorityEdges.delete(edge.id);
  else node.priorityEdges.add(edge.id);
  if (node.priorityEdges.size === 0) node.control = 'YIELD';
  buildSignal(node);
}

/* ────────────────────────  §4  ROUTING (TRAVEL TIME)  ────────────────────────
   Search runs in lane space. Two things fall out of that which a node-space
   search cannot express: turn restrictions are structural (a route can only
   use connectors that exist), and a *lane change* is a weighted transition —
   so a route is allowed to say "be in the left lane by the time you reach that
   junction". Feasibility constrains those shifts, and tactical safety may
   still require waiting or a legal replan.                                  */

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item, p) {
    const a = this.a; a.push({ item, p });
    let i = a.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (a[par].p <= a[i].p) break;
      [a[par], a[i]] = [a[i], a[par]]; i = par;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (!top) return null;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].p < a[m].p) m = l;
        if (r < a.length && a[r].p < a[m].p) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

const ROUTE_MIN_CHANGE_DISTANCE = Math.max(15.5, CFG.LANE_W * 1.4);
const routeMovementCache = new WeakMap();

function sameGroup(a, b) { return a.edge === b.edge && a.forward === b.forward; }

function routeLaneOrder(lane) { return lane.order ?? lane.idx; }

function routeLaneChangeSteps(fromLane, toLane) {
  if (fromLane === toLane) return 0;
  if (!fromLane || !toLane || !sameGroup(fromLane, toLane)) return Infinity;
  const ordered = fromLane.siblings.slice().sort((a, b) => routeLaneOrder(a) - routeLaneOrder(b));
  const from = ordered.indexOf(fromLane), to = ordered.indexOf(toLane);
  return from < 0 || to < 0 ? Infinity : Math.abs(to - from);
}

function routeLaneChangeDuration(fromLane, toLane) {
  const steps = routeLaneChangeSteps(fromLane, toLane);
  if (!Number.isFinite(steps)) return Infinity;
  const lateralTime = 2 * Math.sqrt(CFG.LANE_W / Math.max(CFG.A_LAT, 1));
  return steps * Math.max(CFG.CHANGE_TIME, lateralTime);
}

function routeOutgoingMovements(lane) {
  const node = lane.to, connectors = node.connectors, siblings = lane.siblings;
  const cached = routeMovementCache.get(lane);
  if (cached && cached.connectors === connectors && cached.siblings === siblings) return cached.movements;
  const byLane = new Map(siblings.map(sibling => [sibling, []]));
  for (const conn of connectors) {
    const movements = byLane.get(conn.fromLane);
    if (movements) movements.push(conn);
  }
  const movements = [];
  for (const fromLane of siblings) {
    for (const conn of byLane.get(fromLane) || []) movements.push({ fromLane, conn, toLane: conn.toLane });
  }
  routeMovementCache.set(lane, { connectors, siblings, movements });
  return movements;
}

/* Use a low approach speed for feasibility so a driver may slow down before
   entering a short pocket. Each adjacent merge still needs the same minimum
   distance as executeChange, with enough room after every pocket mouth. */
function routeLaneChangeFeasible(fromLane, toLane, fromS = 0, endS = null,
                                 vehicleLength = CFG.CAR_L) {
  const steps = routeLaneChangeSteps(fromLane, toLane);
  if (!Number.isFinite(steps)) return false;
  if (!steps) return true;
  vehicleLength = Number.isFinite(vehicleLength) && vehicleLength > 0 ? vehicleLength : CFG.CAR_L;
  const stopBudget = vehicleLength / 2 + CFG.STOPLINE + CFG.IDM_S0 + 2;
  const ordered = fromLane.siblings.slice().sort((a, b) => routeLaneOrder(a) - routeLaneOrder(b));
  const fromIndex = ordered.indexOf(fromLane), toIndex = ordered.indexOf(toLane);
  if (fromIndex < 0 || toIndex < 0) return false;
  const direction = Math.sign(toIndex - fromIndex);
  let progress = clamp(fromS, 0, fromLane.length) / Math.max(fromLane.length, 1);
  const goalProgress = Number.isFinite(endS)
    ? (endS - 2) / Math.max(fromLane.length, 1) : Infinity;

  for (let i = 0; i < steps; i++) {
    const current = ordered[fromIndex + direction * i];
    const target = ordered[fromIndex + direction * (i + 1)];
    if (!current || !target) return false;

    // executeChange maps position by lane length. A pocket is enterable only
    // once that mapped position reaches its mouth, even when it is an
    // intermediate lane on the way to the requested connector.
    if (target.pocket && Number.isFinite(target.startS)) {
      const mouth = (target.startS + vehicleLength / 2 + 3) / Math.max(target.length, 1);
      progress = Math.max(progress, mouth);
    }

    let latest = Math.min(
      1 - stopBudget / Math.max(current.length, 1),
      1 - stopBudget / Math.max(target.length, 1)
    );
    if (Number.isFinite(goalProgress)) latest = Math.min(latest, goalProgress);
    const distanceAvailable = (latest - progress) * current.length;
    if (distanceAvailable + 0.01 < ROUTE_MIN_CHANGE_DISTANCE) return false;
    progress += ROUTE_MIN_CHANGE_DISTANCE / Math.max(current.length, 1);
  }
  return true;
}

function routeTrackSpeed(track) {
  const limit = Number(track && track.speedLimit);
  const base = Number.isFinite(limit) && limit > 0 ? limit : 1;
  const load = clamp(Number(track && track.load) || 0, 0, 1);
  return Math.max(1, base * Math.max(0.4, 1 - 0.6 * load));
}

function routeTrackTravelTime(track, distance) {
  distance = Math.max(0, Number(distance) || 0);
  if (!distance) return 0;
  const length = Math.max(1, Number(track.length) || 1);
  const estimated = distance / routeTrackSpeed(track);
  // Tracks may report a smoothed full-traversal EMA after cars clear them.
  // Scale it for partial use, and retain the live speed/load estimate as a floor.
  const observed = Number(track.observedTravelTime);
  return Number.isFinite(observed) && observed > 0
    ? Math.max(estimated, observed * Math.min(distance / length, 1))
    : estimated;
}

function routeJunctionDelay(conn) {
  const node = conn.node;
  for (const observed of [conn.observedJunctionDelay, node.observedJunctionDelay]) {
    if (Number.isFinite(observed) && observed >= 0) return observed;
  }
  const load = clamp(Number(conn.load) || 0, 0, 1);
  const phases = Math.max(1, Number(node.signal && node.signal.phases) || 2);
  let delay = node.control === 'SIGNAL'
    ? CFG.GREEN_TIME * (phases - 1) ** 2 / (2 * phases)
    : node.control === 'STOP' ? 1.5
    : node.control === 'PRIORITY' ? 0.25 : 0.65;
  return delay + load * 3.5 + Math.abs(conn.turn) * 0.12;
}

/* Total estimated seconds for an existing route. `startS` is the current
   position on its first track; the goal arguments trim the final lane. */
function routeTravelTime(route, startS = 0, goalLane = null, goalS = 0,
                         vehicleLength = CFG.CAR_L) {
  if (!route || !route.length) return Infinity;
  let total = 0;
  for (let i = 0; i < route.length; i++) {
    const track = route[i];
    if (track.kind === 'LANE') {
      const at = i === 0 ? clamp(startS, 0, track.length) : 0;
      let end = track.length;
      const finalLane = i === route.length - 1;
      if (finalLane && goalLane && sameGroup(track, goalLane)) {
        const goalPos = goalLane.pos(goalS);
        const projected = track.path.nearest(goalPos).s;
        if (projected < at - 14) return Infinity;
        end = clamp(projected, at, track.length);
        if (track !== goalLane) {
          const changeTime = routeLaneChangeDuration(track, goalLane);
          if (!routeLaneChangeFeasible(track, goalLane, at, end, vehicleLength)) return Infinity;
          total += changeTime;
        }
      }
      const next = route[i + 1];
      if (next && next.kind === 'CONN') {
        const changeTime = routeLaneChangeDuration(track, next.fromLane);
        if (!routeLaneChangeFeasible(track, next.fromLane, at, undefined, vehicleLength)) return Infinity;
        total += changeTime + routeLaneChangeSteps(track, next.fromLane) * 0.12;
      }
      total += routeTrackTravelTime(track, end - at);
    } else if (track.kind === 'CONN') {
      total += routeTrackTravelTime(track, track.length) + routeJunctionDelay(track);
    }
  }
  return total;
}

function findRoute(starts, goalLane, goalPos, blockStart, strictFrom,
                   vehicleLength = CFG.CAR_L) {
  if (!starts.length || !goalLane) return null;
  const open = new Heap();
  const best = new Map(), from = new Map(), startAt = new Map();

  for (const st of starts) {
    const g = Number.isFinite(st.g) ? st.g : 0;
    if (best.has(st.lane.id) && best.get(st.lane.id) <= g) continue;
    best.set(st.lane.id, g);
    startAt.set(st.lane.id, clamp(st.s || 0, 0, st.lane.length));
    from.set(st.lane.id, null);
    open.push(st.lane, g);
  }

  let guard = 9000, goal = null, goalCost = Infinity;
  while (open.size && guard-- > 0) {
    const entry = open.pop();
    const lane = entry.item;
    const g = best.get(lane.id);
    if (g === undefined || entry.p > g + 0.001) continue;
    if (entry.p >= goalCost) break;
    const at = startAt.get(lane.id) || 0;
    if (sameGroup(lane, goalLane) && (!blockStart || from.get(lane.id))) {
      const targetS = lane.path.nearest(goalPos).s;
      if (targetS >= at - 14) {
        const finalSteps = routeLaneChangeSteps(lane, goalLane);
        if (routeLaneChangeFeasible(lane, goalLane, at, targetS, vehicleLength)) {
          const finalCost = g + routeLaneChangeDuration(lane, goalLane) + finalSteps * 0.12 +
            routeTrackTravelTime(lane, Math.max(0, targetS - at));
          if (finalCost < goalCost) { goal = lane; goalCost = finalCost; }
        }
      }
    }

    const node = lane.to;
    const laneTime = routeTrackTravelTime(lane, lane.length - at);
    for (const movement of routeOutgoingMovements(lane)) {
      const S = movement.fromLane;
      if (strictFrom && lane === strictFrom && S !== lane) continue;
      if (!routeLaneChangeFeasible(lane, S, at, undefined, vehicleLength)) continue;
      const steps = routeLaneChangeSteps(lane, S);
      const mergeTime = routeLaneChangeDuration(lane, S) + steps * 0.12;
      const conn = movement.conn, nxt = movement.toLane;
      const ng = g + laneTime + mergeTime + routeTrackTravelTime(conn, conn.length) +
        routeJunctionDelay(conn);
      if (best.has(nxt.id) && best.get(nxt.id) <= ng + 0.001) continue;
      best.set(nxt.id, ng);
      startAt.set(nxt.id, 0);
      from.set(nxt.id, { prev: lane, conn });
      open.push(nxt, ng);
    }
  }
  if (!goal) return null;

  const out = [];
  let cur = goal;
  for (;;) {
    out.unshift(cur);
    const link = from.get(cur.id);
    if (!link) break;
    out.unshift(link.conn);
    cur = link.prev;
  }
  return out;
}

function routeBetween(fromLane, fromS, toLane, toS, strict, vehicleLength = CFG.CAR_L,
                      allowSameRoadDetour = false) {
  if (!fromLane || !toLane) return null;
  if (sameGroup(fromLane, toLane) && toS > fromS + 14) {
    const endS = fromLane.path.nearest(toLane.pos(toS)).s;
    if (routeLaneChangeFeasible(fromLane, toLane, fromS, endS, vehicleLength)) return [fromLane];
    if (!allowSameRoadDetour) return null;
  }
  return findRoute([{ lane: fromLane, g: 0, s: fromS }],
                   toLane, toLane.pos(toS), true, strict ? fromLane : null, vehicleLength);
}

/** A rebuild (upgrade, roundabout, demolition) replaces an edge's Lane objects.
    Any vehicle still riding an orphaned lane is migrated onto the live lane at
    the same index so it stays visible to the rest of the simulation. */
function resyncTrack(c) {
  if (c.manoeuvre) {
    const m = c.manoeuvre;
    if (!m.source.siblings.includes(m.source) || !m.target.siblings.includes(m.target)) {
      cancelManoeuvre(c);
      c.needsReroute = true;
    }
  }
  const t = c.track;
  if (!t || t.kind !== 'LANE') return;
  const g = t.forward ? t.edge.fwd : t.edge.bwd;
  if (!g || !g.length) { c.dead = true; return; }
  if (g.indexOf(t) >= 0) return;
  const real = g.find(l => l.idx === t.idx) || g[Math.min(t.idx, g.length - 1)];
  if (!real) { c.dead = true; return; }
  if (!c.claimClearing) c.releaseClaim();
  c.s = clamp(c.s * (real.length / t.length), 0, real.length);
  c.track = real;
  c.route[c.ri] = real;
  c.lat = 0;
  c.needsReroute = true;
}

/* ────────────────────────  §5  VEHICLES  ────────────────────────
   Longitudinally: the Intelligent Driver Model,

       a = A·[ 1 − (v/v₀)^δ − (s*(v,Δv)/s)² ],
       s* = s₀ + max(0, v·T + v·Δv / (2√(A·B)))

   evaluated against the nearest of several obstacles — the leader (searched
   across track boundaries so following works around corners), the stop line
   of a junction the car has not been cleared for, and the kerb outside its
   destination.

   Laterally: MOBIL. A change happens when it is safe for the new follower and
   the *combined* accelerations of everyone involved improve by more than a
   threshold, with a keep-right bias and an overriding term for merges the
   route requires.                                                            */

const CAR_COLORS = ['#e86a6a', '#f2c14e', '#79d17a', '#7aa7f0', '#b98ae0',
                    '#f09a5b', '#5fc9d6', '#e2849f', '#9fb4c9'];
const TRUCK_COLORS = ['#c2c9d6', '#8fa2bd', '#d8b98a'];

function idmAccel(v, vDes, gap, dv) {
  const free = 1 - Math.pow(clamp(v / Math.max(vDes, 1), 0, 4), CFG.IDM_DELTA);
  if (gap === Infinity) return CFG.IDM_A * free;
  const sStar = CFG.IDM_S0 +
    Math.max(0, v * CFG.IDM_T + (v * dv) / (2 * Math.sqrt(CFG.IDM_A * CFG.IDM_B)));
  const g = Math.max(gap, 0.5);
  return CFG.IDM_A * (free - (sStar / g) * (sStar / g));
}

const gapBetween = (a, b) => b.s - a.s - (a.len + b.len) / 2;

function lanePreparationSpeed(car,lane,movement,startS=0) {
  if(!lane || lane.kind!=='LANE')return Infinity;
  const target=movement?.kind==='CONN' ? movement.fromLane
    : car.goalLane && sameGroup(lane,car.goalLane) ? car.goalLane : null;
  if(!target || !sameGroup(lane,target))return Infinity;
  const changes=routeLaneChangeSteps(lane,target);
  if(!changes || !Number.isFinite(changes))return Infinity;
  let available=lane.length-startS-car.len/2-CFG.STOPLINE-CFG.IDM_S0-2;
  if(!movement)available=Math.min(available,car.goalS-startS-2);
  // Leave margin for discrete integration and for the next adjacent manoeuvre.
  return Math.max(4,.8*available/(changes*CFG.CHANGE_TIME+.25));
}

// Work backwards from the stop line (or kerb) so waiting for a gap never
// consumes the distance needed for the remaining adjacent lane changes.
const MERGE_GAP_RECOVERY_SECONDS = 5;
const ROAD_NO_PROGRESS_RECOVERY_SECONDS = 120;

function laneChangeDistanceBudget(car, lane, target) {
  const targetS = clamp(car.s * (target.length / lane.length), 0, target.length);
  let available = Math.min(lane.length-car.s, (target.length-targetS)*lane.length/target.length)
    - car.len/2 - CFG.STOPLINE - CFG.IDM_S0 - 2;
  if (car.onGoalRoad && car.ri === car.route.length-1) {
    available = Math.min(available, car.goalS-car.s-2);
  }
  return {targetS, available, minimum: Math.max(15.5, LW * 1.4)};
}

function requiredLaneChangeFailure(car) {
  const lane = car.track;
  if (!lane || lane.kind !== 'LANE' || car.wantIdx === null || car.wantIdx === lane.idx) return null;
  const target = lane.siblings.find(l => l.idx === car.wantIdx);
  if (!target) return 'unreachable-lane';
  const mergeStop = laneMergeStopS(car);
  if (Number.isFinite(mergeStop) && car.s > mergeStop + 0.5) return 'lane-change-infeasible';

  const ordered = lane.siblings.slice().sort((a,b)=>routeLaneOrder(a)-routeLaneOrder(b));
  const from = ordered.indexOf(lane), to = ordered.indexOf(target);
  if (from < 0 || to < 0) return 'unreachable-lane';
  const adjacent = ordered[from + Math.sign(to-from)];
  if (!adjacent) return 'unreachable-lane';
  const budget = laneChangeDistanceBudget(car, lane, adjacent);
  if (budget.available < budget.minimum) return 'lane-change-infeasible';
  if (adjacent.pocket) {
    const pocketMouthS = (adjacent.startS + car.len/2 + 3) * lane.length / adjacent.length;
    if (Number.isFinite(mergeStop) && mergeStop < pocketMouthS - 0.5) return 'pocket-infeasible';
  }
  return null;
}

function laneMergeStopS(car) {
  const lane=car.track;
  if(car.manoeuvre || lane?.kind!=='LANE')return Infinity;
  const target=lane.siblings.find(l=>l.idx===car.wantIdx);
  if(!target || target===lane)return Infinity;
  const ordered=lane.siblings.slice().sort((a,b)=>routeLaneOrder(a)-routeLaneOrder(b));
  const from=ordered.indexOf(lane),to=ordered.indexOf(target),direction=Math.sign(to-from);
  if(from<0 || to<0)return Infinity; // A road edit can retire the current lane.
  const stopBudget=car.len/2+CFG.STOPLINE+CFG.IDM_S0+2;
  const goal=car.ri===car.route.length-1 && car.onGoalRoad
    ? (car.goalS-2)/lane.length : Infinity;
  let latest=Infinity;
  for(let i=to-direction;;i-=direction) {
    const source=ordered[i],dest=ordered[i+direction];
    latest=Math.min(latest,1-stopBudget/source.length,1-stopBudget/dest.length,goal)
      - ROUTE_MIN_CHANGE_DISTANCE/source.length;
    if(i===from)break;
  }
  const next=ordered[from+direction];
  const mouth=next.pocket ? (next.startS+car.len/2+3)*lane.length/next.length : 0;
  // Allow for a discrete frame passing a manoeuvre endpoint, but never
  // spend all the usable space between a short pocket's mouth and this limit.
  const limit=latest*lane.length;
  const margin=Math.min(2,Math.max(0,(limit-mouth)/2));
  return Math.max(0,limit-margin);
}

class Car {
  constructor(origin, dest, kind) {
    this.id = uid();
    this.kind = kind || 'CAR';
    this.origin = origin;
    this.dest = dest;
    this.len = this.kind === 'TRUCK' ? CFG.TRUCK_L : CFG.CAR_L;
    this.wide = this.kind === 'TRUCK' ? CFG.TRUCK_W : CFG.CAR_W;
    this.color = this.kind === 'TRUCK'
      ? TRUCK_COLORS[this.id % TRUCK_COLORS.length]
      : CAR_COLORS[this.id % CAR_COLORS.length];
    this.vFactor = this.kind === 'TRUCK' ? 0.74 : (0.86 + rng() * 0.3);
    this.v0 = 130 * this.vFactor;
    this.v = 0;
    this.s = 0;
    this.lat = 0;
    this.manoeuvre = null;
    this.gapConstraints = null;
    this.mergeFailure = null;
    this.lastLaneChangeFrom = null;
    this.lastLaneChangeTo = null;
    this.lastLaneChangeDirection = 0;
    this.laneState = 'KEEP_LANE';
    this.waitReason = null;
    this.lastMotionDiagnostic = {
      limiter: 'No stop constraint', limiters: [], leader: null,
      desiredSpeed: 0, speedCaps: [], acceleration: 0, advance: 0,
    };
    this.stationarySeconds = 0;
    this.noProgressSeconds = 0;
    this.claimRenewalsWhileStopped = 0;
    this.hadClaimDuringStop = false;
    this.routeChanges = 0;
    this.lastReplanAt = W.time;
    this.missedTurns = 0;
    this.trackEnteredAt = W.time;
    this.track = null;
    this.route = [];
    this.ri = 0;
    this.goalLane = null;
    this.goalS = 0;
    this.phase = 'OUT';                 // OUT | ENTER | VISIT | BACK
    this.visitT = 0;
    this.enterT = 0;
    this.enterFromX = 0;
    this.enterFromY = 0;
    this.wantIdx = null;
    this.changeCd = rng() * CFG.CHANGE_CD;
    this.claim = null;
    this.claimT = 0;
    this.claimClearing = false;
    this.wait = 0;
    this.dead = false;
    this.needsReroute = false;
    this.tripStart = W.time;
    this.born = W.time;
    this.px = origin.x; this.py = origin.y; this.ang = 0;
    this.ppx = this.px; this.ppy = this.py; this.pang = 0;
  }

  get target() { return this.phase === 'BACK' ? this.origin : this.dest; }

  setRoute(tracks, goalLane, goalS) {
    const previousTrack = this.track;
    cancelManoeuvre(this);
    this.releaseClaim();
    this.lastLaneChangeFrom = this.lastLaneChangeTo = null;
    this.lastLaneChangeDirection = 0;
    this.route = tracks;
    this.ri = 0;
    this.track = tracks[0];
    this.goalLane = goalLane;
    this.goalS = goalS;
    this.computeWant();
    transferTrackOccupant(this, previousTrack, this.track);
  }

  computeWant() {
    const nt = this.route[this.ri + 1];
    if (nt && nt.kind === 'CONN') { this.wantIdx = nt.fromLane.idx; return; }
    if (this.track && this.goalLane && sameGroup(this.track, this.goalLane)) {
      this.wantIdx = this.goalLane.idx; return;
    }
    this.wantIdx = null;
  }

  releaseClaim() {
    if (!this.claim) return;
    const n = this.claim.node;
    const c = (n.occ.get(this.claim.id) || 1) - 1;
    if (c <= 0) n.occ.delete(this.claim.id); else n.occ.set(this.claim.id, c);
    this.claim = null; this.claimT = 0; this.claimClearing = false;
  }
  kill() {
    cancelManoeuvre(this); this.releaseClaim();
    removeTrackOccupant(this.track, this); this.dead = true;
  }

  recoverFromStrand(reason) {
    if (this.dead || !this.track) return false;
    const source = this.track;
    const target = this.target;
    const before = this.route.slice(this.ri);
    const routeKey = tracks => tracks.map(track => `${track.kind}:${track.id}`).join(',');
    const beforeKey = routeKey(before);
    const base = source.kind === 'LANE' ? source : source.toLane;
    const startS = source.kind === 'LANE' ? this.s : 0;
    const recoveryAttempted = !!(target?.lane && base);
    let candidate = recoveryAttempted
      ? routeBetween(base, startS, target.lane, target.s, false, this.len, true)
      : null;
    let accepted = null;
    if (candidate?.length) {
      const fullCandidate = source.kind === 'CONN' ? [source, ...candidate] : candidate;
      const candidateKey = routeKey(fullCandidate);
      const live = fullCandidate.every(track => track.kind === 'CONN'
        ? track.node.connectors.includes(track)
        : track.siblings.includes(track) && NET.edges.includes(track.edge));
      const cost = routeTravelTime(fullCandidate, startS, target.lane, target.s, this.len);
      if (live && candidateKey !== beforeKey && Number.isFinite(cost)) accepted = fullCandidate;
    }

    if (accepted) {
      const fromKey = beforeKey;
      const toKey = routeKey(accepted);
      if (source.kind === 'CONN' || this.claimClearing) {
        cancelManoeuvre(this);
        const previousTrack = this.track;
        this.route = accepted;
        this.ri = 0;
        this.track = accepted[0];
        this.goalLane = target.lane;
        this.goalS = target.s;
        this.computeWant();
        transferTrackOccupant(this, previousTrack, this.track);
      } else {
        this.setRoute(accepted, target.lane, target.s);
      }
      this.routeChanges++;
      this.lastReplanAt = W.time;
      trafficDiagnostics.recordRouteChange({vehicleId:this.id,from:fromKey,to:toKey,reason:'stranded-recovery'});
      trafficDiagnostics.recordVehicleRecovery({vehicleId:this.id,reason,phase:this.phase,
        simTime:W.time,destinationId:target?.id ?? null,
        fromTrackId:source.id,fromTrackLabel:diagnosticTrackLabel(source),fromS:this.s,
        routeBefore:fromKey,routeAfter:toKey});
      this.noProgressSeconds = 0;
      this.stationarySeconds = 0;
      this.wait = 0;
      this.waitReason = null;
      this.mergeFailure = null;
      this.gapConstraints = null;
      this.laneState = 'KEEP_LANE';
      return true;
    }

    trafficDiagnostics.recordTripFailure({vehicleId:this.id,destinationId:target?.id ?? null,
      simTime:W.time,phase:this.phase,reason,recoveryAttempted,trackId:source.id,
      trackLabel:diagnosticTrackLabel(source),s:this.s});
    this.kill();
    return false;
  }

  findLeader() {
    if (this.manoeuvre) {
      const m = this.manoeuvre, s = this.s * m.target.length / m.source.length;
      const lead = m.target.leaderAfter(s, this);
      const source = this.track.leaderAfter(this.s, this);
      const candidates = [];
      if (lead) candidates.push({ vehicle: lead.owner || lead, measuredTrack: m.target,
        gap: lead.s - s - (this.len + lead.len) / 2, dv: this.v - lead.v });
      if (source) candidates.push({ vehicle: source.owner || source, measuredTrack: this.track,
        gap: gapBetween(this, source), dv: this.v - source.v });
      if (candidates.length) return candidates.reduce((a,b)=>a.gap < b.gap ? a : b);
    }
    const lead = this.track.leaderAfter(this.s, this);
    if (lead) return { vehicle: lead.owner || lead, measuredTrack: this.track,
      gap: gapBetween(this, lead), dv: this.v - lead.v };
    let acc = this.track.length - this.s - this.len / 2;
    let i = this.ri + 1;
    while (acc < CFG.LOOKAHEAD && i < this.route.length) {
      const t = this.route[i];
      const f = t.firstVehicle();
      if (f) return { vehicle: f.owner || f, measuredTrack: t,
        gap: acc + f.s - f.len / 2, dv: this.v - f.v };
      acc += t.length; i++;
    }
    return null;
  }

  get toEnd() { return this.track.length - this.s; }
  get onGoalRoad() { return this.goalLane && this.track && this.track.kind === 'LANE' && sameGroup(this.track, this.goalLane); }

  reroute(strict) {
    if (this.manoeuvre) return;
    this.needsReroute = false;
    const tgt = this.target;
    if (!tgt || !tgt.lane) { this.kill(); return; }
    const previousTrack = this.track;
    const base = this.track.kind === 'LANE' ? this.track : this.track.toLane;
    const s = this.track.kind === 'LANE' ? this.s : 0;
    const r = routeBetween(base, s, tgt.lane, tgt.s, strict, this.len);
    if (r) {
      const tail=this.route.slice(this.ri+(this.track.kind==='CONN'?1:0));
      const signature=tracks=>tracks.map(t=>t.id).join(',');
      const changed=signature(tail)!==signature(r);
      const live=tail.every(t=>t.kind==='CONN'?t.node.connectors.includes(t):t.siblings.includes(t));
      this.lastReplanAt=W.time;
      if(!strict && live) {
        const oldCost=routeTravelTime(tail,s,tgt.lane,tgt.s,this.len),newCost=routeTravelTime(r,s,tgt.lane,tgt.s,this.len);
        if(!changed || (newCost>=oldCost*.85 || oldCost-newCost<1))return;
      }
      if(changed) {
        this.routeChanges++;
        this.noProgressSeconds = 0;
        this.lastLaneChangeFrom=this.lastLaneChangeTo=null;
        this.lastLaneChangeDirection=0;
        trafficDiagnostics.recordRouteChange({vehicleId:this.id,from:signature(tail),to:signature(r),reason:strict?'missed-turn':'travel-time'});
      }
      // Rerouting cannot relinquish a movement we are still driving through.
      if (this.track.kind !== 'CONN' && !this.claimClearing) this.releaseClaim();
      if (this.track.kind === 'CONN') { this.route = [this.track, ...r]; this.ri = 0; }
      else { this.route = r; this.ri = 0; this.track = r[0]; }
      this.goalLane = tgt.lane; this.goalS = tgt.s;
    } else if (strict) {
      // A strict replan can fail when this lane cannot reach the destination
      // without changing lanes first. Keep the current route and destination,
      // then retry without the strict constraint on the next step.
      this.needsReroute = true;
    }
    this.computeWant();
    transferTrackOccupant(this, previousTrack, this.track);
  }

  step(dt) {
    if (this.dead) return;
    if (this.phase === 'ENTER') {
      this.ppx = this.px; this.ppy = this.py;
      this.enterT = Math.max(0, this.enterT - dt);
      const progress = 1 - this.enterT / 0.4;
      this.px = lerp(this.enterFromX, this.target.x, progress);
      this.py = lerp(this.enterFromY, this.target.y, progress);
      if (this.enterT <= 0) {
        this.phase = 'VISIT';
        this.visitT = CFG.VISIT_TIME * (0.6 + rng());
      }
      return;
    }
    if (this.phase === 'VISIT') {
      this.visitT -= dt;
      if (this.visitT <= 0) this.depart();
      return;
    }
    if (!this.track) { this.kill(); return; }
    if (this.claimClearing && this.s >= this.len / 2) this.releaseClaim();
    if (this.needsReroute) this.reroute();
    if (!this.track) return;

    // Legacy offsets may exist after editing; new manoeuvres use path geometry.
    if (!this.manoeuvre && this.lat !== 0) {
      const step = (LW / CFG.CHANGE_TIME) * dt;
      this.latV = -Math.sign(this.lat) * Math.min(Math.abs(this.lat), step) / dt;
      this.lat -= Math.sign(this.lat) * Math.min(Math.abs(this.lat), step);
    } else this.latV = 0;

    const speedCaps = [];
    const applySpeedCap = (name, value, details = {}) => {
      if (Number.isFinite(value)) speedCaps.push({ name, value, ...details });
      vDes = Math.min(vDes, value);
    };
    let vDes = Math.min(this.v0, this.track.speedLimit);
    speedCaps.push({ name: 'vehicle-speed', value: this.v0 });
    speedCaps.push({ name: 'current-track', value: this.track.speedLimit, trackId: this.track.id });
    if (this.manoeuvre) applySpeedCap('lane-change', this.manoeuvre.distance / CFG.CHANGE_TIME);
    const nt = this.route[this.ri + 1];
    if(this.track.kind==='LANE' && !this.manoeuvre) {
      applySpeedCap('lane-preparation', lanePreparationSpeed(this,this.track,nt,this.s));
    }
    let entrySpeed=Infinity,entryDistance=Infinity;
    if(this.track.kind==='CONN') {
      entrySpeed=lanePreparationSpeed(this,this.track.toLane,this.route[this.ri+2]);
      entryDistance=this.toEnd;
    } else if(nt?.kind==='CONN') {
      entrySpeed=lanePreparationSpeed(this,nt.toLane,this.route[this.ri+3]);
      entryDistance=this.toEnd+nt.length;
    }
    if (Number.isFinite(entrySpeed)) speedCaps.push({ name: 'connector-entry-preparation', value: entrySpeed });
    const pocket = this.track.kind === 'LANE' && this.track.siblings.find(l=>l.idx===this.wantIdx && l.pocket);
    if (pocket && !this.manoeuvre) {
      const usable = pocket.length - pocket.startS - this.len - CFG.STOPLINE - CFG.IDM_S0 - 5;
      const mergeSpeed = Math.max(4, usable / CFG.CHANGE_TIME * .85);
      const toMouth = Math.max(0, pocket.startS + this.len / 2 + 3 - this.s - CFG.IDM_S0);
      applySpeedCap('pocket-approach', Math.sqrt(mergeSpeed ** 2 + 2 * CFG.IDM_B * toMouth),
        { pocketTrackId: pocket.id });
    }
    const hasClearance = nt && !this.manoeuvre && this.track === nt.fromLane && this.lat === 0 &&
      this.claim === nt && nt.node.occ.get(nt.id) > 0 &&
      nt.node.connectors.includes(nt);
    if (nt && isFinite(nt.speedLimit)) {
      applySpeedCap('next-connector', Math.sqrt(nt.speedLimit ** 2 + 2 * CFG.IDM_B * Math.max(this.toEnd, 0)),
        { connectorId: nt.id, targetSpeed: nt.speedLimit });
    }

    const speedTargetAcceleration = idmAccel(this.v, vDes, Infinity, 0);
    let a = speedTargetAcceleration;
    const accelerationLimits = [];
    const constrainAcceleration = (name, value, details = {}) => {
      accelerationLimits.push({ name, kind: 'acceleration', value, ...details });
      a = Math.min(a, value);
    };
    if(Number.isFinite(entrySpeed) && this.v>entrySpeed) {
      constrainAcceleration('connector-entry-speed',
        (entrySpeed*entrySpeed-this.v*this.v)/(2*Math.max(entryDistance,.5)),
        { targetSpeed: entrySpeed, distance: entryDistance });
    }
    const lead = this.findLeader();
    if (lead) constrainAcceleration('leader-following', idmAccel(this.v, vDes, lead.gap, lead.dv),
      { gap: lead.gap, leaderId: lead.vehicle.id, measuredTrackId: lead.measuredTrack?.id });
    const regionStop=this.track.kind==='CONN' && Number.isFinite(this.junctionStopS)
      ? Math.max(this.s,this.junctionStopS) : Infinity;
    if(Number.isFinite(regionStop))constrainAcceleration('junction-region',
      idmAccel(this.v,vDes,regionStop-this.s+CFG.IDM_S0,this.v), { stopAt: regionStop, gap: regionStop-this.s });
    const mergeStop=laneMergeStopS(this);
    if(Number.isFinite(mergeStop))constrainAcceleration('lane-merge-hold',
      idmAccel(this.v,vDes,mergeStop-this.s+CFG.IDM_S0,this.v), { stopAt: mergeStop, gap: mergeStop-this.s });
    if (this.yieldUntil > W.time && !this.manoeuvre) constrainAcceleration('yield', -CFG.IDM_B * .18,
      { until: this.yieldUntil });

    // junction stop line — held until the arbiter grants a reservation
    if (nt && nt.kind === 'CONN' && !hasClearance) {
      const stopAt = this.track.length - this.len / 2 - CFG.STOPLINE;
      constrainAcceleration('unclaimed-stop-line',
        idmAccel(this.v, vDes, this.toEnd - this.len / 2 - CFG.STOPLINE, this.v),
        { stopAt, gap: stopAt - this.s, connectorId: nt.id });
    }

    // kerbside stop at the destination
    if (this.ri === this.route.length - 1) {
      // A lot close to the junction must not park the vehicle's rear in it.
      if (this.onGoalRoad && this.claimClearing) this.goalS = Math.max(this.goalS, this.len / 2 + 1.5);
      const stopAt = this.onGoalRoad ? Math.min(this.goalS, this.track.length) : this.track.length;
      constrainAcceleration('destination-stop', idmAccel(this.v, vDes, stopAt - this.s + CFG.IDM_S0, this.v),
        { stopAt, gap: stopAt - this.s });
      if (this.s >= stopAt - 1.5) { this.arrive(); return; }
    }

    const rawAcceleration = a;
    a = clamp(a, -CFG.IDM_B * 1.7, CFG.IDM_A);
    const motionStartS = this.s;
    const desiredAdvance = Math.max(0, this.v + a * dt) * dt;
    const advanceLimits = [];
    this.v = Math.max(0, this.v + a * dt);
    const advance = Math.min(lead ? Math.min(this.v * dt, Math.max(0, lead.gap - 1)) : this.v * dt,
      Math.max(0,Math.min(regionStop,mergeStop)-this.s));
    if (advance < this.v * dt) this.v = Math.max(0, advance / dt);
    this.s += advance;
    if (this.manoeuvre) updateManoeuvre(this);
    // Braking alone cannot prevent a fast car overshooting the stop line.
    if (nt && nt.kind === 'CONN' && !hasClearance) {
      const stopAt = Math.max(0, this.track.length - this.len / 2 - CFG.STOPLINE);
      if (this.s > stopAt) {
        this.s = stopAt; this.v = 0;
        advanceLimits.push({ name: 'unclaimed-stop-line', kind: 'advance',
          value: Math.max(0, stopAt - motionStartS), stopAt, connectorId: nt.id });
      }
    }
    const actualAdvance = this.s - motionStartS;
    if (actualAdvance < desiredAdvance - 1e-6) {
      const distanceLimits = [
        lead ? { name: 'leader-gap', value: Math.max(0, lead.gap - 1), gap: lead.gap,
          leaderId: lead.vehicle.id, measuredTrackId: lead.measuredTrack?.id } : null,
        Number.isFinite(regionStop) ? { name: 'junction-region', value: Math.max(0, regionStop - motionStartS),
          stopAt: regionStop } : null,
        Number.isFinite(mergeStop) ? { name: 'lane-merge-hold', value: Math.max(0, mergeStop - motionStartS),
          stopAt: mergeStop } : null,
      ].filter(Boolean);
      for (const candidate of distanceLimits) {
        if (Math.abs(candidate.value - actualAdvance) <= 1e-6) {
          advanceLimits.push({ ...candidate, kind: 'advance' });
        }
      }
    }
    const activeAccelerationLimits = accelerationLimits.filter(limit =>
      Math.abs(limit.value - rawAcceleration) <= 1e-6 && limit.value < speedTargetAcceleration - 1e-6);
    if (speedTargetAcceleration < -1e-6 && Math.abs(speedTargetAcceleration - rawAcceleration) <= 1e-6) {
      activeAccelerationLimits.push({ name: 'speed-target', kind: 'acceleration',
        value: speedTargetAcceleration, targetSpeed: vDes });
    }
    if (Math.abs(a - rawAcceleration) > 1e-6) {
      activeAccelerationLimits.push({ name: 'acceleration-clamp', kind: 'acceleration', value: a });
    }
    const limiters = [...activeAccelerationLimits, ...advanceLimits];
    const leaderVehicle = lead?.vehicle;
    this.lastMotionDiagnostic = {
      limiter: limiters.length ? [...new Set(limiters.map(limit => limit.name))].join(', ') : 'No stop constraint',
      limiters,
      leader: leaderVehicle ? {
        id: leaderVehicle.id,
        vehicleTrackId: leaderVehicle.track?.id ?? null,
        measuredTrackId: lead.measuredTrack?.id ?? null,
        vehicleTrackLabel: diagnosticTrackLabel(leaderVehicle.track),
        measuredTrackLabel: diagnosticTrackLabel(lead.measuredTrack),
        speed: leaderVehicle.v,
        gap: lead.gap,
      } : null,
      desiredSpeed: vDes,
      speedCaps: speedCaps.map(cap => ({ ...cap })),
      acceleration: a,
      advance: actualAdvance,
    };
    this.wait = this.v < 6 ? this.wait + dt : 0;

    // A missed-turn replan must trigger at the safe lane-change hold point.
    // laneMergeStopS deliberately stops short of the junction stop line, so a
    // stop-line-only check can never recover a car waiting there for a gap.
    const mergeHoldReached = Number.isFinite(mergeStop) && this.s >= mergeStop - 0.5;
    const stopLineReached = this.toEnd <= this.len / 2 + CFG.STOPLINE + CFG.IDM_S0;
    if (this.wait > 3.5 && nt && nt.kind === 'CONN' && this.track !== nt.fromLane &&
        this.lat === 0 && (mergeHoldReached || stopLineReached)) {
      this.reroute(true);
      this.wait = 0;
      if (!this.track) return;
    }
    if (this.claim) {
      this.claimT += dt;
      // never let a stalled reservation lock a junction forever
      if (this.claimT > 7 && !this.claimClearing && this.track.kind === 'LANE' && this.v < 3) this.releaseClaim();
    }

    let guard = 4;
    while (this.s >= this.track.length && guard-- > 0) {
      if (this.ri >= this.route.length - 1) { this.arrive(); return; }
      const next = this.route[this.ri + 1];
      if (next.kind === 'CONN' && (this.manoeuvre || this.claim !== next || this.track !== next.fromLane || this.lat !== 0 ||
          !next.node.occ.get(next.id) || !next.node.connectors.includes(next))) {
        this.s = Math.max(0, this.track.length - this.len / 2 - CFG.STOPLINE);
        this.v = 0;
        break;
      }
      const over = this.s - this.track.length;
      const leaving = this.track;
      const elapsed = Math.max(dt, W.time - this.trackEnteredAt);
      // Ignore partial tracks (spawn and lane changes) when observing travel time.
      if (this.enteredAtStart) leaving.observedTravelTime = leaving.observedTravelTime === undefined
        ? elapsed : lerp(leaving.observedTravelTime, elapsed, .15);
      this.trackEnteredAt = W.time; this.enteredAtStart = true;
      this.ri++;
      this.track = this.route[this.ri];
      this.s = Math.min(over, this.track.length);
      transferTrackOccupant(this, leaving, this.track);
      this.lat = 0;
      if (leaving.kind === 'CONN') this.claimClearing = !!this.claim;
      this.computeWant();
      // Replan at deliberate decision points, not randomly on each road.
      if(this.track.kind==='LANE' && W.time-this.lastReplanAt>=5)this.needsReroute=true;
    }
    if (this.claimClearing && this.s >= this.len / 2) this.releaseClaim();
    if (actualAdvance > 1e-4) this.noProgressSeconds = 0;
    else this.noProgressSeconds += dt;
    if (this.v < 0.5) this.stationarySeconds += dt;
    else {
      this.stationarySeconds = 0;
      this.claimRenewalsWhileStopped = 0;
      this.hadClaimDuringStop = false;
    }
    if (this.track && this.phase !== 'ENTER' && this.phase !== 'VISIT') {
      if (this.waitReason === 'merge-gap' && this.noProgressSeconds >= MERGE_GAP_RECOVERY_SECONDS) {
        this.recoverFromStrand('merge-gap-timeout');
        return;
      }
      if (this.noProgressSeconds >= ROAD_NO_PROGRESS_RECOVERY_SECONDS) {
        this.recoverFromStrand('no-progress-timeout');
        return;
      }
    }
    if (this.track) this.track.vehicles.sort((a, b) => a.s - b.s);
    if (this.manoeuvre) this.manoeuvre.target.vehicles.sort((a, b) => a.s - b.s);
  }

  arrive() {
    if (this.manoeuvre) return;
    this.releaseClaim();
    this.v = 0;
    this.stationarySeconds = 0;
    this.claimRenewalsWhileStopped = 0;
    this.hadClaimDuringStop = false;
    const tgt = this.target;
    const good = tgt && this.onGoalRoad;
    if (!good) { removeTrackOccupant(this.track, this); this.dead = true; return; }
    // Release the destination lane immediately, then animate into the building.
    const p = this.track.pos(clamp(this.goalS, 0, this.track.length));
    this.enterFromX = this.px = p.x;
    this.enterFromY = this.py = p.y;
    this.enterT = 0.4;
    CITY.tripDone(this, W.time - this.tripStart);
    removeTrackOccupant(this.track, this);
    if (this.phase === 'OUT') {
      this.phase = 'ENTER';
      this.track = null;
    } else {
      this.dead = true;
    }
  }

  depart() {
    const o = this.origin;
    if (!o.lane || !this.dest.lane) { this.dead = true; return; }
    const lane = this.dest.lane;
    const s = this.dest.s;
    // Stay inside until the curb slot is clear; inserting into an occupied lane
    // makes the returning car wait on the road and can block following traffic.
    const blocked = lane.vehicles.some(c => c !== this && c.owner !== this && !c.dead &&
      Math.abs(c.s - s) < (this.len + c.len) / 2 + CFG.IDM_S0);
    if (blocked) return;
    const r = routeBetween(lane, s, o.lane, o.s, false, this.len);
    if (!r) { this.dead = true; return; }
    const p = lane.pos(s);
    this.px = this.ppx = p.x;
    this.py = this.ppy = p.y;
    this.phase = 'BACK';
    this.tripStart = W.time;
    this.setRoute(r, o.lane, o.s);
    this.v = 0; this.lat = 0;
    this.stationarySeconds = 0;
    this.noProgressSeconds = 0;
    this.claimRenewalsWhileStopped = 0;
    this.hadClaimDuringStop = false;
  }

  pose() {
    if (this.phase === 'ENTER') return;
    this.ppx = this.px; this.ppy = this.py; this.pang = this.ang;
    if (!this.track) return;
    if (this.manoeuvre) {
      const p = manoeuvrePoint(this, this.s), q = manoeuvrePoint(this, this.s + .05);
      this.px = p.x; this.py = p.y;
      this.ang = Math.atan2(q.y-p.y, q.x-p.x);
      return;
    }
    const p = this.track.pos(this.s);
    const d = this.track.dir(this.s);
    const n = V.rn(d);
    this.px = p.x + n.x * this.lat;
    this.py = p.y + n.y * this.lat;
    const drift = this.v > 8 ? Math.atan2(-this.latV || 0, this.v) * 0.6 : 0;
    const na = Math.atan2(d.y, d.x) + drift;
    this.ang = na;
    if (Math.abs(angDiff(this.pang, na)) > Math.PI * 0.9) this.pang = na;
  }
}

/* ────────────────────  MOBIL lane changing  ──────────────────── */

function laneAccelFor(veh, lane, gap, dv) {
  return idmAccel(veh.v, Math.min(veh.v0, lane.speedLimit), gap, dv);
}

function considerLaneChange(car, dt) {
  car.changeCd -= dt;
  if (car.manoeuvre) return;
  if (car.claimClearing) return;
  if (!car.track || car.track.kind !== 'LANE') return;
  car.mergeFailure = null;
  car.gapConstraints = null;
  const lane = car.track;
  const sibs = lane.siblings;
  if (!sibs || sibs.length < 2) return;

  const want = car.wantIdx;
  const mandatory = want !== null && want !== lane.idx;
  const next = car.route[car.ri + 1];
  // Reserve enough approach distance for every adjacent merge and braking.
  // Once sorted, stay in the route's lane instead of passing its queue and
  // trying to merge back at the lights.
  const speed = Math.max(car.v, Math.min(car.v0, lane.speedLimit));
  const steps = want === null ? 1 : Math.max(1, Math.abs(
    sibs.slice().sort((a,b)=>(a.order ?? a.idx)-(b.order ?? b.idx)).indexOf(lane) -
    sibs.slice().sort((a,b)=>(a.order ?? a.idx)-(b.order ?? b.idx)).findIndex(l=>l.idx===want)));
  const sortDistance = speed * (CFG.CHANGE_TIME * steps + .4) + car.len + CFG.IDM_S0;
  const preSorting = next && next.kind === 'CONN' && car.toEnd <= sortDistance;
  if (preSorting && !mandatory) return;
  const urgency = mandatory ? clamp(1 - car.toEnd / 300, 0, 1) : 0;
  if (car.changeCd > 0 && !mandatory) return;
  if (Math.abs(car.lat) > 1.5) return;

  const dirToward = mandatory ? Math.sign(want - lane.idx) : 0;
  const cands = [];
  const ordered = sibs.slice().sort((a,b)=>(a.order ?? a.idx)-(b.order ?? b.idx));
  const index = ordered.indexOf(lane);
  if (index + 1 < ordered.length) cands.push(ordered[index + 1]);
  if (index > 0) cands.push(ordered[index - 1]);
  const target = sibs.find(l => l.idx === want);
  const towardOrder = target ? Math.sign((target.order ?? target.idx)-(lane.order ?? lane.idx)) : dirToward;

  const infeasibility = requiredLaneChangeFailure(car);
  if (infeasibility) {
    car.laneState = 'ABORT_OR_REPLAN';
    car.waitReason = infeasibility;
    if (next?.kind === 'CONN' && car.lastMissedConnector !== next) {
      car.missedTurns++; car.lastMissedConnector = next;
    }
    car.recoverFromStrand(infeasibility);
    return;
  }

  const reversesRecentMerge = mandatory && target &&
    car.lastLaneChangeTo === lane.id && car.lastLaneChangeDirection &&
    towardOrder === -car.lastLaneChangeDirection;
  const finalApproach = car.onGoalRoad && car.goalS - car.s <= sortDistance;
  if (reversesRecentMerge && !preSorting && urgency <= 0.3 && !finalApproach) {
    car.laneState = 'PREPARE';
    car.waitReason = 'route-commitment';
    car.mergeFailure = 'route-commitment';
    return;
  }

  car.laneState = mandatory ? 'PREPARE' : 'KEEP_LANE';
  if (mandatory && car.toEnd < Math.max(18, LW * 1.5) + car.len / 2 + CFG.STOPLINE && !car.onGoalRoad) {
    car.laneState = 'ABORT_OR_REPLAN';
    car.waitReason = 'unreachable-lane';
    if(car.lastMissedConnector!==next) {car.missedTurns++;car.lastMissedConnector=next;}
    car.reroute(true);
    return;
  }
  let best = null, bestScore = CFG.MOBIL_TH;
  for (const T of cands) {
    if (T.pocket && (T.idx !== want || car.s * T.length / lane.length < T.startS + car.len / 2 + 3)) {
      car.mergeFailure = 'pocket-distance';
      continue;
    }
    const moving = Math.sign((T.order ?? T.idx) - (lane.order ?? lane.idx));
    if (mandatory && (preSorting || urgency > 0.3) && moving !== towardOrder) continue;
    const sc = mobilScore(car, lane, T, mandatory && moving === towardOrder, urgency);
    // A necessary merge may join slower traffic. Gap and follower safety in
    // mobilScore still apply, but acceleration gain must not postpone it.
    if (mandatory && moving === towardOrder && sc !== null) { best = T; break; }
    if (sc !== null && sc > bestScore) { bestScore = sc; best = T; }
  }
  if (best) {
    const changed = executeChange(car, best);
    if (!changed && car.mergeFailure === 'insufficient-distance') {
      car.waitReason = 'unreachable-lane';
      car.recoverFromStrand('lane-change-infeasible');
    }
  }
  else if (mandatory) {
    car.laneState = 'YIELD_FOR_GAP'; car.waitReason = 'merge-gap';
    const T = cands.find(l=>Math.sign((l.order??l.idx)-(lane.order??lane.idx))===towardOrder);
    if (T) {
      const s = car.s * T.length / lane.length, follower = T.followerBefore(s, car);
      // Bounded, local request: braking and safe-gap tests still govern entry.
      if (follower && !follower.owner && s-follower.s < 120 && s-follower.s > car.len) {
        follower.yieldUntil = W.time + .5;
      }
    }
  }
}

function mobilScore(car, lane, T, toward, urgency) {
  const ratio = T.length / lane.length;
  const sT = clamp(car.s * ratio, 0, T.length);
  const probe = { s: sT, len: car.len, v: car.v, v0: car.v0 };

  const newLead = T.leaderAfter(sT, null);
  const newFoll = T.followerBefore(sT, null);
  const gapL = newLead ? gapBetween(probe, newLead) : Infinity;
  const gapF = newFoll ? gapBetween(newFoll, probe) : Infinity;
  car.gapConstraints = {front: gapL, rear: gapF, targetLane: T.id};
  car.mergeFailure = null;
  const reject = reason => { car.mergeFailure = reason; return null; };
  const closure = dv => {
    const t=Math.min(CFG.CHANGE_TIME,Math.max(0,dv)/CFG.IDM_B);
    return Math.max(0,dv)*t-CFG.IDM_B*t*t/2;
  };
  if (newLead && gapL-closure(car.v-newLead.v)<CFG.IDM_S0) return reject('front-gap');
  if (newFoll && gapF-closure(newFoll.v-car.v)<CFG.IDM_S0) return reject('rear-gap');
  const room = toward ? 0.5 : 2.5;
  if (gapL < room) return reject('front-gap');
  if (gapF < room) return reject('rear-gap');
  // A mandatory merge can accept slower traffic, but must leave enough
  // distance to brake if that leader also stops. Incentive is not safety.
  if (toward && newLead) {
    const brakingRoom = CFG.IDM_S0 + Math.max(0,
      (car.v * car.v - newLead.v * newLead.v) / (2 * CFG.IDM_B));
    if (gapL < brakingRoom) return reject('front-braking-room');
  }

  const aNew = laneAccelFor(car, T, gapL, newLead ? car.v - newLead.v : 0);
  if (newFoll) {
    const aFollAfter = laneAccelFor(newFoll, T, gapF, newFoll.v - car.v);
    if (aFollAfter < -CFG.MOBIL_BSAFE) return reject('rear-safe-braking');
  }

  const curLead = lane.leaderAfter(car.s, car);
  const gapC = curLead ? gapBetween(car, curLead) : Infinity;
  const aCur = laneAccelFor(car, lane, gapC, curLead ? car.v - curLead.v : 0);

  let score = aNew - aCur;

  const oldFoll = lane.followerBefore(car.s, car);
  if (oldFoll) {
    const before = laneAccelFor(oldFoll, lane, gapBetween(oldFoll, car), oldFoll.v - car.v);
    const after = curLead
      ? laneAccelFor(oldFoll, lane, gapBetween(oldFoll, curLead), oldFoll.v - curLead.v)
      : laneAccelFor(oldFoll, lane, Infinity, 0);
    score += CFG.MOBIL_P * (after - before);
  }
  if (newFoll) {
    const before = newLead
      ? laneAccelFor(newFoll, T, gapBetween(newFoll, newLead), newFoll.v - newLead.v)
      : laneAccelFor(newFoll, T, Infinity, 0);
    const after = laneAccelFor(newFoll, T, gapF, newFoll.v - car.v);
    score += CFG.MOBIL_P * (after - before);
  }

  score += T.idx < lane.idx ? CFG.KEEP_RIGHT : -CFG.KEEP_RIGHT;
  if (toward) score += 45 + urgency * 320;
  return score;
}

function executeChange(car, T) {
  const old = car.track;
  car.mergeFailure = null;
  if (car.manoeuvre || !old || old.kind !== 'LANE' || !sameGroup(old,T)) {
    car.mergeFailure = 'invalid-lane-change'; return false;
  }
  const ordered = old.siblings.slice().sort((a,b)=>(a.order??a.idx)-(b.order??b.idx));
  if (Math.abs(ordered.indexOf(old)-ordered.indexOf(T)) !== 1) {
    car.mergeFailure = 'nonadjacent-lane'; return false;
  }
  const sT = clamp(car.s * (T.length / old.length), 0, T.length);
  if (T.pocket && sT < T.startS + car.len/2 + 3) {
    car.gapConstraints = {front: null, rear: null, targetLane: T.id};
    car.mergeFailure = 'pocket-distance'; return false;
  }
  const {available,minimum:minDistance} = laneChangeDistanceBudget(car, old, T);
  if (available < minDistance) {
    car.gapConstraints = {front: null, rear: null, targetLane: T.id};
    car.mergeFailure = 'insufficient-distance'; return false;
  }
  if (mobilScore(car,old,T,true,0) === null) return false;
  const distance = Math.min(available, Math.max(minDistance, car.v * CFG.CHANGE_TIME));
  // The first frame must already respect the trajectory's speed/curvature
  // budget. A cap applied after starting cannot undo an unsafe high-speed merge.
  const lateralDistance=V.dist(old.pos(car.s),T.pos(sT));
  const minDuration=Math.max(CFG.CHANGE_TIME,Math.sqrt(6*lateralDistance/CFG.A_LAT));
  if(car.v>distance/minDuration+.01) { car.mergeFailure = 'lateral-budget'; return false; }
  car.releaseClaim();
  const ghost = { owner: car,
    get s() { return car.s * T.length / old.length; },
    get len() { return car.len; }, get wide() { return car.wide; },
    get v() { return car.v; }, get v0() { return car.v0; },
    get dead() { return car.dead; }
  };
  car.manoeuvre = {source:old,target:T,startS:car.s,distance,duration:minDuration,progress:0,ghost};
  car.manoeuvre.startedAt=W.time;
  car.manoeuvre.startDistance=car.toEnd;
  car.laneState = 'CHANGING'; car.waitReason = null;
  car.mergeFailure = null;
  T.vehicles.push(ghost); T.vehicles.sort((a,b)=>a.s-b.s);
  W.laneChanges++;
  return true;
}

function manoeuvrePoint(car, s) {
  const m = car.manoeuvre, u = clamp((s-m.startS)/m.distance,0,1);
  const e = u*u*u*(10+u*(-15+6*u));
  const a=m.source.pos(s), b=m.target.pos(s*m.target.length/m.source.length);
  return {x:lerp(a.x,b.x,e),y:lerp(a.y,b.y,e)};
}

function cancelManoeuvre(car) {
  const m = car.manoeuvre;
  if (!m) return;
  const i=m.target.vehicles.indexOf(m.ghost);
  if (i>=0) m.target.vehicles.splice(i,1);
  if(m.progress<1)trafficDiagnostics.recordLaneChange({vehicleId:car.id,from:m.source.id,to:m.target.id,
    duration:W.time-m.startedAt,success:false,reason:'network-edit-or-removal'});
  car.manoeuvre=null; car.laneState='KEEP_LANE'; car.lat=0;
}

function updateManoeuvre(car) {
  const m=car.manoeuvre;
  m.progress=clamp((car.s-m.startS)/m.distance,0,1);
  car.laneState=m.progress>.9?'SETTLING':'CHANGING';
  if (m.progress<1) return;
  const i=m.source.vehicles.indexOf(car);
  if(i>=0)m.source.vehicles.splice(i,1);
  car.lastLaneChangeFrom=m.source.id;car.lastLaneChangeTo=m.target.id;
  car.lastLaneChangeDirection=Math.sign((m.target.order??m.target.idx)-(m.source.order??m.source.idx));
  car.s*=m.target.length/m.source.length;
  car.track=m.target;car.route[car.ri]=m.target;
  car.enteredAtStart=false;
  trafficDiagnostics.recordLaneChange({vehicleId:car.id,from:m.source.id,to:m.target.id,
    duration:W.time-m.startedAt,success:true});
  cancelManoeuvre(car);
  car.track.vehicles.push(car);car.track.vehicles.sort((a,b)=>a.s-b.s);
  car.changeCd=CFG.CHANGE_CD;car.computeWant();
}

/* ──────────────────  §6  JUNCTION ARBITRATION  ──────────────────
   Signals say *when* an approach may move. The reservation system decides
   whether the manoeuvre is actually safe: no conflicting connector may be
   claimed, priority traffic must not be bearing down on it, and there has to
   be somewhere to go on the far side. That last rule is what makes gridlock
   structurally impossible — cars never enter a box they cannot clear.       */

function updateSignals(dt) {
  for (const n of NET.nodes) {
    if (n.control !== 'SIGNAL') continue;
    const sg = n.signal;
    if (!sg || sg.phases < 2) continue;
    const demand = new Set();
    const laneHeads = new Map();
    for (const car of W.cars) {
      if (car.dead || car.phase === 'VISIT' || car.claim || car.manoeuvre ||
          !car.track || car.track.kind !== 'LANE' || car.lat !== 0) continue;
      const conn = car.route[car.ri + 1];
      if (!conn || conn.kind !== 'CONN' || conn.node !== n || conn.fromLane !== car.track ||
          !n.connectors.includes(conn)) continue;
      const previous = laneHeads.get(car.track);
      if (!previous || car.s > previous.s) laneHeads.set(car.track, car);
    }
    for (const [lane, car] of laneHeads) {
      const conn = car.route[car.ri + 1];
      const distance = car.toEnd;
      const stoppingRange = Math.max(
        CFG.STOPLINE + car.len + CFG.IDM_S0,
        (car.v * car.v) / (2 * CFG.IDM_B) + car.len / 2 + CFG.STOPLINE + CFG.IDM_S0
      );
      const comfortableGap = CFG.IDM_S0 + car.v * CFG.IDM_T +
        (car.v * car.v) / (2 * Math.sqrt(CFG.IDM_A * CFG.IDM_B));
      const approachRange = car.len / 2 + CFG.STOPLINE + 2 * comfortableGap;
      if (distance > Math.max(stoppingRange, approachRange)) continue;
      const phase = sg.movementGroup && sg.movementGroup.get(conn.id);
      const legacyPhase = sg.group && sg.group.get(lane.id);
      if (phase !== undefined) demand.add(phase);
      else if (legacyPhase !== undefined) demand.add(legacyPhase);
    }
    sg.timer += dt;
    if (sg.amber) {
      if (sg.timer >= CFG.AMBER_TIME) {
        let next = sg.idx;
        for (let offset = 1; offset < sg.phases; offset++) {
          const candidate = (sg.idx + offset) % sg.phases;
          if (demand.has(candidate)) { next = candidate; break; }
        }
        sg.amber = false;
        sg.timer = 0;
        sg.idx = next;
      }
      continue;
    }
    const otherDemand = [...demand].some(phase => phase !== sg.idx);
    const noCurrentDemand = !demand.has(sg.idx);
    const minGreen = 1.2;
    if (otherDemand && ((noCurrentDemand && sg.timer >= minGreen) || sg.timer >= CFG.GREEN_TIME)) {
      sg.amber = true;
      sg.timer = 0;
    }
  }
}

function signalAllows(node, conn) {
  const sg = node.signal;
  if (!sg || sg.phases < 2) return true;
  const movement = sg.movementGroup && sg.movementGroup.get(conn.id);
  if (movement !== undefined) return movement === sg.idx && !sg.amber;
  const g = sg.group.get(conn.fromLane.id);
  if (g === undefined) return true;
  return g === sg.idx && !sg.amber;
}

function movementPriority(conn) {
  if (conn.node.isRing && conn.fromLane.edge.type === 'RING') return Number.MAX_SAFE_INTEGER;
  if (conn.node.control === 'PRIORITY') {
    return conn.node.priorityEdges.has(conn.fromLane.edge.id) ? 2 : 1;
  }
  return conn.priority;
}

function arbitrate(cars) {
  const byNode = new Map();
  // Road edits replace connector geometry. Let cars finish the retired paths
  // before admitting traffic against the new, incompatible conflict map.
  const draining = new Set();
  const retired = new Set();
  for (const c of cars) {
    if (c.dead) continue;
    const occupied = c.claim || (c.track && c.track.kind === 'CONN' ? c.track : null);
    if (c.claim && !c.claimClearing && c.track && c.track.kind === 'LANE' &&
        !occupied.node.connectors.includes(occupied)) {
      c.releaseClaim();
      c.needsReroute = true;
      continue;
    }
    if (occupied && !NET.nodes.includes(occupied.node)) retired.add(occupied);
    else if (occupied && !occupied.node.connectors.includes(occupied)) draining.add(occupied.node);
  }
  const retiredGeometry = [...retired].map(connectorPathGeometry);
  const locallyDraining = new Set();
  // A removed hub can be replaced by several nodes; hold only movements whose
  // paths overlap the retired connector until its vehicle releases the claim.
  if (retiredGeometry.length) for (const node of NET.nodes) for (const conn of node.connectors) {
    const geometry = connectorPathGeometry(conn);
    if (retiredGeometry.some(old => connectorPathsConflict(old, geometry))) locallyDraining.add(conn);
  }
  const timeToDistance = (distance, car, conn, slow = false) => {
    if (distance <= 0) return 0;
    const cap = Math.max(car.v || 0, Math.min(car.v0 || conn.speedLimit, conn.speedLimit || car.v0 || 1));
    const speed = clamp(car.v || 0, 0, cap);
    if (slow) return distance / Math.max(6, Math.min(cap, speed || 6));
    const accel = Math.max(CFG.IDM_A, 1);
    const accelDistance = Math.max(0, (cap * cap - speed * speed) / (2 * accel));
    if (distance <= accelDistance) return (Math.sqrt(speed * speed + 2 * accel * distance) - speed) / accel;
    return (cap - speed) / accel + (distance - accelDistance) / Math.max(cap, 1);
  };
  const movementPosition = (car, conn) => {
    if (car.track === conn) return car.s;
    if (car.track === conn.fromLane) return -(conn.fromLane.length - car.s);
    if (car.track === conn.toLane && car.claimClearing) return conn.length + car.s;
    return null;
  };
  const reservationWindows = (car, conn, otherCar = null, onlyOther = null) => {
    const position = movementPosition(car, conn);
    if (position === null) return [];
    const windows = [];
    const buffer = 0.3 + Math.min(0.2, car.len / 120);
    for (const other of conn.conflicts) {
      if (onlyOther && other !== onlyOther) continue;
      const profile = !otherCar || car.kind === 'TRUCK' || otherCar.kind === 'TRUCK' ? 'TRUCK' : 'CAR';
      const pairZones = conn.conflictZonesByVehiclePair && conn.conflictZonesByVehiclePair.get(other);
      if (pairZones && Object.prototype.hasOwnProperty.call(pairZones, profile) && !pairZones[profile].length) continue;
      const zones = pairZones && pairZones[profile] ? pairZones[profile] : conn.conflictZones.get(other);
      const paired = zones && zones.length ? zones : [{
        start: 0, end: conn.length, otherStart: 0, otherEnd: other.length, zoneId: 0,
      }];
      for (let index = 0; index < paired.length; index++) {
        const zone = paired[index];
        // Zone intervals are center-position ranges computed from full vehicle
        // footprints, so rear clearance is already represented geometrically.
        if (position >= zone.end) continue;
        const occupiedNow = position >= zone.start && position <= zone.end;
        if (occupiedNow) {
          // A vehicle already inside a region keeps it until its physical rear
          // clears. Do not predict it out of a conflict while it may be stopped.
          windows.push({ otherId: other.id, zoneId: zone.zoneId ?? index,
            start: 0, end: Infinity, occupiedNow: true, leadTime: 0,
            regionStart: zone.start, regionEnd: zone.end });
          continue;
        }
        const enterDistance = Math.max(0, zone.start - position);
        const exitDistance = Math.max(enterDistance, zone.end - position);
        const earliestEnter = timeToDistance(enterDistance, car, conn);
        const latestExit = timeToDistance(exitDistance, car, conn, true);
        windows.push({
          otherId: other.id, zoneId: zone.zoneId ?? index,
          start: Math.max(0, earliestEnter - buffer), end: latestExit + buffer,
          occupiedNow: false, leadTime: earliestEnter,
          regionStart: zone.start, regionEnd: zone.end,
        });
      }
    }
    return windows;
  };
  const publishReservation = (car, windows) => {
    car.reservationWindows = windows.map(w => ({
      connectorId: w.otherId, zoneId: w.zoneId, start: w.start, end: w.end,
    }));
    car.reservationLeadTime = windows.length ? Math.min(...windows.map(w => w.leadTime)) : null;
  };
  const windowsOverlap = (car, conn, otherCar, other) => {
    const windows = reservationWindows(car, conn, otherCar, other);
    const otherWindows = reservationWindows(otherCar, other, car, conn);
    const a = windows.filter(w => w.otherId === other.id);
    const b = otherWindows.filter(w => w.otherId === conn.id);
    for (const x of a) for (const y of b) {
      if (x.zoneId === y.zoneId && x.start <= y.end && y.start <= x.end) return true;
    }
    return false;
  };

  for (const c of cars) if (!c.dead) {
    c.waitReason = null;
    c.reservationLeadTime = null;
    c.reservationWindows = [];
    c.junctionStopS = null;
  }

  // A forecast grants a provisional slot while a car is still on its lane.
  // Re-evaluate those slots each tick: a lead vehicle can brake after the
  // forecast was made, invalidating a later car's previously safe window.
  // Once a car has entered its connector (or is clearing it), its claim is
  // physical occupancy and must never be revoked by this prediction pass.
  const claimed = [];
  for (const car of cars) {
    if (car.dead) continue;
    const conn = car.claim || (car.track && car.track.kind === 'CONN' ? car.track : null);
    if (!conn) continue;
    claimed.push({ car, conn, entered: car.track === conn || !!car.claimClearing });
  }
  const hasClaim = reservation => reservation.car.claim === reservation.conn ||
    reservation.car.track === reservation.conn;
  const newerClaim = (a, b) => {
    const ageA = Number.isFinite(a.car.claimT) ? a.car.claimT : 0;
    const ageB = Number.isFinite(b.car.claimT) ? b.car.claimT : 0;
    if (ageA !== ageB) return ageA < ageB ? a : b;
    return a.car.id > b.car.id ? a : b;
  };
  for (let i = 0; i < claimed.length; i++) for (let j = i + 1; j < claimed.length; j++) {
    const a = claimed[i], b = claimed[j];
    if (a.conn.node !== b.conn.node || !a.conn.conflicts.includes(b.conn) ||
        !windowsOverlap(a.car, a.conn, b.car, b.conn)) continue;
    let revoke = null;
    if (!a.entered && !b.entered) revoke = newerClaim(a, b);
    else if (!a.entered) revoke = a;
    else if (!b.entered) revoke = b;
    if (revoke && hasClaim(revoke)) {
      revoke.car.releaseClaim();
      revoke.car.waitReason = 'conflict';
    }
  }

  // A granted vehicle may already be on its connector when its forecast
  // changes. Keep both physical claims, but hold the lower-priority vehicle
  // before the next shared region until the other vehicle has cleared it.
  for (let i = 0; i < claimed.length; i++) for (let j = i + 1; j < claimed.length; j++) {
    const a = claimed[i], b = claimed[j];
    if (!hasClaim(a) || !hasClaim(b) || a.conn.node !== b.conn.node ||
        !a.conn.conflicts.includes(b.conn) || a.car.track !== a.conn || b.car.track !== b.conn) continue;
    const aWindows = reservationWindows(a.car, a.conn, b.car, b.conn);
    const bWindows = reservationWindows(b.car, b.conn, a.car, a.conn);
    for (const aw of aWindows) for (const bw of bWindows) {
      if (aw.otherId !== b.conn.id || bw.otherId !== a.conn.id || aw.zoneId !== bw.zoneId ||
          aw.start > bw.end || bw.start > aw.end) continue;
      let stop = null, stopWindow = null;
      if (aw.occupiedNow && !bw.occupiedNow) { stop = b; stopWindow = bw; }
      else if (bw.occupiedNow && !aw.occupiedNow) { stop = a; stopWindow = aw; }
      else if (!aw.occupiedNow && !bw.occupiedNow) {
        stop = newerClaim(a, b);
        stopWindow = stop === a ? aw : bw;
      }
      if (!stop || !stopWindow || stop.car.s >= stopWindow.regionStart) continue;
      const stopAt = Math.max(stop.car.s, stopWindow.regionStart - 1);
      stop.car.junctionStopS = stop.car.junctionStopS === null
        ? stopAt : Math.min(stop.car.junctionStopS, stopAt);
      stop.car.waitReason = 'conflict';
    }
  }

  for (const c of cars) {
    if (c.dead || c.phase === 'VISIT' || !c.track || c.claim) continue;
    const nt = c.route[c.ri + 1];
    if (!nt || nt.kind !== 'CONN') continue;
    if (!nt.node.connectors.includes(nt)) { c.needsReroute = true; c.waitReason = 'stale-route'; continue; }
    if (c.manoeuvre) { c.waitReason = 'lane-change'; continue; }
    if (c.track !== nt.fromLane || c.lat !== 0) continue; // fully settled in the correct lane
    const dist = c.toEnd;
    const stoppingRange = Math.max(
      CFG.STOPLINE + c.len + CFG.IDM_S0,
      (c.v * c.v) / (2 * CFG.IDM_B) + c.len / 2 + CFG.STOPLINE + CFG.IDM_S0
    );
    let requestRange = stoppingRange;
    const signal = nt.node.control === 'SIGNAL' ? nt.node.signal : null;
    if (signal && signal.phases > 1 && !signal.amber && signalAllows(nt.node, nt)) {
      // The IDM starts slowing for a virtual stop line well before the
      // physical braking distance. On a clear green, reserve early enough
      // that an approaching car can keep its speed instead of braking and
      // accelerating again when the reservation finally arrives.
      const comfortableGap = CFG.IDM_S0 + c.v * CFG.IDM_T +
        (c.v * c.v) / (2 * Math.sqrt(CFG.IDM_A * CFG.IDM_B));
      const greenApproachRange = c.len / 2 + CFG.STOPLINE + 2 * comfortableGap;
      const timeToStopLine = Math.max(0, dist - c.len / 2 - CFG.STOPLINE) / Math.max(c.v, 1);
      const greenRemaining = CFG.GREEN_TIME - signal.timer;
      if (greenRemaining > timeToStopLine + 0.15) {
        requestRange = Math.max(requestRange, greenApproachRange);
      }
    }
    if (dist > requestRange) { c.waitReason = 'approach'; continue; }
    if (c.track.leaderAfter(c.s, c)) { c.waitReason = 'queue'; continue; }
    let list = byNode.get(nt.node);
    if (!list) byNode.set(nt.node, list = []);
    const windows = reservationWindows(c, nt);
    publishReservation(c, windows);
    list.push({ car: c, conn: nt, dist, windows });
  }

  for (const [node, reqs] of byNode) {
    if (draining.has(node)) { for (const r of reqs) r.car.waitReason = 'rebuilding'; continue; }
    reqs.sort((a, b) => (movementPriority(b.conn) - movementPriority(a.conn)) ||
                        (b.car.wait - a.car.wait) || (a.dist - b.dist));
    const signalled = node.control === 'SIGNAL' && node.signal && node.signal.phases > 1;
    const requestEligible = r => {
      const { car, conn } = r;
      if (locallyDraining.has(conn)) { car.waitReason = 'rebuilding'; return false; }
      if (signalled && !signalAllows(node, conn)) { car.waitReason = 'signal'; return false; }
      if (node.control === 'STOP' && !signalled &&
          (car.v > CFG.STOP_V || r.dist > CFG.STOPLINE + car.len + CFG.IDM_S0)) {
        car.waitReason = 'stop'; return false;
      }
      return true;
    };
    const eligibleOrder = new Map();
    for (let i = 0; i < reqs.length; i++) {
      if (requestEligible(reqs[i])) eligibleOrder.set(reqs[i].car, { conn: reqs[i].conn, index: i });
    }
    for (let i = 0; i < reqs.length; i++) {
      const r = reqs[i];
      const { car, conn } = r;
      if (!requestEligible(r)) continue;

      let blocked = false;
      const active = [];
      const claimedCounts = new Map();
      for (const otherCar of cars) {
        if (otherCar.dead) continue;
        const occupied = otherCar.claim || (otherCar.track && otherCar.track.kind === 'CONN' ? otherCar.track : null);
        if (!occupied || occupied.node !== node) continue;
        claimedCounts.set(occupied.id, (claimedCounts.get(occupied.id) || 0) + 1);
        if (otherCar === car) continue;
        const windows = reservationWindows(otherCar, occupied);
        publishReservation(otherCar, windows);
        active.push({ car: otherCar, conn: occupied, windows });
      }
      for (const [id, count] of node.occ) {
        if (!count || count <= (claimedCounts.get(id) || 0)) continue;
        const unknown = node.connectors.find(c => c.id === id);
        if (unknown) active.push({ car: null, conn: unknown, unknown: true, windows: [{
          otherId: conn.id, zoneId: -1, start: 0, end: Infinity,
        }] });
      }
      const conflictReservation = active.find(reservation =>
        conn.conflicts.includes(reservation.conn) &&
        (reservation.unknown || windowsOverlap(car, conn, reservation.car, reservation.conn)));
      if (conflictReservation) { car.waitReason = 'conflict'; continue; }

      for (const o of conn.conflicts) {
        if (o.fromLane !== conn.fromLane && !signalled && movementPriority(o) >= movementPriority(conn)) {
          const src = o.fromLane.vehicles;
          let near = null;
          for (let j = src.length - 1; j >= 0; j--) {
            const occupant = src[j];
            const actual = occupant.owner || occupant;
            if (actual === car || actual.dead || actual.track !== o.fromLane ||
                actual.route[actual.ri + 1] !== o) continue;
            const pairZones = conn.conflictZonesByVehiclePair && conn.conflictZonesByVehiclePair.get(o);
            const profile = car.kind === 'TRUCK' || actual.kind === 'TRUCK' ? 'TRUCK' : 'CAR';
            if (pairZones && Object.prototype.hasOwnProperty.call(pairZones, profile) &&
                !pairZones[profile].length) continue;
            if (o.fromLane.length - actual.s < CFG.YIELD_LOOK) { near = actual; break; }
          }
          // A lane can serve several turns. Yield only to the turn this car
          // will actually take, rather than every hypothetical turn from it.
          const otherRequest = near && eligibleOrder.get(near);
          // Equal-priority eligible requests already have a deterministic
          // order; let the earlier one try first and let its claim reserve the
          // conflict for the rest. Keep yielding to non-requests and higher
          // priority approaches as before.
          if (otherRequest && otherRequest.conn === o && movementPriority(o) === movementPriority(conn)) {
            if (otherRequest.index > i) continue;
            if (otherRequest.index < i && near.claim !== o) continue;
          }
          if (near && near.v > 3) {
            const priorityWindows = reservationWindows(near, o, car, conn);
            publishReservation(near, priorityWindows);
            if (windowsOverlap(car, conn, near, o)) {
              blocked = true; car.waitReason = 'priority'; break;
            }
          }
        }
      }
      if (blocked) continue;

      const out = conn.toLane;
      const f = out.firstVehicle();
      if (f && f.s - f.len / 2 < car.len + CFG.BOX_CLEAR) { car.waitReason = 'exit-blocked'; continue; }
      const inside = conn.firstVehicle();
      if (inside && inside.s - inside.len / 2 < car.len * 0.7) { car.waitReason = 'box-occupied'; continue; }

      car.claim = conn;
      car.claimT = 0;
      if (car.v < 0.5) {
        if (car.hadClaimDuringStop) car.claimRenewalsWhileStopped++;
        car.hadClaimDuringStop = true;
      }
      node.occ.set(conn.id, (node.occ.get(conn.id) || 0) + 1);
      car.waitReason = null;
      publishReservation(car, r.windows);
      active.push({ car, conn, windows: r.windows });
    }
  }
}

/* ────────────────────────  §7  WORLD & CITY  ──────────────────── */

const SEED_PARAM = /[?&]seed=(\d+)/.exec(location.search);
let SEED = SEED_PARAM ? (+SEED_PARAM[1] >>> 0) : ((Date.now() ^ (Math.random() * 1e9)) >>> 0);
let rng = makeRNG(SEED);

const W = {
  time: 0,
  cars: [],
  selectedCar: null,
  cityRemovalEnabled: false,
  rings: new Map(),
  running: true,
  speed: 1,
  debug: false,
  safetyChecks: false,
  lastSafetyScan: null,
  river: null,
  trips: [],
  stress: 0,
  peak: 0,
  rerouteAll: false,
  tool: 'ROAD',
  laneEditNode: null,
  preSortingNode: null,
  preSortingCount: 1,
  laneEditSource: null,
  roadType: 'STREET',
  zoneType: 1,
  zoneShape: 'circle',
  builtRoad: 0,
  laneChanges: 0,
};

/* ─────────────────────────────  terrain  ───────────────────────────── */

function makeRiver() {
  const pts = [];
  let x = CFG.WORLD_W * (0.40 + rng() * 0.2);
  for (let y = -160; y <= CFG.WORLD_H + 160; y += 170) {
    pts.push({ x, y });
    x = clamp(x + (rng() - 0.5) * 280, 240, CFG.WORLD_W - 240);
  }
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
    const n = V.rn(V.norm(V.sub(b, a)));
    const w = 44 * (0.8 + 0.35 * Math.sin(i * 1.3));
    left.push({ x: pts[i].x + n.x * w, y: pts[i].y + n.y * w });
    right.push({ x: pts[i].x - n.x * w, y: pts[i].y - n.y * w });
  }
  return { centre: pts, poly: left.concat(right.reverse()) };
}

function pointInWater(p) {
  const poly = W.river.poly;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function crossesWater(a, b) {
  if (!W.river) return false;
  const poly = W.river.poly;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (segX(a, b, poly[i], poly[j])) return true;
  }
  return pointInWater(a) || pointInWater(b);
}

/* ─────────────────────────  buildings & zoning  ───────────────────────── */

const ZONE_NONE = 0, ZONE_R = 1, ZONE_C = 2, ZONE_I = 3;
const ZONE_KEY = { 1: 'R', 2: 'C', 3: 'I' };
const ZONE_COL = { 1: '#4ade80', 2: '#60a5fa', 3: '#fbbf24' };

function zoneRectangleBounds(start, end) {
  const a = CITY.cellOf(start), b = CITY.cellOf(end), size = CFG.CELL;
  return {
    x0: Math.min(a.cx, b.cx) * size, y0: Math.min(a.cy, b.cy) * size,
    x1: (Math.max(a.cx, b.cx) + 1) * size, y1: (Math.max(a.cy, b.cy) + 1) * size,
  };
}

class Building {
  constructor(x, y, type, cell) {
    this.id = uid();
    this.x = x; this.y = y;
    this.type = type;                  // 'R' | 'C' | 'I'
    this.level = 1;
    this.cell = cell;
    this.edge = null;
    this.forward = true;
    this.laneIdx = 0;
    this.tPos = 0.5;
    this.angle = 0;
    this.service = 0.65;
    this.starve = 0;
    this.since = 0;
    this.trips = 0;
    this.outTimer = 2 + rng() * 8;
    this.born = W.time;
    this.dead = false;
    this.seed = rng();
  }
  get size() { return (this.type === 'R' ? 17 : this.type === 'C' ? 21 : 26) + this.level * 4; }
  get lane() {
    if (!this.edge || !this.edge.centre) return null;
    const g = this.forward ? this.edge.fwd : this.edge.bwd;
    if (!g || !g.length) return null;
    return g[Math.min(this.laneIdx, g.length - 1)] || null;
  }
  get s() { const l = this.lane; return l ? clamp(this.tPos * l.length, 2, l.length - 2) : 0; }
  get people() { return this.type === 'R' ? this.level * 9 : 0; }
  get jobs() { return this.type === 'C' ? this.level * 8 : this.type === 'I' ? this.level * 13 : 0; }
}

const CITY = {
  cols: 0, rows: 0,
  zone: null, used: null,
  buildings: [],
  demand: { R: 0.3, C: 0.15, I: 0.1 },
  pop: 0, jobs: 0, happiness: 0.8,
  buildT: 0, tickT: 0,
  reattachDirty: false,
  served: 0, missed: 0,

  init() {
    this.cols = Math.ceil(CFG.WORLD_W / CFG.CELL);
    this.rows = Math.ceil(CFG.WORLD_H / CFG.CELL);
    this.zone = new Uint8Array(this.cols * this.rows);
    this.used = new Uint8Array(this.cols * this.rows);
    this.near = new Uint8Array(this.cols * this.rows);
    this.cands = [[], [], []];
    this.candT = 0;
    this.buildings = [];
    this.demand = { R: 0.3, C: 0.15, I: 0.1 };
    this.pop = 0; this.jobs = 0; this.happiness = 0.8;
    this.served = 0; this.missed = 0;
    this.buildT = 0; this.tickT = 0;
  },

  idx(cx, cy) { return cy * this.cols + cx; },
  cellOf(p) { return { cx: clamp(Math.floor(p.x / CFG.CELL), 0, this.cols - 1), cy: clamp(Math.floor(p.y / CFG.CELL), 0, this.rows - 1) }; },
  cellCentre(cx, cy) { return { x: (cx + 0.5) * CFG.CELL, y: (cy + 0.5) * CFG.CELL }; },

  applyZoneCell(cx, cy, type) {
    const cc = this.cellCentre(cx, cy);
    if (pointInWater(cc)) return;
    const i = this.idx(cx, cy);
    if (type === ZONE_NONE) {
      this.zone[i] = 0;
      const b = this.buildings.find(b => b.cell === i);
      if (b) this.demolish(b);
    } else if (this.zone[i] !== type) {
      const b = this.buildings.find(b => b.cell === i);
      if (b) this.demolish(b);
      this.zone[i] = type;
    }
  },

  paint(p, radius, type) {
    const r = Math.ceil(radius / CFG.CELL);
    const c = this.cellOf(p);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = c.cx + dx, cy = c.cy + dy;
        if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) continue;
        const cc = this.cellCentre(cx, cy);
        if (V.dist(cc, p) > radius) continue;
        this.applyZoneCell(cx, cy, type);
      }
    }
  },

  paintRectangle(start, end, type) {
    const a = this.cellOf(start), b = this.cellOf(end);
    const x0 = Math.min(a.cx, b.cx), x1 = Math.max(a.cx, b.cx);
    const y0 = Math.min(a.cy, b.cy), y1 = Math.max(a.cy, b.cy);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        this.applyZoneCell(cx, cy, type);
      }
    }
  },

  demolish(b) {
    b.dead = true;
    this.used[b.cell] = 0;
    this.buildings = this.buildings.filter(x => x !== b);
    for (const c of W.cars) if (c.origin === b || c.dest === b) c.dead = true;
  },

  buildingAt(p, tol) {
    let best = null, bd = Infinity;
    for (const b of this.buildings) {
      const d = V.dist2({ x: b.x, y: b.y }, p);
      const rr = (b.size * 0.75 + (tol || 0)) ** 2;
      if (d < rr && d < bd) { bd = d; best = b; }
    }
    return best;
  },

  /* ---- attachment: a building's address is (edge, direction, lane, t) ---- */

  attach(b) {
    let bestE = null, bestS = 0, bd = CFG.ROAD_FAR;
    const p = { x: b.x, y: b.y };
    for (const e of NET.edges) {
      if (!e.centre || e.type === 'RING') continue;
      if (Math.abs(e.centre.p0.x - p.x) > CFG.ROAD_FAR + e.chord &&
          Math.abs(e.centre.p2.x - p.x) > CFG.ROAD_FAR + e.chord) continue;
      const near = e.centre.nearest(p);
      const d = near.d - e.halfWidth;
      if (d < bd && near.d > e.halfWidth * 0.4) { bd = d; bestE = e; bestS = near.s; }
    }
    if (!bestE) { b.edge = null; return false; }
    const e = bestE;
    const cp = e.centre.pos(bestS), dir = e.centre.dir(bestS);
    const side = Math.sign(V.cross(dir, { x: p.x - cp.x, y: p.y - cp.y })) || 1;
    const fwd = e.spec.oneway ? true : side > 0;
    const group = fwd ? e.fwd : e.bwd;
    if (!group || !group.length) { b.edge = null; return false; }
    b.edge = e; b.forward = fwd; b.laneIdx = 0;
    const lane = group[0];
    b.tPos = clamp(lane.path.nearest(p).s / lane.length, 0.05, 0.95);
    const n = V.rn(dir);
    const off = (e.halfWidth + b.size * 0.62 + 4) * side;
    b.x = cp.x + n.x * off; b.y = cp.y + n.y * off;
    b.angle = Math.atan2(dir.y, dir.x) + (side > 0 ? 0 : Math.PI);
    return true;
  },

  overlaps(x, y, size, skip) {
    for (const o of this.buildings) {
      if (o === skip) continue;
      const need = (size + o.size) * 0.52;
      if (V.dist2({ x, y }, { x: o.x, y: o.y }) < need * need) return true;
    }
    return false;
  },

  overlapsRoad(b) {
    const wob = 0.82 + 0.36 * b.seed;
    const width = b.size * wob;
    const height = b.size * (b.type === 'I' ? 0.86 : 0.95) / wob;
    const u = { x: Math.cos(b.angle), y: Math.sin(b.angle) };
    const v = { x: -u.y, y: u.x };
    for (const e of NET.edges) {
      if (!e.centre) continue;
      const near = e.centre.nearest({ x: b.x, y: b.y });
      const tangent = e.centre.dir(near.s);
      const normal = { x: -tangent.y, y: tangent.x };
      const support = Math.abs(normal.x * u.x + normal.y * u.y) * width / 2 +
        Math.abs(normal.x * v.x + normal.y * v.y) * height / 2;
      if (near.d < e.halfWidth + support) return true;
      for(const lane of e.lanes) {
        if(!(lane.path instanceof ApproachPath)) continue;
        const hit=lane.path.nearest({x:b.x,y:b.y});
        const p=lane.pos(Math.max(lane.startS||0,hit.s));
        if(V.dist(p,{x:b.x,y:b.y}) < LW/2+Math.hypot(width,height)/2+1) return true;
      }
    }
    return false;
  },

  clearRoadOverlaps() {
    for (const b of this.buildings.slice()) {
      if (this.overlapsRoad(b)) this.demolish(b);
    }
  },

  /* ---- development ----
     Only cells with road access can develop, so the candidate set is derived
     from the network itself: stamp every cell within reach of a road, then
     bucket the free zoned ones by type. Rebuilt whenever the network or the
     zoning changes, which keeps development responsive to a new road. */

  rebuildCandidates() {
    this.near.fill(0);
    const rad = Math.ceil(CFG.ROAD_FAR / CFG.CELL);
    for (const e of NET.edges) {
      if (e.type === 'RING' || !e.centre) continue;
      const steps = Math.max(2, Math.ceil(e.centre.length / 16));
      for (let i = 0; i <= steps; i++) {
        const c = this.cellOf(e.centre.pos(e.centre.length * i / steps));
        for (let dy = -rad; dy <= rad; dy++) {
          const cy = c.cy + dy;
          if (cy < 0 || cy >= this.rows) continue;
          for (let dx = -rad; dx <= rad; dx++) {
            const cx = c.cx + dx;
            if (cx < 0 || cx >= this.cols) continue;
            this.near[cy * this.cols + cx] = 1;
          }
        }
      }
    }
    this.cands = [[], [], []];
    for (let i = 0; i < this.zone.length; i++) {
      const z = this.zone[i];
      if (!z || this.used[i] || !this.near[i]) continue;
      this.cands[z - 1].push(i);
    }
  },

  develop() {
    const order = ['R', 'C', 'I'].sort((a, b) => this.demand[b] - this.demand[a]);
    const type = order[0];
    if (this.demand[type] <= 0.02) return;
    const pool = this.cands[type === 'R' ? 0 : type === 'C' ? 1 : 2];
    if (!pool || !pool.length) return;
    const want = type === 'R' ? ZONE_R : type === 'C' ? ZONE_C : ZONE_I;

    for (let attempt = 0; attempt < 12; attempt++) {
      const pick = (rng() * pool.length) | 0;
      const i = pool[pick];
      if (i === undefined) continue;
      if (this.zone[i] !== want || this.used[i]) { pool.splice(pick, 1); continue; }
      const cx = i % this.cols, cy = (i / this.cols) | 0;
      const c = this.cellCentre(cx, cy);
      const b = new Building(c.x + (rng() - 0.5) * 12, c.y + (rng() - 0.5) * 12, type, i);
      if (!this.attach(b)) continue;
      if (this.overlapsRoad(b)) continue;
      if (this.overlaps(b.x, b.y, b.size, b)) continue;
      this.used[i] = 1;
      const k = pool.indexOf(i);
      if (k >= 0) pool.splice(k, 1);
      b.born = W.time;
      this.buildings.push(b);
      const lane = b.lane;
      if (lane) lane.buildings.push(b);
      return;
    }
  },

  /* ---- economy ---- */

  recompute() {
    let pop = 0, jobsC = 0, jobsI = 0, svc = 0, n = 0;
    for (const b of this.buildings) {
      pop += b.people;
      if (b.type === 'C') jobsC += b.jobs;
      if (b.type === 'I') jobsI += b.jobs;
      svc += b.service; n++;
    }
    this.pop = pop; this.jobs = jobsC + jobsI;
    const avgSvc = n ? svc / n : 0.7;
    this.happiness = clamp(0.3 + 0.7 * avgSvc, 0, 1);
    const h = 0.45 + 0.55 * this.happiness;
    this.demand.R = clamp((0.28 + (this.jobs - pop) / Math.max(pop, 70) * 0.85) * h, -1, 1);
    this.demand.C = clamp((0.16 + (pop * 0.55 - jobsC) / Math.max(jobsC, 45) * 0.75) * h, -1, 1);
    this.demand.I = clamp((0.14 + (jobsC * 1.2 - jobsI) / Math.max(jobsI, 45) * 0.7) * h, -1, 1);
  },

  tripDone(car, dur) {
    const routeChanges=Math.max(0,(car.routeChanges||0)-(car.diagnosticLastRouteChanges||0));
    const missedTurns=Math.max(0,(car.missedTurns||0)-(car.diagnosticLastMissedTurns||0));
    car.diagnosticLastRouteChanges=car.routeChanges||0;
    car.diagnosticLastMissedTurns=car.missedTurns||0;
    trafficDiagnostics.recordTrip({vehicleId:car.id,duration:dur,routeChanges,missedTurns});
    const o = car.origin, d = car.dest;
    const straight = V.dist({ x: o.x, y: o.y }, { x: d.x, y: d.y });
    const expect = straight / 95 + 9;
    const q = clamp(1.65 - (dur / Math.max(expect, 4)) * 0.85, 0, 1);
    for (const b of [o, d]) {
      if (!b || b.dead) continue;
      b.service = lerp(b.service, q, 0.3);
      b.starve = 0;
      b.trips++;
    }
    this.served++;
    W.trips.push(dur);
    if (W.trips.length > 90) W.trips.shift();
  },

  tickBuildings(dt) {
    for (const b of this.buildings) {
      if (!b.edge || !b.lane) {
        if (!this.attach(b)) { b.starve += dt * 2; b.service = lerp(b.service, 0.05, 0.02); }
      }
      b.starve += dt * (b.service < CFG.LEVEL_DOWN ? 1 : 0);
      b.since += dt;
      if (b.since > 22) {
        b.since = 0;
        if (b.service > CFG.LEVEL_UP && this.demand[b.type] > 0 && b.level < 3 && b.trips > 2) {
          b.level++;
          if (b.lane) this.attach(b);
        } else if (b.starve > CFG.ABANDON_TIME) {
          b.level--;
          b.starve = 0;
          if (b.level <= 0) { this.demolish(b); continue; }
        }
      }
    }
  },

  /* ---- trip generation ---- */

  dayFactor(hour) {
    const g = (mu, sig, amp) => amp * Math.exp(-((hour - mu) ** 2) / sig);
    let f = 0.3 + g(8, 5, 1.0) + g(17.5, 6, 1.15) + g(13, 9, 0.45);
    if (hour < 5.5 || hour > 22) f *= 0.22;
    return f;
  },

  pickDest(from, kinds) {
    const pool = [];
    for (let i = 0; i < 10; i++) {
      const b = this.buildings[(rng() * this.buildings.length) | 0];
      if (!b || b === from || !kinds.includes(b.type) || !b.lane) continue;
      pool.push(b);
    }
    if (!pool.length) return null;
    pool.sort((a, b) => V.dist2({ x: a.x, y: a.y }, { x: from.x, y: from.y }) -
                        V.dist2({ x: b.x, y: b.y }, { x: from.x, y: from.y }));
    return pool[Math.min((rng() * 2.6) | 0, pool.length - 1)];
  },

  spawn(dt, hour) {
    if (W.cars.length >= CFG.MAX_CARS * 0.92) return;
    const f = this.dayFactor(hour);
    for (const b of this.buildings) {
      if (b.type === 'C') continue;                 // shops receive, they don't originate
      if (!b.lane) continue;
      b.outTimer -= dt * f * b.level;
      if (b.outTimer > 0) continue;
      b.outTimer = (b.type === 'R' ? CFG.TRIP_R : CFG.TRIP_I) * (0.65 + rng() * 0.8);
      if (W.cars.length >= CFG.MAX_CARS) return;

      const kinds = b.type === 'R'
        ? (hour > 6 && hour < 11 ? ['I', 'C'] : hour > 15 && hour < 20 ? ['C', 'I'] : ['C'])
        : ['C'];
      const dest = this.pickDest(b, kinds);
      if (!dest) { this.missed++; continue; }

      const lane = b.lane, s = b.s;
      const near = lane.vehicles.find(v => Math.abs(v.s - s) < 26);
      if (near) continue;                            // kerb is occupied
      const route = routeBetween(lane, s, dest.lane, dest.s, false, b.type==='I'?CFG.TRUCK_L:CFG.CAR_L);
      if (!route) { this.missed++; continue; }
      const car = new Car(b, dest, b.type === 'I' ? 'TRUCK' : 'CAR');
      car.setRoute(route, dest.lane, dest.s);
      car.s = s;
      insertTrackOccupant(lane,car);
      car.pose();car.ppx=car.px;car.ppy=car.py;car.pang=car.ang;
      W.cars.push(car);
    }
  },
};

/* ─────────────────────────  §8  CAMERA  ───────────────────────── */

const CAM = {
  x: CFG.WORLD_W / 2, y: CFG.WORLD_H / 2, z: 0.75,
  tx: CFG.WORLD_W / 2, ty: CFG.WORLD_H / 2, tz: 0.75,
  ease(dt) {
    const k = 1 - Math.pow(0.0018, dt);
    this.x = lerp(this.x, this.tx, k); this.y = lerp(this.y, this.ty, k); this.z = lerp(this.z, this.tz, k);
  },
  apply(ctx, dpr, cw, ch) {
    ctx.setTransform(this.z * dpr, 0, 0, this.z * dpr,
      (cw / 2 - this.x * this.z) * dpr, (ch / 2 - this.y * this.z) * dpr);
  },
  toWorld(sx, sy, cw, ch) { return { x: (sx - cw / 2) / this.z + this.x, y: (sy - ch / 2) / this.z + this.y }; },
  fit(cw, ch) {
    const pts = NET.nodes.length ? NET.nodes : [{ x: CFG.WORLD_W / 2, y: CFG.WORLD_H / 2 }];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of pts) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
    for (const b of CITY.buildings) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x); y1 = Math.max(y1, b.y); }
    this.tx = (x0 + x1) / 2; this.ty = (y0 + y1) / 2;
    this.tz = clamp(Math.min(cw / (x1 - x0 + 260), ch / (y1 - y0 + 260)), 0.2, 1.5);
  },
};

/* ─────────────────────────  §9  INPUT  ───────────────────────── */

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const stage = document.getElementById('stage');
let cw = 0, ch = 0, dpr = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cw = stage.clientWidth; ch = stage.clientHeight;
  cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
}
window.addEventListener('resize', resize);

const IN = {
  mode: 'idle', startNode: null, startPt: null,
  mouse: { x: 0, y: 0 }, screen: { x: 0, y: 0 },
  moved: 0, bendEdge: null, panFrom: null, space: false,
  panKeys: { w: false, a: false, s: false, d: false },
  brush: 62, erase: false, valid: true, msg: '',
  zoneStart: null,
  hoverNode: null, hoverEdge: null, hoverBuilding: null, hoverPriorityArm: null,
  hoverPreSortingArm: null, preSortingFlash: null,
  laneFromLane: null, laneToLane: null, hoverLaneIn: null, hoverLaneOut: null,
  endPt: null, bend: 0, originalBend: 0,
};

const PAN_KEYS = ['w', 'a', 's', 'd'];
function moveCamera(dt) {
  const dx = Number(IN.panKeys.d) - Number(IN.panKeys.a);
  const dy = Number(IN.panKeys.s) - Number(IN.panKeys.w);
  const length = Math.hypot(dx, dy);
  if (!length) return;
  const step = 560 * dt / length / Math.max(CAM.tz, 0.18);
  CAM.tx = clamp(CAM.tx + dx * step, -400, CFG.WORLD_W + 400);
  CAM.ty = clamp(CAM.ty + dy * step, -400, CFG.WORLD_H + 400);
}

function clearPanKeys() {
  for (const key of PAN_KEYS) IN.panKeys[key] = false;
}

function nodeAt(p, tol) {
  let best = null, bd = Infinity;
  for (const n of NET.nodes) {
    const t = (tol || Math.max(n.r + 10, 24));
    const d = V.dist2(n.pos, p);
    if (d < t * t && d < bd) { bd = d; best = n; }
  }
  return best;
}

function edgeAt(p, extra) {
  let best = null, bd = Infinity, bs = 0;
  for (const e of NET.edges) {
    if (!e.centre) continue;
    const near = e.centre.nearest(p);
    const tol = e.halfWidth + (extra || 4);
    if (near.d < tol && near.d < bd) { bd = near.d; best = e; bs = near.s; }
  }
  return best ? { edge: best, s: bs, d: bd } : null;
}

function carAtPoint(p) {
  let best = null, bestDistance = Infinity;
  const padding = 18 / Math.max(CAM.z, 0.18);
  for (const car of W.cars) {
    if (car.dead || car.phase === 'VISIT' || (!car.track && car.phase !== 'ENTER')) continue;
    const dx = p.x - car.px, dy = p.y - car.py;
    const cos = Math.cos(car.ang), sin = Math.sin(car.ang);
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;
    if (Math.abs(localX) > car.len / 2 + padding || Math.abs(localY) > car.wide / 2 + padding) continue;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) { best = car; bestDistance = distance; }
  }
  return best;
}

function priorityArmAt(p) {
  const hit = edgeAt(p, 4);
  if (!hit || hit.edge.type === 'RING') return null;
  const node = [hit.edge.n1, hit.edge.n2]
    .filter(n => !n.isRing && n.degree >= 3 && V.dist(n.pos, p) <= n.r + hit.edge.halfWidth + 14)
    .sort((a, b) => V.dist2(a.pos, p) - V.dist2(b.pos, p))[0];
  return node ? { node, edge: hit.edge } : null;
}

function preSortingArmAt(p) {
  const node = W.preSortingNode;
  const hit = node && edgeAt(p, 4);
  if (!hit || hit.edge.type === 'RING' || !node.edges.includes(hit.edge)) return null;
  const distanceFromNode = hit.edge.n1 === node ? hit.s : hit.edge.centre.length - hit.s;
  if (distanceFromNode <= node.r + 1 || distanceFromNode >= hit.edge.centre.length / 2) return null;
  const existing = node.preSorting[hit.edge.id];
  const possible = existing || preSortingRecord(node, hit.edge, W.preSortingCount);
  return possible && Object.keys(possible).length ? { node, edge: hit.edge } : null;
}

function laneEndpointAt(node, p, incoming) {
  if (!node || node.isRing || node.degree < 3) return null;
  const lanes = incoming ? node.lanesIn : node.lanesOut;
  const endpoint = lane => incoming ? lane.path.p2 : lane.path.p0;
  let best = null, bestDistance = Infinity;
  for (const lane of lanes) {
    const distance = V.dist2(endpoint(lane), p);
    if (distance < bestDistance) { best = lane; bestDistance = distance; }
  }
  const tolerance = 12 / Math.max(CAM.z, 0.18);
  return best && bestDistance <= tolerance * tolerance ? best : null;
}

function evaluateBuild(aPos, bPos, type) {
  const len = V.dist(aPos, bPos);
  const spec = ROADS[type];
  if (len < Math.max(60, roadHalfWidth(spec) * 2 + 34)) return { ok: false, msg: 'Too short', len };
  return { ok: true, msg: `${spec.name} · ${Math.round(len)} m${crossesWater(aPos, bPos) ? ' · bridge' : ''}`, len };
}

/** Resolve a drag endpoint to a node, creating or splitting as needed. */
function resolveEndpoint(p, allowCreate) {
  const n = nodeAt(p, 0.2);
  if (n) return n;
  const hit = edgeAt(p, -1000);
  if (hit && hit.edge.type !== 'RING') {
    const split = NET.splitEdge(hit.edge, hit.s);
    if (split) return split;
  }
  return allowCreate ? NET.addNode(p.x, p.y) : null;
}

function cancelDrawing() {
  IN.pocketDrag = null;
  if (IN.mode === 'bend' && IN.bendEdge) {
    IN.bendEdge.bend = IN.originalBend;
    NET.rebuildAround([IN.bendEdge.n1, IN.bendEdge.n2]);
    CITY.reattachDirty = true; markReroute();
  }
  IN.mode = 'idle'; IN.startPt = null; IN.endPt = null; IN.startNode = null;
  IN.bendEdge = null; IN.panFrom = null; IN.bend = 0;
  IN.laneFromLane = null; IN.laneToLane = null;
  IN.zoneStart = null;
}

function drawingPoint(pointer, start) {
  const n = !start ? nodeAt(pointer) : null;
  if (n) return n.pos;
  const point = RoadEditor.endpoint(start || pointer, pointer, {
    grid: EDIT.grid, straight: !!start && EDIT.drawMode === 'straight', nodes: start ? NET.nodes : []
  });
  if (point.node) return {x:point.x,y:point.y};
  const locked = start && EDIT.grid && EDIT.drawMode === 'straight';
  let best = {x:point.x,y:point.y}, distance = 20;
  // Road snapping is geometric, not a late commit adjustment: the preview is exact.
  for (const e of NET.edges) {
    if (!e.centre || e.type === 'RING') continue;
    if (locked) {
      const horizontal = Math.abs(pointer.x-start.x) >= Math.abs(pointer.y-start.y);
      const fixed = horizontal ? 'y' : 'x';
      const p = e.centre;
      const aa = p.p0[fixed]-2*p.p1[fixed]+p.p2[fixed];
      const bb = 2*(p.p1[fixed]-p.p0[fixed]), cc = p.p0[fixed]-start[fixed];
      let roots=[];
      if (Math.abs(aa)<1e-8) {if(Math.abs(bb)>1e-8) roots=[-cc/bb];}
      else {const d=bb*bb-4*aa*cc;if(d>=0) roots=[(-bb+Math.sqrt(d))/(2*aa),(-bb-Math.sqrt(d))/(2*aa)];}
      for(const t of roots) if(t>0.02&&t<0.98) {
        const q=p.point(t), d=V.dist(q,pointer);
        if(d<distance) {best=q;best[fixed]=start[fixed];distance=d;}
      }
    } else {
      const near=e.centre.nearest(pointer);
      if(near.d<distance && near.s>30 && near.s<e.centre.length-30) {
        best=e.centre.pos(near.s);distance=near.d;
      }
    }
  }
  return best;
}

function roadPath(a,b,bend=0) {
  const mid=V.mix(a,b,0.5), n=V.rn(V.norm(V.sub(b,a)));
  return new Path(a,{x:mid.x+n.x*bend*2,y:mid.y+n.y*bend*2},b);
}

function pathBend(path) {
  const mid=V.mix(path.p0,path.p2,.5), normal=V.rn(V.norm(V.sub(path.p2,path.p0)));
  return V.dot(V.sub(path.p1,mid),normal)/2;
}

function pathIntersections(path, edge) {
  const out=[], other=edge.centre, na=Math.max(2,Math.ceil(path.length/18)), nb=Math.max(2,Math.ceil(other.length/18));
  for(let i=0;i<na;i++) {
    const a=path.point(i/na),b=path.point((i+1)/na),ab=V.sub(b,a);
    for(let j=0;j<nb;j++) {
      const c=other.point(j/nb),d=other.point((j+1)/nb),cd=V.sub(d,c),den=V.cross(ab,cd);
      if(Math.abs(den)<1e-7) continue;
      const u=V.cross(V.sub(c,a),cd)/den,v=V.cross(V.sub(c,a),ab)/den;
      if(u < -1e-6 || u > 1+1e-6 || v < -1e-6 || v > 1+1e-6) continue;
      let t=(i+u)/na, q=(j+v)/nb;
      // Refine polyline intersections to the true quadratic curves.
      for(let k=0;k<5;k++) {
        const p1=path.point(t),p2=other.point(q),f=V.sub(p2,p1),dt=path.deriv(t),dq=other.deriv(q),cross=V.cross(dt,dq);
        if(Math.abs(cross)<1e-8) break;
        t+=V.cross(f,dq)/cross;q+=V.cross(f,dt)/cross;
      }
      if(t>=-1e-6&&t<=1+1e-6&&q>=-1e-6&&q<=1+1e-6&&!out.some(h=>Math.abs(h.t-t)<.002)) out.push({t:clamp(t,0,1),q:clamp(q,0,1),point:other.point(clamp(q,0,1)),edge});
    }
  }
  return out;
}

function pathsOverlap(path,other) {
  const steps=Math.max(12,Math.ceil(path.length/20));
  for(let i=1;i<steps;i++) {
    const a=path.point(i/steps),b=path.point((i+1)/steps);
    if(V.dist(a,b)<5) continue;
    const near=other.nearest(a),next=other.nearest(b);
    if(near.d<.05&&next.d<.05&&Math.abs(V.cross(path.tangent(i/steps),other.dir(near.s)))<.0001) return true;
  }
  return false;
}

function reshapeRoad(edge,bend) {
  if(edge.type==='RING'||!Number.isFinite(bend)) return {ok:false,msg:'Choose a regular road to reshape'};
  bend=clamp(bend,-edge.chord*.42,edge.chord*.42);
  const path=roadPath(edge.n1.pos,edge.n2.pos,bend);
  for(const other of NET.edges) {
    if(other===edge) continue;
    if(pathsOverlap(path,other.centre)||pathIntersections(path,other).some(h=>h.t>.003&&h.t<.997)) return {ok:false,msg:'That bend crosses a road. Build a new connection instead.'};
  }
  edge.bend=bend;edge.isBridge=crossesWater(edge.n1.pos,edge.n2.pos);
  NET.rebuildAround([edge.n1,edge.n2]);CITY.clearRoadOverlaps();CITY.reattachDirty=true;markReroute();
  return {ok:true,msg:'Road reshaped'};
}

function buildRoad(a,b,bend=0) {
  const check=evaluateBuild(a,b,W.roadType);
  if(!check.ok) return check;
  if([a.x,a.y,b.x,b.y,bend].some(x=>!Number.isFinite(x))||[a.x,a.y,b.x,b.y].some(x=>Math.abs(x)>9000)) return {ok:false,msg:'Road is outside the building area'};
  const path=roadPath(a,b,bend),hits=[];
  for(const e of NET.edges) if(e.centre&&pathsOverlap(path,e.centre)) return {ok:false,msg:'A road already follows that route'};
  for(const e of NET.edges) if(e.centre) for(const h of pathIntersections(path,e)) hits.push(h);
  hits.sort((x,y)=>x.t-y.t);
  // Reject cramped junctions before any mutation, so a failed build loses nothing.
  const stops=[{t:0,point:a},{t:1,point:b}];
  for(const hit of hits) {
    if(hit.t<.002||hit.t>.998) continue;
    if(hit.edge.type==='RING') return {ok:false,msg:'Connect to a roundabout approach road instead'};
    const near=nodeAt(hit.point,1);
    if(!near && Math.min(V.dist(hit.point,hit.edge.n1.pos),V.dist(hit.point,hit.edge.n2.pos))<65) return {ok:false,msg:'Leave more room between junctions'};
    if(!stops.some(s=>V.dist(s.point,hit.point)<2)) stops.push(hit);
  }
  stops.sort((x,y)=>x.t-y.t);
  for(let i=1;i<stops.length;i++) if(V.dist(stops[i-1].point,stops[i].point)<65) return {ok:false,msg:'Leave more room between junctions'};
  for(const p of [a,b]) {
    const existing=nodeAt(p,1);
    if(!existing) for(const e of NET.edges) {
      if(!e.centre) continue;
      const near=e.centre.nearest(p);
      if(near.d<.8 && (e.type==='RING'||Math.min(V.dist(p,e.n1.pos),V.dist(p,e.n2.pos))<65)) return {ok:false,msg:'Start farther from that junction'};
    }
  }
  const na=nodeAt(a,1),nb=nodeAt(b,1);
  if(na&&nb&&NET.findEdge(na,nb)) return {ok:false,msg:'Those junctions already have a road'};
  function ensureNode(p) {
    const n=nodeAt(p,1);if(n) return n;
    for(const e of NET.edges.slice()) {
      const near=e.centre.nearest(p);
      if(near.d<1 && e.type!=='RING') return NET.splitEdge(e,near.s);
    }
    return NET.addNode(p.x,p.y);
  }
  // Split all crossed roads first, then connect each pair along the new curve.
  const nodes=stops.map(s=>ensureNode(s.point));
  const created=[];
  for(let i=1;i<nodes.length;i++) {
    const n1=nodes[i-1],n2=nodes[i];
    const piece=path.sub(stops[i-1].t,stops[i].t);
    const e=NET.addEdge(n1,n2,W.roadType,pathBend(piece));
    if(e) {created.push(e);W.builtRoad+=e.centre.length;}
  }
  if(!created.length) return {ok:false,msg:'Those junctions already have a road'};
  CITY.clearRoadOverlaps();
  hideTip(); CITY.reattachDirty=true;markReroute();
  return {ok:true,msg:created.length>1?'Road connected through '+(created.length-1)+' new junctions':'Road connected'};
}

function commitDrawing() {
  const result=buildRoad(IN.startPt,IN.endPt,IN.bend);
  cancelDrawing();toast(result.msg);
}

cv.addEventListener('contextmenu', e => e.preventDefault());

cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId);
  const r = cv.getBoundingClientRect();
  IN.screen = { x: e.clientX - r.left, y: e.clientY - r.top };
  IN.mouse = CAM.toWorld(IN.screen.x, IN.screen.y, cw, ch);
  IN.moved = 0;
  const right = e.button === 2;

  if (right && (IN.mode === 'curve' || IN.mode === 'build')) { cancelDrawing(); return; }
  if (IN.mode === 'curve' && e.button===0 && !IN.space && !e.shiftKey) { commitDrawing(); return; }

  if (e.button === 1 || IN.space || e.shiftKey) {
    IN.mode = 'pan';
    IN.panFrom = { sx: IN.screen.x, sy: IN.screen.y, cx: CAM.tx, cy: CAM.ty };
    return;
  }

  if (W.tool === 'BULLDOZE' && e.button === 0) {
    W.selectedCar = carAtPoint(IN.mouse);
    syncUI();
    if (W.selectedCar) { IN.mode = 'car-select'; return; }
    IN.mode = W.cityRemovalEnabled ? 'bulldoze-pending' : 'idle';
    return;
  }

  if (W.tool === 'ZONE') {
    IN.erase = right;
    if (W.zoneShape === 'rectangle') {
      IN.mode = 'zone-rectangle';
      IN.zoneStart = { ...IN.mouse };
    } else {
      IN.mode = 'zone';
      CITY.paint(IN.mouse, IN.brush, right ? ZONE_NONE : W.zoneType);
    }
    return;
  }

  if (W.tool === 'LANE_CONNECTIONS' && right) {
    cancelDrawing();
    W.laneEditNode = null;
    W.laneEditSource = null;
    syncUI();
    return;
  }

  if (W.tool === 'PRE_SORTING') {
    if (right) { cancelDrawing(); W.preSortingNode=null; IN.hoverPreSortingArm=null; IN.preSortingFlash=null; syncUI(); return; }
    const handle = preSortingHandleAt(IN.mouse);
    if (handle) {
      const node=W.preSortingNode;
      IN.pocketDrag={node,edge:handle.edge,side:handle.side,original:node.preSorting[handle.edge.id][handle.side]};
      IN.mode='presort-resize'; return;
    }
    const selected = W.preSortingNode;
    const target = preSortingArmAt(IN.mouse);
    if (target) {
      const result = togglePreSortingArm(target.node, target.edge, W.preSortingCount);
      if (result) IN.preSortingFlash = { node: target.node, edge: target.edge, until: performance.now() + 700 };
      toast(result === 'added' ? 'Turning lanes added on this side'
        : result === 'removed' ? 'Turning lanes removed from this side'
        : 'No usable incoming approach or space on this side');
      syncUI();
      return;
    }
    const node=nodeAt(IN.mouse);
    if (node && !node.isRing && node.degree>=3) {
      W.preSortingNode=node;
      IN.preSortingFlash=null;
      toast(node === selected
        ? 'Click an incoming road arm to add or remove its turning lanes'
        : 'Crossing selected · click an incoming road arm to add turning lanes');
      syncUI();
    } else toast(selected
      ? 'Choose an incoming road arm at the selected crossing'
      : 'Choose a regular intersection with 3+ road arms');
    return;
  }

  if (right && W.tool === 'BULLDOZE' && !W.cityRemovalEnabled) {
    IN.mode = 'idle';
    return;
  }

  if (right) {                                   // universal demolish
    const b = CITY.buildingAt(IN.mouse, 4);
    if (b) { CITY.demolish(b); toast('Building demolished'); }
    else {
      const hit = edgeAt(IN.mouse, 2);
      if (hit) { if(hit.edge.type==='RING') NET.removeRoundabout(hit.edge.n1.ringId); else NET.removeEdge(hit.edge); CITY.reattachDirty=true; markReroute(); toast('Road demolished'); }
    }
    IN.mode = 'idle';
    return;
  }

  if (W.tool === 'LANE_CONNECTIONS') {
    const hitNode = nodeAt(IN.mouse);
    if (!W.laneEditNode || (hitNode && hitNode !== W.laneEditNode)) {
      if (hitNode && !hitNode.isRing && hitNode.degree >= 3) {
        W.laneEditNode = hitNode;
        W.laneEditSource = null;
        syncUI();
      } else if (hitNode && hitNode.isRing) toast('Roundabouts use automatic lane connections');
      else toast('Select a regular junction with 3+ road arms');
      return;
    }
    const fromLane = laneEndpointAt(W.laneEditNode, IN.mouse, true);
    if (!fromLane) { toast('Start the drag at an incoming lane end'); return; }
    IN.mode = 'lane-connect';
    IN.laneFromLane = fromLane;
    IN.laneToLane = null;
    W.laneEditSource = fromLane;
    syncUI();
    return;
  }

  switch (W.tool) {
    case 'ROAD': {
      IN.startPt = drawingPoint(IN.mouse); IN.endPt = IN.startPt; IN.bend=0; IN.mode='build';
      IN.valid=false; IN.msg='Drag to set the end of the road';
      return;
    }
    case 'BEND': {
      const hit=edgeAt(IN.mouse,3);
      if(hit&&hit.edge.type!=='RING') {IN.mode='bend';IN.bendEdge=hit.edge;IN.originalBend=hit.edge.bend;}
      else toast('Drag the middle of an existing road to reshape it');
      return;
    }
    case 'UPGRADE': {
      const hit = edgeAt(IN.mouse, 4);
      if (hit && hit.edge.type !== 'RING') {
        if (hit.edge.type === W.roadType && ROADS[hit.edge.type].oneway) {
          NET.reverseOneWay(hit.edge); markReroute(); toast('One-way direction reversed');
        }
        else if (hit.edge.type === W.roadType) toast(`Already a ${ROADS[W.roadType].name.toLowerCase()}`);
        else { NET.setType(hit.edge, W.roadType); markReroute(); toast(`Upgraded to ${ROADS[W.roadType].name}`); }
      }
      IN.mode = 'idle'; return;
    }
    case 'JUNCTION': {
      const n = nodeAt(IN.mouse);
      if (n && !n.isRing && n.degree >= 3) { NET.cycleControl(n); toast(`Junction set to ${n.control.toLowerCase()}`); }
      else if (n && n.isRing) toast('Roundabouts always yield');
      IN.mode = 'idle'; return;
    }
    case 'PRIORITY': {
      const target = priorityArmAt(IN.mouse);
      if (target) {
        const wasSelected = target.node.control === 'PRIORITY' && target.node.priorityEdges.has(target.edge.id);
        togglePriorityArm(target.node, target.edge);
        if (wasSelected) toast(target.node.control === 'YIELD' ? 'Priority road cleared · junction now yields' : 'Priority approach removed');
        else toast('Priority approach added');
      } else toast('Click a road arm near a junction with 3+ arms');
      IN.mode = 'idle'; return;
    }
    case 'ROUNDABOUT': {
      const n = nodeAt(IN.mouse);
      if (n && n.isRing) { NET.removeRoundabout(n.ringId); toast('Roundabout removed'); }
      else if (n && n.degree >= 3) {
        let hw = 12;
        for (const ed of n.edges) hw = Math.max(hw, ed.halfWidth);
        const R = clamp(hw * 2.1 + n.degree * 6 + 10, 40, 130);
        if (NET.makeRoundabout(n, R)) toast('Roundabout built');
      } else toast('Pick a junction with 3+ roads');
      IN.mode = 'idle'; return;
    }
    case 'BULLDOZE': {
      IN.mode = 'bulldoze';
      bulldozeAt(IN.mouse);
      return;
    }
  }
});

function bulldozeAt(p) {
  const b = CITY.buildingAt(p, 4);          // buildings sit on top, so hit them first
  if (b) { CITY.demolish(b); return; }
  const hit = edgeAt(p, 2);
  if (hit) { if(hit.edge.type==='RING') NET.removeRoundabout(hit.edge.n1.ringId); else NET.removeEdge(hit.edge); CITY.reattachDirty=true;markReroute(); return; }
  const n = nodeAt(p, 20);
  if (n) { for (const ed of n.edges.slice()) NET.removeEdge(ed); markReroute(); }
}

cv.addEventListener('pointermove', e => {
  const r = cv.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  IN.moved += Math.hypot(sx - IN.screen.x, sy - IN.screen.y);
  IN.screen = { x: sx, y: sy };
  IN.mouse = CAM.toWorld(sx, sy, cw, ch);

  switch (IN.mode) {
    case 'presort-resize': {
      const drag=IN.pocketDrag;
      const lane=drag.node.lanesIn.find(l=>l.edge===drag.edge && l.pocket===drag.side);
      if (!lane) { cancelDrawing(); return; }
      const nearest=lane.path.nearest(IN.mouse);
      drag.preview=clamp(lane.length-nearest.s,45,pocketLimit(drag.edge,drag.node));
      return;
    }
    case 'pan':
      CAM.tx = clamp(IN.panFrom.cx - (sx - IN.panFrom.sx) / CAM.z, -400, CFG.WORLD_W + 400);
      CAM.ty = clamp(IN.panFrom.cy - (sy - IN.panFrom.sy) / CAM.z, -400, CFG.WORLD_H + 400);
      return;
    case 'car-select':
      return;
    case 'bulldoze-pending':
      if (IN.moved >= 4) {
        IN.mode = 'bulldoze';
        bulldozeAt(IN.mouse);
      }
      return;
    case 'zone':
      CITY.paint(IN.mouse, IN.brush, IN.erase ? ZONE_NONE : W.zoneType);
      return;
    case 'zone-rectangle':
      return;
    case 'bulldoze':
      bulldozeAt(IN.mouse);
      return;
    case 'lane-connect':
      IN.laneToLane = laneEndpointAt(W.laneEditNode, IN.mouse, false);
      return;
    case 'bend': {
      const e2 = IN.bendEdge;
      const a = e2.n1.pos, b = e2.n2.pos;
      const n = V.rn(V.norm(V.sub(b, a)));
      const mid = V.mix(a, b, 0.5);
      const lim = V.dist(a, b) * 0.42;
      const result=reshapeRoad(e2,clamp(V.dot(V.sub(IN.mouse, mid), n), -lim, lim));
      if(!result.ok&&IN.msg!==result.msg) toast(result.msg);
      IN.msg=result.msg;
      return;
    }
    case 'build': {
      IN.endPt=drawingPoint(IN.mouse,IN.startPt);
      const v = evaluateBuild(IN.startPt, IN.endPt, W.roadType);
      IN.valid = v.ok; IN.msg = v.ok ? v.msg : v.msg;
      return;
    }
    case 'curve': {
      const n=V.rn(V.norm(V.sub(IN.endPt,IN.startPt))),mid=V.mix(IN.startPt,IN.endPt,.5);
      IN.bend=clamp(V.dot(V.sub(IN.mouse,mid),n),-V.dist(IN.startPt,IN.endPt)*.42,V.dist(IN.startPt,IN.endPt)*.42);
      IN.msg='Move to shape the curve · Click to build · Esc to cancel';
      return;
    }
  }
  IN.hoverNode = nodeAt(IN.mouse);
  const hit = IN.hoverNode ? null : edgeAt(IN.mouse, 2);
  IN.hoverEdge = hit ? hit.edge : null;
  IN.hoverBuilding = (IN.hoverNode || IN.hoverEdge) ? null : CITY.buildingAt(IN.mouse, 4);
  IN.hoverPriorityArm = W.tool === 'PRIORITY' ? priorityArmAt(IN.mouse) : null;
  IN.hoverPreSortingArm = W.tool === 'PRE_SORTING' ? preSortingArmAt(IN.mouse) : null;
  IN.hoverLaneIn = W.tool === 'LANE_CONNECTIONS' && W.laneEditNode
    ? laneEndpointAt(W.laneEditNode, IN.mouse, true) : null;
  IN.hoverLaneOut = W.tool === 'LANE_CONNECTIONS' && W.laneEditNode
    ? laneEndpointAt(W.laneEditNode, IN.mouse, false) : null;
});

cv.addEventListener('pointerup', e => {
  const mode = IN.mode;
  if (mode === 'bulldoze-pending') {
    const r = cv.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    IN.screen = { x: sx, y: sy };
    IN.mouse = CAM.toWorld(sx, sy, cw, ch);
    const car = carAtPoint(IN.mouse);
    if (car) {
      W.selectedCar = car;
      syncUI();
    } else if (W.cityRemovalEnabled) {
      bulldozeAt(IN.mouse);
      CITY.reattachDirty = true;
    }
    IN.mode = 'idle';
    return;
  }
  if (mode === 'presort-resize') {
    const drag=IN.pocketDrag;
    if(drag && drag.preview!==undefined) resizePreSorting(drag.node,drag.edge,drag.side,drag.preview);
    IN.mode='idle'; IN.pocketDrag=null; syncUI(); return;
  }
  if(mode==='curve') return;
  if (mode === 'zone-rectangle') {
    const r = cv.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    IN.moved += Math.hypot(sx - IN.screen.x, sy - IN.screen.y);
    IN.screen = { x: sx, y: sy };
    IN.mouse = CAM.toWorld(sx, sy, cw, ch);
    const type = IN.erase ? ZONE_NONE : W.zoneType;
    if (IN.moved < 4) {
      const cell = CITY.cellOf(IN.zoneStart);
      CITY.applyZoneCell(cell.cx, cell.cy, type);
    } else {
      CITY.paintRectangle(IN.zoneStart, IN.mouse, type);
    }
    CITY.reattachDirty = true;
    IN.mode = 'idle'; IN.zoneStart = null;
    return;
  }
  if (mode === 'lane-connect') {
    const r = cv.getBoundingClientRect();
    IN.mouse = CAM.toWorld(e.clientX - r.left, e.clientY - r.top, cw, ch);
    const fromLane = IN.laneFromLane;
    if (IN.moved < 4) {
      IN.mode = 'idle'; IN.laneFromLane = null; IN.laneToLane = null;
      syncUI();
      return;
    }
    const toLane = laneEndpointAt(W.laneEditNode, IN.mouse, false);
    if (fromLane && toLane) {
      const result = NET.toggleLaneConnection(W.laneEditNode, fromLane, toLane);
      if (result.ok) toast(result.added ? 'Lane connection added' : 'Lane connection removed');
      else toast(result.msg);
    } else {
      toast('Finish the drag at an outgoing lane end');
    }
    IN.mode = 'idle'; IN.laneFromLane = null; IN.laneToLane = null;
    syncUI();
    return;
  }
  if (mode === 'build') {
    if(IN.moved<6) {cancelDrawing();return;}
    const v=evaluateBuild(IN.startPt,IN.endPt,W.roadType);
    if(!v.ok) {cancelDrawing();toast(v.msg);return;}
    if(EDIT.drawMode==='curve') {IN.mode='curve';IN.msg='Move to shape the curve · Click to build';return;}
    commitDrawing();return;
  }
  if (mode === 'zone' || mode === 'bulldoze') CITY.reattachDirty = true;
  IN.mode='idle';
  IN.startNode = null; IN.startPt = null; IN.bendEdge = null; IN.panFrom = null;
});
cv.addEventListener('pointercancel', cancelDrawing);

cv.addEventListener('wheel', e => {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  if (W.tool === 'ZONE' && e.ctrlKey) {
    IN.brush = clamp(IN.brush * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 24, 220);
    return;
  }
  const before = CAM.toWorld(sx, sy, cw, ch);
  CAM.tz = clamp(CAM.tz * (e.deltaY < 0 ? 1.13 : 1 / 1.13), 0.18, 3.2);
  CAM.z = CAM.tz;
  const after = CAM.toWorld(sx, sy, cw, ch);
  CAM.tx += before.x - after.x; CAM.ty += before.y - after.y;
  CAM.x = CAM.tx; CAM.y = CAM.ty;
}, { passive: false });

const TOOL_KEYS = { '1': 'ROAD', '2': 'ZONE', '3': 'UPGRADE', '4': 'JUNCTION', '5': 'ROUNDABOUT' };
window.addEventListener('keydown', e => {
  if(e.target && (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.target.isContentEditable)) return;
  if(e.ctrlKey||e.metaKey||e.altKey) return;
  if(e.key==='Escape') {cancelDrawing();return;}
  if (e.code === 'Space') { IN.space = true; e.preventDefault(); }
  const k = e.key.toLowerCase();
  if (PAN_KEYS.includes(k)) { IN.panKeys[k] = true; e.preventDefault(); return; }
  if (e.key === '6') {
    if (W.tool === 'BULLDOZE') toggleCityRemoval();
    else { setTool('BULLDOZE'); toggleCityRemoval(true); }
    return;
  }
  if (TOOL_KEYS[e.key]) setTool(TOOL_KEYS[e.key]);
  if(k==='g') {cancelDrawing();EDIT.grid=!EDIT.grid;syncUI();}
  if(k==='c') {cancelDrawing();EDIT.drawMode=EDIT.drawMode==='straight'?'curve':'straight';setTool('ROAD');}
  if(k==='b') setTool('BEND');
  if (k === 'l') { W.debug = !W.debug; syncUI(); }
  if (k === 'p') { W.running = !W.running; syncUI(); }
  if (k === 'f') CAM.fit(cw, ch);
  if (k === 'q') { const i = ROAD_ORDER.indexOf(W.roadType); setRoadType(ROAD_ORDER[(i + 1) % ROAD_ORDER.length]); }
});
window.addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  if (PAN_KEYS.includes(k)) IN.panKeys[k] = false;
  if (e.code === 'Space') IN.space = false;
});

function markReroute() { W.rerouteAll = true; }

/* ─────────────────────────  UI  ───────────────────────── */

const $ = id => document.getElementById(id);
let toastT = 0;

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  toastT = 1.9;
}
function hideTip() { const t = $('tip'); if (t) t.style.opacity = '0'; }

function toolCategory(t) {
  if (t === 'ZONE') return 'zones';
  if (t === 'JUNCTION' || t === 'ROUNDABOUT' || t === 'PRIORITY' || t === 'LANE_CONNECTIONS' || t === 'PRE_SORTING') return 'junctions';
  if (t === 'BULLDOZE') return 'city';
  return 'roads';
}

function setTool(t) {
  cancelDrawing();
  W.tool = t;
  if (t !== 'PRE_SORTING') {
    W.preSortingNode=null;
    IN.hoverPreSortingArm=null;
    IN.preSortingFlash=null;
  }
  if (t !== 'LANE_CONNECTIONS') {
    W.laneEditNode = null;
    W.laneEditSource = null;
  }
  syncUI();
  $('panel-road').style.display = (t === 'ROAD' || t === 'UPGRADE') ? '' : 'none';
  $('drawing-options').style.display = t === 'ROAD' ? '' : 'none';
  $('panel-zone').style.display = t === 'ZONE' ? '' : 'none';
  const hints = {
    ROAD: EDIT.drawMode === 'straight' ? 'Drag to build a straight road. Start or end on a road to connect it. G locks to the grid.' : 'Drag to set endpoints, release, then move to shape the curve. Click to build. Esc cancels.',
    BEND: 'Drag an existing road to reshape it. Escape restores its original shape.',
    ZONE: 'Circle: drag to paint. Rectangle: drag to fill a grid-aligned area. Right-click erases with the selected shape; Ctrl+wheel resizes the circle brush.',
    UPGRADE: 'Click a road to change it to the selected type. Select the same one-way type and click its road again to reverse its direction.',
    JUNCTION: 'Click a junction with 3+ arms to cycle signal → stop → yield.',
    ROUNDABOUT: 'Click a junction with 3+ arms to convert it. Click a ring to remove it.',
    PRIORITY: 'Click each road arm near a junction that should have priority. Click an arm again to remove it; select both sides of a through road.',
    LANE_CONNECTIONS: 'Select a junction. Click an incoming lane to select it, or drag to an outgoing lane to toggle that movement. Reset an edited lane to restore automatic turns.',
    PRE_SORTING: 'Select a crossing. Hover an incoming road arm for a green preview, then click to add or remove lanes. Drag blue handles to set lane lengths.',
    BULLDOZE: 'Click vehicles to inspect them. Toggle removal on to click or drag over roads and buildings.',
  };
  $('hint').textContent = hints[t];
}
function toggleCityRemoval(force) {
  W.cityRemovalEnabled = typeof force === 'boolean' ? force : !W.cityRemovalEnabled;
  if (!W.cityRemovalEnabled && (IN.mode === 'bulldoze-pending' || IN.mode === 'bulldoze')) IN.mode = 'idle';
  syncUI();
}
function setRoadType(t) { W.roadType = t; syncUI(); }
function setZoneType(z) { W.zoneType = z; syncUI(); }
function setZoneShape(shape) {
  if (shape !== 'circle' && shape !== 'rectangle') return;
  if (IN.mode === 'zone-rectangle') cancelDrawing();
  W.zoneShape = shape;
  syncUI();
}

function diagnosticLaneLabel(lane) {
  if (!lane) return 'None';
  return `road ${lane.edge.id} ${lane.forward ? '→' : '←'} lane ${lane.idx}`;
}

function diagnosticTrackLabel(track) {
  if (!track) return 'None';
  if (track.kind === 'LANE') return `${diagnosticLaneLabel(track)} · track ${track.id}`;
  if (track.kind === 'CONN') return `connector ${track.id} · ${diagnosticLaneLabel(track.fromLane)} → ${diagnosticLaneLabel(track.toLane)}`;
  return `${track.kind || 'track'} ${track.id}`;
}

function diagnosticConnectorLabel(connector) {
  return connector && connector.kind === 'CONN'
    ? `connector ${connector.id}: ${diagnosticLaneLabel(connector.fromLane)} → ${diagnosticLaneLabel(connector.toLane)}`
    : 'None';
}

function diagnosticNumber(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function renderCarInspector() {
  const card = $('car-inspector');
  if (!card) return;
  const car = W.selectedCar;
  const live = car && W.cars.includes(car) && !car.dead;
  if (!live) {
    if (car && !W.cars.includes(car)) W.selectedCar = null;
    card.hidden = true;
    return;
  }
  if (toolCategory(W.tool) !== 'city') { card.hidden = true; return; }
  card.hidden = false;

  const roadTraffic = !!car.track && car.phase !== 'ENTER' && car.phase !== 'VISIT';
  const diagnostic = car.lastMotionDiagnostic || {};
  const set = (id, value) => { $(id).textContent = value; };
  set('car-debug-identity', `#${car.id} · ${car.kind} · ${car.phase}`);
  set('car-debug-speed', roadTraffic
    ? `${diagnosticNumber(car.v)} / ${diagnosticNumber(diagnostic.desiredSpeed)} map units/s`
    : `${diagnosticNumber(car.v)} map units/s · desired speed unavailable`);
  set('car-debug-stopped', roadTraffic ? `${diagnosticNumber(car.stationarySeconds)} sim s continuously stopped` : 'Not in road traffic');

  if (!roadTraffic) {
    set('car-debug-track', 'Not in road traffic');
    set('car-debug-route', 'Not in road traffic');
    set('car-debug-leader', 'Not in road traffic');
    set('car-debug-claim', 'Not in road traffic');
    set('car-debug-wait', car.waitReason ? car.waitReason.replace(/-/g, ' ') : 'None');
    set('car-debug-limiter', 'Not in road traffic');
    set('car-debug-speed-caps', 'Not in road traffic');
    return;
  }

  set('car-debug-track', `${diagnosticTrackLabel(car.track)} · s ${diagnosticNumber(car.s)} / ${diagnosticNumber(car.track.length)}`);
  const route = car.route.slice(car.ri, car.ri + 8).map(track =>
    track.kind === 'CONN' ? `C${track.id}` : `R${track.edge.id}${track.forward ? '→' : '←'}L${track.idx}`);
  if (car.route.length - car.ri > 8) route.push('…');
  const next = car.route[car.ri + 1];
  const target = car.target;
  set('car-debug-route', `Target building ${target ? `#${target.id}` : 'None'} · intended ${diagnosticLaneLabel(car.goalLane)} at s ${diagnosticNumber(car.goalS)} · next ${diagnosticConnectorLabel(next)} · route ${route.join(' → ') || 'None'}`);

  const leader = diagnostic.leader;
  set('car-debug-leader', leader
    ? `#${leader.id} · on ${leader.vehicleTrackLabel || `track ${leader.vehicleTrackId ?? 'None'}`} · gap ${diagnosticNumber(leader.gap)} · speed ${diagnosticNumber(leader.speed)} · measured on ${leader.measuredTrackLabel || `track ${leader.measuredTrackId ?? 'None'}`}`
    : 'None (route scan found no leader)');

  const claim = car.claim;
  set('car-debug-claim', claim
    ? `${diagnosticConnectorLabel(claim)} · age ${diagnosticNumber(car.claimT)} sim s · ${car.claimRenewalsWhileStopped} re-grants during this stop`
    : `None · ${car.claimRenewalsWhileStopped} re-grants during this stop`);
  set('car-debug-wait', car.waitReason ? car.waitReason.replace(/-/g, ' ') : 'None');

  const limiterLabels = {
    'leader-following': 'Leader following', 'junction-region': 'Junction region',
    'lane-merge-hold': 'Lane merge hold', yield: 'Yield',
    'unclaimed-stop-line': 'Unclaimed stop line', 'destination-stop': 'Destination stop',
    'connector-entry-speed': 'Connector entry speed', 'speed-target': 'Speed target',
    'acceleration-clamp': 'Acceleration limit', 'leader-gap': 'Leader gap',
  };
  const limiters = diagnostic.limiters || [];
  const limiterText = limiters.length ? limiters.map(limit => {
    const name = limiterLabels[limit.name] || limit.name.replace(/-/g, ' ');
    const amount = limit.kind === 'advance'
      ? `advance ${diagnosticNumber(limit.value, 2)} map units`
      : `accel ${diagnosticNumber(limit.value)} map units/s²`;
    const gap = Number.isFinite(limit.gap) ? `, gap ${diagnosticNumber(limit.gap)} map units` : '';
    const targetSpeed = Number.isFinite(limit.targetSpeed) ? `, target ${diagnosticNumber(limit.targetSpeed)} map units/s` : '';
    return `${name} (${amount}${gap}${targetSpeed})`;
  }).join(' · ') : (diagnostic.limiter || 'No stop constraint');
  set('car-debug-limiter', limiterText);
  const caps = (diagnostic.speedCaps || []).filter(cap => Number.isFinite(cap.value))
    .map(cap => `${cap.name.replace(/-/g, ' ')} ${diagnosticNumber(cap.value)}`);
  set('car-debug-speed-caps', caps.length
    ? `${caps.join(' · ')} · desired ${diagnosticNumber(diagnostic.desiredSpeed)} map units/s`
    : 'None');
}

function syncUI() {
  for (const el of document.querySelectorAll('[data-tool]')) el.classList.toggle('on', el.dataset.tool === W.tool);
  for (const el of document.querySelectorAll('[data-road]')) el.classList.toggle('on', el.dataset.road === W.roadType);
  for (const el of document.querySelectorAll('[data-zone]')) el.classList.toggle('on', +el.dataset.zone === W.zoneType);
  for (const el of document.querySelectorAll('[data-zone-shape]')) {
    const active = el.dataset.zoneShape === W.zoneShape;
    el.classList.toggle('on', active);
    el.setAttribute('aria-pressed', String(active));
  }
  const category = toolCategory(W.tool);
  for (const el of document.querySelectorAll('[data-category]')) {
    const active = el.dataset.category === category;
    el.classList.toggle('on', active);
    el.setAttribute('aria-pressed', String(active));
  }
  for (const el of document.querySelectorAll('[data-category-panel]')) {
    el.hidden = el.dataset.categoryPanel !== category;
  }
  $('btn-pause').textContent = W.running ? 'Pause' : 'Resume';
  const cityRemoval = $('btn-city-removal');
  cityRemoval.classList.toggle('on', W.cityRemovalEnabled);
  cityRemoval.setAttribute('aria-pressed', String(W.cityRemovalEnabled));
  cityRemoval.setAttribute('aria-label', W.cityRemovalEnabled
    ? 'Turn off road and building removal' : 'Turn on road and building removal');
  $('city-removal-label').textContent = `Remove roads or buildings · ${W.cityRemovalEnabled ? 'On' : 'Off'}`;
  $('btn-speed').textContent = `Speed ${W.speed}×`;
  $('btn-debug').classList.toggle('on', W.debug);
  $('btn-pause').setAttribute('aria-label',W.running?'Pause simulation':'Resume simulation');
  $('btn-grid').setAttribute('aria-pressed',String(EDIT.grid));
  const laneControls = $('lane-edit-controls');
  $('pre-sorting-controls').hidden = W.tool !== 'PRE_SORTING';
  for(const count of [1,2]) {
    const button=$(count===1?'btn-presort-one':'btn-presort-two'),selected=W.preSortingCount===count;
    button.classList.toggle('on',selected);button.setAttribute('aria-pressed',String(selected));
  }
  $('btn-presort-remove').disabled = !preSortingHandles(W.preSortingNode).length;
  if (laneControls) laneControls.hidden = W.tool !== 'LANE_CONNECTIONS';
  const laneStatus = $('lane-edit-status');
  if (laneStatus) {
    if (!W.laneEditNode) laneStatus.textContent = 'Select a regular junction to show its lane connections.';
    else if (!W.laneEditSource) laneStatus.textContent = 'Drag from an incoming lane end to an outgoing lane end.';
    else laneStatus.textContent = laneRuleFor(W.laneEditNode, W.laneEditSource)
      ? 'Selected lane · Manual connections'
      : 'Selected lane · Automatic connections';
  }
  const laneReset = $('btn-lane-reset');
  if (laneReset) laneReset.disabled = !W.laneEditNode || !W.laneEditSource ||
    !laneRuleFor(W.laneEditNode, W.laneEditSource);
  for(const el of document.querySelectorAll('[data-draw]')) {el.classList.toggle('on',el.dataset.draw===EDIT.drawMode);el.setAttribute('aria-pressed',String(el.dataset.draw===EDIT.drawMode));}
  for (const el of document.querySelectorAll('[data-tool], [data-road]')) {
    const selected = el.dataset.category
      ? el.dataset.category === category
      : el.dataset.tool ? el.dataset.tool === W.tool : el.dataset.road === W.roadType;
    el.setAttribute('aria-pressed', String(selected));
  }
  renderCarInspector();
}

/* ─────────────────────────  scene setup  ───────────────────────── */

function restart(blankMap = false) {
  trafficDiagnostics=TrafficDiagnostics.createRecorder();
  diagnosticStartedAt=0;
  W.lastSafetyScan=null;
  cancelDrawing();
  _id = 0; _ringSeq = 0;
  if (!SEED_PARAM) SEED = ((Date.now() ^ (Math.random() * 1e9)) >>> 0);
  rng = makeRNG(SEED);
  NET.nodes = []; NET.edges = [];
  W.time = 0; W.cars = []; W.selectedCar = null; W.rings = new Map(); W.trips = []; W.stress = 0;
  W.peak = 0; W.running = true; W.builtRoad = 0;
  W.resumeTraffic=false;W.laneChanges=0;W.rerouteAll=false;acc=0;
  W.river = makeRiver();
  CITY.init();
  if (blankMap) CITY.reattachDirty = false;
  else {
    initScene();
    populateStarter();
  }
  CAM.fit(cw, ch);
  CAM.tz = Math.max(CAM.tz, 0.7);
  const tip = $('tip'); if (tip) tip.style.opacity = '1';
  syncUI();
}

/** A starter grid with zoned blocks, so the city has room to grow from. */
function initScene() {
  const cx = CFG.WORLD_W / 2, cy = CFG.WORLD_H / 2;
  const side = W.river.centre[6].x > cx ? -1 : 1;
  const columns = 4, rows = 5, spacing = 350;
  const centerX = cx + side * 700;
  const baseX = Math.round((centerX - (columns - 1) * spacing / 2) / 50) * 50;
  const baseY = Math.round((cy - (rows - 1) * spacing / 2) / 50) * 50;
  const nodes = Array.from({ length: rows }, (_, y) =>
    Array.from({ length: columns }, (_, x) => NET.addNode(baseX + x * spacing, baseY + y * spacing)));
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns - 1; x++) {
      if (y === 0 && x === 1) continue; // a useful missing connection to experiment with
      NET.addEdge(nodes[y][x], nodes[y][x + 1], y === 2 ? 'AVENUE' : 'STREET');
    }
  }
  for (let x = 0; x < columns; x++) {
    for (let y = 0; y < rows - 1; y++) NET.addEdge(nodes[y][x], nodes[y + 1][x], x === 2 ? 'AVENUE' : 'STREET');
  }
  for (const n of NET.nodes) if (n.degree >= 3) { n.control = 'SIGNAL'; buildSignal(n); }
  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < columns - 1; x++) {
      const zone = x === 2 ? ZONE_I : y === 1 ? ZONE_C : ZONE_R;
      const blockX = baseX + x * spacing + spacing / 2;
      const blockY = baseY + y * spacing + spacing / 2;
      CITY.paint({ x: blockX, y: blockY - 65 }, 132, zone);
      CITY.paint({ x: blockX, y: blockY + 65 }, 132, zone);
    }
  }
  CITY.reattachDirty=true;
}

function populateStarter() {
  CITY.rebuildCandidates();
  for(let i=0;i<190;i++) {CITY.develop();CITY.recompute();}
  for(let i=0;i<720;i++) simStep(1/60);
  for(const c of W.cars) {c.ppx=c.px;c.ppy=c.py;c.pang=c.ang;}
}

/* ─────────────────────────  §10  RENDERING  ───────────────────────── */

const LIGHT = (() => {
  const c = document.createElement('canvas');
  c.width = 160; c.height = 90;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 160, 0);
  grd.addColorStop(0, 'rgba(255,228,160,0.6)');
  grd.addColorStop(0.45, 'rgba(255,214,120,0.2)');
  grd.addColorStop(1, 'rgba(255,200,90,0)');
  g.fillStyle = grd;
  g.beginPath(); g.moveTo(0, 45); g.lineTo(160, 2); g.lineTo(160, 88); g.closePath(); g.fill();
  return c;
})();

function dayPhase() {
  const t = ((W.time / CFG.DAY_LENGTH) + 0.30) % 1;
  return { t, hour: t * 24, dark: clamp((Math.cos(t * TAU) + 0.35) / 1.05, 0, 1) * 0.7 };
}

const PALETTES={
  light:{ground:'#eeecdc',outside:'#e5e4d3',grid:'#afb69b55',border:'#aeb59a55',park:'#daddbd',trees:'#bac590',water:'#a6c9ca',water2:'#b8d4cf',bank:'#8fb7af',road:'#fffef6',roadEdge:'#b7bbaa',median:'#d6d7bf',lane:'#778779',centre:'#c2b36c',island:'#c0c990',text:'#3f6650',shadow:'#6d74502a'},
  dark:{ground:'#28332d',outside:'#222c27',grid:'#91a08633',border:'#a2ad8c33',park:'#334334',trees:'#465c42',water:'#365e63',water2:'#2d4d53',bank:'#598182',road:'#586760',roadEdge:'#172a24',median:'#344237',lane:'#c5d2bd',centre:'#d0be79',island:'#526844',text:'#d0e0b7',shadow:'#0004'}
};
let P=PALETTES[theme];
function applyTheme(value) {
  theme=value==='dark'?'dark':'light';P=PALETTES[theme];
  document.documentElement.dataset.theme=theme;
  for(const r of Object.values(ROADS)) r.surf=P.road;
  $('btn-theme').innerHTML=theme==='light'?'☾ <span>Dark mode</span>':'☀ <span>Light mode</span>';
  $('btn-theme').setAttribute('aria-label',theme==='light'?'Switch to dark mode':'Switch to light mode');
  try{localStorage.setItem('arterial-theme',theme);}catch(_){}
}

function applySidebarTextSize() {
  const sidebar = $('sidebar');
  const button = $('btn-text-size');
  const action = sidebarTextLarge ? 'Use standard City Tools text size' : 'Increase City Tools text size';
  sidebar.classList.toggle('text-large', sidebarTextLarge);
  button.textContent = sidebarTextLarge ? 'A−' : 'A+';
  button.setAttribute('aria-pressed', String(sidebarTextLarge));
  button.setAttribute('aria-label', action);
  button.title = action;
}

function viewBounds() {
  const a = CAM.toWorld(0, 0, cw, ch), b = CAM.toWorld(cw, ch, cw, ch);
  return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
}

function drawGround(vb) {
  ctx.fillStyle = P.outside;
  ctx.fillRect(vb.x0 - 20, vb.y0 - 20, vb.x1 - vb.x0 + 40, vb.y1 - vb.y0 + 40);
  ctx.fillStyle = P.ground;
  ctx.fillRect(0, 0, CFG.WORLD_W, CFG.WORLD_H);
  // A quiet, reproducible landscape leaves the road geometry easy to read.
  ctx.fillStyle=P.park;
  for(let i=0;i<12;i++) {
    const x=180+(i*647+SEED%487)%Math.max(1,CFG.WORLD_W-360),y=120+(i*479+SEED%331)%Math.max(1,CFG.WORLD_H-240);
    ctx.beginPath();ctx.ellipse(x,y,85+(i%3)*35,55+(i%4)*25,i*.4,0,TAU);ctx.fill();
  }
  if(!EDIT.grid) return;
  const g = CAM.z<.4?100:50;
  ctx.strokeStyle = P.grid;
  ctx.lineWidth = 1 / CAM.z;
  ctx.beginPath();
  for (let x = Math.max(0, Math.floor(vb.x0 / g) * g); x < Math.min(vb.x1, CFG.WORLD_W); x += g) {
    ctx.moveTo(x, Math.max(vb.y0, 0)); ctx.lineTo(x, Math.min(vb.y1, CFG.WORLD_H));
  }
  for (let y = Math.max(0, Math.floor(vb.y0 / g) * g); y < Math.min(vb.y1, CFG.WORLD_H); y += g) {
    ctx.moveTo(Math.max(vb.x0, 0), y); ctx.lineTo(Math.min(vb.x1, CFG.WORLD_W), y);
  }
  ctx.stroke();
  ctx.strokeStyle = P.border;
  ctx.lineWidth = 2 / CAM.z;
  ctx.strokeRect(0, 0, CFG.WORLD_W, CFG.WORLD_H);
}

function drawZones(vb) {
  if(W.tool!=='ZONE' && !W.debug) return;
  const C = CFG.CELL;
  const x0 = clamp(Math.floor(vb.x0 / C), 0, CITY.cols - 1), x1 = clamp(Math.ceil(vb.x1 / C), 0, CITY.cols - 1);
  const y0 = clamp(Math.floor(vb.y0 / C), 0, CITY.rows - 1), y1 = clamp(Math.ceil(vb.y1 / C), 0, CITY.rows - 1);
  for (const z of [1, 2, 3]) {
    ctx.beginPath();
    let any = false;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (CITY.zone[cy * CITY.cols + cx] !== z) continue;
        ctx.rect(cx * C + 0.6, cy * C + 0.6, C - 1.2, C - 1.2);
        any = true;
      }
    }
    if (!any) continue;
    ctx.fillStyle = ZONE_COL[z] + '22';
    ctx.fill();
  }
}

function drawRiver() {
  const poly = W.river.poly;
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, CFG.WORLD_H);
  g.addColorStop(0, P.water); g.addColorStop(1, P.water2);
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = P.bank; ctx.lineWidth = 3 / CAM.z; ctx.stroke();
  ctx.save(); ctx.clip();
  ctx.strokeStyle = 'rgba(225,250,240,0.12)'; ctx.lineWidth = 2;
  ctx.beginPath();
  const c = W.river.centre;
  for (let k = -2; k <= 2; k++) {
    for (let i = 0; i < c.length; i++) {
      const off = k * 22 + Math.sin(W.time * 0.5 + i * 0.7 + k) * 7;
      if (i === 0) ctx.moveTo(c[i].x + off, c[i].y); else ctx.lineTo(c[i].x + off, c[i].y);
    }
  }
  ctx.stroke(); ctx.restore();
}

function strokePath(path, width, color, dash) {
  ctx.beginPath(); path.stroke(ctx);
  ctx.lineWidth = width; ctx.strokeStyle = color; ctx.lineCap = 'round';
  ctx.setLineDash(dash || []);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawRoads(detail) {
  for (const e of NET.edges) {
    if (!e.centre) continue;
    if(e.pocketSurface) {ctx.beginPath();tracePreSortingSurface(e);ctx.fillStyle=P.roadEdge;ctx.fill();ctx.lineWidth=5;ctx.strokeStyle=P.roadEdge;ctx.lineJoin='round';ctx.stroke();}
    else strokePath(e.centre, e.width + 5, P.roadEdge);
  }
  for (const e of NET.edges) {
    if (!e.centre) continue;
    if(e.pocketSurface) {ctx.beginPath();tracePreSortingSurface(e);ctx.fillStyle=P.road;ctx.fill();}
    else strokePath(e.centre, e.width, P.road);
  }
  // Keep the junction pad independent of approach pockets so one widened arm
  // cannot pull the whole crossing into a pointed polygon.
  for (const n of NET.nodes) {
    if (!n.degree || n.isRing) continue;
    let hw = 11, surf = P.road;
    for (const e of n.edges) if (e.halfWidth > hw) { hw = e.halfWidth; surf = e.spec.surf; }
    ctx.beginPath();
    ctx.arc(n.x, n.y, hw + 2, 0, TAU);
    ctx.fillStyle = surf; ctx.fill();
  }
  // roundabouts: a clean annulus plus a planted island
  for (const [, ring] of W.rings) {
    const hw = ring.hw || 9;
    ctx.beginPath(); ctx.arc(ring.cx, ring.cy, ring.R + hw, 0, TAU);
    ctx.fillStyle = ROADS.RING.surf; ctx.fill();
    ctx.beginPath(); ctx.arc(ring.cx, ring.cy, Math.max(4, ring.R - hw), 0, TAU);
    ctx.fillStyle = P.island; ctx.fill();
    ctx.strokeStyle = P.roadEdge; ctx.lineWidth = 1.6; ctx.stroke();
  }
  if (!detail) return;
  for (const e of NET.edges) if (e.centre) drawMarkings(e);
  for (const e of NET.edges) {
    if (!e.isBridge || !e.marks) continue;
    if (!e.marks.rails.length) e.buildMarkings();
    for (const p of e.marks.rails) strokePath(p, 2, 'rgba(150,190,240,0.45)');
  }
}

function lighten(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (n >> 16) + 22), g = Math.min(255, ((n >> 8) & 255) + 22), b = Math.min(255, (n & 255) + 26);
  return `rgb(${r},${g},${b})`;
}

function drawMarkings(e) {
  const sp = e.spec;
  const n = sp.lanes;
  // interior lane dividers within each direction (cached geometry)
  const mk = e.marks || (e.buildMarkings(), e.marks);
  ctx.globalAlpha = 0.5;
  for (const p of mk.dividers) strokePath(p, 1.2, P.lane, [11, 12]);
  ctx.globalAlpha = 1;

  if (sp.mark === 'dash') {
    ctx.globalAlpha = 0.45;
    strokePath(e.centre, 1.4, P.centre, [10, 11]);
    ctx.globalAlpha = 1;
  } else if (sp.mark === 'median') {
    strokePath(e.centre, sp.median * 2, P.median);
    ctx.globalAlpha = 0.65;
    for (const p of mk.medians) strokePath(p, 1.2, P.centre);
    ctx.globalAlpha = 1;
  }
  // one-way / ring direction arrows
  if (sp.oneway && e.centre.length > 60) {
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = P.lane;
    const count = Math.max(1, Math.floor(e.centre.length / 90));
    for (let i = 0; i < count; i++) {
      const s = e.centre.length * (i + 0.5) / count;
      const p = e.centre.pos(s), d = e.centre.dir(s), nn = V.rn(d);
      ctx.beginPath();
      ctx.moveTo(p.x + d.x * 6, p.y + d.y * 6);
      ctx.lineTo(p.x - d.x * 4 + nn.x * 3.4, p.y - d.y * 4 + nn.y * 3.4);
      ctx.lineTo(p.x - d.x * 4 - nn.x * 3.4, p.y - d.y * 4 - nn.y * 3.4);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function signalApproachActive(node,lane) {
  const sg=node.signal;
  return node.connectors.some(c=>sameGroup(c.fromLane,lane) &&
    (sg.movementGroup?.get(c.id) ?? sg.group.get(c.fromLane.id))===sg.idx);
}

function signalMovementAspect(node,conn) {
  const sg=node.signal;
  const phase=sg.movementGroup?.get(conn.id) ?? sg.group.get(conn.fromLane.id);
  return phase===sg.idx ? (sg.amber?'amber':'green') : 'red';
}

function drawSignals() {
  for (const n of NET.nodes) {
    if (n.control === 'SIGNAL' && n.signal && n.signal.phases > 1) {
      const sg = n.signal;
      for (const l of n.lanesIn) {
        const p = l.path.p2, d = l.path.tangent(1), nn = V.rn(d);
        const movements=n.connectors.filter(c=>c.fromLane===l).sort((a,b)=>a.turn-b.turn);
        for(let i=0;i<movements.length;i++) {
          const conn=movements[i],aspect=signalMovementAspect(n,conn);
          const offset=(i-(movements.length-1)/2)*3.3;
          const x=p.x+nn.x*offset-d.x*3,y=p.y+nn.y*offset-d.y*3;
          ctx.beginPath();ctx.arc(x,y,movements.length===1?2.6:1.4,0,TAU);
          ctx.fillStyle=aspect==='green'?'#3ddc97':aspect==='amber'?'#ffc23d':'#ff5f6d';ctx.fill();
          if(CAM.z>1.3) {
            ctx.save();ctx.translate(x-d.x*5,y-d.y*5);ctx.rotate(Math.atan2(d.y,d.x)+Math.PI/2);
            ctx.font='3.5px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
            ctx.fillText(conn.turn<-.45?'←':conn.turn>.45?'→':'↑',0,0);ctx.restore();
          }
        }
      }
    } else if (n.degree >= 3 && !n.isRing) {
      for (const l of n.lanesIn) {
        if (l.idx !== 0) continue;
        const p = l.path.p2, d = l.path.tangent(1), nn = V.rn(d);
        const x = p.x + nn.x * 7 - d.x * 2, y = p.y + nn.y * 7 - d.y * 2;
        ctx.beginPath();
        if (n.control === 'PRIORITY' && n.priorityEdges.has(l.edge.id)) {
          ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
          ctx.fillStyle = '#3ddc97'; ctx.fillRect(-2.8, -2.8, 5.6, 5.6);
          ctx.restore();
        } else if (n.control === 'STOP') {
          ctx.arc(x, y, 3.2, 0, TAU);
          ctx.fillStyle = '#e8434f'; ctx.fill();
        } else {
          ctx.moveTo(x, y - 3.4); ctx.lineTo(x + 3, y + 2.2); ctx.lineTo(x - 3, y + 2.2);
          ctx.closePath(); ctx.fillStyle = '#ffd479'; ctx.fill();
        }
      }
    }
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const BCOL = {
  R: ['#acbb83', '#9eaf70', '#8b9c61'],
  C: ['#94b9b2', '#7ca59d', '#68958c'],
  I: ['#d0bb86', '#bfaa72', '#b59b60'],
};

function drawBuildings(dark, detail) {
  for (const b of CITY.buildings) {
    const grow = clamp((W.time - b.born) / 0.8, 0, 1);
    const sz = b.size * (0.55 + 0.45 * grow);
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);
    const wob = 0.82 + b.seed * 0.36;
    const w = sz * wob, h = sz * (b.type === 'I' ? 0.86 : 0.95) / wob;
    ctx.fillStyle = P.shadow;
    roundRect(-w / 2 + 1.5, -h / 2 + 2, w, h, 3); ctx.fill();
    ctx.fillStyle = BCOL[b.type][b.level - 1];
    roundRect(-w / 2, -h / 2, w, h, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(62,77,47,0.25)'; ctx.lineWidth = 1; ctx.stroke();
    if (detail) {
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(-w / 2, -h / 2, w, Math.max(2, h * 0.22));
      // lit windows at night
      if (dark > 0.2 && CAM.z > 0.75) {
        ctx.fillStyle = `rgba(255,228,160,${0.2 + dark * 0.55})`;
        const cols = Math.min(4, Math.max(2, Math.round(w / 9))), rows = Math.min(3, Math.max(1, Math.round(h / 10)));
        for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
          if (((i * 7 + j * 3 + (b.seed * 97) | 0) % 5) === 0) continue;
          ctx.fillRect(-w / 2 + 2.5 + i * (w - 5) / cols, -h / 2 + 3 + j * (h - 6) / rows, 2.4, 2.4);
        }
      }
      if (b.service < 0.3) {
        ctx.fillStyle = '#ff5f6d';
        ctx.beginPath(); ctx.arc(0, -h / 2 - 4, 2.2, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }
}

function drawCars(alpha, detail) {
  for (const c of W.cars) {
    if (c.phase === 'VISIT' || (!c.track && c.phase !== 'ENTER')) continue;
    const x = lerp(c.ppx, c.px, alpha), y = lerp(c.ppy, c.py, alpha);
    const a = c.pang + angDiff(c.pang, c.ang) * alpha;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(-c.len / 2 + 1, -c.wide / 2 + 1.4, c.len, c.wide, 2.2); ctx.fill();
    ctx.fillStyle = c.color;
    roundRect(-c.len / 2, -c.wide / 2, c.len, c.wide, 2.2); ctx.fill();
    if (detail) {
      ctx.fillStyle = 'rgba(10,16,26,0.72)';
      if (c.kind === 'TRUCK') roundRect(c.len / 2 - 6, -c.wide / 2 + 1.2, 4, c.wide - 2.4, 1);
      else roundRect(0.4, -c.wide / 2 + 1.2, 4, c.wide - 2.4, 1);
      ctx.fill();
      if (c.v < 10) {
        ctx.fillStyle = 'rgba(255,70,70,0.85)';
        ctx.fillRect(-c.len / 2, -c.wide / 2 + 0.8, 1.4, 1.8);
        ctx.fillRect(-c.len / 2, c.wide / 2 - 2.6, 1.4, 1.8);
      }
    }
    if (c === W.selectedCar) {
      ctx.strokeStyle = '#cf67f2';
      ctx.lineWidth = 2.5 / CAM.z;
      ctx.setLineDash([]);
      roundRect(-c.len / 2 - 2 / CAM.z, -c.wide / 2 - 2 / CAM.z,
        c.len + 4 / CAM.z, c.wide + 4 / CAM.z, 3 / CAM.z);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawStreetlights(dark) {
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = dark * 0.45;
  for (const n of NET.nodes) {
    if (!n.degree) continue;
    const r = n.r + 34;
    const g = ctx.createRadialGradient(n.x, n.y, 2, n.x, n.y, r);
    g.addColorStop(0, 'rgba(180,205,255,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function drawHeadlights(alpha, dark) {
  if (dark < 0.12) return;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = clamp((dark - 0.1) / 0.6, 0, 1) * 0.7;
  for (const c of W.cars) {
    if (!c.track || c.phase === 'VISIT') continue;
    const x = lerp(c.ppx, c.px, alpha), y = lerp(c.ppy, c.py, alpha);
    const a = c.pang + angDiff(c.pang, c.ang) * alpha;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.drawImage(LIGHT, 4, -14, 50, 28);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function drawLaneConnectionEditor() {
  if (W.tool !== 'LANE_CONNECTIONS') return;
  const node = W.laneEditNode;
  if (!node) {
    if (IN.hoverNode && !IN.hoverNode.isRing && IN.hoverNode.degree >= 3) {
      ctx.beginPath(); ctx.arc(IN.hoverNode.x, IN.hoverNode.y, IN.hoverNode.r + 8, 0, TAU);
      ctx.strokeStyle = 'rgba(61,220,151,0.9)'; ctx.lineWidth = 2 / CAM.z; ctx.stroke();
    }
    return;
  }

  ctx.beginPath(); ctx.arc(node.x, node.y, node.r + 9, 0, TAU);
  ctx.strokeStyle = 'rgba(61,220,151,0.95)'; ctx.lineWidth = 2.5 / CAM.z; ctx.stroke();
  for (const connector of node.connectors) {
    const manual = !!laneRuleFor(node, connector.fromLane);
    strokePath(connector.path, (manual ? 2.8 : 2) / CAM.z,
      manual ? 'rgba(61,220,151,0.95)' : 'rgba(197,125,255,0.82)');
  }

  for (const lane of node.lanesIn) {
    const p = lane.path.p2, d = lane.path.tangent(1), rule = laneRuleFor(node, lane);
    const selected = lane === W.laneEditSource || lane === IN.laneFromLane;
    const hovered = lane === IN.hoverLaneIn;
    ctx.beginPath(); ctx.arc(p.x, p.y, (selected || hovered ? 6 : 4.5) / CAM.z, 0, TAU);
    ctx.fillStyle = rule ? '#3ddc97' : '#c57dff'; ctx.fill();
    ctx.lineWidth = 1.4 / CAM.z; ctx.strokeStyle = '#f2f4ff'; ctx.stroke();
    ctx.font = `${8 / CAM.z}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = rule ? '#3ddc97' : 'rgba(235,220,255,0.95)';
    ctx.fillText(rule ? 'MANUAL' : 'AUTO', p.x - d.x * 14, p.y - d.y * 14);
    if (selected) {
      ctx.beginPath(); ctx.arc(p.x, p.y, 8 / CAM.z, 0, TAU);
      ctx.strokeStyle = 'rgba(61,220,151,0.95)'; ctx.lineWidth = 2 / CAM.z; ctx.stroke();
    }
  }
  for (const lane of node.lanesOut) {
    const p = lane.path.p0, hovered = lane === IN.hoverLaneOut || lane === IN.laneToLane;
    ctx.beginPath(); ctx.arc(p.x, p.y, (hovered ? 6 : 4.5) / CAM.z, 0, TAU);
    ctx.fillStyle = hovered ? '#ffd479' : 'rgba(235,244,255,0.95)';
    ctx.fill(); ctx.lineWidth = 1.3 / CAM.z; ctx.strokeStyle = '#263647'; ctx.stroke();
  }

  if (IN.mode === 'lane-connect' && IN.laneFromLane) {
    const fromLane = IN.laneFromLane, toLane = IN.laneToLane || IN.hoverLaneOut;
    if (toLane) {
      const allowed = node.connectors.some(connector => connector.fromLane === fromLane && connector.toLane === toLane);
      const path = connectorPath(fromLane, toLane);
      const valid = fromLane.edge !== toLane.edge;
      strokePath(path, 3 / CAM.z, !valid ? 'rgba(255,95,109,0.95)' : allowed
        ? 'rgba(255,95,109,0.95)' : 'rgba(61,220,151,0.98)', [6 / CAM.z, 5 / CAM.z]);
    } else {
      const p = fromLane.path.p2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(IN.mouse.x, IN.mouse.y);
      ctx.setLineDash([6 / CAM.z, 5 / CAM.z]);
      ctx.strokeStyle = 'rgba(61,220,151,0.9)'; ctx.lineWidth = 2 / CAM.z; ctx.stroke(); ctx.setLineDash([]);
    }
  }
}

function drawOverlays() {
  // zone brush
  if (W.tool === 'ZONE') {
    const erasing = IN.erase && (IN.mode === 'zone' || IN.mode === 'zone-rectangle');
    const color = erasing ? 'rgba(255,120,130,0.8)' : ZONE_COL[W.zoneType] + 'cc';
    ctx.beginPath();
    if (W.zoneShape === 'rectangle') {
      if (IN.mode === 'zone-rectangle' && IN.zoneStart) {
        const b = zoneRectangleBounds(IN.zoneStart, IN.moved < 4 ? IN.zoneStart : IN.mouse);
        ctx.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      }
    } else {
      ctx.arc(IN.mouse.x, IN.mouse.y, IN.brush, 0, TAU);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6 / CAM.z;
    ctx.stroke();
    if (W.zoneShape === 'circle' || (IN.mode === 'zone-rectangle' && IN.zoneStart)) {
      ctx.fillStyle = W.zoneShape === 'circle' ? ZONE_COL[W.zoneType] + '14'
        : erasing ? 'rgba(255,120,130,0.08)' : ZONE_COL[W.zoneType] + '14';
      ctx.fill();
    }
  }
  // road preview
  if ((IN.mode === 'build' || IN.mode === 'curve') && IN.startPt && IN.endPt && IN.moved >= 6) {
    const end = nodeAt(IN.endPt,1);
    const target = IN.endPt;
    const spec = ROADS[W.roadType];
    ctx.beginPath();roadPath(IN.startPt,target,IN.bend).stroke(ctx);
    ctx.lineWidth = roadHalfWidth(spec) * 2; ctx.lineCap = 'round';
    ctx.strokeStyle = IN.valid ? 'rgba(87,147,92,0.35)' : 'rgba(220,95,80,0.35)';
    ctx.stroke();
    ctx.lineWidth = 1.5; ctx.setLineDash([7, 7]);
    ctx.strokeStyle = IN.valid ? P.text : '#d05e51';
    ctx.stroke(); ctx.setLineDash([]);
    if (end) { ctx.beginPath(); ctx.arc(end.x, end.y, end.r + 6, 0, TAU); ctx.strokeStyle = 'rgba(150,200,255,0.9)'; ctx.lineWidth = 2; ctx.stroke(); }
    const mid = V.mix(IN.startPt, target, 0.5);
    ctx.font = `${12 / CAM.z}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = IN.valid ? P.text : '#c45248';
    ctx.fillText(IN.msg, mid.x, mid.y - (roadHalfWidth(spec) + 12) / CAM.z);
  }
  drawLaneConnectionEditor();
  drawPreSortingEditor();
  // hover highlights for the contextual tools
  if (IN.mode === 'idle') {
    if ((W.tool === 'JUNCTION' || W.tool === 'ROUNDABOUT') && IN.hoverNode && IN.hoverNode.degree >= 3) {
      ctx.beginPath(); ctx.arc(IN.hoverNode.x, IN.hoverNode.y, IN.hoverNode.r + 7, 0, TAU);
      ctx.strokeStyle = 'rgba(150,200,255,0.9)'; ctx.lineWidth = 2 / CAM.z; ctx.stroke();
    }
    if (W.tool === 'PRE_SORTING') {
      const now = performance.now();
      const flash = IN.preSortingFlash && IN.preSortingFlash.until > now ? IN.preSortingFlash : null;
      const target = IN.hoverPreSortingArm || flash;
      if (target) {
        const fade = IN.hoverPreSortingArm ? 1 : clamp((flash.until - now) / 700, 0, 1);
        const record = target.node.preSorting[target.edge.id] || preSortingRecord(target.node, target.edge, W.preSortingCount);
        const pocketWidth = record ? (record.left ? 2 * LW : 0) + (record.right ? 2 * LW : 0) : 0;
        strokePath(target.edge.centre, target.edge.width + pocketWidth + 5, `rgba(61,220,151,${0.24 * fade})`);
        ctx.beginPath(); ctx.arc(target.node.x, target.node.y, target.node.r + 7, 0, TAU);
        ctx.strokeStyle = `rgba(61,220,151,${0.9 * fade})`; ctx.lineWidth = 2 / CAM.z; ctx.stroke();
      }
    }
    if (W.tool === 'PRIORITY' && IN.hoverPriorityArm) {
      const { node, edge } = IN.hoverPriorityArm;
      strokePath(edge.centre, edge.width + 5, 'rgba(61,220,151,0.28)');
      ctx.beginPath(); ctx.arc(node.x, node.y, node.r + 7, 0, TAU);
      ctx.strokeStyle = 'rgba(61,220,151,0.9)'; ctx.lineWidth = 2 / CAM.z; ctx.stroke();
    }
    if ((W.tool === 'UPGRADE' || W.tool === 'BULLDOZE' || W.tool === 'BEND') && IN.hoverEdge) {
      strokePath(IN.hoverEdge.centre, IN.hoverEdge.width + 4,
        W.tool === 'BULLDOZE' ? 'rgba(255,95,109,0.3)' : 'rgba(77,163,255,0.3)');
    }
    if (W.tool === 'BULLDOZE' && IN.hoverBuilding) {
      const b = IN.hoverBuilding;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.size * 0.75, 0, TAU);
      ctx.strokeStyle = 'rgba(255,95,109,0.9)'; ctx.lineWidth = 2 / CAM.z; ctx.stroke();
    }
  }
}

function drawDebug() {
  ctx.save();
  ctx.font=`${10 / CAM.z}px sans-serif`;ctx.textAlign='left';
  for(const c of W.cars) {
    if(!c.track || c.dead)continue;
    ctx.fillStyle=c.waitReason?'#f0a345':'#65cda0';
    const state=c.manoeuvre?`${c.laneState} ${Math.round(c.manoeuvre.progress*100)}%`:c.laneState;
    ctx.fillText(`${c.id}: ${state} → lane ${c.wantIdx ?? '—'} · ${c.waitReason || (c.claim?'reserved':'following')}`,
      c.px+10/CAM.z,c.py-12/CAM.z);
    const planned=c.route[c.ri+1],gaps=c.gapConstraints;
    const gap=value=>Number.isFinite(value)?`${(value/CFG.WORLD_UNITS_PER_METRE).toFixed(1)} m`:'clear';
    const detail=[planned?.kind==='CONN'?`movement ${planned.id}`:null,
      gaps?`front ${gap(gaps.front)} / rear ${gap(gaps.rear)}`:null,c.mergeFailure,
      c.reservationLeadTime!==null && c.reservationLeadTime!==undefined?`reservation ${c.reservationLeadTime.toFixed(1)}s`:null].filter(Boolean);
    if(detail.length)ctx.fillText(detail.join(' · '),c.px+10/CAM.z,c.py-1/CAM.z);
    if(c.manoeuvre) {
      const m=c.manoeuvre,p=m.target.pos(c.s*m.target.length/m.source.length);
      ctx.strokeStyle='#65cda0';ctx.beginPath();ctx.moveTo(c.px,c.py);ctx.lineTo(p.x,p.y);ctx.stroke();
    }
  }
  ctx.restore();
  for (const e of NET.edges) {
    for (const l of e.lanes) {
      const h = clamp(l.load, 0, 1);
      if(l.pocket) {
        const mouth=l.pos(l.startS);
        ctx.beginPath();ctx.arc(mouth.x,mouth.y,4/CAM.z,0,TAU);
        ctx.strokeStyle='#e9a23b';ctx.lineWidth=1/CAM.z;ctx.stroke();
      }
      strokePath(l.path, 1.8, `rgba(${(70 + h * 185) | 0},${(220 - h * 175) | 0},${(255 - h * 165) | 0},0.75)`);
      const m = l.pos(Math.max(l.length - 7, 0)), d = l.dir(Math.max(l.length - 7, 0));
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x - d.x * 6 - d.y * 3.4, m.y - d.y * 6 + d.x * 3.4);
      ctx.lineTo(m.x - d.x * 6 + d.y * 3.4, m.y - d.y * 6 - d.x * 3.4);
      ctx.closePath(); ctx.fillStyle = 'rgba(120,220,255,0.8)'; ctx.fill();
    }
  }
  for (const n of NET.nodes) {
    for (const c of n.connectors) {
      const busy = n.occ.get(c.id);
      strokePath(c.path, busy ? 2.4 : 1, busy ? 'rgba(255,95,109,0.95)' : 'rgba(200,120,255,0.3)');
    }
    ctx.strokeStyle = 'rgba(255,180,80,0.08)';
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    for (const c of n.connectors) {
      const a = c.pos(c.length / 2);
      for (const o of c.conflicts) {
        if (o.id < c.id) continue;
        const b = o.pos(o.length / 2);
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath();
  for (const c of W.cars) {
    if (!c.track || c.phase === 'VISIT') continue;
    const l = c.track.leaderAfter(c.s, c);
    if (!l) continue;
    const actual=l.owner || l;
    ctx.moveTo(c.px, c.py); ctx.lineTo(actual.px, actual.py);
  }
  ctx.stroke();
  // buildings' kerb attachment
  ctx.strokeStyle = 'rgba(120,255,180,0.22)';
  ctx.beginPath();
  for (const b of CITY.buildings) {
    const l = b.lane; if (!l) continue;
    const p = l.pos(b.s);
    ctx.moveTo(b.x, b.y); ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

/* ─────────────────────────  §11  SIM STEP  ───────────────────────── */

function collectTracks() {
  const out = [];
  for (const e of NET.edges) for (const l of e.lanes) out.push(l);
  for (const n of NET.nodes) for (const c of n.connectors) out.push(c);
  return out;
}

function reattachBuildings() {
  const live = new Set(NET.edges);
  for (const e of NET.edges) for (const l of e.lanes) l.buildings.length = 0;
  for (const b of CITY.buildings) {
    if (!b.edge || !live.has(b.edge)) CITY.attach(b);
    const l = b.lane;
    if (l) l.buildings.push(b);
  }
}

function simStep(dt) {
  const cpuStart=performance.now();
  const flushDiagnosticWait = car => {
    const seconds=Number(car.diagnosticWaitSeconds)||0;
    if(seconds>0)trafficDiagnostics.recordWait({vehicleId:car.id,
      reason:car.diagnosticWaitReason,seconds});
    car.diagnosticWaitSeconds=0;
    car.diagnosticWaitReason=null;
  };
  if(W.resumeTraffic) {
    for(const b of CITY.buildings) if(b.type!=='C') b.outTimer=Math.min(b.outTimer,2+rng()*6);
    W.resumeTraffic=false;
  }
  W.time += dt;
  const { hour } = dayPhase();

  updateSignals(dt);

  if (W.rerouteAll) { for (const c of W.cars) c.needsReroute = true; W.rerouteAll = false; }
  if (CITY.reattachDirty) { reattachBuildings(); CITY.rebuildCandidates(); CITY.reattachDirty = false; }
  CITY.candT -= dt;
  if (CITY.candT <= 0) { CITY.candT = 2.5; CITY.rebuildCandidates(); }

  for (const c of W.cars) if (!c.dead && c.phase !== 'VISIT') resyncTrack(c);

  const tracks = collectTracks();
  const set = new Set(tracks);
  for (const c of W.cars) if (c.track && !set.has(c.track)) { set.add(c.track); tracks.push(c.track); }
  for (const t of tracks) t.vehicles.length = 0;
  for (const c of W.cars) {
    if (c.dead || c.phase === 'VISIT' || !c.track) continue;
    c.track.vehicles.push(c);
    if(c.manoeuvre)c.manoeuvre.target.vehicles.push(c.manoeuvre.ghost);
  }
  for (const t of tracks) {
    t.vehicles.sort((a, b) => a.s - b.s);
    const cap = Math.max(1, (t.length-(t.startS||0)) / (CFG.CAR_L + CFG.IDM_S0 + 7));
    t.load = lerp(t.load, clamp(t.vehicles.length / cap, 0, 1), 0.07);
  }

  arbitrate(W.cars);
  for(const c of W.cars) {
    if(!c.claim) {c.diagnosticClaim=null;continue;}
    if(c.diagnosticClaim===c.claim)continue;
    c.diagnosticClaim=c.claim;
    trafficDiagnostics.recordReservation({vehicleId:c.id,leadTime:c.reservationLeadTime ?? 0,grantedAt:W.time});
  }

  for (const c of W.cars) {
    if (c.dead || c.phase === 'VISIT') {
      flushDiagnosticWait(c);
      if(c.dead)trafficDiagnostics.forgetVehicle(c.id);
      c.step(dt); continue;
    }
    considerLaneChange(c, dt);
    if (c.dead) {
      flushDiagnosticWait(c);
      trafficDiagnostics.forgetVehicle(c.id);
      continue;
    }
    c.step(dt);
    if (c.dead) {
      flushDiagnosticWait(c);
      trafficDiagnostics.forgetVehicle(c.id);
      continue;
    }
    c.pose();
    const activeTraffic=!c.dead && c.track && c.phase!=='ENTER' && c.phase!=='VISIT';
    const waiting=activeTraffic && c.v<6 ? (c.waitReason || 'leader-or-destination') : null;
    if(c.diagnosticWaitReason!==waiting || c.diagnosticWaitSeconds>=1) {
      flushDiagnosticWait(c);c.diagnosticWaitReason=waiting;
    }
    if(waiting)c.diagnosticWaitSeconds=(c.diagnosticWaitSeconds||0)+dt;
    if(c.dead)trafficDiagnostics.forgetVehicle(c.id);
  }
  if(W.debug || W.safetyChecks) {
    W.lastSafetyScan=TrafficDiagnostics.detectSweptOverlaps(W.cars,{maxVehicles:Math.max(CFG.MAX_CARS,W.cars.length)});
    trafficDiagnostics.recordSafety(W.lastSafetyScan);
  }

  let removed = false;
  for (const c of W.cars) if (c.dead) {
    removed = true; flushDiagnosticWait(c); trafficDiagnostics.forgetVehicle(c.id); c.releaseClaim();
  }
  if (removed) W.cars = W.cars.filter(c => !c.dead);
  if (W.selectedCar && !W.cars.includes(W.selectedCar)) W.selectedCar = null;

  CITY.buildT -= dt;
  if (CITY.buildT <= 0) { CITY.buildT = CFG.BUILD_EVERY; CITY.develop(); }
  CITY.tickT += dt;
  if (CITY.tickT >= 1) { CITY.tickBuildings(CITY.tickT); CITY.recompute(); CITY.tickT = 0; }
  CITY.spawn(dt, hour);

  W.peak = Math.max(W.peak, W.cars.length);
  let sum = 0, n = 0;
  for (const c of W.cars) {
    if (!c.track || c.phase === 'VISIT') continue;
    sum += clamp(1 - c.v / c.v0, 0, 1); n++;
  }
  W.stress = lerp(W.stress, n ? sum / n : 0, 0.04);
  trafficDiagnostics.recordPerformance({frameMs:performance.now()-cpuStart,vehicleCount:W.cars.length,simulatedSeconds:dt});
}

/* ─────────────────────────  §12  MAIN LOOP  ───────────────────────── */

const DT = 1 / 60;
let acc = 0, last = performance.now(), hudT = 0, fps = 60;

function render(alpha) {
  const dark = theme==='dark' ? .55 : 0;
  const detail = CAM.z > 0.42;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  CAM.apply(ctx, dpr, cw, ch);

  const vb = viewBounds();
  drawGround(vb);
  drawZones(vb);
  drawRiver();
  drawRoads(detail);
  drawBuildings(dark, detail);
  if (detail) drawSignals();
  drawCars(alpha, detail);
  drawOverlays();
  if (W.debug) drawDebug();

  drawHeadlights(alpha, dark);
}

function bar(id, v) {
  const el = $(id);
  const pos = clamp(v, -1, 1);
  el.style.width = Math.abs(pos) * 50 + '%';
  el.style.left = pos >= 0 ? '50%' : (50 - Math.abs(pos) * 50) + '%';
  el.style.background = pos >= 0 ? 'var(--good)' : 'var(--bad)';
}

function trafficAnalysis() {
  const waitReasons={},metrics=trafficDiagnostics.summary();
  let queued=0;
  for(const c of W.cars) {
    if(c.dead || !c.track || c.phase==='VISIT' || c.phase==='ENTER' || c.v>=6)continue;
    queued++;
    const reason=c.waitReason || 'leader-or-destination';
    waitReasons[reason]=(waitReasons[reason]||0)+1;
  }
  return {queued,waitReasons,tripsPerMinute:metrics.trips.count*60/Math.max(1,W.time-diagnosticStartedAt),tripP95:metrics.trips.p95};
}

function updateHUD(dtReal) {
  if (toastT > 0) { toastT -= dtReal; if (toastT <= 0) $('toast').classList.remove('show'); }
  hudT -= dtReal;
  if (hudT > 0) return;
  hudT = 0.2;

  const avg = W.trips.length ? W.trips.reduce((a, b) => a + b, 0) / W.trips.length : null;
  $('s-pop').textContent = CITY.pop.toLocaleString();
  $('s-jobs').textContent = CITY.jobs.toLocaleString();
  $('s-happy').innerHTML = Math.round(CITY.happiness * 100) + '<small>%</small>';
  $('s-bld').textContent = CITY.buildings.length;
  $('s-cars').textContent = W.cars.length;
  $('s-trip').textContent = avg ? avg.toFixed(1) + 's' : '—';
  $('s-stress').innerHTML = Math.round(W.stress * 100) + '<small>%</small>';
  $('s-graph').innerHTML = NET.nodes.length + '<small>/</small>' + NET.edges.length;
  const traffic=trafficAnalysis();
  $('s-queued').textContent=traffic.queued;
  $('s-throughput').textContent=traffic.tripsPerMinute.toFixed(1);
  $('s-trip-p95').textContent=traffic.tripP95 ? `${traffic.tripP95.toFixed(1)}s` : '—';
  const cause=Object.entries(traffic.waitReasons).sort((a,b)=>b[1]-a[1])[0];
  const causes={signal:'Traffic light',conflict:'Crossing traffic',exit:'Exit queue',queue:'Traffic ahead',
    approach:'Traffic ahead','merge-gap':'Merge gap','unreachable-lane':'Missed turn','lane-change':'Merging',
    'leader-or-destination':'Traffic / parking',stop:'Stop sign',rebuilding:'Road works',priority:'Give way'};
  $('s-wait-cause').textContent=cause ? (causes[cause[0]] || 'Traffic ahead') : '—';

  bar('bar-r', CITY.demand.R); bar('bar-c', CITY.demand.C); bar('bar-i', CITY.demand.I);

  $('h-pop').textContent = CITY.pop.toLocaleString();
  $('h-cars').textContent = W.cars.length;
  $('h-trip').textContent = avg ? avg.toFixed(1) + 's' : '—';
  $('h-stress').textContent = Math.round(W.stress * 100) + '%';
  $('flow-fill').style.width=Math.round(W.stress*100)+'%';
  $('flow-fill').style.background=W.stress>.65?'var(--bad)':W.stress>.35?'var(--warn)':'var(--good)';
  $('flow-status').textContent=W.stress>.65?'Time for a new connection':W.stress>.35?'Some queues are forming':'The city is moving';
  $('h-fps').textContent = Math.round(fps);

  const { hour, dark } = dayPhase();
  const hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60);
  $('clock-t').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  $('sun').style.color = dark > 0.5 ? '#8fa8d8' : dark > 0.2 ? '#ffb267' : '#ffd479';
  renderCarInspector();
}

function frame(now) {
  let dtReal = (now - last) / 1000;
  last = now;
  if (dtReal > 0.25) dtReal = 0.25;
  fps = lerp(fps, 1 / Math.max(dtReal, 1e-4), 0.05);

  if (W.running) {
    acc += dtReal * W.speed;
    let steps = 0;
    const maxSteps = 5 * W.speed;
    while (acc >= DT && steps < maxSteps) { simStep(DT); acc -= DT; steps++; }
    if (acc > DT * 3) acc = 0;
  }
  moveCamera(dtReal);
  CAM.ease(dtReal);
  render(clamp(acc / DT, 0, 1));
  updateHUD(dtReal);
  requestAnimationFrame(frame);
}

/* Local saves contain authored state; lanes and vehicle trips are rebuilt. */
const SAVE_KEY='arterial-city-v1', RECOVERY_KEY='arterial-recovery-v1';
const BUILDING_FIELDS=['x','y','type','level','cell','service','starve','since','trips','outTimer','born','seed'];
function captureCity() {
  return {
    version:CitySave.VERSION,seed:SEED,time:W.time,
    nodes:NET.nodes.map(n=>({id:n.id,x:n.x,y:n.y,control:n.control,preSorting:JSON.parse(JSON.stringify(n.preSorting)),priorityEdges:[...n.priorityEdges],laneRules:n.laneRules.map(rule=>({...rule,to:rule.to.map(target=>({...target}))})),isRing:n.isRing,ringId:n.ringId})),
    edges:NET.edges.map(e=>({id:e.id,n1:e.n1.id,n2:e.n2.id,type:e.type,bend:e.bend})),
    rings:[...W.rings].map(([id,r])=>({id,cx:r.cx,cy:r.cy,R:r.R,hw:r.hw,nodes:r.nodes.map(n=>n.id)})),
    river:{centre:W.river.centre.map(p=>({x:p.x,y:p.y})),poly:W.river.poly.map(p=>({x:p.x,y:p.y}))},
    zones:Array.from(CITY.zone),
    buildings:CITY.buildings.map(b=>Object.fromEntries(BUILDING_FIELDS.map(k=>[k,k==='outTimer'?Math.max(0,b[k]):b[k]]))),
    camera:{x:CAM.tx,y:CAM.ty,z:CAM.tz},trips:W.trips.slice(-1000),
    settings:{grid:EDIT.grid,drawMode:EDIT.drawMode,roadType:W.roadType}
  };
}

function restoreCity(raw) {
  const data=CitySave.migrate(raw);
  const previousId=_id,previousRng=rng;
  let candidate;
  try {
    _id=Math.max(0,...data.nodes.map(n=>n.id),...data.edges.map(e=>e.id));
    const nodes=data.nodes.map(n=>{const node=new GNode(n.x,n.y);for(const k of ['id','control','isRing','ringId']) node[k]=n[k];node.preSorting=JSON.parse(JSON.stringify(n.preSorting||{}));node.priorityEdges=new Set(n.priorityEdges);node.laneRules=n.laneRules.map(rule=>({...rule,to:rule.to.map(target=>({...target}))}));return node;});
    const byId=new Map(nodes.map(n=>[n.id,n]));
    const edges=data.edges.map(e=>{
      const edge=new Edge(byId.get(e.n1),byId.get(e.n2),e.type,e.bend);edge.id=e.id;
      edge.n1.edges.push(edge);edge.n2.edges.push(edge);return edge;
    });
    const net=Object.create(NET);net.nodes=nodes;net.edges=edges;net.rebuildAll();
    rng=makeRNG(data.seed);
    const buildings=data.buildings.map(b=>{
      const building=new Building(b.x,b.y,b.type,b.cell);
      for(const k of BUILDING_FIELDS) building[k]=b[k];
      return building;
    });
    const rings=new Map(data.rings.map(r=>[r.id,{cx:r.cx,cy:r.cy,R:r.R,hw:r.hw,nodes:r.nodes.map(id=>byId.get(id))}]));
    candidate={nodes,edges,buildings,rings};
  } catch(error) {_id=previousId;rng=previousRng;throw new Error('Could not rebuild that city. Your current city is unchanged.');}
  // Only replace the live state after validation and geometry reconstruction succeed.
  cancelDrawing();SEED=data.seed;W.time=data.time;W.cars=[];W.selectedCar=null;W.rings=candidate.rings;
  W.river={centre:data.river.centre.map(p=>({...p})),poly:data.river.poly.map(p=>({...p}))};
  NET.nodes=candidate.nodes;NET.edges=candidate.edges;NET.dirty=true;
  CITY.init();CITY.zone.set(data.zones);CITY.buildings=candidate.buildings;
  for(const b of CITY.buildings) CITY.used[b.cell]=1;
  for(const e of NET.edges) {e.isBridge=crossesWater(e.n1.pos,e.n2.pos);e.buildMarkings();}
  // Restored buildings retain their exact saved geometry; derive curb addresses separately.
  for(const b of CITY.buildings) {const x=b.x,y=b.y;CITY.attach(b);b.x=x;b.y=y;}
  reattachBuildings();CITY.rebuildCandidates();CITY.reattachDirty=false;CITY.recompute();
  W.trips=data.trips.slice();W.stress=0;W.peak=0;W.rerouteAll=true;W.builtRoad=0;W.laneChanges=0;
  trafficDiagnostics=TrafficDiagnostics.createRecorder();diagnosticStartedAt=W.time;W.lastSafetyScan=null;
  W.resumeTraffic=true;
  _ringSeq=Math.max(0,...data.rings.map(r=>r.id));
  CAM.x=CAM.tx=data.camera.x;CAM.y=CAM.ty=data.camera.y;CAM.z=CAM.tz=data.camera.z;
  EDIT.grid=data.settings.grid;EDIT.drawMode=data.settings.drawMode;W.roadType=data.settings.roadType;
  acc=0;hudT=0;setTool('ROAD');syncUI();
}

function saveCity(recovery=false) {
  try {
    const data=captureCity();CitySave.validate(data);
    localStorage.setItem(recovery?RECOVERY_KEY:SAVE_KEY,JSON.stringify(data));
    if(!recovery) {toast('City saved on this PC');$('save-state').textContent='City saved';}
    return true;
  } catch(error) {
    if(!recovery) toast('Could not save in this browser. Use Export to keep a backup.');
    else $('save-state').textContent='Recovery unavailable · use Export';
    return false;
  }
}

function loadSavedCity(key) {
  try {
    const text=localStorage.getItem(key);
    if(!text) {toast('No city saved in that slot yet');return;}
    restoreCity(JSON.parse(text));toast('City loaded · traffic will start new trips');$('save-state').textContent='City loaded';
  } catch(error) {toast(error.message || 'Could not load this city');}
}

function exportCity() {
  try {
    const data=captureCity();CitySave.validate(data);
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;link.download='arterial-city.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),2000);toast('City exported to your Downloads folder');
  } catch(error) {toast('Could not export: '+error.message);}
}

async function importCity(file) {
  if(!file) return;
  try {
    if(file.size>4*1024*1024) throw new Error('That save is too large (maximum 4 MB)');
    const data=CitySave.migrate(JSON.parse(await file.text()));
    if(!window.confirm('Import this city and replace your current map? Save or export first to keep it.')) return;
    restoreCity(data);toast('City imported · traffic will start new trips');$('save-state').textContent='City imported';
  } catch(error) {toast(error instanceof SyntaxError?'That file is not a valid city save':error.message);}
  finally {$('import-file').value='';}
}

/* ─────────────────────────  boot  ───────────────────────── */

resize();
W.river = makeRiver();
CITY.init();
initScene();
populateStarter();
CAM.fit(cw, ch);
CAM.tz = Math.max(CAM.tz, 0.7);
CAM.x=CAM.tx;CAM.y=CAM.ty;CAM.z=CAM.tz;

$('btn-pause').onclick = () => { W.running = !W.running; syncUI(); };
$('btn-speed').onclick = () => { W.speed = W.speed === 1 ? 2 : W.speed === 2 ? 4 : 1; syncUI(); };
$('btn-debug').onclick = () => { W.debug = !W.debug; syncUI(); };
$('btn-fit').onclick = () => CAM.fit(cw, ch);
function openNewDialog(blankMap) {
  const dialog = $('new-dialog');
  const confirm = $('new-confirm');
  $('new-title').textContent = blankMap ? 'Create a blank map?' : 'Start a new city?';
  $('new-description').textContent = blankMap
    ? 'Save or export first to keep your current map.'
    : 'Save or export first to keep your current road network.';
  confirm.textContent = blankMap ? 'Create blank map' : 'New city';
  confirm.value = blankMap ? 'blank' : 'new';
  dialog.returnValue = 'cancel';
  dialog.showModal();
}
$('btn-restart').onclick = () => openNewDialog(false);
$('btn-new-map').onclick = () => openNewDialog(true);
$('btn-lane-reset').onclick = () => {
  const changed = NET.resetLaneConnections(W.laneEditNode, W.laneEditSource);
  toast(changed ? 'Lane restored to automatic connections' : 'Selected lane has no manual override');
  syncUI();
};
$('btn-presort-remove').onclick=()=>{removePreSorting(W.preSortingNode);syncUI();toast('Pre-sorting lanes removed');};
$('btn-presort-one').onclick=()=>setPreSortingCount(1);
$('btn-presort-two').onclick=()=>setPreSortingCount(2);
$('new-dialog').addEventListener('close',()=>{
  const action = $('new-dialog').returnValue;
  if (action === 'new') restart();
  else if (action === 'blank') restart(true);
});
$('btn-theme').onclick=()=>applyTheme(theme==='light'?'dark':'light');
$('btn-text-size').onclick=()=>{
  sidebarTextLarge=!sidebarTextLarge;
  applySidebarTextSize();
  try { localStorage.setItem(SIDEBAR_TEXT_SIZE_KEY,sidebarTextLarge?'large':'standard'); } catch (_) {}
};
applySidebarTextSize();
$('btn-save').onclick=()=>saveCity();
$('btn-load').onclick=()=>{
  try {$('load-manual').disabled=!localStorage.getItem(SAVE_KEY);$('load-recovery').disabled=!localStorage.getItem(RECOVERY_KEY);}catch(_){}
  $('load-dialog').showModal();
};
$('load-dialog').addEventListener('close',()=>{const value=$('load-dialog').returnValue;if(value==='manual'||value==='recovery') loadSavedCity(value==='manual'?SAVE_KEY:RECOVERY_KEY);});
$('btn-export').onclick=exportCity;
$('btn-import').onclick=()=>{$('import-file').value='';$('import-file').click();};
$('import-file').addEventListener('change',e=>importCity(e.target.files[0]));
setInterval(()=>saveCity(true),30000);
window.addEventListener('pagehide',()=>saveCity(true));
window.addEventListener('blur',()=>{IN.space=false;clearPanKeys();});
$('btn-grid').onclick=()=>{cancelDrawing();EDIT.grid=!EDIT.grid;syncUI();};
$('btn-zoom-in').onclick=()=>{CAM.tz=clamp(CAM.tz*1.25,.18,3.2);};
$('btn-zoom-out').onclick=()=>{CAM.tz=clamp(CAM.tz/1.25,.18,3.2);};
for(const el of document.querySelectorAll('[data-draw]')) el.onclick=()=>{cancelDrawing();EDIT.drawMode=el.dataset.draw;setTool('ROAD');};
for (const el of document.querySelectorAll('[data-tool]')) el.onclick = () => setTool(el.dataset.tool);
$('btn-city-removal').onclick = () => toggleCityRemoval();
for (const el of document.querySelectorAll('[data-road]')) el.onclick = () => setRoadType(el.dataset.road);
for (const el of document.querySelectorAll('[data-zone]')) el.onclick = () => setZoneType(+el.dataset.zone);
for (const el of document.querySelectorAll('[data-zone-shape]')) el.onclick = () => setZoneShape(el.dataset.zoneShape);

setTool('ROAD');
syncUI();
applyTheme(theme);
requestAnimationFrame(frame);

window.ARTERIAL = {
  trafficAnalysis,
  get trafficDiagnostics() { return trafficDiagnostics; },
  addPreSorting, resizePreSorting, removePreSorting, preSortingHandles,
  W, NET, CITY, CFG, CAM, IN, ROADS, simStep, restart, setTool, setRoadType, setZoneType, setZoneShape,
  EDIT, buildRoad, reshapeRoad, drawingPoint, cancelDrawing, render, applyTheme, captureCity, restoreCity, saveCity, loadSavedCity, exportCity, importCity,
  get seed() { return SEED; },
};
