// Brokentooth, concept 01: the broken tooth.
//
// The layout grid is drawn as a regular row of inked steel pylons. One pylon is
// missing. That gap is the only place on the page where anything can be read:
// scrolling parts the structure until the gap becomes the reading column, and
// the light inside it warms the deeper you go.
//
// Geometry is owned by CSS (.shaft-inner); the structure conforms to it.

(() => {
  const cv = document.getElementById('works');
  const ctx = cv.getContext('2d');
  const shaft = document.querySelector('.shaft');
  const inner = document.querySelector('.shaft-inner');
  const root = document.documentElement;

  const INK = '#000';
  const SLATE = '#414c52';
  const SLATE_DK = '#20272b';
  const STEEL = [176, 188, 194];
  const SKY_DAY = [91, 103, 110];
  const SKY_NIGHT = [17, 22, 25];
  // Must match the --light-* stops in style.css.
  const LIGHT = [
    [0, [223, 229, 232]],
    [0.45, [229, 227, 218]],
    [0.8, [237, 217, 182]],
    [1, [240, 199, 142]],
  ];
  const WINDOW_COLD = [198, 210, 214];
  const WINDOW_WARM = [236, 168, 78];

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  const mix = (a, b, t) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t);
  const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  let fade = 1;
  const steel = (a) => rgba(STEEL, a * fade);

  function lightAt(f) {
    f = clamp(f, 0, 1);
    for (let i = 1; i < LIGHT.length; i++) {
      if (f <= LIGHT[i][0]) {
        const [f0, c0] = LIGHT[i - 1];
        const [f1, c1] = LIGHT[i];
        return mix(c0, c1, (f - f0) / (f1 - f0));
      }
    }
    return LIGHT[LIGHT.length - 1][1];
  }

  function mulberry(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const seedOf = (...n) => n.reduce((h, v) => Math.imul(h ^ ((v + 0x9e3779b9) | 0), 2654435761) >>> 0, 2166136261);

  function pick(weights, r) {
    let total = 0;
    for (const k in weights) total += weights[k];
    let x = r() * total;
    for (const k in weights) { x -= weights[k]; if (x <= 0) return k; }
    return Object.keys(weights)[0];
  }

  // ── State ────────────────────────────────────────────────────────────────

  let W, H, DPR, narrow;
  let P, PW, SLOT, scale, gapHalf, cx, colL, colR, colW, extraFinal, maxK;
  let shaftTop, shaftH, docH;
  let beams = [];
  let pylons = new Map();
  let clouds = [];
  let paint = null;
  let bands = new Map();
  let grimeDark, grimeLight;
  let fontsReady = false;

  // ── Textures ─────────────────────────────────────────────────────────────

  function makeGrime(color, aLo, aHi, streaks, specks, seed) {
    const tw = 180, th = 420;
    const t = document.createElement('canvas');
    t.width = tw; t.height = th;
    const g = t.getContext('2d');
    const r = mulberry(seed);
    for (let i = 0; i < streaks; i++) {
      const x = r() * tw, y = r() * th;
      const len = 6 + r() ** 2 * 190;
      const w = 0.5 + r() * 1.9;
      g.fillStyle = rgba(color, aLo + r() * (aHi - aLo));
      for (const dy of [-th, 0, th]) g.fillRect(x, y + dy, w, len);
    }
    for (let i = 0; i < specks; i++) {
      const s = 0.6 + r() * 1.8;
      g.fillStyle = rgba(color, aLo + r() * (aHi - aLo) * 1.4);
      g.fillRect(r() * tw, r() * th, s, s * (0.6 + r()));
    }
    return ctx.createPattern(t, 'repeat');
  }

  // ── Structure generation ─────────────────────────────────────────────────

  function pylon(k) {
    let p = pylons.get(k);
    if (p) return p;
    const r = mulberry(seedOf(k, 77));
    const side = Math.sign(k);
    // The left mass is heavier and darker; the right is lighter and more open.
    const weights = side < 0
      ? { plate: 4, slate: 0.5, lattice: 0.5, pipes: 1.3, louvre: 1.1, hatch: 1.1 }
      : { plate: 2.6, slate: 1.5, lattice: 0.9, pipes: 1.1, louvre: 1, hatch: 1 };
    const limit = docH + H;
    const cells = [];
    let y = -r() * 220 * scale;
    let prev = null;
    while (y < limit) {
      const h = (150 + r() * 380) * scale;
      let type = pick(weights, r);
      if (type === prev) type = pick(weights, r);
      cells.push({ y, h, type, seed: (r() * 1e9) | 0 });
      prev = type;
      y += h;
    }
    const girders = [];
    y = r() * 300 * scale;
    while (y < limit) {
      girders.push({ y, double: r() < 0.25 });
      y += (220 + r() * 520) * scale;
    }
    p = { cells, girders, side };
    pylons.set(k, p);
    return p;
  }

  function buildClouds() {
    const r = mulberry(seedOf(9, 31));
    clouds = [];
    const span = H + docH * 0.12 + 200;
    const n = Math.round(5 + (span / H) * 5);
    for (let i = 0; i < n; i++) {
      const rx = W * (0.07 + r() * 0.2) + 60;
      const ry = rx * (0.1 + r() * 0.12);
      const ph = [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28];
      const pts = [];
      const N = 64;
      for (let j = 0; j < N; j++) {
        const a = (j / N) * Math.PI * 2;
        const rad = 1 + 0.2 * Math.sin(3 * a + ph[0]) + 0.11 * Math.sin(7 * a + ph[1])
          + 0.06 * Math.sin(17 * a + ph[2]) + 0.04 * Math.sin(29 * a + ph[3]);
        const sy = Math.sin(a);
        pts.push([Math.cos(a) * rx * rad, sy * ry * rad * (sy < 0 ? 1.35 : 0.55)]);
      }
      clouds.push({ x: r() * W * 1.2 - W * 0.1, y: r() * span - 120, pts });
    }
  }

  // The name is painted once, onto the intact structure. Each pylon carries its
  // own slice of the paint, so the word is cut by the slots and comes apart
  // with the steel.
  function buildPaint() {
    bands = new Map();
    paint = document.createElement('canvas');
    paint.width = Math.ceil(W * DPR);
    paint.height = Math.ceil(H * DPR);
    const g = paint.getContext('2d');
    g.scale(DPR, DPR);
    g.fillStyle = '#dcdfda';
    if ('letterSpacing' in g) g.letterSpacing = '0.02em';

    if (!narrow) {
      g.font = '100px Michroma';
      const wB = g.measureText('BROKEN').width;
      const wT = g.measureText('TOOTH').width;
      const inset = 0.2 * P;
      const margin = Math.max(28, W * 0.03);
      const availL = cx - gapHalf - inset - margin;
      const availR = W - (cx + gapHalf + inset) - margin;
      const fs = Math.min((100 * availL) / wB, (100 * availR) / wT, H * 0.16);
      g.font = `${fs}px Michroma`;
      const capH = g.measureText('H').actualBoundingBoxAscent;
      const base = H * 0.86;
      g.textBaseline = 'alphabetic';
      g.textAlign = 'right';
      g.fillText('BROKEN', cx - gapHalf - inset, base);
      g.textAlign = 'left';
      g.fillText('TOOTH', cx + gapHalf + inset, base);
      const band = [base - capH - fs * 0.3, base + fs * 0.3];
      const spanL = [cx - gapHalf - inset - (fs * wB) / 100, cx - gapHalf];
      const spanR = [cx + gapHalf, cx + gapHalf + inset + (fs * wT) / 100];
      for (let k = -maxK; k <= maxK; k++) {
        if (!k) continue;
        const x0 = cx + k * P - PW / 2, x1 = x0 + PW;
        const s = k < 0 ? spanL : spanR;
        if (x1 > s[0] && x0 < s[1]) bands.set(k, band);
      }
    } else {
      // Tall, narrow screens: the name runs up the two pylons that frame the gap.
      const fs = PW * 0.5;
      g.font = `${fs}px Michroma`;
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      const bottom = H * 0.9;
      let tallest = 0;
      for (const [k, word] of [[-1, 'BROKEN'], [1, 'TOOTH']]) {
        const len = g.measureText(word).width;
        tallest = Math.max(tallest, len);
        g.save();
        g.translate(cx + k * P, bottom);
        g.rotate(-Math.PI / 2);
        g.fillText(word, 0, 0);
        g.restore();
      }
      const band = [bottom - tallest - PW * 0.35, bottom + PW * 0.3];
      bands.set(-1, band);
      bands.set(1, band);
    }

    // Weather the paint: chips, scrapes and runs.
    const r = mulberry(seedOf(3, 5));
    g.globalCompositeOperation = 'destination-out';
    const area = W * H;
    for (let i = 0; i < area / 260; i++) {
      g.fillStyle = `rgba(0,0,0,${0.35 + r() * 0.65})`;
      const s = 0.8 + r() ** 3 * 5;
      g.fillRect(r() * W, r() * H, s, s * (0.5 + r()));
    }
    for (let i = 0; i < area / 9000; i++) {
      g.fillStyle = `rgba(0,0,0,${0.25 + r() * 0.5})`;
      g.fillRect(r() * W, r() * H, 6 + r() * 40, 0.8 + r() * 1.6);
    }
    for (let i = 0; i < area / 7000; i++) {
      g.fillStyle = `rgba(0,0,0,${0.15 + r() * 0.4})`;
      g.fillRect(r() * W, r() * H, 0.7 + r() * 1.5, 10 + r() * 60);
    }
  }

  // ── Drawing primitives ───────────────────────────────────────────────────

  function line(x0, y0, x1, y1) {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }

  function chamfer(x, y, w, h, c) {
    c = Math.min(c, w / 3, h / 3);
    ctx.beginPath();
    ctx.moveTo(x + c, y); ctx.lineTo(x + w - c, y); ctx.lineTo(x + w, y + c);
    ctx.lineTo(x + w, y + h - c); ctx.lineTo(x + w - c, y + h); ctx.lineTo(x + c, y + h);
    ctx.lineTo(x, y + h - c); ctx.lineTo(x, y + c); ctx.closePath();
  }

  function rivets(y, x0, x1, step, color) {
    ctx.fillStyle = color;
    for (let x = x0; x <= x1; x += step) {
      ctx.beginPath(); ctx.arc(x, y, 1.25, 0, 6.283); ctx.fill();
    }
  }

  function windowColor(worldY, r) {
    // Deep in the structure, a few windows are lit by someone.
    const depth = clamp((worldY - shaftTop) / shaftH, 0, 1);
    return r() < depth * depth * 0.55 ? WINDOW_WARM : WINDOW_COLD;
  }

  function drawCell(c, w, side) {
    const r = mulberry(c.seed);
    const { y, h } = c;
    ctx.lineWidth = 1;
    switch (c.type) {
      case 'plate': {
        ctx.fillStyle = INK; ctx.fillRect(0, y, w, h);
        ctx.strokeStyle = steel(0.2); ctx.strokeRect(5.5, y + 5.5, w - 11, h - 11);
        chamfer(14.5, y + 20.5, w - 29, h - 41, 10 * scale);
        ctx.strokeStyle = steel(0.16); ctx.stroke();
        if (r() < 0.5) { ctx.strokeStyle = steel(0.12); line(w / 2, y + 20, w / 2, y + h - 20); }
        rivets(y + 11, 12, w - 12, 11 * scale + 4, steel(0.4));
        rivets(y + h - 11, 12, w - 12, 11 * scale + 4, steel(0.4));
        ctx.fillStyle = grimeLight; ctx.fillRect(0, y, w, h);
        break;
      }
      case 'slate': {
        ctx.fillStyle = SLATE; ctx.fillRect(0, y, w, h);
        ctx.fillStyle = grimeDark; ctx.fillRect(0, y, w, h);
        // Light comes from the gap; the far face falls into shadow.
        const sw = w * (0.2 + r() * 0.16);
        const sx = side < 0 ? 0 : w - sw;
        ctx.fillStyle = INK; ctx.fillRect(sx, y, sw, h);
        ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
        let yy = y + 18 + r() * 30;
        while (yy < y + h - 12) { line(0, yy, w, yy); yy += 24 + r() * 56; }
        if (r() < 0.5) {
          const vx = side < 0 ? sw + 10 : 10;
          const vw = (w - sw - 20) * (0.35 + r() * 0.3);
          const vy = y + h * (0.2 + r() * 0.4);
          ctx.fillStyle = INK; ctx.fillRect(vx, vy, vw, vw * 0.7);
          ctx.fillStyle = steel(0.4); ctx.fillRect(vx, vy + vw * 0.7, vw, 1);
        }
        ctx.fillStyle = steel(0.5);
        ctx.fillRect(side < 0 ? w - 1.5 : 0, y, 1.5, h);
        break;
      }
      case 'lattice': {
        const cw = Math.max(5, w * 0.13);
        ctx.fillStyle = INK;
        ctx.fillRect(0, y, cw, h); ctx.fillRect(w - cw, y, cw, h);
        const bays = Math.max(1, Math.round(h / (w * 0.95)));
        const bh = h / bays;
        ctx.strokeStyle = INK; ctx.lineWidth = Math.max(2.4, w * 0.028);
        for (let i = 0; i < bays; i++) {
          const y0 = y + i * bh, y1 = y0 + bh;
          line(cw, y0, w - cw, y1); line(w - cw, y0, cw, y1);
          ctx.fillRect(0, y0 - 2.5, w, 5);
          ctx.fillStyle = steel(0.3); ctx.fillRect(cw, y0 - 2.5, w - 2 * cw, 1);
          ctx.fillStyle = INK;
        }
        ctx.fillStyle = steel(0.32);
        ctx.fillRect(cw - 1, y, 1, h); ctx.fillRect(w - cw, y, 1, h);
        break;
      }
      case 'pipes': {
        ctx.fillStyle = INK; ctx.fillRect(0, y, w, h);
        const n = 2 + (r() < 0.5 ? 1 : 0);
        const pw = w * 0.17;
        const gap = (w - n * pw) / (n + 1);
        for (let i = 0; i < n; i++) {
          const px = gap + i * (pw + gap);
          ctx.fillStyle = SLATE_DK; ctx.fillRect(px, y, pw, h);
          ctx.fillStyle = steel(0.42); ctx.fillRect(px + pw * 0.26, y, 1.2, h);
          let fy = y + 8 + r() * 40;
          while (fy < y + h - 8) {
            ctx.fillStyle = SLATE_DK; ctx.fillRect(px - 3, fy, pw + 6, 5);
            ctx.fillStyle = steel(0.34); ctx.fillRect(px - 3, fy, pw + 6, 1);
            fy += 90 + r() * 140;
          }
        }
        ctx.fillStyle = grimeLight; ctx.fillRect(0, y, w, h);
        break;
      }
      case 'louvre': {
        ctx.fillStyle = INK; ctx.fillRect(0, y, w, h);
        ctx.strokeStyle = steel(0.24); ctx.strokeRect(7.5, y + 7.5, w - 15, h - 15);
        ctx.fillStyle = steel(0.09);
        for (let yy = y + 16; yy < y + h - 14; yy += 4) ctx.fillRect(13, yy, w - 26, 1);
        break;
      }
      case 'hatch': {
        ctx.fillStyle = INK; ctx.fillRect(0, y, w, h);
        const hx = w * 0.16, hw = w * 0.68, hy = y + h * 0.1, hh = h * 0.8;
        chamfer(hx, hy, hw, hh, 12 * scale);
        ctx.fillStyle = SLATE_DK; ctx.fill();
        ctx.strokeStyle = steel(0.34); ctx.stroke();
        chamfer(hx + 6, hy + 6, hw - 12, hh - 12, 9 * scale);
        ctx.strokeStyle = steel(0.14); ctx.stroke();
        const lit = windowColor(y, r);
        // A single vision slit in the door.
        const q = Math.max(2.5, 3.5 * scale);
        const wx = side < 0 ? hx + hw * 0.72 : hx + hw * 0.28 - q;
        ctx.fillStyle = rgba(lit, 0.9);
        ctx.fillRect(wx, hy + hh * 0.14, q, Math.min(hh * 0.22, q * 9));
        ctx.fillStyle = grimeLight; ctx.fillRect(0, y, w, h);
        break;
      }
    }
  }

  function joint(y, w) {
    ctx.fillStyle = INK; ctx.fillRect(-3, y - 3, w + 6, 6);
    ctx.fillStyle = steel(0.38); ctx.fillRect(-3, y - 3, w + 6, 1);
  }

  // A beam that once crossed the gap, sheared off.
  function stub(dir, x0, y, len, bh) {
    const jag = [[0, 0], [len, 0], [len - 5, bh * 0.3], [len + 3, bh * 0.55], [len - 7, bh * 0.8], [len - 2, bh], [0, bh]];
    ctx.beginPath();
    jag.forEach(([px, py], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x0 + dir * px, y + py));
    ctx.closePath();
    ctx.fillStyle = INK; ctx.fill();
    ctx.fillStyle = steel(0.42);
    ctx.fillRect(dir > 0 ? x0 : x0 - (len - 5), y, len - 5, 1);
    rivets(y + bh / 2, Math.min(x0, x0 + dir * (len - 16)) + 6, Math.max(x0, x0 + dir * (len - 16)), 10, steel(0.32));
  }

  function drawPylon(k, x, s) {
    const p = pylon(k);
    const w = PW;
    const side = p.side;
    const top = s - 30, bot = s + H + 30;
    ctx.save();
    ctx.translate(x, -s);

    // Girders across the outward slot.
    const slotX = side < 0 ? -SLOT : w;
    for (const gd of p.girders) {
      if (gd.y < top || gd.y > bot) continue;
      const gh = 10 * scale + 3;
      ctx.fillStyle = INK; ctx.fillRect(slotX - 2, gd.y, SLOT + 4, gh);
      ctx.fillStyle = steel(0.36); ctx.fillRect(slotX, gd.y, SLOT, 1);
      if (gd.double) {
        ctx.fillStyle = INK; ctx.fillRect(slotX - 2, gd.y + gh * 2.6, SLOT + 4, gh * 0.7);
      }
    }

    for (const c of p.cells) {
      if (c.y + c.h < top) continue;
      if (c.y > bot) break;
      drawCell(c, w, side);
      joint(c.y, w);
    }

    // The two pylons that frame the gap carry the sheared beams.
    if (Math.abs(k) === 1) {
      const bh = 16 * scale + 4;
      const reach = gapHalf * 0.86;
      const x0 = side < 0 ? w : 0;
      const dir = -side;
      stub(dir, x0, H * 0.31, reach, bh);
      stub(dir, x0, H * 0.13, reach * (side < 0 ? 0.38 : 0.22), bh * 0.7);
    }

    // Where a floor girder in the shaft meets the steel, it is seated on a bearing.
    if (Math.abs(k) === 1) {
      const bw = 22 * scale + 8;
      const ex = side < 0 ? w - bw : 0;
      for (const by of beams) {
        if (by < top - 60 || by > bot + 60) continue;
        ctx.fillStyle = INK; ctx.fillRect(ex, by - 16, bw, 52);
        ctx.strokeStyle = steel(0.4); ctx.lineWidth = 1;
        ctx.strokeRect(ex + 0.5, by - 15.5, bw - 1, 51);
        ctx.beginPath();
        const gx = side < 0 ? w : 0;
        ctx.moveTo(gx, by + 36); ctx.lineTo(gx + side * bw * 0.9, by + 36); ctx.lineTo(gx, by + 36 + bw * 1.1);
        ctx.closePath(); ctx.fillStyle = INK; ctx.fill(); ctx.stroke();
        rivets(by - 8, ex + 6, ex + bw - 5, bw - 11, steel(0.5));
        rivets(by + 28, ex + 6, ex + bw - 5, bw - 11, steel(0.5));
      }
    }

    const band = bands.get(k);
    if (band) {
      const [y0, y1] = band;
      ctx.fillStyle = INK; ctx.fillRect(-2, y0, w + 4, y1 - y0);
      ctx.fillStyle = steel(0.34);
      ctx.fillRect(-2, y0, w + 4, 1); ctx.fillRect(-2, y1 - 1, w + 4, 1);
      rivets(y0 + 7, 8, w - 8, w - 16, steel(0.45));
      rivets(y1 - 7, 8, w - 8, w - 16, steel(0.45));
      if (paint) {
        const sx = cx + k * P - PW / 2;
        const a = Math.max(0, sx), b = Math.min(W, sx + w);
        if (b > a) {
          ctx.drawImage(paint, a * DPR, 0, (b - a) * DPR, H * DPR, a - sx, 0, b - a, H);
        }
      }
    }
    ctx.restore();
  }

  function drawFigure(fx, fy, fh) {
    // A person standing on the walkway, head slightly down. Silhouette only.
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(fx + fh * 0.012, fy - fh * 0.915, fh * 0.062, fh * 0.078, 0.25, 0, 6.283);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(fx - fh * 0.1, fy - fh * 0.79);
    ctx.quadraticCurveTo(fx, fy - fh * 0.84, fx + fh * 0.11, fy - fh * 0.79);
    ctx.lineTo(fx + fh * 0.14, fy - fh * 0.34);
    ctx.lineTo(fx - fh * 0.13, fy - fh * 0.33);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(fx - fh * 0.085, fy - fh * 0.36, fh * 0.065, fh * 0.36);
    ctx.fillRect(fx + fh * 0.02, fy - fh * 0.36, fh * 0.065, fh * 0.36);
    ctx.fillRect(fx - fh * 0.1, fy - fh * 0.025, fh * 0.09, fh * 0.025);
    ctx.fillRect(fx + fh * 0.015, fy - fh * 0.025, fh * 0.09, fh * 0.025);
  }

  function drawWalkway(xl, xr, y) {
    const t = 4 + scale * 2;
    ctx.fillStyle = INK;
    ctx.fillRect(xl, y, xr - xl, t);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
    line(xl, y - 17, xr, y - 17);
    ctx.lineWidth = 1;
    line(xl, y - 9, xr, y - 9);
    for (let x = xl + 6; x < xr; x += 13) line(x, y - 17, x, y);
    // Truss underneath.
    ctx.lineWidth = 1.2;
    line(xl, y + t + 9, xr, y + t + 9);
    for (let x = xl, i = 0; x < xr; x += 11, i++) {
      line(x, y + t, Math.min(xr, x + 11), y + t + 9);
    }
  }

  // ── Frame ────────────────────────────────────────────────────────────────

  function frame() {
    queued = false;
    const s = window.scrollY;
    const p = smooth(clamp(s / (H * 0.62), 0, 1));
    const extra = p * extraFinal;
    const depth = smooth(clamp(s / Math.max(1, docH - H), 0, 1));

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const sky = mix(SKY_DAY, SKY_NIGHT, depth);
    ctx.fillStyle = rgba(sky); ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = rgba(mix(sky, [0, 0, 0], 0.36));
    const cs = s * 0.12;
    for (const c of clouds) {
      const cy = c.y - cs;
      if (cy < -200 || cy > H + 200) continue;
      ctx.beginPath();
      c.pts.forEach(([px, py], i) => (i ? ctx.lineTo(c.x + px, cy + py) : ctx.moveTo(c.x + px, cy + py)));
      ctx.closePath(); ctx.fill();
    }

    fade = 1 - 0.5 * depth;
    for (let k = -maxK; k <= maxK; k++) {
      if (!k) continue;
      const x = cx + k * P + Math.sign(k) * extra - PW / 2;
      if (x > W + SLOT || x + PW < -SLOT) continue;
      drawPylon(k, x, s);
    }
    fade = 1;
    // Night falls on the structure the further in you go.
    if (depth > 0) { ctx.fillStyle = `rgba(4,6,8,${0.5 * depth})`; ctx.fillRect(0, 0, W, H); }

    const gapL = cx - gapHalf - extra;
    const gapR = cx + gapHalf + extra;

    const wy = H * 0.64 - s;
    if (wy > -40) {
      drawWalkway(gapL, gapR, wy);
      drawFigure(gapL + (gapR - gapL) * 0.7, wy, Math.max(24, H * 0.036));
    }

    // And at the bottom, under the light, the same walkway.
    const ey = shaftTop + shaftH + Math.min(H * 0.22, 190) - s;
    if (ey < H + 40 && ey > -40) {
      drawWalkway(gapL, gapR, ey);
      drawFigure(gapL + (gapR - gapL) * 0.34, ey, Math.max(22, H * 0.034));
    }

    drawLight(s, gapL, gapR);

    const clip = Math.max(0, colW / 2 - gapHalf - extra);
    inner.style.setProperty('--clip', `${clip.toFixed(2)}px`);
    root.style.setProperty('--p', p.toFixed(3));
  }

  function drawLight(s, gapL, gapR) {
    const top = shaftTop - s, bot = shaftTop + shaftH - s;
    if (bot < -200 || top > H + 200) return;
    const f = clamp((s + H * 0.5 - shaftTop) / shaftH, 0, 1);
    const c = lightAt(f);
    const y0 = Math.max(top, 0), y1 = Math.min(bot, H);
    const reach = Math.min(260, P * 1.5);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    // Light on the flanking steel, softened where the shaft begins and ends.
    const gL = ctx.createLinearGradient(gapL, 0, gapL - reach, 0);
    const gR = ctx.createLinearGradient(gapR, 0, gapR + reach, 0);
    for (const g of [gL, gR]) {
      g.addColorStop(0, rgba(c, 0.3)); g.addColorStop(0.35, rgba(c, 0.1)); g.addColorStop(1, rgba(c, 0));
    }
    const soft = reach * 0.7;
    const ya = Math.max(0, top - soft), yb = Math.min(H, bot + soft);
    for (let y = ya; y < yb; y += 8) {
      const d = Math.min(y - (top - soft), bot + soft - y) / (soft * 2);
      ctx.globalAlpha = smooth(clamp(d, 0, 1));
      ctx.fillStyle = gL; ctx.fillRect(gapL - reach, y, reach, 8);
      ctx.fillStyle = gR; ctx.fillRect(gapR, y, reach, 8);
    }
    ctx.globalAlpha = 1;
    // Light spilling from the open ends of the shaft.
    for (const [edge, col] of [[top, lightAt(0)], [bot, lightAt(1)]]) {
      const rad = (gapR - gapL) * 0.6 + reach * 0.6;
      if (edge < -rad || edge > H + rad) continue;
      ctx.save();
      ctx.translate((gapL + gapR) / 2, edge);
      ctx.scale(1, 0.55);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
      g.addColorStop(0, rgba(col, 0.42)); g.addColorStop(0.4, rgba(col, 0.12)); g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
      ctx.restore();
    }
    ctx.restore();

    if (y1 > y0) {
      ctx.fillStyle = rgba(c, 0.9);
      ctx.fillRect(gapL - 1.5, y0, 1.5, y1 - y0);
      ctx.fillRect(gapR, y0, 1.5, y1 - y0);
    }
  }

  // ── Layout ───────────────────────────────────────────────────────────────

  function layout() {
    W = window.innerWidth;
    H = window.innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);

    // Phones and portrait tablets: the name runs up the steel instead of across it.
    narrow = W < 700 || H > W * 1.25;
    P = narrow ? clamp(W / 4.3, 72, 120) : clamp(W / 7.4, 120, 220);
    PW = P * (narrow ? 0.88 : 0.91);
    SLOT = P - PW;
    scale = P / 150;
    gapHalf = P - PW / 2;

    const rect = inner.getBoundingClientRect();
    colL = rect.left; colR = rect.right; colW = rect.width;
    cx = (colL + colR) / 2;
    extraFinal = Math.max(0, colW / 2 - gapHalf);
    maxK = Math.ceil((W + extraFinal) / P) + 2;
    shaftTop = shaft.getBoundingClientRect().top + window.scrollY;
    shaftH = shaft.offsetHeight;
    docH = root.scrollHeight;
    beams = [...inner.querySelectorAll('section')].map((sec) =>
      sec.getBoundingClientRect().top + window.scrollY + parseFloat(getComputedStyle(sec, '::before').marginTop));

    pylons = new Map();
    if (!grimeDark) {
      grimeDark = makeGrime([0, 0, 0], 0.1, 0.42, 170, 700, 11);
      grimeLight = makeGrime(STEEL, 0.02, 0.07, 120, 380, 12);
    }
    buildClouds();
    if (fontsReady) buildPaint();
    frame();
  }

  let queued = false;
  const request = () => { if (!queued) { queued = true; requestAnimationFrame(frame); } };
  window.addEventListener('scroll', request, { passive: true });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 80);
  });

  layout();
  Promise.all([document.fonts.load('100px Michroma'), document.fonts.ready]).then(() => {
    fontsReady = true;
    layout();
  });
})();
