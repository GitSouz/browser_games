/*
 * Track definitions + geometry builder.
 *
 * Each track is a closed loop of control points (in "units"), smoothed with a
 * centripetal Catmull-Rom spline and resampled at a fixed spacing. The first
 * control point is the start/finish line and the list order is the driving
 * direction. All circuits are fictional.
 */
(function (root) {
  'use strict';

  const TRACKS = [
    {
      id: 'monzano',
      name: 'Monzano',
      tagline: 'Parco della Velocità',
      desc: 'Huge straights, tight chicanes and one long sweeping final bend. Keep it flat.',
      scale: 50,
      pts: [
        [40, 30], [55, 30], [68, 30],
        // Turn 1 chicane
        [74, 30], [77, 32.5], [81, 32.5],
        // Long right sweeper
        [88, 33], [95, 37], [99, 44],
        // Second chicane
        [100, 50], [102.5, 53], [102.5, 57],
        // Double rights
        [103, 63], [100, 68], [94, 69],
        [89, 69], [85, 72], [80, 74],
        // Back stretch
        [70, 76], [58, 76],
        // Fast chicane
        [52, 76], [49, 78.5], [45, 78.5], [42, 76],
        // back straight + final sweeper
        [32, 74], [22, 66], [14, 58], [9, 50], [9, 40], [13, 33], [22, 30],
      ],
    },
    {
      id: 'monterra',
      name: 'Monterra',
      tagline: 'Harbour Street Circuit',
      desc: 'Narrow, twisty and unforgiving. A hairpin, a tunnel and a waterfront chicane. Brake early.',
      scale: 50,
      pts: [
        [30, 20], [42, 19], [50, 18],
        // Turn 1
        [55, 18], [57.5, 22],
        // Uphill run
        [59, 29], [62, 35],
        // Plaza section
        [66, 39], [71, 39.5], [75, 41], [77, 45],
        // Downhill right
        [76, 50], [71, 51.5],
        // Hairpin
        [65, 51], [61, 51.5], [59, 54], [60.5, 57], [64, 58],
        // Seafront right
        [69, 58.5], [72.5, 61], [73, 65],
        // Tunnel
        [71, 69], [65, 71], [56, 71],
        // Harbour chicane
        [50, 71], [47, 73], [43, 73],
        // Quayside left
        [37, 72], [33, 69],
        // Waterfront esses
        [31, 64], [33.5, 60], [31, 56],
        // Final corners
        [27, 52], [22, 50], [17, 45], [15.5, 38], [17, 28], [22, 22],
      ],
    },
    {
      id: 'silverbrook',
      name: 'Silverbrook',
      tagline: 'Old Airfield Circuit',
      desc: 'Fast and flowing. Commit through the high-speed esses and carry speed onto the straights.',
      scale: 46,
      pts: [
        [40, 21], [50, 21],
        // Turn 1 / 2
        [56, 23], [59, 28], [60, 34],
        // Infield loop
        [60.5, 39], [63, 42.5], [67, 42.5],
        // Long straight
        [74, 39], [81, 33],
        // Stadium section
        [85, 29], [86, 24], [88, 19], [92, 16],
        // Pit straight
        [98, 15.5], [104, 17],
        // Fast right
        [107.5, 21], [108, 27],
        // High-speed esses
        [105.5, 31], [107.5, 35.5], [104.5, 40], [105.5, 45],
        // Hangar straight
        [104, 53], [100, 63],
        // Heavy braking right
        [97, 69], [92, 72.5], [86, 73],
        // Final complex
        [80, 73], [76.5, 75.5], [72, 74.5],
        // Sweep back to the line
        [60, 74], [48, 72], [38, 66], [32, 56], [30, 44], [30, 32], [32, 25], [35, 22],
      ],
    },
    {
      id: 'spavelle',
      name: 'Spavelle',
      tagline: 'Forest Hills Circuit',
      desc: 'A tight opening hairpin, a dip-and-climb kink, an endless straight and a flat-out final sweep.',
      scale: 46,
      pts: [
        [14, 64], [14, 52], [14, 42],
        // Opening hairpin
        [14.5, 35], [17.5, 31], [21.5, 32], [22.5, 37],
        // Downhill + compression kink
        [22.5, 47], [23, 56], [24.5, 62], [27.5, 63.5], [30, 60.5],
        // Long uphill straight
        [37, 54], [50, 45], [65, 37],
        // Top chicane
        [71, 34], [74, 36.5], [78, 36.5],
        // Far hairpin
        [83, 37.5], [86.5, 41], [86.5, 46], [83, 49], [79, 47.5],
        [74, 48], [68, 52],
        // Double left
        [63, 57], [61, 63], [63, 69],
        // Valley section
        [67, 73], [72, 76], [75, 80], [73, 85], [68, 87],
        // Flat-out sweep
        [58, 87], [45, 85], [34, 82],
        // Final chicane
        [27, 81], [24, 83], [20, 81.5], [16, 76], [14.5, 70],
      ],
    },
  ];

  const SPACING = 8;

  function catmullRom(p0, p1, p2, p3, u) {
    // Centripetal Catmull-Rom (alpha = 0.5), avoids loops and cusps.
    const td = (a, b) => Math.max(1e-4, Math.pow(Math.hypot(b.x - a.x, b.y - a.y), 0.5));
    const t0 = 0;
    const t1 = t0 + td(p0, p1);
    const t2 = t1 + td(p1, p2);
    const t3 = t2 + td(p2, p3);
    const t = t1 + (t2 - t1) * u;
    const lerp = (a, b, ta, tb) => {
      const w = (t - ta) / (tb - ta);
      return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
    };
    const a1 = lerp(p0, p1, t0, t1);
    const a2 = lerp(p1, p2, t1, t2);
    const a3 = lerp(p2, p3, t2, t3);
    const b1 = lerp(a1, a2, t0, t2);
    const b2 = lerp(a2, a3, t1, t3);
    return lerp(b1, b2, t1, t2);
  }

  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  /**
   * Build sampled geometry for a track definition.
   * `phys` supplies limits used to compute the advisory (AI) speed profile.
   */
  function buildTrack(def, phys) {
    const S = def.scale;
    const P = def.pts.map(([x, y]) => ({ x: x * S, y: y * S }));
    const n = P.length;

    // Dense spline sampling.
    const raw = [];
    for (let i = 0; i < n; i++) {
      const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
      const steps = 40;
      for (let s = 0; s < steps; s++) raw.push(catmullRom(p0, p1, p2, p3, s / steps));
    }

    // Arc-length resample to uniform spacing.
    const cum = [0];
    for (let i = 1; i <= raw.length; i++) {
      const a = raw[i - 1], b = raw[i % raw.length];
      cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    const length = cum[raw.length];
    const N = Math.round(length / SPACING);
    const spacing = length / N;
    const x = new Float32Array(N), y = new Float32Array(N);
    let seg = 0;
    for (let i = 0; i < N; i++) {
      const d = i * spacing;
      while (cum[seg + 1] < d) seg++;
      const a = raw[seg], b = raw[(seg + 1) % raw.length];
      const w = (d - cum[seg]) / Math.max(1e-6, cum[seg + 1] - cum[seg]);
      x[i] = a.x + (b.x - a.x) * w;
      y[i] = a.y + (b.y - a.y) * w;
    }

    // Tangents, normals (pointing right of travel), headings.
    const tx = new Float32Array(N), ty = new Float32Array(N);
    const nx = new Float32Array(N), ny = new Float32Array(N);
    const head = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      let dx = x[b] - x[a], dy = y[b] - y[a];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      tx[i] = dx; ty[i] = dy;
      nx[i] = -dy; ny[i] = dx;
      head[i] = Math.atan2(dy, dx);
    }

    // Signed curvature, smoothed.
    const kRaw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 2 + N) % N, b = (i + 2) % N;
      kRaw[i] = wrapAngle(head[b] - head[a]) / (4 * spacing);
    }
    const k = new Float32Array(N);
    const W = 5;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let j = -W; j <= W; j++) s += kRaw[(i + j + N) % N];
      k[i] = s / (2 * W + 1);
    }

    // Advisory speed profile (used by AI): cornering limit + braking pass.
    const adv = new Float32Array(N);
    if (phys) {
      for (let i = 0; i < N; i++) {
        const ka = Math.max(1e-5, Math.abs(k[i]));
        const vGrip = Math.sqrt((phys.LAT_TARMAC * 0.9) / ka);
        const vSteer = phys.STEER / (ka + (phys.STEER * phys.STEER_FADE) / phys.VMAX);
        adv[i] = Math.min(phys.VMAX, vGrip, vSteer * 1.15);
      }
      const brake = phys.BRAKE * 0.7;
      for (let pass = 0; pass < 2; pass++) {
        for (let c = N - 1; c >= 0; c--) {
          const j = (c + 1) % N;
          const lim = Math.sqrt(adv[j] * adv[j] + 2 * brake * spacing);
          if (adv[c] > lim) adv[c] = lim;
        }
      }
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < N; i++) {
      if (x[i] < minX) minX = x[i];
      if (y[i] < minY) minY = y[i];
      if (x[i] > maxX) maxX = x[i];
      if (y[i] > maxY) maxY = y[i];
    }

    return {
      def, n: N, spacing, length, x, y, tx, ty, nx, ny, head, k, adv,
      bounds: { minX, minY, maxX, maxY },
    };
  }

  const api = { TRACKS, buildTrack, wrapAngle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RacingTracks = api;
})(this);
