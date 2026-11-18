/*
 * Car physics, track-relative positioning, lap tracking and AI drivers.
 * DOM-free so it can be simulated headlessly.
 */
(function (root) {
  'use strict';

  const PHYS = {
    VMAX: 560,          // px/s top speed on tarmac
    ACCEL: 340,         // px/s^2 at low speed
    BRAKE: 900,         // px/s^2
    REV_MAX: 150,
    DRAG: 0.12,         // proportional drag (1/s)
    COAST: 60,          // extra decel when off throttle
    STEER: 2.9,         // rad/s at full lock (low-ish speed)
    STEER_FADE: 0.45,   // fraction of steering lost at top speed
    STEER_RESP: 9,      // how fast steering input ramps
    GRIP: 7,            // lateral velocity damping (1/s)
    LAT_TARMAC: 720,    // max lateral accel on tarmac
    LAT_GRASS: 280,
    GRASS_VMAX: 210,
    GRASS_DRAG: 1.4,
    HALF_W: 44,         // half track width
    WALL: 112,          // barrier distance from centre line
    CAR_R: 14,          // collision radius
  };

  const SEARCH_WIN = 30;

  function nearest(track, px, py, hint) {
    const N = track.n, X = track.x, Y = track.y;
    let best = -1, bestD = Infinity;
    if (hint < 0) {
      for (let i = 0; i < N; i++) {
        const dx = px - X[i], dy = py - Y[i];
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
      }
    } else {
      for (let o = -SEARCH_WIN; o <= SEARCH_WIN; o++) {
        const i = (hint + o + N) % N;
        const dx = px - X[i], dy = py - Y[i];
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    const lat = (px - X[best]) * track.nx[best] + (py - Y[best]) * track.ny[best];
    return { i: best, lat };
  }

  function createCar(track, opts) {
    const back = opts.back;       // distance behind the line, px
    const side = opts.side || 0;  // lateral offset
    const N = track.n;
    const idx = (N - Math.round(back / track.spacing)) % N;
    const car = {
      x: track.x[idx] + track.nx[idx] * side,
      y: track.y[idx] + track.ny[idx] * side,
      a: track.head[idx],
      vx: 0, vy: 0, vf: 0, vr: 0,
      steer: 0,
      idx,
      prog: idx - N,   // continuous progress in samples; crossing 0 starts lap 1
      lap: 0,
      lapStart: 0,
      lastLap: null,
      bestLap: null,
      finished: false,
      finishTime: null,
      offTrack: false,
      sliding: false,
      wrongWayT: 0,
      stuckT: 0,
      color: opts.color,
      helmet: opts.helmet || '#ffffff',
      name: opts.name,
      isPlayer: !!opts.isPlayer,
      skill: opts.skill || 1,
      lane: opts.lane || 0,
      laneT: Math.random() * 10,
      throttle: false,
      braking: false,
    };
    return car;
  }

  /** Advance one car by dt seconds with the given input {up, down, steer}. */
  function stepCar(car, inp, dt, track) {
    const P = PHYS;
    const near0 = nearest(track, car.x, car.y, car.idx);
    const off = Math.abs(near0.lat) > P.HALF_W + 4;
    car.offTrack = off;

    const fx = Math.cos(car.a), fy = Math.sin(car.a);
    let vf = car.vx * fx + car.vy * fy;
    let vr = -car.vx * fy + car.vy * fx;
    const vmax = off ? P.GRASS_VMAX : P.VMAX * (car.vmaxMul || 1);

    // Longitudinal
    car.throttle = !!inp.up;
    car.braking = !!inp.down && vf > 5;
    if (inp.up) {
      if (vf < vmax) {
        const r = Math.max(0, vf) / vmax;
        vf += P.ACCEL * (1 - r * r) * dt;
      }
    }
    if (inp.down) {
      if (vf > 5) vf = Math.max(0, vf - P.BRAKE * dt);
      else vf = Math.max(-P.REV_MAX, vf - P.ACCEL * 0.6 * dt);
    }
    if (!inp.up && !inp.down) {
      const c = P.COAST * dt;
      vf = Math.abs(vf) <= c ? 0 : vf - Math.sign(vf) * c;
    }
    vf -= vf * (off ? P.GRASS_DRAG : P.DRAG) * dt;
    if (vf > vmax) vf -= (vf - vmax) * (off ? 2.2 : 1) * dt;

    // Steering
    const target = Math.max(-1, Math.min(1, inp.steer || 0));
    car.steer += (target - car.steer) * Math.min(1, P.STEER_RESP * dt);
    const sp = Math.abs(vf);
    const lowSpeed = Math.min(1, sp / 110);
    const fade = 1 - P.STEER_FADE * Math.min(1, sp / P.VMAX);
    const omega = car.steer * P.STEER * lowSpeed * fade * (vf >= 0 ? 1 : -1);
    car.a += omega * dt;

    // Lateral grip (capped => slides when asking too much)
    let dvr = -vr * (1 - Math.exp(-P.GRIP * dt));
    const cap = (off ? P.LAT_GRASS : P.LAT_TARMAC) * dt;
    if (dvr > cap) dvr = cap; else if (dvr < -cap) dvr = -cap;
    vr += dvr;
    car.sliding = Math.abs(vr) > 70;

    const nfx = Math.cos(car.a), nfy = Math.sin(car.a);
    car.vx = nfx * vf - nfy * vr;
    car.vy = nfy * vf + nfx * vr;
    car.vf = vf; car.vr = vr;
    car.x += car.vx * dt;
    car.y += car.vy * dt;

    // Barriers
    const near = nearest(track, car.x, car.y, car.idx);
    if (Math.abs(near.lat) > P.WALL) {
      const s = Math.sign(near.lat);
      const nxw = track.nx[near.i] * s, nyw = track.ny[near.i] * s;
      const pen = Math.abs(near.lat) - P.WALL;
      car.x -= nxw * pen;
      car.y -= nyw * pen;
      const vn = car.vx * nxw + car.vy * nyw;
      if (vn > 0) {
        car.vx -= nxw * vn * 1.4;
        car.vy -= nyw * vn * 1.4;
      }
      car.vx *= 0.8; car.vy *= 0.8;
      car.hitWall = true;
    } else car.hitWall = false;

    // Progress
    const N = track.n;
    let d = near.i - car.idx;
    if (d > N / 2) d -= N; else if (d < -N / 2) d += N;
    car.prog += d;
    car.idx = near.i;
    car.lat = near.lat;

    // Wrong-way detection
    const along = car.vx * track.tx[car.idx] + car.vy * track.ty[car.idx];
    car.wrongWayT = along < -40 ? car.wrongWayT + dt : 0;
  }

  /** Update lap counters. Returns 'lap' | 'finish' | null. */
  function updateLaps(car, track, time, totalLaps) {
    if (car.finished) return null;
    const lapNow = Math.floor(car.prog / track.n) + 1;
    if (lapNow > car.lap) {
      let ev = null;
      if (car.lap >= 1) {
        const t = time - car.lapStart;
        car.lastLap = t;
        if (car.bestLap == null || t < car.bestLap) car.bestLap = t;
        ev = 'lap';
      }
      car.lap = lapNow;
      car.lapStart = time;
      if (car.lap > totalLaps) {
        car.finished = true;
        car.finishTime = time;
        car.lap = totalLaps;
        ev = 'finish';
      }
      return ev;
    }
    return null;
  }

  /** Pure-pursuit AI driver. */
  function aiInput(car, track, dt) {
    const N = track.n;
    const speed = Math.hypot(car.vx, car.vy);
    car.laneT += dt * 0.35;
    const lane = car.lane + Math.sin(car.laneT) * 8;
    const look = Math.round((45 + speed * 0.28) / track.spacing);
    const ti = (car.idx + look) % N;
    const px = track.x[ti] + track.nx[ti] * lane;
    const py = track.y[ti] + track.ny[ti] * lane;
    const want = Math.atan2(py - car.y, px - car.x);
    let diff = want - car.a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const steer = Math.max(-1, Math.min(1, diff * 3.2));

    let target = track.adv[(car.idx + 3) % N] * car.skill;
    if (car.offTrack) target = Math.min(target, PHYS.GRASS_VMAX);
    const vf = car.vf;

    // Unstick: if crawling for a while, reverse briefly.
    if (car.reverseT > 0) {
      car.reverseT -= dt;
      return { up: false, down: true, steer: -steer };
    }
    if (speed < 25) car.stuckT += dt; else car.stuckT = 0;
    if (car.stuckT > 1.5) { car.stuckT = 0; car.reverseT = 0.8; }

    return { up: vf < target, down: vf > target + 30, steer };
  }

  /** Simple circle collisions between cars. */
  function collideCars(cars) {
    const R = PHYS.CAR_R, D = R * 2;
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= D * D || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        const pen = (D - d) / 2;
        a.x -= nx * pen; a.y -= ny * pen;
        b.x += nx * pen; b.y += ny * pen;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          const imp = -rel * 0.65;
          a.vx -= nx * imp; a.vy -= ny * imp;
          b.vx += nx * imp; b.vy += ny * imp;
        }
        a.bumped = b.bumped = true;
      }
    }
  }

  const api = { PHYS, nearest, createCar, stepCar, updateLaps, aiInput, collideCars };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RacingPhysics = api;
})(this);
