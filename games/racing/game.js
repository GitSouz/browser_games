/* Grand Prix Racer: rendering, input, race flow. */
(function () {
  'use strict';

  const { TRACKS, buildTrack } = window.RacingTracks;
  const Ph = window.RacingPhysics;
  const P = Ph.PHYS;

  const KMH = 0.6; // px/s -> displayed km/h
  const DT = 1 / 120;

  const AI_DRIVERS = [
    { name: 'Moreau', color: '#00c8b4', helmet: '#ffffff' },
    { name: 'Tanaka', color: '#ff8a00', helmet: '#1a1a1a' },
    { name: 'Novak', color: '#2f55ff', helmet: '#ffd400' },
    { name: 'Silva', color: '#0d7a55', helmet: '#ffffff' },
    { name: 'Kowalski', color: '#e9e9ee', helmet: '#e10600' },
  ];
  const DIFFICULTY = {
    easy: [0.80, 0.86],
    medium: [0.88, 0.95],
    hard: [0.95, 1.01],
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const el = {
    hud: $('hud'), pos: $('hud-pos'), lap: $('hud-lap'), time: $('hud-time'),
    last: $('hud-last'), best: $('hud-best'), speed: $('hud-speed'),
    lights: $('lights'), banner: $('banner'),
    menu: $('menu'), pause: $('pause'), results: $('results'), touch: $('touch'),
    trackList: $('track-list'),
  };

  // ---------- Storage (best laps) ----------
  function loadBest(id) {
    try { const v = localStorage.getItem('gpracer.best.' + id); return v ? parseFloat(v) : null; } catch (e) { return null; }
  }
  function saveBest(id, t) {
    try { localStorage.setItem('gpracer.best.' + id, String(t)); } catch (e) { /* ignore */ }
  }

  function fmt(t) {
    if (t == null || !isFinite(t)) return '–';
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
  }

  // ---------- Track render data ----------
  const built = {};
  function getTrack(id) {
    if (!built[id]) {
      const def = TRACKS.find((t) => t.id === id);
      const track = buildTrack(def, P);
      track.render = buildRender(track);
      built[id] = track;
    }
    return built[id];
  }

  function offsetPath(track, off, from, to, closed) {
    const p = new Path2D();
    const N = track.n;
    const count = closed ? N : to - from + 1;
    for (let c = 0; c < count; c++) {
      const i = (from + c + N) % N;
      const x = track.x[i] + track.nx[i] * off, y = track.y[i] + track.ny[i] * off;
      if (c === 0) p.moveTo(x, y); else p.lineTo(x, y);
    }
    if (closed) p.closePath();
    return p;
  }

  function buildRender(track) {
    const N = track.n;
    const center = offsetPath(track, 0, 0, N - 1, true);
    const edgeL = offsetPath(track, -(P.HALF_W - 4), 0, N - 1, true);
    const edgeR = offsetPath(track, P.HALF_W - 4, 0, N - 1, true);

    // Kerbs on corners
    const kerbs = [];
    const TH = 1 / 420;
    let i = 0;
    // start scanning from a straight-ish sample so runs don't wrap awkwardly
    let start = 0;
    for (let s = 0; s < N; s++) if (Math.abs(track.k[s]) < TH) { start = s; break; }
    while (i < N) {
      const s = (start + i) % N;
      if (Math.abs(track.k[s]) >= TH) {
        let len = 0;
        while (i + len < N && Math.abs(track.k[(start + i + len) % N]) >= TH) len++;
        if (len >= 6) {
          const a = start + i - 5, b = start + i + len + 5;
          kerbs.push(offsetPath(track, P.HALF_W + 2, a, b, false));
          kerbs.push(offsetPath(track, -(P.HALF_W + 2), a, b, false));
        }
        i += len;
      } else i++;
    }

    // Scenery trees, kept clear of the circuit
    const trees = [];
    const b = track.bounds;
    let seed = 1234567 + N;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const pad = 500;
    for (let t = 0; t < 420; t++) {
      const x = b.minX - pad + rnd() * (b.maxX - b.minX + pad * 2);
      const y = b.minY - pad + rnd() * (b.maxY - b.minY + pad * 2);
      let ok = true;
      for (let j = 0; j < N; j += 3) {
        const dx = x - track.x[j], dy = y - track.y[j];
        if (dx * dx + dy * dy < (P.WALL + 60) * (P.WALL + 60)) { ok = false; break; }
      }
      if (ok) trees.push({ x, y, r: 16 + rnd() * 18, s: rnd() });
    }

    return { center, edgeL, edgeR, kerbs, trees };
  }

  // ---------- Game state ----------
  const cfg = { trackId: 'monzano', laps: 3, ai: 5, diff: 'medium' };
  let state = 'menu';
  let track = null;
  let cars = [];
  let player = null;
  let raceTime = 0;
  let countdownT = 0;
  let goDelay = 0;
  let skids = [];
  let cam = { x: 0, y: 0, z: 1 };
  let bannerT = 0;
  let resultsTimer = 0;
  let sessionBest = null;

  const keys = { up: false, down: false, left: false, right: false };

  function setupRace() {
    track = getTrack(cfg.trackId);
    cars = [];
    skids = [];
    raceTime = 0;
    const [lo, hi] = DIFFICULTY[cfg.diff];
    const nAi = cfg.ai;
    const total = nAi + 1;
    // Fastest AI start at the front; player starts at the back.
    const ai = AI_DRIVERS.slice(0, nAi).map((d, k) => ({
      ...d, skill: hi - (hi - lo) * (nAi > 1 ? k / (nAi - 1) : 0.5),
    }));
    for (let slot = 0; slot < total; slot++) {
      const isPlayer = slot === total - 1;
      const back = 34 + slot * 46;
      const side = slot % 2 === 0 ? -18 : 18;
      const d = isPlayer ? { name: 'You', color: '#e10600', helmet: '#ffd400' } : ai[slot];
      const car = Ph.createCar(track, {
        back, side, name: d.name, color: d.color, helmet: d.helmet,
        isPlayer, skill: d.skill || 1, lane: (Math.random() - 0.5) * 22,
      });
      if (!isPlayer) car.vmaxMul = 0.94 + d.skill * 0.06;
      cars.push(car);
      if (isPlayer) player = car;
    }
    sessionBest = loadBest(track.def.id);
    cam.x = player.x; cam.y = player.y;
    el.best.textContent = fmt(sessionBest);
    el.last.textContent = '–';
  }

  function startCountdown() {
    setupRace();
    state = 'countdown';
    countdownT = 0;
    goDelay = 0.4 + Math.random() * 1.2;
    show(el.hud); show(el.lights);
    hide(el.menu); hide(el.pause); hide(el.results); hide(el.banner);
    if (isTouch) show(el.touch);
    for (const s of el.lights.children) s.classList.remove('on');
  }

  function banner(text, secs, warn) {
    el.banner.textContent = text;
    el.banner.classList.toggle('warn', !!warn);
    show(el.banner);
    bannerT = secs;
  }

  function show(e) { e.classList.remove('hidden'); }
  function hide(e) { e.classList.add('hidden'); }

  // ---------- Simulation ----------
  function playerInput() {
    return { up: keys.up, down: keys.down, steer: (keys.right ? 1 : 0) - (keys.left ? 1 : 0) };
  }

  function tick(dt) {
    if (state === 'countdown') {
      countdownT += dt;
      const lit = Math.min(5, Math.floor(countdownT / 0.75));
      for (let i = 0; i < 5; i++) el.lights.children[i].classList.toggle('on', i < lit);
      if (countdownT > 5 * 0.75 + goDelay) {
        state = 'race';
        hide(el.lights);
        banner('GO!', 0.9);
      }
      return;
    }
    if (state !== 'race' && state !== 'done') return;

    raceTime += dt;
    for (const car of cars) {
      let inp;
      if (car.isPlayer && state === 'race' && !car.finished) inp = playerInput();
      else if (car.isPlayer) inp = { up: false, down: true, steer: 0 };
      else inp = car.finished ? { up: false, down: true, steer: Ph.aiInput(car, track, dt).steer } : Ph.aiInput(car, track, dt);
      const prevRear = rearPositions(car);
      Ph.stepCar(car, inp, dt, track);
      if (car.sliding && !car.offTrack && Math.hypot(car.vx, car.vy) > 60) {
        const now = rearPositions(car);
        skids.push([prevRear[0], prevRear[1], now[0], now[1], prevRear[2], prevRear[3], now[2], now[3]]);
        if (skids.length > 1800) skids.splice(0, 200);
      }
      const ev = Ph.updateLaps(car, track, raceTime, cfg.laps);
      if (car.isPlayer && ev) onPlayerLap(ev);
    }
    Ph.collideCars(cars);

    if (state === 'race' && player.wrongWayT > 1 && bannerT <= 0.1) banner('WRONG WAY', 0.3, true);
  }

  function onPlayerLap(ev) {
    el.last.textContent = fmt(player.lastLap);
    let newBest = false;
    if (player.lastLap != null && (sessionBest == null || player.lastLap < sessionBest)) {
      sessionBest = player.lastLap;
      saveBest(track.def.id, sessionBest);
      el.best.textContent = fmt(sessionBest);
      newBest = true;
    }
    if (ev === 'finish') {
      state = 'done';
      banner('FINISH', 1.4);
      hide(el.touch);
      setTimeout(showResults, 1400);
      return;
    }
    if (player.lap === cfg.laps) banner(newBest ? 'NEW BEST · FINAL LAP' : 'FINAL LAP', 1.6);
    else if (newBest) banner('NEW BEST LAP', 1.4);
    else if (player.lap > 1) banner('LAP ' + player.lap, 1.1);
  }

  function rearPositions(car) {
    const c = Math.cos(car.a), s = Math.sin(car.a);
    const rx = car.x - c * 12, ry = car.y - s * 12;
    return [rx - s * 8, ry + c * 8, rx + s * 8, ry - c * 8];
  }

  function standings() {
    return cars.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.prog - a.prog;
    });
  }

  // ---------- Results ----------
  function showResults() {
    if (state !== 'done') return;
    hide(el.hud);
    show(el.results);
    renderResults();
  }

  function renderResults() {
    const st = standings();
    const pos = st.indexOf(player) + 1;
    const ord = ['th', 'st', 'nd', 'rd'];
    const suf = (n) => (n % 100 >= 11 && n % 100 <= 13) ? 'th' : (ord[n % 10] || 'th');
    $('results-title').textContent = cars.length === 1 ? 'Finished' : (pos === 1 ? 'Victory!' : pos + suf(pos) + ' place');
    $('results-sub').textContent = track.def.name + ' · ' + cfg.laps + (cfg.laps === 1 ? ' lap' : ' laps') +
      ' · Your best lap: ' + fmt(loadBest(track.def.id));
    const winner = st[0];
    const body = $('results-body');
    body.innerHTML = '';
    st.forEach((c, i) => {
      const tr = document.createElement('tr');
      if (c.isPlayer) tr.className = 'me';
      let t;
      if (c.finished) t = i === 0 ? fmt(c.finishTime) : '+' + (c.finishTime - winner.finishTime).toFixed(3);
      else t = 'racing…';
      tr.innerHTML = '<td>' + (i + 1) + '</td><td><span class="swatch" style="background:' + c.color + '"></span>' +
        c.name + '</td><td>' + t + '</td><td>' + fmt(c.bestLap) + '</td>';
      body.appendChild(tr);
    });
  }

  // ---------- Rendering ----------
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
  }

  function updateCamera(dt) {
    if (!player) return;
    const speed = Math.hypot(player.vx, player.vy);
    const base = Math.max(0.5, Math.min(1.15, Math.min(W, H) / 760));
    const zt = base * (1 - 0.18 * Math.min(1, speed / P.VMAX));
    const tx = player.x + player.vx * 0.32, ty = player.y + player.vy * 0.32;
    const k = 1 - Math.exp(-dt * 5);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    cam.z += (zt - cam.z) * (1 - Math.exp(-dt * 2));
  }

  function drawWorld() {
    const r = track.render;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#2c6a2c';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(cam.z, cam.z);
    ctx.translate(-cam.x, -cam.y);

    const vw = W / cam.z / 2 + 60, vh = H / cam.z / 2 + 60;
    const x0 = cam.x - vw, x1 = cam.x + vw, y0 = cam.y - vh, y1 = cam.y + vh;

    // mowing stripes
    ctx.fillStyle = '#2f7130';
    const sw = 90;
    for (let x = Math.floor(x0 / (sw * 2)) * sw * 2; x < x1; x += sw * 2) ctx.fillRect(x, y0, sw, y1 - y0);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // tyre barrier band
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = P.WALL * 2 + 16;
    ctx.stroke(r.center);
    ctx.setLineDash([22, 22]);
    ctx.strokeStyle = '#d92b2b';
    ctx.lineWidth = P.WALL * 2 + 10;
    ctx.stroke(r.center);
    ctx.setLineDash([]);
    // run-off
    ctx.strokeStyle = '#3c8a3a';
    ctx.lineWidth = P.WALL * 2;
    ctx.stroke(r.center);
    // gravel-ish shoulder
    ctx.strokeStyle = '#4c9446';
    ctx.lineWidth = P.HALF_W * 2 + 34;
    ctx.stroke(r.center);
    // asphalt
    ctx.strokeStyle = '#3b3e44';
    ctx.lineWidth = P.HALF_W * 2;
    ctx.stroke(r.center);
    // edge lines
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 3;
    ctx.stroke(r.edgeL);
    ctx.stroke(r.edgeR);
    // kerbs
    ctx.lineCap = 'butt';
    for (const k of r.kerbs) {
      ctx.strokeStyle = '#d5262c';
      ctx.lineWidth = 11;
      ctx.stroke(k);
      ctx.setLineDash([12, 12]);
      ctx.strokeStyle = '#f4f4f4';
      ctx.stroke(k);
      ctx.setLineDash([]);
    }

    drawStartLine();

    // skid marks
    ctx.strokeStyle = 'rgba(15,15,18,0.32)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (const s of skids) {
      if (s[0] < x0 || s[0] > x1 || s[1] < y0 || s[1] > y1) continue;
      ctx.moveTo(s[0], s[1]); ctx.lineTo(s[4], s[5]);
      ctx.moveTo(s[2], s[3]); ctx.lineTo(s[6], s[7]);
    }
    ctx.stroke();

    for (const c of cars) drawCar(c);

    // trees above cars (they're off-track anyway)
    for (const t of r.trees) {
      if (t.x < x0 - 40 || t.x > x1 + 40 || t.y < y0 - 40 || t.y > y1 + 40) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.arc(t.x + 8, t.y + 10, t.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = t.s > 0.5 ? '#1f5224' : '#24602a';
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath(); ctx.arc(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.55, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
  }

  function drawStartLine() {
    const i = 0;
    ctx.save();
    ctx.translate(track.x[i], track.y[i]);
    ctx.rotate(track.head[i]);
    const sq = 8;
    const rows = Math.round((P.HALF_W * 2) / sq);
    for (let c = 0; c < 2; c++) {
      for (let rI = 0; rI < rows; rI++) {
        ctx.fillStyle = (c + rI) % 2 ? '#111' : '#fff';
        ctx.fillRect(-sq + c * sq, -P.HALF_W + rI * sq, sq, sq);
      }
    }
    ctx.restore();
    // grid slots
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2.5;
    for (let slot = 0; slot < 6; slot++) {
      const back = 34 + slot * 46 - 20;
      const idx = (track.n - Math.round(back / track.spacing)) % track.n;
      const side = slot % 2 === 0 ? -18 : 18;
      ctx.save();
      ctx.translate(track.x[idx] + track.nx[idx] * side, track.y[idx] + track.ny[idx] * side);
      ctx.rotate(track.head[idx]);
      ctx.beginPath();
      ctx.moveTo(-2, -12); ctx.lineTo(4, -12); ctx.moveTo(-2, -12); ctx.lineTo(-2, 12); ctx.lineTo(4, 12);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawCar(c) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.a);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-18, -8, 40, 19);

    const tyre = '#141414';
    const steerA = c.steer * 0.4;
    // rear tyres
    ctx.fillStyle = tyre;
    ctx.fillRect(-17, -11, 10, 5.5);
    ctx.fillRect(-17, 5.5, 10, 5.5);
    // front tyres (steer)
    for (const sy of [-8.5, 8.5]) {
      ctx.save();
      ctx.translate(11, sy);
      ctx.rotate(steerA);
      ctx.fillRect(-4.5, -2.5, 9, 5);
      ctx.restore();
    }
    // rear wing
    ctx.fillStyle = '#1d1d1d';
    ctx.fillRect(-21, -8, 4, 16);
    ctx.fillStyle = c.color;
    ctx.fillRect(-21, -8, 4, 3);
    ctx.fillRect(-21, 5, 4, 3);
    // body
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.moveTo(-17, -4);
    ctx.lineTo(-6, -7);
    ctx.lineTo(4, -6);
    ctx.lineTo(8, -3);
    ctx.lineTo(20, -1.6);
    ctx.lineTo(20, 1.6);
    ctx.lineTo(8, 3);
    ctx.lineTo(4, 6);
    ctx.lineTo(-6, 7);
    ctx.lineTo(-17, 4);
    ctx.closePath();
    ctx.fill();
    // front wing
    ctx.fillStyle = '#1d1d1d';
    ctx.fillRect(18, -10, 3.5, 20);
    ctx.fillStyle = c.color;
    ctx.fillRect(18, -10, 3.5, 4);
    ctx.fillRect(18, 6, 3.5, 4);
    // cockpit + helmet
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.ellipse(-1, 0, 5, 3.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.helmet;
    ctx.beginPath(); ctx.arc(-1.5, 0, 2.6, 0, Math.PI * 2); ctx.fill();
    // brake lights
    if (c.braking) {
      ctx.fillStyle = '#ff3030';
      ctx.fillRect(-19, -1.5, 2, 3);
    }
    ctx.restore();

    if (c.isPlayer && state === 'countdown') {
      ctx.fillStyle = '#ffd400';
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - 30); ctx.lineTo(c.x - 7, c.y - 42); ctx.lineTo(c.x + 7, c.y - 42);
      ctx.closePath(); ctx.fill();
    }
  }

  function drawMinimap() {
    const b = track.bounds;
    const maxW = Math.min(190, W * 0.32), maxH = Math.min(150, H * 0.26);
    const tw = b.maxX - b.minX, th = b.maxY - b.minY;
    const s = Math.min(maxW / tw, maxH / th);
    const mw = tw * s, mh = th * s;
    const pad = 10;
    const ox = W - mw - pad - 12, oy = 62;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = 'rgba(10,12,15,0.62)';
    roundRect(ox - pad, oy - pad, mw + pad * 2, mh + pad * 2, 10);
    ctx.fill();
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    ctx.translate(-b.minX, -b.minY);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 3 / s;
    ctx.stroke(track.render.center);
    ctx.restore();
    // start line
    const sx = ox + (track.x[0] - b.minX) * s, sy = oy + (track.y[0] - b.minY) * s;
    ctx.fillStyle = '#ffd400';
    ctx.fillRect(sx - 2, sy - 2, 4, 4);
    for (const c of cars) {
      if (c === player) continue;
      dot(ox + (c.x - b.minX) * s, oy + (c.y - b.minY) * s, 3.5, c.color);
    }
    dot(ox + (player.x - b.minX) * s, oy + (player.y - b.minY) * s, 5, '#e10600', '#fff');
  }

  function dot(x, y, r, fill, stroke) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.lineWidth = 1.5; ctx.strokeStyle = stroke; ctx.stroke(); }
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

  function updateHud() {
    const st = standings();
    el.pos.textContent = (st.indexOf(player) + 1) + '/' + cars.length;
    el.lap.textContent = Math.max(1, Math.min(cfg.laps, player.lap)) + '/' + cfg.laps;
    const lapT = player.lap >= 1 && !player.finished ? raceTime - player.lapStart : (player.finished ? player.lastLap : 0);
    el.time.textContent = fmt(lapT || 0);
    el.speed.textContent = Math.round(Math.max(0, player.vf) * KMH);
  }

  // Attract-mode camera for the menu: slow orbit around the selected track.
  let menuT = 0;
  function menuCamera(dt) {
    const t = getTrack(cfg.trackId);
    if (track !== t) { track = t; cars = []; player = null; skids = []; }
    menuT += dt;
    const i = Math.floor((menuT * 30) % t.n);
    const z = Math.max(0.45, Math.min(0.9, Math.min(W, H) / 1100));
    const k = 1 - Math.exp(-dt * 1.5);
    cam.x += (t.x[i] - cam.x) * k;
    cam.y += (t.y[i] - cam.y) * k;
    cam.z += (z - cam.z) * k;
  }

  // ---------- Main loop ----------
  let last = performance.now();
  let acc = 0;
  function frame(now) {
    let dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    if (state === 'menu') {
      menuCamera(dt);
      drawWorld();
    } else if (track) {
      if (state !== 'paused') {
        acc += dt;
        while (acc >= DT) { tick(DT); acc -= DT; }
        updateCamera(dt);
        if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) hide(el.banner); }
        if (state === 'done') {
          resultsTimer += dt;
          if (resultsTimer > 0.5 && !el.results.classList.contains('hidden')) { resultsTimer = 0; renderResults(); }
        }
      }
      drawWorld();
      if (state !== 'done' || el.results.classList.contains('hidden')) drawMinimap();
      if (state !== 'done') updateHud();
    }
    requestAnimationFrame(frame);
  }

  // ---------- Pause / flow ----------
  let prevState = null;
  function pause() {
    if (state !== 'race' && state !== 'countdown') return;
    prevState = state;
    state = 'paused';
    show(el.pause);
    hide(el.touch);
  }
  function resume() {
    if (state !== 'paused') return;
    state = prevState;
    hide(el.pause);
    if (isTouch) show(el.touch);
    last = performance.now();
  }
  function toMenu() {
    state = 'menu';
    hide(el.hud); hide(el.pause); hide(el.results); hide(el.lights); hide(el.banner); hide(el.touch);
    show(el.menu);
    refreshTrackCards();
  }

  // ---------- Input ----------
  const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  };
  window.addEventListener('keydown', (e) => {
    const k = KEYMAP[e.code];
    if (k) { keys[k] = true; if (state !== 'menu') e.preventDefault(); }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (state === 'paused') resume(); else pause();
    }
    if (e.code === 'KeyR' && state !== 'menu') startCountdown();
    if ((e.code === 'Enter' || e.code === 'Space') && state === 'menu') { e.preventDefault(); startCountdown(); }
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.code];
    if (k) keys[k] = false;
  });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  const isTouch = ('ontouchstart' in window) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  if (isTouch) document.body.classList.add('touch');
  for (const b of el.touch.querySelectorAll('button')) {
    const k = b.dataset.k;
    const on = (e) => { e.preventDefault(); keys[k] = true; b.classList.add('active'); };
    const off = (e) => { e.preventDefault(); keys[k] = false; b.classList.remove('active'); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('pointerleave', off);
  }

  // ---------- Menu ----------
  function drawPreview(cv, t) {
    const c = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    c.clearRect(0, 0, w, h);
    const b = t.bounds, pad = 14;
    const s = Math.min((w - pad * 2) / (b.maxX - b.minX), (h - pad * 2) / (b.maxY - b.minY));
    const ox = (w - (b.maxX - b.minX) * s) / 2, oy = (h - (b.maxY - b.minY) * s) / 2;
    c.save();
    c.translate(ox, oy); c.scale(s, s); c.translate(-b.minX, -b.minY);
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineWidth = 6 / s;
    c.stroke(t.render.center);
    c.restore();
    c.fillStyle = '#e10600';
    c.beginPath();
    c.arc(ox + (t.x[0] - b.minX) * s, oy + (t.y[0] - b.minY) * s, 5, 0, Math.PI * 2);
    c.fill();
  }

  const cards = {};
  function buildMenu() {
    for (const def of TRACKS) {
      const btn = document.createElement('button');
      btn.className = 'track-card';
      btn.type = 'button';
      const cv = document.createElement('canvas');
      cv.width = 320; cv.height = 240;
      btn.appendChild(cv);
      btn.insertAdjacentHTML('beforeend',
        '<div class="tname">' + def.name + '</div><div class="ttag">' + def.tagline + '</div><div class="tbest"></div>');
      btn.addEventListener('click', () => { cfg.trackId = def.id; refreshTrackCards(); });
      btn.addEventListener('dblclick', () => { cfg.trackId = def.id; startCountdown(); });
      el.trackList.appendChild(btn);
      cards[def.id] = btn;
      drawPreview(cv, getTrack(def.id));
    }
    const desc = document.createElement('p');
    desc.className = 'track-desc';
    desc.id = 'track-desc';
    el.trackList.after(desc);

    const seg = (id, key, parse) => {
      const root = $(id);
      root.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        for (const x of root.children) x.classList.toggle('on', x === b);
        cfg[key] = parse(b.dataset.v);
      });
    };
    seg('opt-laps', 'laps', Number);
    seg('opt-ai', 'ai', Number);
    seg('opt-diff', 'diff', String);
    refreshTrackCards();
  }

  function refreshTrackCards() {
    for (const def of TRACKS) {
      const c = cards[def.id];
      c.classList.toggle('on', def.id === cfg.trackId);
      const b = loadBest(def.id);
      c.querySelector('.tbest').textContent = b ? 'Best ' + fmt(b) : '';
    }
    $('track-desc').textContent = TRACKS.find((t) => t.id === cfg.trackId).desc;
  }

  $('start-btn').addEventListener('click', startCountdown);
  $('pause-btn').addEventListener('click', pause);
  $('resume-btn').addEventListener('click', resume);
  $('restart-btn').addEventListener('click', startCountdown);
  $('quit-btn').addEventListener('click', toMenu);
  $('again-btn').addEventListener('click', startCountdown);
  $('menu-btn').addEventListener('click', toMenu);

  window.addEventListener('resize', resize);
  resize();
  buildMenu();
  requestAnimationFrame(frame);

  // Exposed for debugging / automated checks.
  window.__racer = { cfg, keys, get state() { return state; }, get player() { return player; }, get cars() { return cars; } };
})();
