/* Turning pockets use the parent approach's longitudinal coordinate. Only the
   portion after startS is drivable; ordinary lanes keep their saved indices. */
class ApproachPath {
  constructor(base, shift, start = 0, taper = 0) {
    this.base = base; this.shift = shift; this.start = start; this.taper = taper;
    this.length = base.length;
    this.p0 = this.pos(0); this.p2 = this.pos(this.length);
  }
  amount(s) {
    if (!this.taper) return this.shift;
    const t = clamp((s - this.start) / this.taper, 0, 1);
    return this.shift * t * t * (3 - 2 * t);
  }
  pos(s) { return V.add(this.base.pos(s), V.mul(V.rn(this.base.dir(s)), this.amount(s))); }
  dir(s) { return V.norm(V.sub(this.pos(Math.min(this.length, s + .2)), this.pos(Math.max(0, s - .2)))); }
  tangent(t) { return this.dir(t * this.length); }
  radius(t) { return this.base.radius(t); }
  nearest(p) {
    let best = {s:0,d:Infinity};
    // Refinement keeps curved-road drags smooth without rebuilding a LUT.
    let low=0, high=this.length;
    for (let pass=0;pass<4;pass++) {
      const step=(high-low)/24;
      for(let i=0;i<=24;i++) {
        const s=low+i*step,d=V.dist(this.pos(s),p);
        if(d<best.d) best={s,d};
      }
      low=Math.max(0,best.s-step);high=Math.min(this.length,best.s+step);
    }
    return best;
  }
  stroke(ctx) { this.strokeRange(ctx, 0); }
  strokeRange(ctx, start) {
    const count = Math.max(2, Math.ceil((this.length - start) / 5));
    for (let i = 0; i <= count; i++) {
      const p = this.pos(lerp(start, this.length, i / count));
      if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
    }
  }
}

function pocketLimit(edge, node) {
  return Math.max(0, Math.min(500, edge.centre.length - node.r - edge.other(node).r - 35));
}

function prunePreSorting(node) {
  for(const id of Object.keys(node.preSorting)) {
    const edge=node.edges.find(e=>String(e.id)===id);
    if(!edge || edge.type==='RING' || node.isRing || node.degree<3 ||
      (edge.spec.oneway && edge.n2!==node)) delete node.preSorting[id];
  }
}

function buildPreSorting(edge) {
  for (const group of [edge.fwd, edge.bwd]) {
    if (!group.length) continue;
    const node = group[0].to;
    const record = node.preSorting[edge.id];
    if (!record || node.isRing || node.degree < 3 || edge.type === 'RING') {
      delete node.preSorting[edge.id]; continue;
    }
    const limit = pocketLimit(edge, node);
    if (limit < 45) { delete node.preSorting[edge.id]; continue; }
    const bases = group.slice(), n = bases.length;
    for (const side of ['left', 'right']) if (record[side]) record[side] = clamp(record[side], 45, limit);
    for (const lane of bases) {
      lane.order = lane.idx;
      if (record.left) {
        lane.path = new ApproachPath(lane.path, LW, lane.length - record.left - 35, 35);
      }
    }
    for (const [side, source, shift, idx, order] of [
      ['right', bases[0], record.left ? LW * 2 : LW, n, -1],
      ['left', bases[n - 1], 0, n + 1, n],
    ]) {
      if (!record[side]) continue;
      const base = source.path instanceof ApproachPath ? source.path.base : source.path;
      const path = new ApproachPath(side === 'right' ? source.path : base, side === 'right' ? LW : shift);
      const lane = new Lane(edge, source.forward, idx, path);
      lane.pocket = side; lane.order = order; lane.offset = source.offset + shift;
      lane.startS = Math.max(0, lane.length - record[side]);
      group.push(lane);
    }
  }
  buildPreSortingSurface(edge);
}

function smoothPocketWidth(distance, length) {
  if(!length) return 0;
  const t=clamp((length+35-distance)/35,0,1);
  return LW*t*t*(3-2*t);
}

function preSortingBoundary(edge,s) {
  const L=edge.centre.length,p=edge.centre.pos(s),normal=V.rn(edge.centre.dir(s));
  const f=edge.n2.preSorting[edge.id],b=edge.n1.preSorting[edge.id];
  const extra=(record,distance)=>record ? smoothPocketWidth(distance,record.left)+smoothPocketWidth(distance,record.right) : 0;
  return [V.add(p,V.mul(normal,edge.halfWidth+extra(f,L-s-edge.n2.r))),
    V.add(p,V.mul(normal,-edge.halfWidth-extra(b,s-edge.n1.r)))];
}

