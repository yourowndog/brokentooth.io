// Brokentooth, concept 03: "Section Cut".
// The page is a vertical section through a megastructure. A fragment shader
// draws the cut (sky and roofline, then one room per content section, each
// floor slab sitting exactly on a section boundary). The sidebar is the same
// building as a small section drawing: links sit on their floors and the slice
// you are reading is lit.

(() => {
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const narrowQ = matchMedia('(max-width: 860px)');

  const cv = document.getElementById('cut');
  const side = document.querySelector('.side');
  const toggle = document.querySelector('.index-toggle');
  const here = document.querySelector('.here');
  const elev = document.querySelector('.elev');
  const links = [...document.querySelectorAll('.floors a')];
  const items = links.map((a) => a.parentElement);
  const sections = links.map((a) => document.getElementById(a.dataset.floor));
  const rooms = sections.slice(1);
  const sign = document.querySelector('.sign');
  const firstRoom = document.querySelector('.room');

  const SVGNS = 'http://www.w3.org/2000/svg';
  const MAX_ROOMS = 4;

  // ───────────────────────── shader ─────────────────────────
  const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
  const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uDpr;
uniform float uScroll;
uniform float uTime;
uniform float uF[8];
uniform float uOn[4];
uniform vec2 uText;
uniform float uSignR;
uniform float uSignH;
uniform float uNarrow;

#define SLAB 64.0
#define BEAM 34.0

float h11(float n){ return fract(sin(n * 91.345) * 47453.5453); }
float h21(vec2 p){ p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

vec3 ramp(float L){
  vec3 c0 = vec3(0.0);
  vec3 c1 = vec3(0.090, 0.118, 0.130);
  vec3 c2 = vec3(0.357, 0.404, 0.431);
  vec3 c3 = vec3(0.867, 0.882, 0.871);
  if (L < 0.2) return mix(c0, c1, L / 0.2);
  if (L < 0.52) return mix(c1, c2, (L - 0.2) / 0.32);
  if (L < 0.92) return mix(c2, c3, (L - 0.52) / 0.4);
  return mix(c3, vec3(0.97), clamp((L - 0.92) / 0.08, 0.0, 1.0));
}

void main(){
  vec2 fc = gl_FragCoord.xy / uDpr;
  float W = uRes.x;
  float x = fc.x;
  float y = uScroll + (uRes.y - fc.y);

  float L = 0.0;
  float ink = -1.0;
  float light = 0.0;
  float warm = 0.0;

  float roof = uF[0];
  int idx = -1;
  float top = 0.0;
  float bot = 1e7;
  for (int i = 0; i < 8; i++){ if (y >= uF[i]) { idx = i; top = uF[i]; } }
  for (int i = 0; i < 8; i++){ if (i == idx + 1) bot = uF[i]; }

  if (idx < 0) {
    // ── sky above the roof ──
    float t = clamp(y / roof, 0.0, 1.0);
    L = mix(0.30, 0.78, smoothstep(0.0, 1.0, t));
    float c = fbm(vec2(x * 0.0024 + uTime * 0.003, y * 0.007 - uTime * 0.0005));
    float edge = 0.06 * vnoise(vec2(x, y) * 0.06);
    float cm = step(0.56, c + edge) * (1.0 - smoothstep(0.16, 0.38, t));
    L = mix(L, 0.19, cm);
    float hb = roof - y;

    // the colossus: one vast grey structure, its top lost above the frame
    float u = x / W;
    float cx0 = uNarrow > 0.5 ? 0.30 : 0.5;
    float tierH = roof * (uNarrow > 0.5 ? 0.36 : 0.52);
    float big = 0.0;
    float topH = roof * (uNarrow > 0.5 ? 0.5 : 1.5);
    if (u > cx0 + 0.1 && hb < topH) big = 1.0;
    if (u > cx0 && u <= cx0 + 0.1 && hb < tierH) big = 2.0;
    if (big > 0.5) {
      float st = fbm(vec2(x * 0.02, hb * 0.0016));
      L = 0.42 - (st - 0.5) * 0.14;
      float n = floor(hb / 58.0);
      float rib = fract(hb / 58.0);
      float kind = h11(n * 3.7 + 1.0);
      if (kind > 0.72 && rib > 0.12 && fract(hb / 5.0) < 0.45) L = 0.33;
      if (rib < 0.06) L = 0.3;
      else if (rib < 0.09) L = 0.52;
      float px0 = x - W * cx0;
      float pil = fract(px0 / 96.0 + 0.4 * step(0.5, h11(n)));
      if (kind < 0.72 && pil < 0.03) L = 0.32;
      float streak = vnoise(vec2(x * 0.12, hb * 0.004)) * vnoise(vec2(x * 0.03, hb * 0.012));
      L -= streak * 0.12;
      if (big < 1.5 && abs(x - W * (cx0 + 0.1)) < 1.5 && hb > tierH) L = 0.26;
      if (big > 1.5 && hb > tierH - 2.5) L = 0.62;
      if (big > 1.5 && abs(x - W * cx0) < 1.5) L = 0.28;
      if (hb > topH - 2.5) L = 0.62;
      // heavy black members: two shafts, girders, a pipe bundle
      float s1 = W * (cx0 + 0.2), s2 = W * (cx0 + 0.36);
      bool clear = hb > uSignH;
      if (clear && (abs(x - s1) < 17.0 || abs(x - s2) < 10.0)) {
        L = 0.015;
        float e = abs(x - s1) < 17.0 ? x - (s1 - 17.0) : x - (s2 - 10.0);
        if (e < 2.0) ink = 0.55;
        if (fract(hb / 34.0) < 0.06) ink = 0.24;
      }
      float gA = roof * 0.42, gB = roof * 0.9;
      if (clear && (abs(hb - gA) < 11.0 || abs(hb - gB) < 8.0) && big < 1.5) {
        L = 0.015;
        if (hb > gA + 9.0 && hb < gA + 11.0 || hb > gB + 6.0 && hb < gB + 8.0) ink = 0.62;
        if (fract(x / 18.0) < 0.12 && abs(hb - gA) < 3.0) ink = 0.3;
      }
      float pb = roof * 0.24;
      for (int k = 0; k < 3; k++) {
        float py = pb + float(k) * 13.0;
        if (clear && abs(hb - py) < 5.0 && u > cx0 + 0.04) { L = 0.02; ink = hb - py > 3.4 ? 0.5 : -1.0; }
      }
    }
    // lattice crown on the setback
    if (u > cx0 && u <= cx0 + 0.1 && hb >= tierH && hb < tierH + 44.0) {
      float lu = fract((x - W * cx0) / 44.0);
      float lv = (hb - tierH) / 44.0;
      if (lu < 0.06 || abs(lu - lv) < 0.05 || abs(lu - (1.0 - lv)) < 0.05 || lv > 0.94) L = 0.3;
    }
    // a gantry bridge from the colossus across the sky
    float gy = roof * (uNarrow > 0.5 ? 0.26 : 0.66);
    if (u < cx0 + 0.1 && u > cx0 - (uNarrow > 0.5 ? 0.4 : 0.26) && hb > gy && hb < gy + 16.0) {
      float lu = fract(x / 16.0);
      float lv = (hb - gy) / 16.0;
      if (lv < 0.14 || lv > 0.86 || abs(lu - lv) < 0.09 || lu < 0.08) L = 0.27;
    }

    // near skyline: black ink, only beyond the sign
    float nx = x - uSignR;
    if (nx > 0.0) {
      float b2 = floor(x / 92.0);
      float nh = (0.1 + 0.45 * h11(b2 * 1.7 + 4.0)) * roof * 0.5 * smoothstep(0.0, 220.0, nx);
      if (hb < nh) {
        L = 0.02;
        float fx = fract(x / 92.0);
        if (fract(hb / 40.0) < 0.03) ink = 0.22;
        if (fx < 0.014 || abs(fx - 0.62) < 0.008) ink = 0.28;
        if (nh - hb < 2.0) ink = 0.55;
      }
    }
    // truss mast
    float mw = 22.0;
    float mx = W - max(54.0, W * 0.085);
    float mh = roof * (uNarrow > 0.5 ? 0.56 : 0.86);
    if (x > mx && x < mx + mw && hb > 0.0 && hb < mh) {
      float mu = (x - mx) / mw;
      float f = fract(hb / mw);
      if (mu < 0.1 || mu > 0.9 || f < 0.08 || abs(f - mu) < 0.07 || abs(f - (1.0 - mu)) < 0.07) ink = 0.0;
    }
    if (x > mx + mw * 0.5 - 0.8 && x < mx + mw * 0.5 + 0.8 && hb > mh && hb < mh + 60.0) ink = 0.0;
  } else if (idx < 4) {
    float rid = float(idx);
    float ly = y - top;
    if (ly < SLAB) {
      // ── floor slab, cut ──
      L = 0.012;
      if (ly < 2.0) ink = 0.9;
      else if (ly > 13.0 && ly < 16.0 && fract(x / 24.0) < 0.12) ink = 0.3;
      else if (ly > SLAB - 3.0 && ly < SLAB - 1.5) ink = 0.2;
      else if (fract((x + rid * 137.0) / 410.0) < 0.0035) ink = 0.16;
      float hatch = fract((x + ly) / 9.0);
      if (ly > 20.0 && ly < SLAB - 8.0 && hatch < 0.1 && vnoise(vec2(x * 0.01, rid)) > 0.62) ink = 0.08;
    } else {
      // ── room ──
      float ry = ly - SLAB;
      float rh = bot - top - SLAB;
      float on = uOn[0];
      if (idx == 1) on = uOn[1];
      if (idx == 2) on = uOn[2];
      if (idx == 3) on = uOn[3];

      float st = fbm(vec2(x * 0.035, ry * 0.0022 + rid * 9.1));
      float drip = vnoise(vec2(x * 0.21, ry * 0.006 + rid * 3.0)) * vnoise(vec2(x * 0.05, ry * 0.02));
      L = 0.15 + (st - 0.5) * 0.14 - drip * 0.09;
      float pw = 190.0;
      float pxl = fract((x + rid * 61.0) / pw) * pw;
      if (pxl < 1.4) ink = 0.05;
      if (abs(ry - rh * 0.52) < 0.7) ink = 0.05;

      bool inText = x > uText.x && x < uText.y;
      float lx = uNarrow > 0.5 ? W * 0.84 : mix(uText.y, W, 0.47);

      // light
      if (idx == 3) {
        // the one warm lamp
        float lampY = rh * (uNarrow > 0.5 ? 0.16 : 0.36);
        float dxl = x - lx;
        if (abs(dxl) < 0.7 && ry < lampY - 14.0) ink = 0.04;
        float shade = step(lampY - 16.0, ry) * step(ry, lampY) * step(abs(dxl), 9.0 + (ry - lampY + 16.0) * 0.9);
        float spread = 22.0 + max(ry - lampY, 0.0) * 0.62;
        float cone = (1.0 - smoothstep(spread * 0.5, spread, abs(dxl))) * step(lampY, ry) * (1.0 - smoothstep(0.0, rh, ry - lampY) * 0.6);
        float glow = exp(-length(vec2(dxl, (ry - lampY) * 1.2)) / 70.0);
        float pool = exp(-pow(dxl / (spread * 0.8), 2.0)) * smoothstep(rh - 70.0, rh - 20.0, ry);
        light = (cone * 0.42 + glow * 0.55 + pool * 0.5) * on;
        warm = clamp(cone + glow * 1.4 + pool, 0.0, 1.0) * on;
        if (shade > 0.5) { ink = 0.0; if (ry > lampY - 2.0) ink = 0.98 * on + 0.05; }
      } else {
        float dx = abs(x - lx);
        float spread = 30.0 + max(ry - BEAM, 0.0) * 0.5;
        float cone = (1.0 - smoothstep(spread * 0.55, spread, dx)) * step(BEAM, ry) * (1.0 - smoothstep(0.0, rh * 1.1, ry) * 0.5);
        float pool = exp(-pow((x - lx) / (spread * 0.85), 2.0)) * smoothstep(rh - 90.0, rh - 22.0, ry);
        float dust = step(0.9965, h21(floor(vec2(x, y - uTime * 7.0) / 2.0))) * cone;
        light = (cone * 0.38 + pool * 0.46 + dust * 0.5) * on;
        if (ry > BEAM && ry < BEAM + 6.0 && dx < 30.0) ink = 0.97 * on + 0.06;
      }
      if (inText) {
        float k = uNarrow > 0.5 ? 0.5 : 0.16;
        light *= k; L *= 0.72; warm *= k + 0.15;
      }

      // downstand beams under the slab, one carries the fixture
      float bx = abs(mod(x - lx + 160.0, 320.0) - 160.0);
      if (ry < BEAM && bx < 24.0) {
        L = 0.01; light = 0.0;
        if (abs(bx - 21.0) < 1.0) ink = 0.24;
        if (ry > BEAM - 2.0) ink = 0.4;
      }

      // service pipes along the ceiling, right of the reading bay
      if (uNarrow < 0.5 && x > uText.y + 40.0 && ry > BEAM + 12.0 && ry < BEAM + 22.0) {
        L = 0.02; light = 0.0; ink = -1.0;
        if (ry < BEAM + 13.5) ink = 0.42;
      }

      // machines: five cabinets on the plant-room floor
      if (idx == 2) {
        float x0 = uNarrow > 0.5 ? W * 0.58 : uText.y + 70.0;
        float x1 = uNarrow > 0.5 ? W - 8.0 : W - 92.0;
        float cw = (x1 - x0) / 5.0;
        float k = floor((x - x0) / cw);
        float cx = x - x0 - k * cw;
        float ch = rh * (0.34 + 0.08 * h11(k + 2.0));
        float cy = rh - 20.0 - ry;
        if (x > x0 && x < x1 && cx > 6.0 && cx < cw - 6.0 && cy > 0.0 && cy < ch) {
          L = 0.025;
          float lit = light;
          light = 0.0;
          ink = -1.0;
          if (ch - cy < 2.0) ink = 0.3 + lit * 1.4;
          else if (cx < 7.5 || cx > cw - 7.5) ink = 0.2 + lit;
          else if (cx > 14.0 && cx < cw - 14.0 && cy > 18.0 && cy < ch - 22.0 && fract(cy / 7.0) < 0.3) ink = 0.1 + lit * 0.8;
        }
      }

      // columns frame the reading bay
      if (uNarrow < 0.5) {
        float c1 = uText.y + 22.0;
        float c2 = W - 58.0;
        float d1 = abs(x - c1), d2 = abs(x - c2);
        float cw = 22.0;
        if (d1 < cw || d2 < 28.0) {
          float d = d1 < cw ? d1 : d2;
          float w = d1 < cw ? cw : 28.0;
          L = 0.012; light = 0.0; warm = 0.0;
          ink = -1.0;
          if (abs(d - (w - 5.0)) < 0.8) ink = 0.2;
          if (fract(ry / 130.0) < 0.022) ink = 0.3;
        }
      } else if (x > W - 10.0) {
        L = 0.012; light = 0.0; ink = -1.0;
      }

      // the floor itself
      if (ry > rh - 20.0) {
        float pool2 = light;
        L = 0.06;
        ink = -1.0;
        light = pool2 * 1.2;
        if (ry < rh - 18.5) ink = 0.4 + pool2 * 0.9;
      }
    }
  }

  float Lt = L + light;
  float d = h21(fc + 0.37) - 0.5;
  Lt = floor(Lt * 9.0 + d * 0.45) / 9.0;
  if (ink >= 0.0) Lt = ink;
  Lt = clamp(Lt, 0.0, 1.0);
  vec3 col = ramp(Lt);
  vec3 amber = vec3(0.913, 0.635, 0.353);
  col = mix(col, amber * (0.25 + Lt * 1.15), clamp(warm, 0.0, 1.0) * 0.9);
  gl_FragColor = vec4(col, 1.0);
}`;

  let gl = null, prog = null, U = {};
  try {
    gl = cv.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false });
  } catch (e) { gl = null; }

  if (gl) {
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      for (const n of ['uRes', 'uDpr', 'uScroll', 'uTime', 'uF', 'uOn', 'uText', 'uSignR', 'uSignH', 'uNarrow']) {
        U[n] = gl.getUniformLocation(prog, n);
      }
    } catch (e) {
      (window.__errs = window.__errs || []).push(String(e));
      gl = null;
    }
  }

  // ───────────────────────── geometry ─────────────────────────
  const geo = { floors: [], docH: 1, cvLeft: 0, text: [0, 0], signR: 0, signH: 0, dpr: 1, w: 0, h: 0 };

  function docTop(el) { return el.getBoundingClientRect().top + scrollY; }

  function measure() {
    geo.docH = root.scrollHeight;
    geo.floors = rooms.map(docTop);
    geo.secTops = sections.map(docTop);
    const cr = cv.getBoundingClientRect();
    geo.cvLeft = cr.left;
    geo.w = cr.width;
    geo.h = cr.height;
    const rr = firstRoom.getBoundingClientRect();
    const pad = narrowQ.matches ? 8 : 30;
    geo.text = [rr.left - cr.left - pad, rr.right - cr.left + pad];
    const range = document.createRange();
    range.selectNodeContents(sign);
    const sr = range.getBoundingClientRect();
    geo.signR = sr.right - cr.left + 24;
    geo.signH = sr.height * 0.85 + 14;
    geo.dpr = Math.min(devicePixelRatio || 1, 1.5);
    if (gl) {
      cv.width = Math.round(geo.w * geo.dpr);
      cv.height = Math.round(geo.h * geo.dpr);
      gl.viewport(0, 0, cv.width, cv.height);
    }
    drawElevation();
  }

  // ───────────────────────── lights ─────────────────────────
  // Each room's fixture strikes once, the first time you arrive on that floor.
  const lit = rooms.map(() => ({ t0: -1 }));
  function onLevel(i, now) {
    const s = lit[i];
    if (reduce.matches) return 1;
    if (s.t0 < 0) return 0;
    const t = (now - s.t0) / 900;
    if (t >= 1) return 1;
    const step = Math.floor(t * 16);
    const r = Math.abs(Math.sin(step * 12.9898 + i * 78.233) * 43758.5453) % 1;
    return r < 0.25 + t * 0.8 ? (t > 0.6 ? 1 : 0.75) : 0.04;
  }
  function checkArrivals(now) {
    for (let i = 0; i < rooms.length; i++) {
      if (lit[i].t0 < 0 && geo.floors[i] < scrollY + innerHeight * 0.7) lit[i].t0 = now;
    }
  }

  // ───────────────────────── render ─────────────────────────
  const fl = new Float32Array(8).fill(1e7);
  const ons = new Float32Array(4);
  function render(now) {
    geo.floors.forEach((v, i) => { if (i < 7) fl[i] = v; });
    fl[Math.min(geo.floors.length, 7)] = geo.docH;
    for (let i = 0; i < MAX_ROOMS; i++) ons[i] = i < rooms.length ? onLevel(i, now) : 0;
    cones.forEach((c, i) => c.setAttribute('fill-opacity', (ons[i] * (i === cones.length - 1 ? 0.55 : 0.2)).toFixed(3)));
    if (!gl) return;
    gl.uniform2f(U.uRes, geo.w, geo.h);
    gl.uniform1f(U.uDpr, geo.dpr);
    gl.uniform1f(U.uScroll, scrollY);
    gl.uniform1f(U.uTime, reduce.matches ? 0 : now / 1000);
    gl.uniform1fv(U.uF, fl);
    gl.uniform1fv(U.uOn, ons);
    gl.uniform2f(U.uText, geo.text[0], geo.text[1]);
    gl.uniform1f(U.uSignR, geo.signR);
    gl.uniform1f(U.uSignH, geo.signH);
    gl.uniform1f(U.uNarrow, narrowQ.matches ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ───────────────────────── the sidebar drawing ─────────────────────────
  let band = null, walker = null, slabs = [], cones = [];
  function el(name, attrs) {
    const n = document.createElementNS(SVGNS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function drawElevation() {
    const W = elev.clientWidth, H = elev.clientHeight;
    elev.replaceChildren();
    slabs = [];
    if (!W || !H) return;
    const top = 6;
    const map = (y) => top + (y / geo.docH) * (H - top);
    geo.map = map;
    const x0 = 0.5, x1 = W - 0.5;
    const roofY = map(geo.floors[0]);

    // rooftop: the colossus in hairline, its top lost, and the mast
    const g = el('g', { fill: 'none', stroke: '#3a4448', 'stroke-width': 1 });
    const cA = W * 0.46, cB = W * 0.6;
    const tier = roofY - (roofY - top) * 0.45;
    g.append(el('path', { d: `M${cA - W * 0.12} ${roofY} V${roofY - 6} H${cA} V${tier} H${cB} V${top - 6} M${cB} ${tier} V${roofY}` }));
    for (let yy = roofY - 7; yy > top; yy -= 7) {
      g.append(el('path', { d: `M${yy > tier ? cA : cB} ${yy} H${W - 34}`, stroke: '#20272b' }));
    }
    const mx = W - 18;
    const mh = Math.min(roofY - top - 4, 90);
    g.append(el('path', { d: `M${mx} ${roofY} V${roofY - mh} M${mx + 6} ${roofY} V${roofY - mh + 8} M${mx + 3} ${roofY - mh} V${roofY - mh - 14}` }));
    for (let yy = roofY - 8; yy > roofY - mh + 8; yy -= 8) {
      g.append(el('path', { d: `M${mx} ${yy} L${mx + 6} ${yy - 8} M${mx + 6} ${yy} L${mx} ${yy - 8}` }));
    }
    elev.append(g);

    // each room's fixture and its light, struck when you first arrive
    cones = [];
    geo.floors.forEach((fy, i) => {
      const a = map(fy) + 4;
      const b = i + 1 < geo.floors.length ? map(geo.floors[i + 1]) : map(geo.docH);
      const cx = W - 52;
      const warmRoom = i === geo.floors.length - 1;
      const sp = Math.min(22, (b - a) * 0.3);
      const y0 = warmRoom ? a + (b - a) * 0.3 : a + 3;
      const cone = el('path', {
        d: `M${cx - 3} ${y0} L${cx + 3} ${y0} L${cx + sp} ${b} L${cx - sp} ${b} Z`,
        fill: warmRoom ? '#e9a25a' : '#dde1de',
        'fill-opacity': 0,
      });
      elev.append(cone);
      elev.append(el('rect', { x: cx - 4, y: y0 - 2, width: 8, height: 2, fill: warmRoom ? '#e9a25a' : '#9aa4a8' }));
      cones.push(cone);
    });

    // the building in section: two walls, a column line, the basement
    const yEnd = map(geo.docH);
    elev.append(el('path', { d: `M${x0} ${roofY} V${yEnd} M${x1} ${roofY} V${yEnd} M${W - 30} ${roofY} V${yEnd}`, stroke: '#262e32', 'stroke-width': 1, fill: 'none' }));

    // the lit slice: what the reader can see right now
    band = el('rect', { x: 0, width: W, y: 0, height: 0, fill: 'rgba(221,225,222,0.1)' });
    elev.append(band);
    const bandEdge = el('rect', { x: 0, width: 2, y: 0, height: 0, fill: '#dde1de' });
    elev.append(bandEdge);
    band.edge = bandEdge;

    // slabs
    geo.floors.forEach((fy, i) => {
      const y = map(fy);
      const r = el('rect', { x: 0, y: y.toFixed(1), width: W, height: 4, fill: '#4a555b' });
      elev.append(r);
      slabs.push(r);
    });

    // the person, standing in the lit slice
    walker = el('path', {
      d: 'M6 0c1.7 0 2.6 1.3 2.6 2.9S7.7 6 6 6 3.4 4.5 3.4 2.9 4.3 0 6 0zM3 7h6l1.6 1.2.9 11.3-1.6.4L9 13.2 8.6 33.6H6.8L6.2 21h-.4l-.6 12.6H3.4L3 13.2l-.9 6.7-1.6-.4 1-11.3z',
      fill: '#dde1de',
    });
    elev.append(walker);

    // place labels in their rooms
    items.forEach((li, i) => {
      let y;
      if (i === 0) y = roofY - 14;
      else {
        const a = map(geo.secTops[i]);
        const b = i + 1 < sections.length ? map(geo.secTops[i + 1]) : yEnd;
        y = a + Math.min(26, (b - a) / 2);
      }
      li.style.top = `${y}px`;
    });
    updateElevation();
  }

  let current = -1;
  function updateElevation() {
    let c = 0;
    for (let i = 0; i < sections.length; i++) if (geo.secTops[i] <= scrollY + innerHeight * 0.4) c = i;
    if (c !== current) {
      current = c;
      links.forEach((l, i) => l.setAttribute('aria-current', i === c ? 'true' : 'false'));
      here.textContent = links[c].textContent;
    }
    slabs.forEach((r, i) => r.setAttribute('fill', i === c - 1 || i === c ? '#9aa4a8' : '#4a555b'));
    if (!band || !geo.map) return;
    const map = geo.map;
    const a = map(scrollY), b = map(scrollY + innerHeight);
    band.setAttribute('y', a.toFixed(1));
    band.setAttribute('height', Math.max(2, b - a).toFixed(1));
    band.edge.setAttribute('y', a.toFixed(1));
    band.edge.setAttribute('height', Math.max(2, b - a).toFixed(1));
    // the walker stands on the lowest floor line visible in the slice, or the roof
    const probe = scrollY + innerHeight * 0.55;
    let floorY = geo.floors[0];
    for (let i = 0; i < geo.floors.length; i++) {
      const next = i + 1 < geo.floors.length ? geo.floors[i + 1] : geo.docH;
      if (probe >= geo.floors[i]) floorY = next;
    }
    if (probe < geo.floors[0]) floorY = geo.floors[0];
    const fy = Math.min(map(floorY), b) - 1;
    const s = 0.42;
    walker.setAttribute('transform', `translate(10 ${(fy - 34 * s).toFixed(1)}) scale(${s})`);

  }

  // ───────────────────────── wiring ─────────────────────────
  let dirty = true;
  function frame(now) {
    checkArrivals(now);
    const animating = !reduce.matches && !document.hidden;
    if (dirty || animating) {
      render(now);
      dirty = false;
    }
    requestAnimationFrame(frame);
  }

  addEventListener('scroll', () => { dirty = true; updateElevation(); }, { passive: true });
  let rt = 0;
  addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { measure(); dirty = true; }, 60);
  });
  reduce.addEventListener?.('change', () => { dirty = true; });

  toggle.addEventListener('click', () => {
    const open = side.dataset.open !== 'true';
    side.dataset.open = String(open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) requestAnimationFrame(drawElevation);
  });
  links.forEach((a) => a.addEventListener('click', () => {
    if (side.dataset.open === 'true') {
      side.dataset.open = 'false';
      toggle.setAttribute('aria-expanded', 'false');
    }
  }));
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && side.dataset.open === 'true') {
      side.dataset.open = 'false';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    }
  });

  measure();
  (document.fonts?.ready || Promise.resolve()).then(() => { measure(); dirty = true; });
  if (!gl) cv.classList.add('flat');
  requestAnimationFrame(frame);
})();
