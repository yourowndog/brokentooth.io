// Brokentooth, concept 02: Lamplight.
//
// The site's index is a line of streetlamps on an elevated road, drawn in one fixed
// perspective. Each section owns a lamp; reading a section strikes it, so the line
// lights toward the horizon as you go deeper. The lamps are cold mercury, except one:
// About is the only sodium lamp on the road. The camera never moves.

(() => {
  const cv = document.getElementById('road');
  const ctx = cv.getContext('2d');
  const side = document.querySelector('.side');
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  const mix = (a, b, t) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t);
  const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  function mulberry(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // World units are metres. Camera at X=0, eye 1.7 m above the deck, looking down +z.
  const CAM_H = 1.7;
  const LAMP_X = -4.9, ARM = 2.15, HEAD_Y = 8.6, POLE_Y = 8.2;
  const LAMP_COUNT = 14, SPACING = 10.5;
  const SODIUM = 4;

  const MERCURY = { from: [70, 120, 140], to: [178, 228, 218], core: [236, 250, 246], dur: 1.5 };
  const SODIUM_LIGHT = { from: [196, 58, 74], to: [255, 166, 78], core: [255, 232, 196], dur: 3.4 };

  let W, H, DPR, mainX, mainW, vpX, vpY, f, z0;
  let stat = null, fog = null, grain = null;
  let lamps = [];
  let active = -1, hovered = -1;

  const P = (X, Y, z) => [vpX + (X * f) / z, vpY - ((Y - CAM_H) * f) / z];

  function poly(g, pts) {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
  }

  // ── Static scene ───────────────────────────────────────────────────────

  function buildStatic() {
    stat = document.createElement('canvas');
    stat.width = Math.ceil(W * DPR); stat.height = Math.ceil(H * DPR);
    const g = stat.getContext('2d');
    g.scale(DPR, DPR);
    const r = mulberry(1977);

    // Sky.
    let gr = g.createLinearGradient(0, 0, 0, vpY);
    gr.addColorStop(0, '#030507'); gr.addColorStop(0.55, '#0c1418'); gr.addColorStop(0.88, '#24343a'); gr.addColorStop(1, '#3a4d53');
    g.fillStyle = gr; g.fillRect(0, 0, W, vpY + 1);
    gr = g.createLinearGradient(0, vpY, 0, H);
    gr.addColorStop(0, '#141c20'); gr.addColorStop(1, '#06090b');
    g.fillStyle = gr; g.fillRect(0, vpY, W, H - vpY);

    // A low cloud deck, lit faintly from below by somewhere else.
    for (let i = 0; i < 9; i++) {
      const cx = mainX + r() * mainW * 1.2 - mainW * 0.1;
      const cy = vpY * (0.12 + r() * 0.62);
      const rx = mainW * (0.1 + r() * 0.22), ry = rx * (0.06 + r() * 0.07);
      const ph = [r() * 6, r() * 6, r() * 6];
      const pts = [];
      for (let j = 0; j < 60; j++) {
        const a = (j / 60) * Math.PI * 2;
        const k = 1 + 0.22 * Math.sin(3 * a + ph[0]) + 0.1 * Math.sin(8 * a + ph[1]) + 0.05 * Math.sin(19 * a + ph[2]);
        const sy = Math.sin(a);
        pts.push([cx + Math.cos(a) * rx * k, cy + sy * ry * k * (sy > 0 ? 0.5 : 1.3)]);
      }
      poly(g, pts);
      g.fillStyle = '#080d10'; g.fill();
      g.save(); g.clip(); g.translate(0, ry * 0.5);
      poly(g, pts); g.strokeStyle = 'rgba(120,150,156,0.16)'; g.lineWidth = 1.5; g.stroke(); g.restore();
    }

    // Haze sitting on the horizon.
    gr = g.createLinearGradient(0, vpY - H * 0.12, 0, vpY + H * 0.06);
    gr.addColorStop(0, 'rgba(84,108,114,0)'); gr.addColorStop(0.8, 'rgba(84,108,114,0.55)'); gr.addColorStop(1, 'rgba(84,108,114,0)');
    g.fillStyle = gr; g.fillRect(0, vpY - H * 0.12, W, H * 0.18);

    // Distant city, far right, very low.
    let x = vpX - 30;
    while (x < W) {
      const w = 4 + r() * 26, h = 2 + r() ** 2.4 * 26;
      g.fillStyle = '#0c1215'; g.fillRect(x, vpY - h, w, h + 2);
      if (r() < 0.25) { g.fillStyle = 'rgba(170,200,205,0.35)'; g.fillRect(x + r() * w, vpY - h * r(), 1, 1); }
      x += w + r() * 6;
    }

    // Megastructure, set back from the road on the left.
    const blocks = [];
    for (let z = 6; z < 900; z += 10 + r() * 30) {
      blocks.push({ X0: -12 - r() * 30, wid: 10 + r() * 30, za: z, zb: z + 12 + r() * 40, h: 26 + r() ** 1.5 * 110, tone: r() });
    }
    // The wall that lines the road.
    const wall = [];
    for (let z = 2; z < 1200; ) {
      const len = 9 + r() * 16;
      wall.push({ X0: -7, wid: 5, za: z, zb: z + len, h: 12 + r() * 26, tone: r(), wall: true });
      z += len;
    }
    for (const b of [...blocks].sort((a, b2) => b2.za - a.za)) drawBlock(g, b, r);
    for (const b of [...wall].sort((a, b2) => b2.za - a.za)) drawBlock(g, b, r);

    // Pipe bundle running along the wall.
    for (const [Y, rad] of [[11.2, 0.45], [12.3, 0.55]]) {
      const a = P(-6.4, Y + rad, 3), b = P(-6.4, Y + rad, 1500), c = P(-6.4, Y - rad, 1500), d = P(-6.4, Y - rad, 3);
      poly(g, [a, b, c, d]); g.fillStyle = '#080c0e'; g.fill();
      g.strokeStyle = 'rgba(160,180,185,0.22)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
    }
    for (let z = 4; z < 600; z += 12) {
      const [x1, y1] = P(-6.4, 10.4, z), [x2, y2] = P(-6.4, 13.2, z), [x3] = P(-7, 13.2, z);
      g.strokeStyle = '#06090b'; g.lineWidth = Math.max(1, (0.25 * f) / z);
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo(x3, y2); g.stroke();
    }

    // An overpass far ahead: the road runs under the city.
    {
      const z = 74;
      const [xl, yt] = P(-7, 17.5, z), [xr, yb] = P(60, 14, z);
      g.fillStyle = '#070b0d'; g.fillRect(xl, yt, xr - xl, yb - yt);
      g.strokeStyle = 'rgba(150,170,175,0.25)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(xl, yt + 0.5); g.lineTo(xr, yt + 0.5); g.stroke();
      const s = f / z, bay = 3.2 * s, th = (yb - yt);
      g.strokeStyle = '#000'; g.lineWidth = Math.max(1, 0.3 * s);
      for (let x = xl, i = 0; x < xr; x += bay, i++) {
        g.beginPath(); g.moveTo(x, yb); g.lineTo(x + bay / 2, yb + th * 0.9); g.lineTo(x + bay, yb); g.stroke();
      }
      g.beginPath(); g.moveTo(xl, yb + th * 0.9); g.lineTo(xr, yb + th * 0.9); g.stroke();
      for (const X of [8, 30]) {
        const [px, py] = P(X, 0, z), [, pt] = P(X, 14, z);
        g.fillStyle = '#06090b'; g.fillRect(px - 0.6 * s, pt, 1.2 * s, py - pt);
      }
    }

    // Walkway between the wall and the kerb.
    poly(g, [P(-7, 0.25, 1.2), P(-7, 0.25, 4000), P(-4.25, 0.25, 4000), P(-4.25, 0.25, 1.2)]);
    g.fillStyle = '#0e1316'; g.fill();
    // Deck.
    poly(g, [P(-4.25, 0, 1.2), P(-4.25, 0, 4000), P(5.6, 0, 4000), P(5.6, 0, 1.2)]);
    gr = g.createLinearGradient(0, vpY, 0, H);
    gr.addColorStop(0, '#151b1e'); gr.addColorStop(1, '#07090a');
    g.fillStyle = gr; g.fill();
    // Kerb face.
    poly(g, [P(-4.25, 0.25, 1.2), P(-4.25, 0.25, 4000), P(-4.25, 0, 4000), P(-4.25, 0, 1.2)]);
    g.fillStyle = '#20282c'; g.fill();

    // Expansion joints, closer together as they recede.
    for (let z = 3; z < 900; z += 7) {
      const [a1, b1] = P(-4.25, 0, z), [a2] = P(5.6, 0, z);
      g.fillStyle = `rgba(0,0,0,${clamp(0.55 - z / 1400, 0.1, 0.55)})`;
      g.fillRect(a1, b1, a2 - a1, Math.max(0.6, (0.06 * f) / z));
    }
    // Centre line.
    for (let z = 2.5; z < 700; z += 10) {
      poly(g, [P(0.55, 0, z), P(0.55, 0, z + 3.2), P(0.72, 0, z + 3.2), P(0.72, 0, z)]);
      g.fillStyle = '#323b3f'; g.fill();
    }
    // Parapet on the open side.
    poly(g, [P(5.6, 1.15, 1.2), P(5.6, 1.15, 4000), P(5.6, 0, 4000), P(5.6, 0, 1.2)]);
    g.fillStyle = '#161d20'; g.fill();
    g.strokeStyle = 'rgba(170,190,195,0.3)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(...P(5.6, 1.15, 1.2)); g.lineTo(...P(5.6, 1.15, 4000)); g.stroke();
    for (let z = 3; z < 500; z += 5) {
      const [x1, y1] = P(5.6, 1.15, z), [, y2] = P(5.6, 0, z);
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x1, y1, Math.max(0.5, (0.08 * f) / z), y2 - y1);
    }

    // Lamp standards, far to near.
    for (let i = LAMP_COUNT - 1; i >= 0; i--) drawStandard(g, lamps[i]);

    // Vignette.
    gr = g.createRadialGradient(vpX, vpY, Math.min(W, H) * 0.2, vpX, vpY, Math.max(W, H) * 0.95);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }

  function drawBlock(g, b, r) {
    const { X0, wid, za, zb, h, tone } = b;
    // Front face (towards the viewer).
    poly(g, [P(X0 - wid, 0, za), P(X0, 0, za), P(X0, h, za), P(X0 - wid, h, za)]);
    g.fillStyle = b.wall ? '#080c0e' : '#06090b'; g.fill();
    // Side face (towards the road).
    const sideFace = [P(X0, 0, za), P(X0, 0, zb), P(X0, h, zb), P(X0, h, za)];
    poly(g, sideFace);
    const base = b.wall ? 11 + tone * 6 : 8 + tone * 6;
    g.fillStyle = `rgb(${base - 3},${base + 4},${base + 7})`; g.fill();
    g.save(); poly(g, sideFace); g.clip();
    // Floor lines converge on the vanishing point; vertical joints mark the bays.
    g.strokeStyle = `rgba(150,172,178,${b.wall ? 0.085 : 0.06})`; g.lineWidth = 1;
    const step = b.wall ? 2.4 : 3.6;
    for (let Y = step; Y < h; Y += step) {
      g.beginPath(); g.moveTo(...P(X0, Y, za)); g.lineTo(...P(X0, Y, zb)); g.stroke();
    }
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    for (let z = za + 4; z < zb; z += 4 + r() * 3) {
      g.lineWidth = Math.max(1, (0.18 * f) / z);
      g.beginPath(); g.moveTo(...P(X0, 0, z)); g.lineTo(...P(X0, h, z)); g.stroke();
    }
    if (!b.wall && r() < 0.5) {
      const n = (r() * 4) | 0;
      for (let i = 0; i < n; i++) {
        const z = za + r() * (zb - za), Y = 4 + r() * (h - 8);
        const [x, y] = P(X0, Y, z), s = f / z;
        g.fillStyle = 'rgba(176,206,210,0.55)'; g.fillRect(x, y, Math.max(1, 0.5 * s), Math.max(1, 0.35 * s));
      }
    }
    g.restore();
    // Lit top edge.
    g.strokeStyle = 'rgba(160,180,185,0.16)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(...P(X0 - wid, h, za)); g.lineTo(...P(X0, h, za)); g.lineTo(...P(X0, h, zb)); g.stroke();
  }

  function drawStandard(g, L) {
    const { z } = L;
    const s = f / z;
    const [bx, by] = P(LAMP_X, 0.25, z), [tx, ty] = P(LAMP_X, POLE_Y, z);
    const [hx, hy] = P(LAMP_X + ARM, HEAD_Y, z);
    const w = Math.max(1, 0.2 * s);
    g.fillStyle = '#05080a';
    g.fillRect(bx - w / 2, ty, w, by - ty);
    g.fillRect(bx - w * 1.4, by - 0.9 * s, w * 2.8, 0.9 * s);
    g.strokeStyle = '#05080a'; g.lineWidth = Math.max(1, 0.13 * s);
    g.beginPath(); g.moveTo(tx, ty); g.quadraticCurveTo(tx, hy - 0.25 * s, hx - 0.45 * s, hy); g.stroke();
    g.fillStyle = '#1d2528';
    g.fillRect(hx - 0.5 * s, hy - 0.1 * s, Math.max(2, 1.0 * s), Math.max(1, 0.2 * s));
    // A cold lens that is not lit yet.
    g.fillStyle = 'rgba(150,175,180,0.55)';
    g.fillRect(hx - 0.42 * s, hy + 0.08 * s, Math.max(2, 0.84 * s), Math.max(1, 0.06 * s));
    g.fillStyle = 'rgba(160,180,185,0.4)';
    g.fillRect(bx + w / 2 - Math.max(0.5, w * 0.25), ty, Math.max(0.5, w * 0.25), by - ty);
  }

  // ── Fog and grain ──────────────────────────────────────────────────────

  function buildFog() {
    const fw = 384, fh = 96;
    fog = document.createElement('canvas');
    fog.width = fw; fog.height = fh;
    const g = fog.getContext('2d');
    const img = g.createImageData(fw, fh);
    const r = mulberry(7);
    const grid = (n) => Array.from({ length: n * n }, r);
    const octs = [[6, 0.5], [12, 0.28], [24, 0.14], [48, 0.08]].map(([n, a]) => ({ n, a, v: grid(n + 1) }));
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      let v = 0;
      for (const o of octs) {
        const gx = (x / fw) * o.n, gy = (y / fh) * o.n;
        const ix = gx | 0, iy = gy | 0, fx = smooth(gx - ix), fy = smooth(gy - iy);
        const idx = (a, b) => o.v[(b % o.n) * (o.n + 1) + (a % o.n)];
        const top = idx(ix, iy) * (1 - fx) + idx(ix + 1, iy) * fx;
        const bot = idx(ix, iy + 1) * (1 - fx) + idx(ix + 1, iy + 1) * fx;
        v += (top * (1 - fy) + bot * fy) * o.a;
      }
      const edge = Math.sin((y / fh) * Math.PI);
      const a = clamp((v - 0.42) * 2.4, 0, 1) * edge;
      const i = (y * fw + x) * 4;
      img.data[i] = 150; img.data[i + 1] = 168; img.data[i + 2] = 172; img.data[i + 3] = a * 255;
    }
    g.putImageData(img, 0, 0);

    grain = document.createElement('canvas');
    grain.width = grain.height = 160;
    const gg = grain.getContext('2d');
    const gi = gg.createImageData(160, 160);
    for (let i = 0; i < gi.data.length; i += 4) {
      const v = r() * 255;
      gi.data[i] = gi.data[i + 1] = gi.data[i + 2] = v; gi.data[i + 3] = 13;
    }
    gg.putImageData(gi, 0, 0);
  }

  // ── Light ──────────────────────────────────────────────────────────────

  function lampLight(L, now) {
    const spec = L.i === SODIUM ? SODIUM_LIGHT : MERCURY;
    let level, col;
    if (L.on) {
      const t = reduced ? spec.dur : (now - L.t0) / 1000;
      const k = smooth(clamp(t / spec.dur, 0, 1));
      // A discharge lamp catches in stutters before it settles.
      const stutter = t < 0.55 && Math.sin(t * 61) * Math.sin(t * 23 + 1) > 0.15 ? 0.3 : 1;
      level = Math.max(0.12, k) * stutter;
      col = mix(spec.from, spec.to, k);
      L.level = level;
    } else {
      L.level = Math.max(0, (L.level || 0) - 0.04);
      level = L.level;
      col = spec.to;
    }
    if (L.i === hovered && level < 0.3) { level = 0.3; col = mix(spec.from, spec.to, 0.5); }
    return [level, col, spec.core];
  }

  function drawLamp(L, level, col, core) {
    if (level <= 0.01) return;
    const z = L.z, s = f / z;
    const warm = L.i === SODIUM ? 1.7 : 1;
    const [hx, hy] = P(LAMP_X + ARM, HEAD_Y, z);
    const [gx, gy] = P(LAMP_X + ARM, 0, z);

    // Pool on the deck: a ground circle in perspective.
    const R = 5.5;
    const yN = vpY + (CAM_H * f) / Math.max(z - R, 1.2), yF = vpY + (CAM_H * f) / (z + R);
    const rx = R * s, ry = (yN - yF) / 2, cy = (yN + yF) / 2;
    ctx.save();
    ctx.translate(gx, cy); ctx.scale(1, ry / rx);
    let g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, rgba(col, Math.min(1, 0.78 * warm) * level)); g.addColorStop(0.3, rgba(col, 0.36 * warm * level)); g.addColorStop(0.7, rgba(col, 0.08 * level)); g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g; ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
    ctx.restore();

    // Light on the wall beside it.
    const [wx, wy] = P(-7, 4.5, z);
    g = ctx.createRadialGradient(wx, wy, 0, wx, wy, 7 * s);
    g.addColorStop(0, rgba(col, 0.13 * warm * warm * level)); g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g; ctx.fillRect(wx - 7 * s, wy - 7 * s, 14 * s, 14 * s);

    // The cone through the haze: two passes, soft outside, denser core.
    for (const [spread, a] of [[R * 1.15, 0.03], [R * 0.95, 0.035], [R * 0.75, 0.04], [R * 0.55, 0.045], [R * 0.35, 0.05], [R * 0.18, 0.05]]) {
      g = ctx.createLinearGradient(0, hy, 0, gy);
      g.addColorStop(0, rgba(col, a * level)); g.addColorStop(0.7, rgba(col, a * 0.35 * level)); g.addColorStop(1, rgba(col, 0.02 * level));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(hx - 0.35 * s, hy); ctx.lineTo(hx + 0.35 * s, hy);
      ctx.lineTo(gx + spread * s, gy); ctx.lineTo(gx - spread * s, gy);
      ctx.closePath(); ctx.fill();
    }

    // Bloom and the lamp itself.
    const bloom = Math.max(26, 6 * s) * warm * warm;
    g = ctx.createRadialGradient(hx, hy, 0, hx, hy, bloom);
    g.addColorStop(0, rgba(col, 0.32 * warm * level)); g.addColorStop(0.25, rgba(col, 0.1 * level)); g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g; ctx.fillRect(hx - bloom, hy - bloom, bloom * 2, bloom * 2);
    const halo = Math.max(5, 1.1 * s);
    g = ctx.createRadialGradient(hx, hy + 0.05 * s, 0, hx, hy + 0.05 * s, halo);
    g.addColorStop(0, rgba(core, 0.95 * level)); g.addColorStop(0.3, rgba(col, 0.6 * level)); g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g; ctx.fillRect(hx - halo, hy - halo, halo * 2, halo * 2);
    ctx.fillStyle = rgba(core, level);
    ctx.fillRect(hx - 0.42 * s, hy + 0.05 * s, Math.max(2, 0.84 * s), Math.max(1, 0.09 * s));
  }

  // Dust hanging in each lit cone, drifting slowly.
  const motes = Array.from({ length: 260 }, (_, k) => {
    const r = mulberry(k * 7 + 3);
    return { lamp: k % 5, u: r(), v: r(), w: r() * 2 - 1, sp: 0.2 + r() * 0.8, ph: r() * 6.28, sz: 0.5 + r() * 1.3 };
  });
  function drawMotes(now, dt) {
    const t = now / 1000;
    for (const m of motes) {
      const L = lamps[m.lamp];
      if (!L || !L.level) continue;
      if (!reduced) { m.v += dt * 0.012 * m.sp; if (m.v > 1) m.v -= 1; }
      const z = L.z, s = f / z;
      const [hx, hy] = P(LAMP_X + ARM, HEAD_Y, z), [gx, gy] = P(LAMP_X + ARM, 0, z);
      const y = hy + (gy - hy) * (0.08 + m.v * 0.9);
      const k = (y - hy) / (gy - hy);
      const half = (0.35 + k * 4.2) * s;
      const x = hx + (gx - hx) * k + m.w * half * 0.85 + Math.sin(t * 0.4 + m.ph) * 0.15 * s;
      const fadeIn = Math.min(1, (1 - Math.abs(m.w)) * 2.2);
      const a = L.level * fadeIn * (0.35 + 0.35 * Math.sin(t * 1.3 + m.ph));
      if (a <= 0.02) continue;
      const col = L.i === SODIUM ? SODIUM_LIGHT.core : MERCURY.core;
      ctx.fillStyle = rgba(col, a);
      const sz = Math.max(0.6, m.sz * Math.min(1.6, s / 40));
      ctx.fillRect(x, y, sz, sz);
    }
  }

  function drawFigure(level, col) {
    // Someone waiting under the sodium lamp.
    const L = lamps[SODIUM];
    const z = L.z - 1.2, s = f / z;
    const [x, y] = P(-2.4, 0, z);
    const h = 1.78 * s;
    ctx.globalAlpha = clamp((level - 0.45) / 0.55, 0, 1);
    ctx.fillStyle = '#020303';
    ctx.beginPath(); ctx.ellipse(x, y - h * 0.92, h * 0.065, h * 0.08, 0.2, 0, 6.283); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - h * 0.11, y - h * 0.8); ctx.lineTo(x + h * 0.11, y - h * 0.8);
    ctx.lineTo(x + h * 0.14, y - h * 0.32); ctx.lineTo(x - h * 0.13, y - h * 0.32); ctx.closePath(); ctx.fill();
    ctx.fillRect(x - h * 0.085, y - h * 0.34, h * 0.07, h * 0.34);
    ctx.fillRect(x + h * 0.02, y - h * 0.34, h * 0.07, h * 0.34);
    ctx.fillStyle = rgba(col, 0.8);
    ctx.fillRect(x - h * 0.05, y - h * 0.995, h * 0.1, Math.max(1, h * 0.012));
    ctx.fillRect(x - h * 0.11, y - h * 0.8, h * 0.22, Math.max(1, h * 0.01));
    ctx.globalAlpha = 1;
    // Shadow thrown forward by the lamp behind.
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.ellipse(x + h * 0.05, y + h * 0.02, h * 0.16, h * 0.035, 0, 0, 6.283); ctx.fill();
  }

  let fogX = 0, last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.drawImage(stat, 0, 0, W, H);

    if (!reduced) fogX += dt * 6;
    const fy = vpY - H * 0.16, fh = H - fy;
    ctx.globalAlpha = 0.085;
    for (const [dir, scl, off] of [[1, 1, 0], [-0.6, 1.4, 0.3]]) {
      const fw = W * scl * 1.6;
      let x = -((fogX * dir + off * fw) % fw);
      if (x > 0) x -= fw;
      for (; x < W; x += fw) ctx.drawImage(fog, x, fy, fw, fh);
    }
    ctx.globalAlpha = 1;

    ctx.globalCompositeOperation = 'lighter';
    let sodium = null;
    for (let i = LAMP_COUNT - 1; i >= 0; i--) {
      const [lv, col, core] = lampLight(lamps[i], now);
      drawLamp(lamps[i], lv, col, core);
      if (i === SODIUM) sodium = [lv, col];
    }
    drawMotes(now, dt);
    ctx.globalCompositeOperation = 'source-over';
    if (sodium && sodium[0] > 0.45) drawFigure(...sodium);

    ctx.globalAlpha = 1;
    ctx.fillStyle = ctx.createPattern(grain, 'repeat');
    ctx.fillRect(0, 0, W, H);

    requestAnimationFrame(frame);
  }

  // ── Reading position ───────────────────────────────────────────────────

  const markers = [...document.querySelectorAll('[data-lamp]')];
  const links = [...document.querySelectorAll('.lamps a')];
  const sections = markers.filter((m) => !m.matches('a'));

  function strike(i) {
    const L = lamps[i];
    if (!L || L.on) return;
    L.on = true; L.t0 = performance.now();
  }

  function onScroll() {
    let a = 0;
    for (const s of sections) if (s.getBoundingClientRect().top < H * 0.62) a = +s.dataset.lamp;
    if (window.scrollY + H >= root.scrollHeight - 4) a = 4;
    if (a !== active) {
      active = a;
      for (const L of lamps) { if (L.i <= a) strike(L.i); else L.on = false; }
      for (const m of markers) m.classList.toggle('lit', +m.dataset.lamp <= a);
      for (const l of links) l.setAttribute('aria-current', +l.dataset.lamp === a ? 'true' : 'false');
    }
    // At the end of the road the veil lifts, so the last lamp can be seen.
    const toEnd = clamp((window.scrollY + H - (root.scrollHeight - H * 0.45)) / (H * 0.45), 0, 1);
    const veil = clamp((window.scrollY - H * 0.2) / (H * 0.55), 0, 1) * (1 - 0.75 * toEnd);
    root.style.setProperty('--veil', veil.toFixed(3));
  }

  for (const l of links) {
    l.addEventListener('pointerenter', () => { hovered = +l.dataset.lamp; });
    l.addEventListener('pointerleave', () => { hovered = -1; });
  }

  // ── Layout ─────────────────────────────────────────────────────────────

  function layout() {
    W = innerWidth; H = innerHeight;
    DPR = Math.min(devicePixelRatio || 1, 2);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    const phone = W <= 820;
    mainX = phone ? 0 : side.getBoundingClientRect().width;
    mainW = W - mainX;
    vpX = mainX + mainW * (phone ? 0.72 : 0.74);
    vpY = H * (phone ? 0.46 : 0.5);
    f = phone ? Math.max(W * 0.95, H * 0.42) : Math.max(mainW * 0.62, H * 0.75);
    // The nearest lamp's head sits just inside the top of the frame.
    z0 = Math.max(6, ((HEAD_Y - CAM_H) * f) / (vpY - H * (phone ? 0.16 : 0.1)));
    const prev = lamps;
    lamps = Array.from({ length: LAMP_COUNT }, (_, i) => ({ i, z: z0 + i * SPACING, on: prev[i]?.on, t0: prev[i]?.t0 ?? 0, level: prev[i]?.level ?? 0 }));
    buildStatic();
  }

  buildFog();
  layout();
  active = -1;
  onScroll();
  addEventListener('scroll', onScroll, { passive: true });
  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { layout(); onScroll(); }, 100); });
  requestAnimationFrame(frame);
})();