function buildPreSortingSurface(edge) {
  edge.pocketSurface=null;
  if(!edge.n1.preSorting[edge.id] && !edge.n2.preSorting[edge.id]) return;
  const a=[],b=[],count=Math.max(2,Math.ceil(edge.centre.length/5));
  for(let i=0;i<=count;i++) {const pair=preSortingBoundary(edge,edge.centre.length*i/count);a.push(pair[0]);b.push(pair[1]);}
  edge.pocketSurface=a.concat(b.reverse());
}

function tracePreSortingSurface(edge) {
  const pts=edge.pocketSurface;
  ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
  ctx.closePath();
}

function preSortingDivider(edge,path,forward) {
  const node=forward?edge.n2:edge.n1,record=node.preSorting[edge.id];
  if(!record || !record.left) return path;
  return {stroke(ctx) {
    const count=Math.max(2,Math.ceil(path.length/5));
    for(let i=0;i<=count;i++) {
      const fraction=i/count,s=path.length*fraction;
      const distance=(forward?1-fraction:fraction)*edge.centre.length-node.r;
      const shift=smoothPocketWidth(distance,record.left)*(forward?1:-1);
      const p=V.add(path.pos(s),V.mul(V.rn(path.dir(s)),shift));
      if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);
    }
  }};
}

function preSortingRecord(node, edge, count, previous = {}) {
  if (!node || node.isRing || node.degree < 3 || !node.edges.includes(edge) ||
    (count !== 1 && count !== 2) || edge.type === 'RING' || pocketLimit(edge, node) < 45) return null;
  const incoming = edge.lanes.filter(l => l.to === node && !l.pocket);
  if (!incoming.length) return null;
  const record = {};
  // Inspect the arm geometry, including turns overridden by manual rules.
  const heading = incoming[0].path.tangent(1);
  for (const out of node.lanesOut.filter(l => !l.pocket && l.edge !== edge)) {
    const d = out.path.tangent(0);
    const turn = angDiff(Math.atan2(heading.y, heading.x), Math.atan2(d.y, d.x));
    if (turn < -.45) record.left = previous.left || Math.min(140, pocketLimit(edge, node));
    if (turn > .45) record.right = previous.right || Math.min(140, pocketLimit(edge, node));
  }
  if (count !== 2 && record.left) delete record.right;
  return record;
}

function togglePreSortingArm(node, edge, count = W.preSortingCount) {
  if (!node || !edge || !node.edges.includes(edge) || node.isRing || node.degree < 3) return false;
  if (node.preSorting[edge.id]) {
    delete node.preSorting[edge.id];
    refreshPreSorting(node);
    return 'removed';
  }
  const record = preSortingRecord(node, edge, count);
  if (!record || !Object.keys(record).length) return false;
  node.preSorting[edge.id] = record;
  refreshPreSorting(node);
  return 'added';
}

function addPreSorting(node, count = W.preSortingCount) {
  if (!node || node.isRing || node.degree < 3) return false;
  for (const edge of node.edges) {
    const record = preSortingRecord(node, edge, count, node.preSorting[edge.id] || {});
    if (record && Object.keys(record).length) node.preSorting[edge.id] = record;
    else delete node.preSorting[edge.id];
  }
  refreshPreSorting(node);
  return Object.keys(node.preSorting).length > 0;
}

function setPreSortingCount(count) {
  if(count !== 1 && count !== 2) return;
  cancelDrawing(); W.preSortingCount=count;
  syncUI();
}

function resizePreSorting(node, edge, side, length) {
  const record = node && node.preSorting[edge.id];
  if (!record || !record[side] || !Number.isFinite(length)) return false;
  record[side] = clamp(length, 45, pocketLimit(edge, node));
  refreshPreSorting(node); return true;
}

function removePreSorting(node) {
  if (!node) return;
  node.preSorting = {}; refreshPreSorting(node);
}

function refreshPreSorting(node) {
  NET.rebuildAround([node]); NET.reattachAll(); markReroute();
}

function preSortingHandles(node) {
  if (!node || !NET.nodes.includes(node)) return [];
  return node.lanesIn.filter(l => l.pocket).map(lane => ({lane, edge: lane.edge,
    side: lane.pocket, pos: lane.pos(lane.startS)}));
}

