(function attachTrafficDiagnostics(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TrafficDiagnostics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createTrafficDiagnostics() {
  'use strict';

  const TAU = Math.PI * 2;
  const EPSILON = 1e-9;

  function numberOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function positiveOr(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function angleDelta(from, to) {
    return Math.atan2(Math.sin(to - from), Math.cos(to - from));
  }

  function interpolatePose(vehicle, fraction) {
    const t = Math.max(0, Math.min(1, numberOr(fraction, 0)));
    const x0 = numberOr(vehicle.ppx, numberOr(vehicle.px, 0));
    const y0 = numberOr(vehicle.ppy, numberOr(vehicle.py, 0));
    const x1 = numberOr(vehicle.px, x0);
    const y1 = numberOr(vehicle.py, y0);
    const a0 = numberOr(vehicle.pang, numberOr(vehicle.ang, 0));
    const a1 = numberOr(vehicle.ang, a0);
    return {
      x: x0 + (x1 - x0) * t,
      y: y0 + (y1 - y0) * t,
      angle: a0 + angleDelta(a0, a1) * t,
    };
  }

  function footprintAt(vehicle, pose) {
    const current = pose || interpolatePose(vehicle, 1);
    const x = numberOr(current.x, 0);
    const y = numberOr(current.y, 0);
    const angle = numberOr(current.angle, numberOr(current.ang, 0));
    const length = positiveOr(vehicle.len, positiveOr(vehicle.length, 15));
    const width = positiveOr(vehicle.wide, positiveOr(vehicle.width, 8));
    const fx = Math.cos(angle), fy = Math.sin(angle);
    const sx = -fy, sy = fx;
    const hl = length / 2, hw = width / 2;
    const corners = [
      {x: x + fx * hl + sx * hw, y: y + fy * hl + sy * hw},
      {x: x + fx * hl - sx * hw, y: y + fy * hl - sy * hw},
      {x: x - fx * hl - sx * hw, y: y - fy * hl - sy * hw},
      {x: x - fx * hl + sx * hw, y: y - fy * hl + sy * hw},
    ];
    return {x, y, angle, length, width, fx, fy, sx, sy, corners};
  }

  function projectionRadius(rect, axisX, axisY) {
    return Math.abs(rect.fx * axisX + rect.fy * axisY) * rect.length / 2 +
      Math.abs(rect.sx * axisX + rect.sy * axisY) * rect.width / 2;
  }

  function axisSeparations(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const axes = [[a.fx, a.fy], [a.sx, a.sy], [b.fx, b.fy], [b.sx, b.sy]];
    return axes.map(([ax, ay]) => Math.abs(dx * ax + dy * ay) -
      projectionRadius(a, ax, ay) - projectionRadius(b, ax, ay));
  }

  function footprintsOverlap(a, b) {
    return axisSeparations(a, b).every(gap => gap <= EPSILON);
  }

  function pointSegmentDistance(point, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= EPSILON) return Math.hypot(point.x - a.x, point.y - a.y);
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
    return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
  }

  function footprintDistance(a, b) {
    if (footprintsOverlap(a, b)) return 0;
    let minimum = Infinity;
    for (let i = 0; i < 4; i++) {
      const a0 = a.corners[i], a1 = a.corners[(i + 1) % 4];
      const b0 = b.corners[i], b1 = b.corners[(i + 1) % 4];
      for (let j = 0; j < 4; j++) {
        const be0 = b.corners[j], be1 = b.corners[(j + 1) % 4];
        minimum = Math.min(minimum,
          pointSegmentDistance(a0, be0, be1), pointSegmentDistance(a1, be0, be1));
        const ae0 = a.corners[i], ae1 = a.corners[(i + 1) % 4];
        minimum = Math.min(minimum,
          pointSegmentDistance(be0, ae0, ae1), pointSegmentDistance(be1, ae0, ae1));
      }
    }
    return minimum;
  }

  function isDiagnosticVehicle(vehicle) {
    return !!vehicle && !vehicle.dead && vehicle.phase !== 'ENTER' && vehicle.phase !== 'VISIT';
  }

  function vehicleId(vehicle, index) {
    return vehicle.id === undefined || vehicle.id === null ? index : vehicle.id;
  }

  function sweptBounds(vehicle) {
    const radius = Math.hypot(
      positiveOr(vehicle.len, positiveOr(vehicle.length, 15)),
      positiveOr(vehicle.wide, positiveOr(vehicle.width, 8))
    ) / 2;
    const x0 = numberOr(vehicle.ppx, numberOr(vehicle.px, 0));
    const y0 = numberOr(vehicle.ppy, numberOr(vehicle.py, 0));
    const x1 = numberOr(vehicle.px, x0);
    const y1 = numberOr(vehicle.py, y0);
    return {minX: Math.min(x0, x1) - radius, maxX: Math.max(x0, x1) + radius,
      minY: Math.min(y0, y1) - radius, maxY: Math.max(y0, y1) + radius};
  }

  function boundsOverlap(a, b) {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
  }

  function buildCandidatePairs(entries, options) {
    const buckets = new Map();
    const oversized = [];
    const cellSize = positiveOr(options.cellSize, 64);
    const maxCells = Math.max(1, Math.floor(positiveOr(options.maxCellsPerVehicle, 512)));
    const pairSet = new Set();
    let pairLimitReached = false;
    const maxPairs = Number.isFinite(options.maxCandidatePairs) && options.maxCandidatePairs >= 0
      ? Math.floor(options.maxCandidatePairs)
      : (entries.length * (entries.length - 1)) / 2;

    const addPair = (a, b) => {
      if (a.index === b.index) return;
      const low = Math.min(a.index, b.index), high = Math.max(a.index, b.index);
      const key = `${low}:${high}`;
      if (pairSet.has(key)) return;
      if (pairSet.size >= maxPairs) { pairLimitReached = true; return; }
      if (boundsOverlap(a.bounds, b.bounds)) pairSet.add(key);
    };

    for (const entry of entries) {
      const minCol = Math.floor(entry.bounds.minX / cellSize);
      const maxCol = Math.floor(entry.bounds.maxX / cellSize);
      const minRow = Math.floor(entry.bounds.minY / cellSize);
      const maxRow = Math.floor(entry.bounds.maxY / cellSize);
      const cellCount = (maxCol - minCol + 1) * (maxRow - minRow + 1);
      if (cellCount > maxCells) {
        oversized.push(entry);
        continue;
      }
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const key = `${col},${row}`;
          let bucket = buckets.get(key);
          if (!bucket) buckets.set(key, bucket = []);
          for (const other of bucket) addPair(entry, other);
          bucket.push(entry);
        }
      }
    }

    if (oversized.length) {
      for (const large of oversized) for (const other of entries) addPair(large, other);
    }
    const pairs = Array.from(pairSet, key => {
      const [a, b] = key.split(':').map(Number);
      return [entries[a], entries[b]];
    });
    return {pairs, pairLimitReached};
  }

  function maximumFootprintTravel(vehicle, t0, t1) {
    const x0 = numberOr(vehicle.ppx, numberOr(vehicle.px, 0));
    const y0 = numberOr(vehicle.ppy, numberOr(vehicle.py, 0));
    const x1 = numberOr(vehicle.px, x0);
    const y1 = numberOr(vehicle.py, y0);
    const a0 = numberOr(vehicle.pang, numberOr(vehicle.ang, 0));
    const a1 = numberOr(vehicle.ang, a0);
    const radius = Math.hypot(
      positiveOr(vehicle.len, positiveOr(vehicle.length, 15)),
      positiveOr(vehicle.wide, positiveOr(vehicle.width, 8))
    ) / 2;
    const fraction = Math.max(0, t1 - t0);
    return fraction * (Math.hypot(x1 - x0, y1 - y0) + Math.abs(angleDelta(a0, a1)) * radius);
  }

  function detectSweptOverlaps(vehicles, options = {}) {
    const list = Array.isArray(vehicles) ? vehicles : [];
    const maxVehicles = Math.max(1, Math.floor(positiveOr(options.maxVehicles, 240)));
    const entries = [];
    let excludedCount = 0;
    let eligibleCount = 0;
    let inputTruncated = false;
    for (let i = 0; i < list.length; i++) {
      if (!isDiagnosticVehicle(list[i])) { excludedCount++; continue; }
      if (eligibleCount < maxVehicles) {
        entries.push({vehicle: list[i], index: entries.length,
          id: vehicleId(list[i], i), bounds: sweptBounds(list[i])});
      } else {
        inputTruncated = true;
      }
      eligibleCount++;
    }
    const candidateBuild = buildCandidatePairs(entries, options);
    const overlaps = [];
    const nearMisses = [];
    const inconclusive = [];
    const nearMissDistance = Math.max(0, numberOr(options.nearMissDistance, 3));
    const nearMissResolution = positiveOr(options.nearMissResolution, .01);
    const maxTravelPerSample = positiveOr(options.maxTravelPerSample, 2);
    const maxSamples = Math.max(2, Math.floor(positiveOr(options.maxSamplesPerPair, 8192)));
    const maxDepth = Math.max(1, Math.floor(positiveOr(options.maxSubdivisionDepth, 32)));
    let sampleCount = 0;
    let subdivisionLimitReached = false;

    for (const [entryA, entryB] of candidateBuild.pairs) {
      const a = entryA.vehicle, b = entryB.vehicle;
      let collisionTime = null;
      let nearestDistance = Infinity;
      let nearestTime = 0;
      let possibleNearMiss = false, nearMissLowerBound = Infinity;
      let pairSampleCount = 0;
      let unresolved = null;
      let remainingIntervals = 0;

      const sampleAt = time => {
        pairSampleCount++;
        sampleCount++;
        const boxA = footprintAt(a, interpolatePose(a, time));
        const boxB = footprintAt(b, interpolatePose(b, time));
        if (footprintsOverlap(boxA, boxB)) {
          collisionTime = time;
          return 0;
        }
        const distance = footprintDistance(boxA, boxB);
        if (distance < nearestDistance) { nearestDistance = distance; nearestTime = time; }
        return distance;
      };

      // Check both ends explicitly. The adaptive intervals below then prove
      // that no unobserved collision can occur between the sampled poses.
      if (sampleAt(0) !== 0 && sampleAt(1) !== 0) {
        const intervals = [{start: 0, end: 1, depth: 0}];
        while (intervals.length && collisionTime === null) {
          if (pairSampleCount >= maxSamples) {
            unresolved = intervals[intervals.length - 1];
            remainingIntervals = intervals.length;
            break;
          }
          const interval = intervals.pop();
          const middle = (interval.start + interval.end) / 2;
          const distance = sampleAt(middle);
          if (collisionTime !== null) break;

          const motionA = maximumFootprintTravel(a, interval.start, interval.end);
          const motionB = maximumFootprintTravel(b, interval.start, interval.end);
          // A footprint can move at most half its interval travel from the
          // midpoint to any other time in this interval. This Hausdorff bound
          // makes the lower bound conservative for both translation and turn.
          const uncertainty = (motionA + motionB) / 2;
          const lowerClearance = distance - uncertainty;
          const collisionPossible = lowerClearance <= EPSILON;
          const nearMissPossible = lowerClearance <= nearMissDistance + EPSILON;
          const motionSmall = Math.max(motionA, motionB) <= maxTravelPerSample;
          if (!collisionPossible && motionSmall &&
              (nearestDistance <= nearMissDistance + EPSILON || !nearMissPossible)) {
            continue;
          }
          // Collision clearance is already proved for this interval. Do not
          // exhaust its safety budget refining an optional metric at an exact
          // threshold: retain a conservative, explicitly possible near miss.
          if (!collisionPossible && motionSmall && uncertainty <= nearMissResolution) {
            possibleNearMiss = true;
            nearMissLowerBound = Math.min(nearMissLowerBound, lowerClearance);
            continue;
          }
          if (interval.depth >= maxDepth) {
            unresolved = interval;
            remainingIntervals = intervals.length;
            break;
          }
          // Visit the earlier half first so a reported collision time follows
          // the vehicle pair's chronological motion.
          intervals.push({start: middle, end: interval.end, depth: interval.depth + 1});
          intervals.push({start: interval.start, end: middle, depth: interval.depth + 1});
        }
      }

      const ids = [entryA.id, entryB.id];
      if (collisionTime !== null) {
        overlaps.push({ids, time: collisionTime});
      } else if (nearestDistance <= nearMissDistance + EPSILON) {
        nearMisses.push({ids, time: nearestTime, clearance: nearestDistance});
      } else if (possibleNearMiss) {
        nearMisses.push({ids, time: nearestTime, clearance: nearestDistance,
          possible: true, lowerClearance: nearMissLowerBound});
      }
      if (collisionTime === null && unresolved) {
        inconclusive.push({ids, reason: pairSampleCount >= maxSamples ? 'sample-limit' : 'subdivision-limit',
          interval: {start: unresolved.start, end: unresolved.end}, remainingIntervals});
        subdivisionLimitReached = true;
      }
    }

    return {
      overlaps,
      nearMisses,
      inconclusive,
      stats: {
        inputCount: list.length,
        vehicleCount: entries.length,
        excludedCount,
        possiblePairs: (entries.length * (entries.length - 1)) / 2,
        candidatePairs: candidateBuild.pairs.length,
        sampledPoses: sampleCount,
        inconclusivePairs: inconclusive.length,
        truncated: inputTruncated || candidateBuild.pairLimitReached || subdivisionLimitReached,
      },
    };
  }

  function boundedLimit(value, fallback) {
    return Math.max(1, Math.floor(positiveOr(value, fallback)));
  }

  function createMetric(maxSamples) {
    return {count: 0, sum: 0, min: Infinity, max: -Infinity, samples: [], maxSamples};
  }

  function addMetric(metric, value) {
    if (!Number.isFinite(value)) return false;
    metric.count++;
    metric.sum += value;
    metric.min = Math.min(metric.min, value);
    metric.max = Math.max(metric.max, value);
    metric.samples.push(value);
    if (metric.samples.length > metric.maxSamples) metric.samples.shift();
    return true;
  }

  function percentile(samples, fraction) {
    if (!samples.length) return null;
    const ordered = samples.slice().sort((a, b) => a - b);
    const position = (ordered.length - 1) * fraction;
    const low = Math.floor(position), high = Math.ceil(position);
    if (low === high) return ordered[low];
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low);
  }

  function metricSummary(metric, names = {}) {
    if (!metric.count) return {count: 0, average: null, median: null, p95: null, min: null, max: null};
    return {
      count: metric.count,
      average: metric.sum / metric.count,
      median: percentile(metric.samples, 0.5),
      p95: percentile(metric.samples, 0.95),
      min: metric.min,
      max: metric.max,
      ...names,
    };
  }

  function createRecorder(options = {}) {
    const maxEvents = boundedLimit(options.maxEvents, 500);
    const maxSamples = boundedLimit(options.maxSamples, 2000);
    const maxReasons = boundedLimit(options.maxReasons, 32);
    const maxTrackedVehicles = boundedLimit(options.maxTrackedVehicles, 240);
    const events = [];
    const trips = createMetric(maxSamples);
    const tripRouteChanges = createMetric(maxSamples);
    const tripLaneChanges = createMetric(maxSamples);
    const tripMissedTurns = createMetric(maxSamples);
    const laneChangeDurations = createMetric(maxSamples);
    const reservationLeads = createMetric(maxSamples);
    const frameTimes = createMetric(maxSamples);
    const waitReasons = Object.create(null);
    const routeReasons = Object.create(null);
    const laneChanges = {count: 0, succeeded: 0, failed: 0};
    const laneChangesByVehicle = new Map();
    const safety = {overlaps: 0, nearMisses: 0, inconclusivePairs: 0, incompleteScans: 0};
    let maxVehicleCount = 0;
    let routeChangeCount = 0;
    let recoveryCount = 0;
    let failedTripCount = 0;
    const tripFailureReasons = Object.create(null);

    function reasonBucket(map, reason) {
      const key = String(reason || 'unknown');
      if (map[key]) return map[key];
      if (Object.keys(map).length >= maxReasons) return map._other || (map._other = {count: 0, seconds: 0});
      return map[key] = {count: 0, seconds: 0};
    }

    function addEvent(type, data) {
      const event = {type, ...data};
      events.push(event);
      if (events.length > maxEvents) events.shift();
      return event;
    }

    function recordTrip(data = {}) {
      const duration = numberOr(data.duration, numberOr(data.durationSeconds,
        Number.isFinite(data.startedAt) && Number.isFinite(data.endedAt) ? data.endedAt - data.startedAt : NaN));
      if (duration >= 0) addMetric(trips, duration);
      const id = data.vehicleId;
      const laneState = id === undefined || id === null ? null : laneChangesByVehicle.get(id);
      const routeChangeCount = numberOr(data.routeChanges, NaN);
      const laneChangeCount = numberOr(data.laneChanges, laneState ? laneState.count : (id == null ? NaN : 0));
      const missedTurnCount = numberOr(data.missedTurns, NaN);
      if (routeChangeCount >= 0) addMetric(tripRouteChanges, routeChangeCount);
      if (laneChangeCount >= 0) addMetric(tripLaneChanges, laneChangeCount);
      if (missedTurnCount >= 0) addMetric(tripMissedTurns, missedTurnCount);
      if (id !== undefined && id !== null) laneChangesByVehicle.delete(id);
      return addEvent('trip', {vehicleId: id ?? null, duration: duration >= 0 ? duration : null,
        routeChanges: routeChangeCount >= 0 ? routeChangeCount : null,
        laneChanges: laneChangeCount >= 0 ? laneChangeCount : null,
        missedTurns: missedTurnCount >= 0 ? missedTurnCount : null});
    }

    function recordVehicleRecovery(data = {}) {
      recoveryCount++;
      return addEvent('vehicleRecovery', {
        vehicleId: data.vehicleId ?? null,
        simTime: numberOr(data.simTime, null),
        destinationId: data.destinationId ?? null,
        reason: data.reason || 'unknown',
        phase: data.phase || null,
        fromTrackId: data.fromTrackId ?? null,
        fromTrackLabel: data.fromTrackLabel ?? null,
        fromS: numberOr(data.fromS, null),
        routeBefore: data.routeBefore ?? null,
        routeAfter: data.routeAfter ?? null,
      });
    }

    function recordTripFailure(data = {}) {
      failedTripCount++;
      const reason = String(data.reason || 'unknown');
      reasonBucket(tripFailureReasons, reason).count++;
      return addEvent('tripFailure', {
        vehicleId: data.vehicleId ?? null,
        simTime: numberOr(data.simTime, null),
        destinationId: data.destinationId ?? null,
        phase: data.phase || null,
        reason,
        recoveryAttempted: !!data.recoveryAttempted,
        trackId: data.trackId ?? null,
        trackLabel: data.trackLabel ?? null,
        s: numberOr(data.s, null),
      });
    }

    function recordWait(data = {}) {
      const seconds = Math.max(0, numberOr(data.seconds, numberOr(data.duration, 0)));
      const reason = String(data.reason || 'unknown');
      const bucket = reasonBucket(waitReasons, reason);
      bucket.count++;
      bucket.seconds += seconds;
      return addEvent('wait', {vehicleId: data.vehicleId ?? null, reason,
        seconds, startedAt: Number.isFinite(data.startedAt) ? data.startedAt : null,
        endedAt: Number.isFinite(data.endedAt) ? data.endedAt : null});
    }

    function recordLaneChange(data = {}) {
      laneChanges.count++;
      const success = data.success !== false;
      if (success) laneChanges.succeeded++; else laneChanges.failed++;
      const id = data.vehicleId;
      if (success && id !== undefined && id !== null) {
        let state = laneChangesByVehicle.get(id);
        if (!state) {
          if (laneChangesByVehicle.size >= maxTrackedVehicles) {
            laneChangesByVehicle.delete(laneChangesByVehicle.keys().next().value);
          }
          state = {count: 0};
          laneChangesByVehicle.set(id, state);
        }
        state.count++;
      }
      const duration = numberOr(data.duration, NaN);
      if (duration >= 0) addMetric(laneChangeDurations, duration);
      return addEvent('laneChange', {vehicleId: data.vehicleId ?? null,
        from: data.from ?? null, to: data.to ?? null, success,
        duration: duration >= 0 ? duration : null, reason: data.reason || null});
    }

    function forgetVehicle(id) {
      if (id !== undefined && id !== null) laneChangesByVehicle.delete(id);
    }

    function recordRouteChange(data = {}) {
      routeChangeCount++;
      const reason = String(data.reason || 'unknown');
      const bucket = reasonBucket(routeReasons, reason);
      bucket.count++;
      return addEvent('routeChange', {vehicleId: data.vehicleId ?? null,
        from: data.from ?? null, to: data.to ?? null, reason});
    }

    function recordReservation(data = {}) {
      const leadTime = numberOr(data.leadTime,
        Number.isFinite(data.requestedAt) && Number.isFinite(data.grantedAt)
          ? data.grantedAt - data.requestedAt : NaN);
      if (leadTime >= 0) addMetric(reservationLeads, leadTime);
      return addEvent('reservation', {vehicleId: data.vehicleId ?? null,
        leadTime: leadTime >= 0 ? leadTime : null,
        requestedAt: Number.isFinite(data.requestedAt) ? data.requestedAt : null,
        grantedAt: Number.isFinite(data.grantedAt) ? data.grantedAt : null});
    }

    function recordSafety(result = {}) {
      const overlapCount = Array.isArray(result.overlaps) ? result.overlaps.length : Math.max(0, numberOr(result.overlaps, 0));
      const nearMissCount = Array.isArray(result.nearMisses) ? result.nearMisses.length : Math.max(0, numberOr(result.nearMisses, 0));
      const inconclusiveCount = Array.isArray(result.inconclusive) ? result.inconclusive.length : Math.max(0, numberOr(result.inconclusive, 0));
      const truncated = !!result.stats?.truncated;
      safety.overlaps += overlapCount;
      safety.nearMisses += nearMissCount;
      safety.inconclusivePairs += inconclusiveCount;
      if (truncated) safety.incompleteScans++;
      return addEvent('safety', {overlaps: overlapCount, nearMisses: nearMissCount,
        inconclusivePairs: inconclusiveCount, truncated});
    }

    function recordPerformance(data = {}) {
      const frameMs = numberOr(data.frameMs, numberOr(data.cpuMs, NaN));
      if (frameMs >= 0) addMetric(frameTimes, frameMs);
      const vehicleCount = Math.max(0, numberOr(data.vehicleCount, 0));
      maxVehicleCount = Math.max(maxVehicleCount, vehicleCount);
      return addEvent('performance', {frameMs: frameMs >= 0 ? frameMs : null, vehicleCount,
        simulatedSeconds: numberOr(data.simulatedSeconds, null)});
    }

    return {
      recordTrip,
      recordVehicleRecovery,
      recordTripFailure,
      recordWait,
      recordLaneChange,
      recordRouteChange,
      recordReservation,
      recordSafety,
      recordPerformance,
      forgetVehicle,
      getEvents() { return events.map(event => ({...event})); },
      summary() {
        const waits = {};
        for (const [reason, bucket] of Object.entries(waitReasons)) waits[reason] = {...bucket};
        const routes = {};
        for (const [reason, bucket] of Object.entries(routeReasons)) routes[reason] = {count: bucket.count};
        const laneSummary = metricSummary(laneChangeDurations);
        const leadSummary = metricSummary(reservationLeads);
        const frameSummary = metricSummary(frameTimes);
        const perTrip = {
          routeChanges: metricSummary(tripRouteChanges),
          laneChanges: metricSummary(tripLaneChanges),
          missedTurns: metricSummary(tripMissedTurns),
        };
        return {
          trips: metricSummary(trips),
          perTrip,
          waitReasons: waits,
          laneChanges: {count: laneChanges.count, succeeded: laneChanges.succeeded,
            failed: laneChanges.failed, averageDuration: laneSummary.average,
            p95Duration: laneSummary.p95},
          routeChanges: {count: routeChangeCount, byReason: routes},
          vehicleRecoveries: {count: recoveryCount},
          tripFailures: {count: failedTripCount, byReason: Object.fromEntries(
            Object.entries(tripFailureReasons).map(([reason, bucket]) => [reason, {count: bucket.count}]))},
          reservationLead: {count: leadSummary.count, average: leadSummary.average,
            median: leadSummary.median, p95: leadSummary.p95},
          safety: {...safety},
          performance: {samples: frameSummary.count, averageFrameMs: frameSummary.average,
            p95FrameMs: frameSummary.p95, maxFrameMs: frameSummary.max,
            maxVehicleCount},
          retainedEvents: events.length,
        };
      },
    };
  }

  return Object.freeze({
    angleDelta,
    interpolatePose,
    footprintAt,
    footprintsOverlap,
    footprintDistance,
    detectSweptOverlaps,
    createRecorder,
  });
});