function preSortingHandleAt(p) {
  return preSortingHandles(W.preSortingNode).filter(h => V.dist(h.pos, p) < 11 / Math.max(.18, CAM.z))
    .sort((a,b) => V.dist(a.pos,p) - V.dist(b.pos,p))[0] || null;
}

function pocketUsability(lane, length = lane.length-lane.startS, vehicleLength = CFG.TRUCK_L) {
  const usable=Math.max(0,length-vehicleLength-CFG.STOPLINE-CFG.IDM_S0-5);
  const mergeSpeed=usable/CFG.CHANGE_TIME*.85;
  return {mergeSpeed,requiresSlowing:mergeSpeed<lane.speedLimit,
    unusable:usable<Math.max(15.5,LW*1.4),usable,metres:length/CFG.WORLD_UNITS_PER_METRE};
}

function drawPreSortingEditor() {
  ctx.save();
  for (const node of NET.nodes) for (const lane of node.lanesIn) {
    if (!lane.pocket) continue;
    const start = lane.startS, end = lane.length;
    // Mark the boundary shared with the through lane, keeping the lane centre clear.
    ctx.beginPath();
    const sign=lane.pocket==='right'?-1:1,count=Math.max(2,Math.ceil((end-start)/6));
    for(let i=0;i<=count;i++) {
      const s=lerp(start,end,i/count),p=V.add(lane.pos(s),V.mul(V.rn(lane.dir(s)),sign*LW/2));
      if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);
    }
    ctx.strokeStyle = P.lane; ctx.lineWidth = 1; ctx.setLineDash([7,7]); ctx.stroke(); ctx.setLineDash([]);
    const p = lane.pos(Math.max(start + 12, end - 30)), d = lane.dir(end), normal = V.rn(d);
    const side = lane.pocket === 'left' ? -1 : 1;
    ctx.beginPath(); ctx.moveTo(p.x-d.x*7,p.y-d.y*7);ctx.lineTo(p.x,p.y);
    const tip=V.add(p,V.mul(normal,side*6));ctx.lineTo(tip.x,tip.y);
    ctx.moveTo(tip.x-normal.x*side*3-d.x*3,tip.y-normal.y*side*3-d.y*3);
    ctx.lineTo(tip.x,tip.y);ctx.lineTo(tip.x-normal.x*side*3+d.x*3,tip.y-normal.y*side*3+d.y*3);ctx.stroke();
  }
  if (W.tool !== 'PRE_SORTING') {ctx.restore();return;}
  for (const handle of preSortingHandles(W.preSortingNode)) {
    const {lane}=handle,drag=IN.pocketDrag;
    const length=drag && drag.edge===lane.edge && drag.side===lane.pocket && drag.preview!==undefined
      ? drag.preview : lane.length-lane.startS;
    const start=lane.length-length,pos=lane.pos(start);
    ctx.beginPath();lane.path.strokeRange(ctx,start);ctx.lineWidth=LW-2;
    ctx.strokeStyle='rgba(66,195,240,.25)';ctx.stroke();
    ctx.beginPath();ctx.arc(pos.x,pos.y,6/Math.max(.5,CAM.z),0,TAU);
    ctx.fillStyle='#42c3f0';ctx.fill();ctx.strokeStyle=P.roadEdge;ctx.lineWidth=1.5;ctx.stroke();
    ctx.font=`${12/Math.max(.5,CAM.z)}px sans-serif`;ctx.fillStyle=P.lane;
    const direction=lane.dir(start),normal=V.rn(direction),side=lane.pocket==='right'?1:-1;
    const label=V.add(pos,V.mul(normal,side*15/Math.max(.5,CAM.z)));
    ctx.textAlign=label.x<pos.x-1?'right':'left';ctx.textBaseline='bottom';
    const usability=pocketUsability(lane,length);
    ctx.fillText(`${Math.round(usability.metres)} m${usability.requiresSlowing?' · slow merge':''}`,label.x,label.y-5/CAM.z);
    if(usability.requiresSlowing) {
      ctx.fillStyle='#e9a23b';
      ctx.fillText(usability.unusable?'Too short for trucks':`Trucks: ${Math.max(0,Math.round(usability.mergeSpeed/CFG.WORLD_UNITS_PER_METRE*3.6))} km/h`,label.x,label.y+10/CAM.z);
    }
  }
  ctx.restore();
}
