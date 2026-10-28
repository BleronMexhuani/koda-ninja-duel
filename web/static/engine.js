// Koda battle renderer: skeletal characters, animation, effects, and playback
// of the battle events the server sends. The server decides every outcome;
// this file only shows it.
(() => {
"use strict";
const D2R = Math.PI / 180, R2D = 180 / Math.PI, TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const easeOut = u => 1 - Math.pow(1 - clamp(u, 0, 1), 3);
const easeIn = u => Math.pow(clamp(u, 0, 1), 2.2);
const norm = a => ((a + 180) % 360 + 360) % 360 - 180;
const rnd = (a, b) => a + Math.random() * (b - a);
const irnd = (a, b) => Math.floor(rnd(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const VIEW_W = 760, HIP_H = 78;
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* =================== RIG =================== */
const BONES = [
  { n: "hips", p: null, len: 12, rest: 90 },
  { n: "spine", p: "hips", len: 24, rest: 0, at: 1 },
  { n: "chest", p: "spine", len: 26, rest: 0, at: 1 },
  { n: "neck", p: "chest", len: 8, rest: 0, at: 1 },
  { n: "head", p: "neck", len: 24, rest: 0, at: 1 },
  { n: "armB", p: "chest", len: 26, rest: 180, at: .9 },
  { n: "foreB", p: "armB", len: 24, rest: 0, at: 1 },
  { n: "handB", p: "foreB", len: 8, rest: 0, at: 1 },
  { n: "armF", p: "chest", len: 26, rest: 180, at: .9 },
  { n: "foreF", p: "armF", len: 24, rest: 0, at: 1 },
  { n: "handF", p: "foreF", len: 8, rest: 0, at: 1 },
  { n: "legB", p: "hips", len: 38, rest: 180, at: 0 },
  { n: "shinB", p: "legB", len: 36, rest: 0, at: 1 },
  { n: "footB", p: "shinB", len: 14, rest: 90, at: 1 },
  { n: "legF", p: "hips", len: 38, rest: 180, at: 0 },
  { n: "shinF", p: "legF", len: 36, rest: 0, at: 1 },
  { n: "footF", p: "shinF", len: 14, rest: 90, at: 1 },
];
const BONE_NAMES = BONES.map(b => b.n);
const ANGLE_KEYS = [...BONE_NAMES, "staff", "rot"];
const DEF = { ikF: 1, ikB: 1, fFx: 10, fFy: 4, fBx: -9, fBy: 4 };

function fk(pose) {
  const out = {};
  for (const b of BONES) {
    let sx, sy, a;
    if (!b.p) { sx = pose.x || 0; sy = HIP_H + (pose.y || 0); a = b.rest + (pose[b.n] || 0) + (pose.rot || 0); }
    else { const P = out[b.p]; sx = P.x + (P.ex - P.x) * b.at; sy = P.y + (P.ey - P.y) * b.at; a = P.a + b.rest + (pose[b.n] || 0); }
    const r = a * D2R;
    out[b.n] = { x: sx, y: sy, a, ex: sx + Math.cos(r) * b.len, ey: sy + Math.sin(r) * b.len };
  }
  return out;
}
function legIK(pose, side) {
  const hx = pose.x || 0, hy = HIP_H + (pose.y || 0), a = 38, b = 36;
  const dx = pose["f" + side + "x"] - hx, dy = pose["f" + side + "y"] - hy;
  const L = clamp(Math.hypot(dx, dy), Math.abs(a - b) + .5, a + b - .01);
  const base = Math.atan2(dy, dx) * R2D;
  const al = Math.acos(clamp((a * a + L * L - b * b) / (2 * a * L), -1, 1)) * R2D;
  const be = Math.acos(clamp((b * b + L * L - a * a) / (2 * b * L), -1, 1)) * R2D;
  const thW = base + al, shW = base - be, hw = 90 + (pose.hips || 0) + (pose.rot || 0);
  pose["leg" + side] = norm(thW - hw - 180);
  pose["shin" + side] = norm(shW - thW);
  pose["foot" + side] = norm(-shW - 90);
}

/* =================== POSES & ANIMATIONS =================== */
function kf(t, frames) {
  if (t <= frames[0][0]) return { ...frames[0][1] };
  for (let i = 0; i < frames.length - 1; i++) {
    const [t0, p0] = frames[i], [t1, p1] = frames[i + 1];
    if (t <= t1) {
      const u = smooth((t - t0) / (t1 - t0)), o = {};
      for (const k of new Set([...Object.keys(p0), ...Object.keys(p1)])) { const a = p0[k] ?? DEF[k] ?? 0, b = p1[k] ?? DEF[k] ?? 0; o[k] = a + (b - a) * u; }
      return o;
    }
  }
  return { ...frames[frames.length - 1][1] };
}
const STAND = { y: -1.5, armF: 8, foreF: 12, armB: -6, foreB: 14 };
const GUARD = { fFx: 22, fBx: -18, y: -7, armF: 40, foreF: 115, armB: 20, foreB: 120, chest: 4 };
const SEAL = { y: -12, fFx: 14, fBx: -12, chest: -6, armF: 62, foreF: 118, armB: 58, foreB: 122, head: 4 };
const PALM = { fFx: 24, fBx: -18, y: -8, chest: -10, spine: -5, armF: 88, foreF: -6, armB: 80, foreB: 6, head: 8 };
const SWIPE = { fFx: 24, fBx: -18, y: -9, chest: -16, spine: -8, armF: 40, foreF: -20, armB: -40, foreB: 60, head: 10 };
const KICK_CH = { y: -5, fBx: -6, ikF: 0, legF: 85, shinF: -115, footF: 20, spine: 6, chest: 6, armF: 40, foreF: 110, armB: 30, foreB: 120 };
const KICK_EX = { y: -4, fBx: -6, ikF: 0, legF: 100, shinF: -2, footF: -30, spine: 14, chest: 10, head: -10, armF: -20, foreF: 40, armB: 60, foreB: 60 };
const PUNCH = { ...GUARD, chest: -12, spine: -6, armF: 92, foreF: 0, armB: -30, foreB: 110, head: 10 };
const THROW = { ...GUARD, chest: -14, spine: -6, armF: -285, foreF: 5, armB: -20, foreB: 100 };
const CROSS = { y: -7, fFx: 18, fBx: -16, chest: 4, armF: 72, foreF: 118, armB: 62, foreB: 124, head: -4 };
const HURT = { x: -13, y: -5, fFx: 12, fBx: -16, chest: 18, spine: 8, head: 16, armF: -30, foreF: 45, armB: 55, foreB: 35 };
const STAND_V = { y: -1.5, armF: 25, foreF: 50, armB: -8, foreB: 22, chest: -2, head: 2 };
const RAISE_V = { y: -3, fFx: 14, fBx: -12, armF: 165, foreF: -10, staff: -75, chest: 8, spine: 4, head: 12, armB: -30, foreB: 40 };
const CAST_V = { y: -5, fFx: 18, fBx: -14, armF: 95, foreF: -5, staff: -40, chest: -8, spine: -4, armB: 40, foreB: 60, head: 6 };
const BAR_V = { y: -5, fFx: 16, fBx: -14, armF: 55, foreF: 75, staff: -10, armB: 45, foreB: 95, chest: 3 };
const DOWN = { ikF: 0, ikB: 0, y: -62, rot: 88, legF: -10, shinF: -5, footF: -20, legB: -15, shinB: -10, footB: -20, chest: 5, head: 10, armF: -120, foreF: 10, armB: -150, foreB: 20 };

function stance(t) { const b = Math.sin(t * 2.2); return { y: -1.5 + b * .7, chest: b * 1.4, head: -b * .8, armF: 8 + b, foreF: 12, armB: -6 - b, foreB: 14 }; }
function breathe(p, t, amt = 1) { const b = Math.sin(t * 2) * amt; return { ...p, chest: (p.chest || 0) + b * 1.3, y: (p.y || 0) + b * .6 }; }
function gait(d, S, lift, run) {
  const p = d / (2 * S);
  const foot = ph => { const q = ((p + ph) % 1 + 1) % 1; if (q < .5) return [S / 2 - 2 * q * S, 4]; const s = (q - .5) / .5; return [-S / 2 + S * smooth(s), 4 + lift * Math.sin(Math.PI * s)]; };
  const [fx, fy] = foot(0), [bx, by] = foot(.5), sw = Math.cos(2 * Math.PI * p), amp = run ? 55 : 28;
  return { fFx: fx, fFy: fy, fBx: bx, fBy: by, y: (run ? -6 : -2.5) + (run ? 3 : 2) * Math.cos(4 * Math.PI * p),
    spine: run ? -8 : -2, chest: run ? -10 : -3, head: run ? 10 : 3, armF: -amp * sw + (run ? 12 : 0), armB: amp * sw + (run ? 12 : 0), foreF: run ? 85 : 16, foreB: run ? 85 : 16 };
}
function flipFn(t) {
  const T0 = .16, T1 = .82;
  if (t < T0) { const u = smooth(t / T0); return { y: -14 * u, fFx: 12, fBx: -10, chest: -6 * u, armF: 8 - 40 * u, armB: -6 - 40 * u, foreF: 20, foreB: 20 }; }
  if (t < T1) {
    const s = (t - T0) / (T1 - T0), tk = Math.sin(Math.PI * s);
    return { ikF: 0, ikB: 0, y: -14 + 80 * 4 * s * (1 - s), rot: 360 * smooth(s), legF: 25 + 95 * tk, shinF: -20 - 125 * tk, legB: 15 + 90 * tk, shinB: -20 - 120 * tk,
      footF: 10, footB: 10, spine: -10 * tk, chest: -12 * tk, armF: 40 + 40 * tk, foreF: 70, armB: 30 + 40 * tk, foreB: 75, head: -15 * tk };
  }
  const u = smooth((t - T1) / .24);
  return { y: -14 * (1 - u) - 1.5 * u, fFx: 12, fBx: -10, chest: -6 * (1 - u), armF: 30 - 22 * u, foreF: 30 - 18 * u, armB: 20 - 26 * u, foreB: 30 - 16 * u };
}
const A = {
  idle: { fn: t => stance(t) },
  run: { move: true, speed: 560, fn: (t, c) => gait(c.dist, 36, 16, true) },
  punch: { dur: .55, fn: t => kf(t, [[0, GUARD], [.1, { ...GUARD, chest: 10, armF: 20, foreF: 125 }], [.22, PUNCH], [.34, PUNCH], [.55, GUARD]]) },
  kick: { dur: .7, fn: t => kf(t, [[0, GUARD], [.14, KICK_CH], [.26, KICK_EX], [.42, KICK_EX], [.54, KICK_CH], [.7, GUARD]]) },
  throw: { dur: .6, fn: t => kf(t, [[0, STAND], [.2, { ...GUARD, chest: 12, spine: 4, armF: -140, foreF: 50, armB: 30, foreB: 90 }], [.3, THROW], [.42, THROW], [.6, { ...STAND, armF: -352 }]]) },
  seal: { fn: t => breathe({ ...SEAL, armF: SEAL.armF + Math.sin(t * 30) * 1.2 }, t) },
  palm: { dur: .7, fn: t => kf(t, [[0, SEAL], [.12, PALM], [.45, PALM], [.7, STAND]]) },
  swipe: { dur: .7, fn: t => kf(t, [[0, STAND], [.16, { ...GUARD, chest: 10, armF: -150, foreF: 40 }], [.28, { ...SWIPE, armF: -315 }], [.48, { ...SWIPE, armF: -315 }], [.7, { ...STAND, armF: -352 }]]) },
  flip: { dur: 1.06, fn: t => flipFn(t) },
  leap: { fn: t => { const s = smooth(t / .5), tk = Math.sin(Math.PI * clamp(t / .5, 0, 1));
    return { ikF: 0, ikB: 0, rot: -410 * s, legF: 30 + 90 * tk, shinF: -40 - 100 * tk, legB: 20 + 80 * tk, shinB: -40 - 100 * tk, armF: 60, foreF: 70, armB: 50, foreB: 70, chest: -10, head: -10 }; } },
  dive: { fn: () => ({ ikF: 0, ikB: 0, rot: -50, legF: 100, shinF: -5, footF: -30, legB: 30, shinB: -70, armF: -60, foreF: 10, armB: -80, foreB: 20, chest: -10, head: 20 }) },
  guardIdle: { fn: t => breathe(CROSS, t, .6) },
  block: { dur: .4, fn: t => kf(t, [[0, CROSS], [.07, { ...CROSS, x: -8, y: -10, chest: 10, head: 4 }], [.4, CROSS]]) },
  hurt: { dur: .5, fn: t => kf(t, [[0, STAND], [.07, HURT], [.18, HURT], [.5, STAND]]) },
  dodge: { dur: .5, fn: t => kf(t, [[0, STAND], [.1, { x: -26, y: -10, fFx: 4, fBx: -30, chest: 20, spine: 10, head: -6, armF: 60, foreF: 90, armB: 70, foreB: 90 }], [.5, STAND]]) },
  stagger: { dur: .9, fn: t => kf(t, [[0, STAND], [.08, { ...HURT, x: -18, chest: 24, head: 22 }], [.5, { ...HURT, x: -10, y: -10, chest: -14, spine: -10, head: -10, armF: 20, armB: 10 }], [.9, STAND]]) },
  meditate: { fn: t => { const b = Math.sin(t * 1.6), lift = clamp((t - .5) / 1, 0, 1);
    return { ikF: 0, ikB: 0, y: -52 + lift * (12 + 3 * b), legF: 92, shinF: -150, footF: 55, legB: 82, shinB: -145, footB: 55, spine: -2, chest: 2 + b * 1.5, armF: 38, foreF: 55, armB: 28, foreB: 60, head: -2 }; } },
  down: { fn: t => kf(Math.min(t, .9), [[0, HURT], [.25, { y: -22, rot: 30, ikF: 0, ikB: 0, legF: 20, shinF: -30, legB: 10, shinB: -20, chest: 15, armF: -60, armB: -40 }], [.9, DOWN]]) },
  victory: { fn: t => ({ ...stance(t), armF: 155, foreF: 20 + 25 * Math.sin(t * 8), chest: 4, head: 8, y: -1.5 - 2 * Math.abs(Math.sin(t * 4)) }) },
  v_idle: { fn: t => { const b = Math.sin(t * 1.8); return { ...STAND_V, chest: -2 + b * 1.2, y: -1.5 + b * .6, staff: 4 * Math.sin(t * 1.1) }; } },
  glide: { move: true, speed: 620, fn: () => ({ y: -3, fFx: 5, fBx: -7, spine: -12, chest: -8, head: 12, armF: 5, foreF: 40, armB: -35, foreB: 20, staff: 70 }) },
  glideBack: { move: true, speed: 520, fn: () => ({ y: -3, fFx: 9, fBx: -4, spine: 8, chest: 6, head: -4, armF: 30, foreF: 50, armB: 10, foreB: 30 }) },
  v_swing: { dur: .78, fn: t => kf(t, [[0, STAND_V], [.2, { y: -6, fFx: 20, fBx: -16, armF: -150, foreF: 30, staff: 60, chest: 12, spine: 6, armB: 20, foreB: 80 }],
    [.34, { y: -8, fFx: 24, fBx: -18, armF: -290, foreF: 5, staff: 20, chest: -16, spine: -8, armB: -20, foreB: 60, head: 8 }], [.5, { y: -8, fFx: 24, fBx: -18, armF: -290, foreF: 5, staff: 20, chest: -16, spine: -8, armB: -20, foreB: 60, head: 8 }],
    [.78, { ...STAND_V, armF: 25 - 360 }]]) },
  v_raise: { fn: t => ({ ...RAISE_V, staff: -75 + Math.sin(t * 40) * 1.5, y: -3 + Math.sin(t * 3) }) },
  v_cast: { fn: t => breathe(CAST_V, t) },
  v_guardIdle: { fn: t => breathe(BAR_V, t, .6) },
  v_block: { dur: .4, fn: t => kf(t, [[0, BAR_V], [.07, { ...BAR_V, x: -8, y: -9, chest: 9 }], [.4, BAR_V]]) },
  v_chargeIdle: { fn: t => ({ ...RAISE_V, y: -3 + 2 * Math.sin(t * 2.4), staff: -75 + Math.sin(t * 35) * 2, chest: 8 + Math.sin(t * 2.4) * 2 }) },
  v_victory: { fn: t => ({ ...RAISE_V, staff: -80, head: 18 + 4 * Math.sin(t * 9), chest: 10 + 3 * Math.sin(t * 9), y: -2 - 2 * Math.abs(Math.sin(t * 9)) }) },
};

/* =================== LOOKS =================== */
const hex2 = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const LOOKS = {
  koda: { style: "ninja", head: "straw", glow: "#ffcf6b", glow2: "#ff8a3a", col: { tunic: "#2f4b54", tunicB: "#223940", pants: "#3d3732", pantsB: "#2c2824", boot: "#1d1a18", bootB: "#141210", sash: "#d3a23e", scarf: "#b4452b", scarfB: "#8e3420", skin: "#c98e66", skinB: "#a8714f", wrap: "#d8d0bf", wrapB: "#b0a898", hood: "#20262b", hat: "#caa86a", hatD: "#a48649", eye: "#14181b", band: "#b4452b" } },
  bandit: { style: "ninja", head: "band", glow: "#ffcf6b", glow2: "#ff8a3a", col: { tunic: "#5b4630", tunicB: "#46351f", pants: "#3a3936", pantsB: "#2b2a28", boot: "#211c17", bootB: "#16120e", sash: "#8f2d22", scarf: "#6f6a45", scarfB: "#55513a", skin: "#b97d58", skinB: "#97623f", wrap: "#c4b59a", wrapB: "#a09279", hood: "#1d1a17", hat: "#000000", hatD: "#000000", eye: "#120f0c", band: "#a3352a" } },
  kunoichi: { style: "ninja", head: "hood", glow: "#8fe3dc", glow2: "#3d9a96", col: { tunic: "#1e3534", tunicB: "#162827", pants: "#262b33", pantsB: "#1b1f25", boot: "#15171b", bootB: "#0f1013", sash: "#cfd3d6", scarf: "#3d9a96", scarfB: "#2d7a77", skin: "#d4a07c", skinB: "#b5835f", wrap: "#e3e0da", wrapB: "#bdb9b2", hood: "#141c1e", hat: "#000000", hatD: "#000000", eye: "#101416", band: "#3d9a96" } },
  varga: { style: "monk", horns: true, glow: "#b98cff", glow2: "#7a4fd1", col: { robe: "#3c2a52", robeB: "#2b1e3c", trim: "#c9b37a", cord: "#9c2f2a", glove: "#251d2e", gloveB: "#1a1421", boot: "#1c1622", bootB: "#140f19", hood: "#1f1628", mask: "#ebe4d6", maskRed: "#b3342a", horn: "#d9cfb9", eye: "#d6b8ff", cape: "#2a1d3a", staff: "#6b4b33", staffD: "#4c3423", orb: "#b98cff" } },
  acolyte: { style: "monk", horns: false, glow: "#8fb8ff", glow2: "#4f6fb0", col: { robe: "#4b4a52", robeB: "#37363d", trim: "#8f8a7d", cord: "#5c6a7a", glove: "#2a2a30", gloveB: "#1f1f24", boot: "#22222a", bootB: "#18181e", hood: "#26262c", mask: "#d9d5cc", maskRed: "#5c6a7a", horn: "#cccccc", eye: "#b9d4ff", cape: "#33323a", staff: "#5e5040", staffD: "#43392d", orb: "#9cc3ff" } },
  ikaru: { style: "monk", horns: true, glow: "#ffd36b", glow2: "#c48a1f", col: { robe: "#d8d2c4", robeB: "#b3ad9f", trim: "#d4a843", cord: "#2e5a8a", glove: "#3a3328", gloveB: "#2a241c", boot: "#2a241c", bootB: "#1d1913", hood: "#5c4a24", mask: "#e9cf86", maskRed: "#2e5a8a", horn: "#f2e6c4", eye: "#fff1b0", cape: "#7a2f22", staff: "#3a2d1d", staffD: "#2a2014", orb: "#ffd36b" } },
};
for (const L of Object.values(LOOKS)) for (const k in L.col) L.col[k] = hex2(L.col[k]);

/* =================== FIGHTERS =================== */
class Fighter {
  constructor(data, side) {
    const look = LOOKS[data.palette] || LOOKS[data.style === "monk" ? "varga" : "koda"];
    Object.assign(this, { side, look, style: look.style, name: data.name, title: data.title || "", kind: data.kind, maxHp: data.maxHp, hp: data.hp, energy: data.energy,
      status: { ...data.status }, cooldowns: { ...(data.cooldowns || {}) }, moves: data.moves || [] });
    this.dir = side === "p" ? 1 : -1;
    this.home = side === "p" ? -215 : 215;
    this.scale = this.style === "monk" ? (data.palette === "ikaru" ? 1.18 : 1.12) : (data.palette === "kunoichi" ? .97 : 1);
    this.x = this.home; this.lift = 0; this.flash = 0; this.flashCol = [255, 255, 255]; this.shieldHit = 0; this.arcT = 0; this.arcs = []; this.shocked = 0;
    this.cur = { x: 0, y: 0 }; for (const k of ANGLE_KEYS) this.cur[k] = 0;
    this.tweens = [];
    const chains = this.style === "monk"
      ? [{ n: 9, len: 9, w0: 14, w1: 6, col: "cape", anchor: "cape", wind: 90 }]
      : [{ n: 8, len: 7.5, w0: 8, w1: 4, col: "scarfB", anchor: "neck", wind: 160 }, { n: 5, len: 6, w0: 5, w1: 3, col: "sash", anchor: "waist", wind: 50 }];
    if (this.look.head === "hood") chains.push({ n: 6, len: 6, w0: 6, w1: 3, col: "hood", anchor: "pony", wind: 120 });
    this.chains = chains.map(c => ({ ...c, pts: Array.from({ length: c.n }, () => ({ x: 0, y: 0, px: 0, py: 0 })) }));
    this.chainsReady = false;
    this.idleName = this.baseIdle(); this.anim = this.idleAnim();
    this.skel = fk(this.cur);
  }
  baseIdle() {
    if (this.hp <= 0) return "down";
    if (this.style === "monk") return this.status.charging ? "v_chargeIdle" : this.status.guard ? "v_guardIdle" : "v_idle";
    return this.status.guard ? "guardIdle" : "idle";
  }
  idleAnim() { return { name: this.idleName, def: A[this.idleName], t: 0, ctx: {}, idle: true }; }
  get hurtAnim() { return this.status.guard ? (this.style === "monk" ? "v_block" : "block") : "hurt"; }
}
let P = null, E = null;
const other = f => f === P ? E : P;
const sideOf = s => s === "p" ? P : E;

function finish(f, an) { if (f.anim === an) f.anim = f.idleAnim(); if (an.resolve) { const r = an.resolve; an.resolve = null; r(); } }
function play(f, name, opts = {}) {
  const prev = f.anim;
  return new Promise(res => {
    f.anim = { name, def: A[name], t: 0, dur: opts.dur ?? A[name].dur, rate: opts.rate || 1, resolve: res, target: opts.target, keepFacing: opts.keepFacing,
      events: (opts.events || []).map(e => ({ t: e[0], fn: e[1], done: false })), ctx: { dist: 0 } };
    if (prev && prev.resolve) { const r = prev.resolve; prev.resolve = null; r(); }
  });
}
function setIdle(f, name) { f.idleName = name; if (f.anim.idle && f.anim.name !== name) f.anim = f.idleAnim(); }
function syncIdle(f) { setIdle(f, f.baseIdle()); }
function tween(f, key, to, dur, ease = smooth) {
  return new Promise(res => { f.tweens = f.tweens.filter(tw => tw.key !== key || (tw.res(), false)); f.tweens.push({ key, from: f[key], to, t: 0, dur, ease, res }); });
}
const L2W = (f, lx, ly) => [f.x + f.dir * f.scale * lx, f.lift + f.scale * ly];
function boneW(f, name, frac = 0) { const b = f.skel[name]; return L2W(f, b.x + (b.ex - b.x) * frac, b.y + (b.ey - b.y) * frac); }
const chestW = f => boneW(f, "chest", .5);
function staffTip(f) {
  const h = f.skel.handF, a = (h.a + 90 + (f.cur.staff || 0)) * D2R, gx = h.x + (h.ex - h.x) * .4, gy = h.y + (h.ey - h.y) * .4;
  return L2W(f, gx + Math.cos(a) * 62, gy + Math.sin(a) * 62);
}
function anchorFor(f, kind) {
  const s = f.skel;
  if (kind === "neck") return L2W(f, s.neck.x - 2, s.neck.y);
  if (kind === "pony") { const ha = s.head.a * D2R, b = ha + Math.PI / 2; return L2W(f, s.head.x + Math.cos(ha) * 16 + Math.cos(b) * 12, s.head.y + Math.sin(ha) * 16 + Math.sin(b) * 12); }
  if (kind === "waist") { const hw = s.hips.a * D2R, b = hw + Math.PI / 2; return L2W(f, s.hips.x + Math.cos(b) * 13 + Math.cos(hw) * 10, s.hips.y + Math.sin(b) * 13 + Math.sin(hw) * 10); }
  const ca = s.chest.a * D2R, b = ca + Math.PI / 2; return L2W(f, s.chest.ex + Math.cos(b) * 11 - Math.cos(ca) * 5, s.chest.ey + Math.sin(b) * 11 - Math.sin(ca) * 5);
}
function resetChains(f) { for (const c of f.chains) { const [ax, ay] = anchorFor(f, c.anchor); c.pts.forEach((p, i) => { p.x = p.px = ax - f.dir * i * c.len * .8; p.y = p.py = ay - i * c.len * .5; }); } }
function simChain(f, c, dt) {
  const [ax, ay] = anchorFor(f, c.anchor), len = c.len * f.scale, p0 = c.pts[0];
  p0.x = p0.px = ax; p0.y = p0.py = ay;
  const dt2 = dt * dt, wind = -f.dir * c.wind + 100 * Math.sin(G.time * 1.3 + f.home);
  for (let i = 1; i < c.n; i++) { const p = c.pts[i], vx = (p.x - p.px) * .965, vy = (p.y - p.py) * .965; p.px = p.x; p.py = p.y; p.x += vx + wind * dt2; p.y += vy - 420 * dt2; }
  for (let it = 0; it < 6; it++) for (let i = 1; i < c.n; i++) {
    const a = c.pts[i - 1], b = c.pts[i], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-4, k = (d - len) / d;
    if (i === 1) { b.x -= dx * k; b.y -= dy * k; } else { a.x += dx * k * .5; a.y += dy * k * .5; b.x -= dx * k * .5; b.y -= dy * k * .5; }
    if (b.y < 1) b.y = 1;
  }
}
function updateFighter(f, dt) {
  let an = f.anim;
  an.t += dt * (an.rate || 1);
  if (an.def.move) {
    const rem = an.target - f.x, st = an.def.speed * dt;
    if (!an.keepFacing && rem) f.dir = Math.sign(rem);
    if (Math.abs(rem) <= st) { f.x = an.target; an.ctx.dist += Math.abs(rem); finish(f, an); }
    else { f.x += Math.sign(rem) * st; an.ctx.dist += st; }
  }
  for (const e of an.events || []) if (!e.done && an.t >= e.t) { e.done = true; e.fn(); }
  if (an.dur != null && an.t >= an.dur) finish(f, an);
  an = f.anim;
  for (let i = f.tweens.length - 1; i >= 0; i--) {
    const tw = f.tweens[i]; tw.t += dt; f[tw.key] = tw.from + (tw.to - tw.from) * tw.ease(tw.t / tw.dur);
    if (tw.t >= tw.dur) { f[tw.key] = tw.to; f.tweens.splice(i, 1); tw.res(); }
  }
  const tgt = { ...DEF, ...(an.def.fn(an.t, an.ctx) || {}) };
  if (tgt.ikF > .5) legIK(tgt, "F");
  if (tgt.ikB > .5) legIK(tgt, "B");
  const k = 1 - Math.exp(-dt * 18), c = f.cur;
  for (const key of ANGLE_KEYS) c[key] = norm(c[key] + norm((Number(tgt[key]) || 0) - c[key]) * k);
  c.x += ((tgt.x || 0) - c.x) * k; c.y += ((tgt.y || 0) - c.y) * k;
  f.skel = fk(c);
  if (!f.chainsReady) { resetChains(f); f.chainsReady = true; }
  for (const ch of f.chains) simChain(f, ch, dt);
  f.flash *= Math.exp(-dt * 9); f.shieldHit *= Math.exp(-dt * 5); f.shocked = Math.max(0, f.shocked - dt);
  if (f.status.burn > 0 && f.hp > 0 && Math.random() < dt * 22) {
    const [x, y] = boneW(f, pick(["spine", "chest", "armF", "legF", "foreB", "shinB"]), Math.random());
    emit({ x: x + rnd(-4, 4), y, vx: rnd(-10, 10), vy: rnd(40, 80), max: rnd(.35, .6), size: rnd(5, 9), size1: 1, col: pick(["#ff9a3c", "#ff6a1f", "#ffd27a"]) });
  }
  if (f.status.smoke && Math.random() < dt * 10) {
    const [x, y] = chestW(f); emit({ x: x + rnd(-30, 30), y: y + rnd(-50, 30), vx: rnd(-10, 10), vy: rnd(5, 20), max: 1.2, size: rnd(10, 16), size1: 26, kind: "smoke", col: "#9aa1ab", alpha: .35 });
  }
  if (f.status.charging) {
    f.arcT -= dt;
    if (f.arcT <= 0) { f.arcT = .07; f.arcs = Array.from({ length: 2 }, () => { const [x0, y0] = boneW(f, pick(BONE_NAMES), Math.random()); return boltPts(x0, y0, x0 + rnd(-30, 30), y0 + rnd(-30, 30), 10, 3); }); }
    if (Math.random() < dt * 30) { const [cx, cy] = chestW(f), a = rnd(0, TAU), r = rnd(70, 110);
      emit({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, vx: -Math.cos(a) * r * 2, vy: -Math.sin(a) * r * 2, max: .45, size: rnd(3, 6), size1: 1, col: pick([f.look.glow, "#8fb8ff", "#e6dcff"]) }); }
  }
}

/* =================== FX =================== */
const parts = [], fx = [];
function emit(p) { if (parts.length < 1500) parts.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: .5, size: 8, size1: 0, col: "#ffffff", kind: "glow", drag: 0, grav: 0, alpha: 1, ...p }); }
const spriteCache = {};
function sprite(hex) {
  if (spriteCache[hex]) return spriteCache[hex];
  const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"), [r, gg, b] = hex2(hex);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${r},${gg},${b},1)`); gr.addColorStop(.3, `rgba(${r},${gg},${b},.5)`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return spriteCache[hex] = c;
}
let ctx = null;
function glow(x, y, size, hex, alpha = 1) { if (size <= 0 || alpha <= 0) return; ctx.globalAlpha = alpha; ctx.drawImage(sprite(hex), x - size, y - size, size * 2, size * 2); }
function boltPts(x0, y0, x1, y1, disp, depth) {
  let pts = [[x0, y0], [x1, y1]];
  for (let d = 0; d < depth; d++) {
    const n = [pts[0]];
    for (let i = 1; i < pts.length; i++) { const [ax, ay] = pts[i - 1], [bx, by] = pts[i], len = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / len, ny = (bx - ax) / len, o = rnd(-disp, disp);
      n.push([(ax + bx) / 2 + nx * o, (ay + by) / 2 + ny * o], pts[i]); }
    pts = n; disp *= .55;
  }
  return pts;
}
function strokePts(pts, w, col, a) { ctx.globalAlpha = a; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); }
function drawBolt(pts, a, core = "#ffffff", glowCol = "#9fc4ff", w = 1) {
  ctx.globalCompositeOperation = "lighter";
  strokePts(pts, 16 * w, glowCol, .14 * a); strokePts(pts, 7 * w, glowCol, .45 * a); strokePts(pts, 2.4 * w, core, a);
  ctx.globalCompositeOperation = "source-over";
}
function addFx(o) { fx.push(o); return o; }
function ring(x, y, r1, col, max = .5, w = 6, sq = 1, r0 = 4) {
  addFx({ t: 0, update(dt) { this.t += dt; return this.t < max; }, draw() { const u = this.t / max, r = r0 + (r1 - r0) * easeOut(u);
    ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = (1 - u) * .9; ctx.strokeStyle = col; ctx.lineWidth = w * (1 - u) + .5;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * sq, 0, 0, TAU); ctx.stroke(); ctx.globalCompositeOperation = "source-over"; } });
}
function groundGlow(x, col, r, max = .8, a = .5) {
  addFx({ t: 0, back: true, update(dt) { this.t += dt; return this.t < max; }, draw() { const u = this.t / max;
    ctx.globalCompositeOperation = "lighter"; ctx.save(); ctx.translate(x, 2); ctx.scale(1, .22); glow(0, 0, r, col, a * (1 - u)); ctx.restore(); ctx.globalCompositeOperation = "source-over"; } });
}
const BURST = {
  fire: { cols: ["#fff1c2", "#ffb347", "#ff6a1f", "#ff3d1a"], ring: "#ffb04a", spark: "#ffd27a" },
  bolt: { cols: ["#ffffff", "#b9d6ff", "#8fb8ff"], ring: "#a9cbff", spark: "#e8f1ff" },
  impact: { cols: ["#ffffff", "#ffe2a8", "#ffbf6b"], ring: "#fff0d0", spark: "#ffffff" },
  wind: { cols: ["#ffffff", "#c9fff6", "#8fe3dc"], ring: "#c9fff6", spark: "#e8fffb" },
};
function burst(x, y, kind, power = 1, look) {
  const P_ = kind === "void" && look ? { cols: ["#f1e8ff", look.glow, look.glow2], ring: look.glow, spark: "#f6efff" } : BURST[kind] || BURST.impact;
  const n = Math.round(18 * power);
  for (let i = 0; i < n; i++) { const a = rnd(0, TAU), sp = rnd(120, 420) * Math.sqrt(power); emit({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: rnd(.2, .45), size: rnd(1.5, 3), kind: "spark", col: P_.spark, drag: 4, grav: 300 }); }
  for (let i = 0; i < n; i++) { const a = rnd(0, TAU), sp = rnd(30, 160) * power; emit({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 20, max: rnd(.3, .7), size: rnd(10, 22) * power, size1: 2, col: pick(P_.cols), drag: 3 }); }
  emit({ x, y, max: .25, size: 70 * power, size1: 110 * power, col: P_.cols[0], alpha: .9 });
  if (kind === "fire") for (let i = 0; i < 8 * power; i++) emit({ x: x + rnd(-15, 15), y: y + rnd(-10, 10), vx: rnd(-40, 40), vy: rnd(20, 70), max: rnd(.8, 1.4), size: rnd(10, 18) * power, size1: rnd(26, 40) * power, kind: "smoke", col: "#3a302c", drag: 1.5, alpha: .55 });
  ring(x, y, 70 * power, P_.ring, .45, 7 * power, 1);
  ring(x, 3, 110 * power, P_.ring, .6, 5, .18);
  groundGlow(x, P_.ring, 140 * power, .9, .55);
}
function smokePuff(x, n = 18, y0 = 40) {
  for (let i = 0; i < n; i++) { const a = rnd(0, TAU), sp = rnd(30, 110);
    emit({ x: x + Math.cos(a) * 10, y: y0 + rnd(0, 90), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * .5 + 15, max: rnd(.7, 1.2), size: rnd(12, 20), size1: rnd(30, 44), kind: "smoke", col: pick(["#b7bcc4", "#9aa1ab", "#c9ccd1"]), drag: 2.5, alpha: .7 }); }
}
function shards(x, y, col) {
  for (let i = 0; i < 16; i++) { const a = rnd(-1.2, 1.2) + (Math.random() < .5 ? 0 : Math.PI), sp = rnd(140, 320);
    emit({ x, y: y + rnd(-40, 40), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 60, max: rnd(.4, .7), size: rnd(2, 3.5), kind: "spark", col, drag: 2, grav: 500 }); }
  ring(x, y, 90, col, .4, 6);
}

/* =================== GLOBAL STATE =================== */
const G = { time: 0, epoch: 0, freeze: 0, shake: 0, flashA: 0, flashCol: "#ffffff", dim: 0, dimT: 0, timers: [], floaters: [], active: null };
function gsleep(s) { return new Promise(res => G.timers.push({ at: G.time + s, res })); }
const shake = v => { if (!REDUCED) G.shake = Math.max(G.shake, v); };
const screenFlash = (col, a) => { G.flashCol = col; G.flashA = Math.max(G.flashA, REDUCED ? a * .4 : a); };
const freeze = s => { G.freeze = Math.max(G.freeze, s); };
function floater(f, text, col, size, sub, dy = 0) {
  const [x, y] = boneW(f, "head", 1), n = G.floaters.filter(o => o.f === f && o.t < .35).length;
  G.floaters.push({ f, x: x + rnd(-10, 10), y: y + 18 + n * 22 + dy, text: String(text), col, size, sub, t: 0, max: 1.3 });
}

/* =================== RENDERING =================== */
let canvas, wrap, bg, W = 0, H = 0, S = 1, GY = 0, CX = 0, dpr = 1;
function resize() {
  if (!wrap) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = wrap.clientWidth; if (!W) return;
  H = Math.round(Math.max(300, W * .58));
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.height = H + "px";
  S = Math.min(W / VIEW_W, H / 360); CX = W / 2; GY = H - Math.max(30, H * .15);
  paintBG();
}
function rnds(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
function paintBG() {
  bg.width = canvas.width; bg.height = canvas.height;
  const g = bg.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sky = g.createLinearGradient(0, 0, 0, GY); sky.addColorStop(0, "#10152a"); sky.addColorStop(.5, "#272a46"); sky.addColorStop(1, "#6e4a4a");
  g.fillStyle = sky; g.fillRect(0, 0, W, GY);
  const r = rnds(7);
  for (let i = 0; i < 80; i++) { g.fillStyle = `rgba(240,232,215,${.12 + r() * .5})`; g.fillRect(r() * W, r() * GY * .55, 1.3, 1.3); }
  const mx = W * .5, my = H * .36, mr = Math.max(14, S * 30);
  const gl = g.createRadialGradient(mx, my, mr * .5, mx, my, mr * 5); gl.addColorStop(0, "rgba(255,226,190,.25)"); gl.addColorStop(1, "rgba(255,226,190,0)");
  g.fillStyle = gl; g.fillRect(0, 0, W, GY); g.fillStyle = "#eedfc3"; g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.fill();
  const ridge = (base, amp, col, f, seed) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, GY);
    for (let x = 0; x <= W + 8; x += 6) { const n = .5 + .5 * (Math.sin(x * .0045 * f + seed) * .6 + Math.sin(x * .012 * f + seed * 2) * .3 + Math.sin(x * .03 + seed * 3) * .1); g.lineTo(x, base - amp * n); }
    g.lineTo(W, GY); g.closePath(); g.fill(); };
  ridge(GY - S * 60, S * 120, "#2e2e48", 1, 1.3); ridge(GY - S * 34, S * 80, "#211f36", 1.4, 4.1);
  for (const [wx, h, w] of [[-372, 260, 7], [-356, 300, 6], [-338, 220, 5], [350, 280, 7], [366, 240, 6]]) {
    const x = CX + wx * S; g.fillStyle = "#16241f"; g.fillRect(x - w * S / 2, GY - h * S, w * S, h * S);
    g.fillStyle = "#0f1a16"; for (let y = 30; y < h; y += 34) g.fillRect(x - w * S / 2 - 1, GY - y * S, w * S + 2, 2 * S);
  }
  g.fillStyle = "#1b1520"; g.fillRect(0, GY - 46 * S, W, 4 * S); g.fillRect(0, GY - 26 * S, W, 3 * S);
  for (let wx = -420; wx <= 420; wx += 140) g.fillRect(CX + wx * S - 3 * S, GY - 52 * S, 6 * S, 52 * S);
  for (const wx of [-300, 300]) { const x = CX + wx * S, y = GY - 82 * S;
    const lg = g.createRadialGradient(x, y, 2, x, y, 60 * S); lg.addColorStop(0, "rgba(255,180,90,.33)"); lg.addColorStop(1, "rgba(255,180,90,0)");
    g.fillStyle = lg; g.fillRect(x - 60 * S, y - 60 * S, 120 * S, 120 * S); g.fillStyle = "#1b1520"; g.fillRect(x - 1.5 * S, GY - 112 * S, 3 * S, 20 * S);
    g.fillStyle = "#e39a52"; g.beginPath(); g.ellipse(x, y, 9 * S, 13 * S, 0, 0, TAU); g.fill();
    g.fillStyle = "#1b1520"; g.fillRect(x - 6 * S, y - 14 * S, 12 * S, 3 * S); g.fillRect(x - 6 * S, y + 11 * S, 12 * S, 3 * S); }
  g.fillStyle = "#3a2a21"; g.fillRect(0, GY, W, H - GY); g.fillStyle = "#6c4c37"; g.fillRect(0, GY, W, Math.max(2, 3 * S));
  g.strokeStyle = "rgba(0,0,0,.28)"; g.lineWidth = 1; let y = GY + 8 * S, gap = 7 * S;
  while (y < H) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); gap *= 1.35; y += gap; }
}
let PAL = {};
function palette(f) { const o = {}, m = f.flash, [fr, fg, fb] = f.flashCol;
  for (const k in f.look.col) { const [r, g, b] = f.look.col[k]; o[k] = `rgb(${Math.round(r + (fr - r) * m)},${Math.round(g + (fg - g) * m)},${Math.round(b + (fb - b) * m)})`; } return o; }
function seg(x1, y1, x2, y2, w, col) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
const lerpP = (b, f) => [b.x + (b.ex - b.x) * f, b.y + (b.ey - b.y) * f];

function drawNinja(sk, f) {
  const C = PAL, head = f.look.head;
  const arm = (s, back) => { const up = sk["arm" + s], fo = sk["fore" + s], ha = sk["hand" + s];
    seg(up.x, up.y, up.ex, up.ey, 11, back ? C.tunicB : C.tunic); const [mx, my] = lerpP(fo, .5);
    seg(fo.x, fo.y, mx, my, 9, back ? C.skinB : C.skin); seg(mx, my, fo.ex, fo.ey, 10, back ? C.wrapB : C.wrap);
    ctx.fillStyle = back ? C.skinB : C.skin; ctx.beginPath(); ctx.arc(...lerpP(ha, .4), 5.2, 0, TAU); ctx.fill(); };
  const leg = (s, back) => { const th = sk["leg" + s], sh = sk["shin" + s], ft = sk["foot" + s];
    seg(th.x, th.y, th.ex, th.ey, 17, back ? C.pantsB : C.pants); const [mx, my] = lerpP(sh, .55);
    seg(sh.x, sh.y, mx, my, 14, back ? C.pantsB : C.pants); seg(mx, my, sh.ex, sh.ey, 11, back ? C.bootB : C.boot); seg(ft.x, ft.y, ft.ex, ft.ey, 9, back ? C.bootB : C.boot); };
  arm("B", true); leg("B", true);
  ctx.fillStyle = C.pants; ctx.beginPath(); ctx.arc(sk.hips.x, sk.hips.y, 13, 0, TAU); ctx.fill();
  ctx.strokeStyle = C.tunic; ctx.lineWidth = 28; ctx.beginPath(); ctx.moveTo(sk.spine.x, sk.spine.y); ctx.lineTo(sk.chest.x, sk.chest.y); ctx.lineTo(sk.chest.ex, sk.chest.ey); ctx.stroke();
  leg("F", false);
  const hw = sk.hips.a * D2R; ctx.lineCap = "butt";
  seg(sk.hips.x + Math.cos(hw) * 7, sk.hips.y + Math.sin(hw) * 7, sk.hips.x + Math.cos(hw) * 15, sk.hips.y + Math.sin(hw) * 15, 30, C.sash); ctx.lineCap = "round";
  const h = sk.head, nk = sk.neck; seg(nk.x, nk.y, nk.ex, nk.ey, 10, C.hood);
  const [cx, cy] = lerpP(h, .5); ctx.save(); ctx.translate(cx, cy); ctx.rotate((h.a - 90) * D2R);
  ctx.fillStyle = C.hood; ctx.beginPath(); ctx.arc(0, 0, 14, 0, TAU); ctx.fill();
  if (head !== "band") { ctx.beginPath(); ctx.arc(-13, -3, 4.5, 0, TAU); ctx.fill(); }
  ctx.fillStyle = C.skin; ctx.beginPath(); ctx.ellipse(6.5, 2, 8, head === "band" ? 9 : 4.6, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = C.eye; ctx.beginPath(); ctx.ellipse(9.6, 2.3, 1.7, 2.3, 0, 0, TAU); ctx.fill();
  if (head === "band") { ctx.fillRect(8, -5, 4, 1.4); ctx.fillStyle = C.band; ctx.fillRect(-14, 7, 27, 4.5); ctx.beginPath(); ctx.moveTo(-14, 9); ctx.lineTo(-24, 3); ctx.lineTo(-22, 11); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.hood; ctx.beginPath(); ctx.arc(-4, 14, 5, 0, TAU); ctx.fill(); }
  else ctx.fillRect(5.5, 5.4, 7.5, 1.3);
  if (head === "straw") {
    ctx.rotate(-6 * D2R); ctx.fillStyle = C.hat; ctx.beginPath(); ctx.moveTo(-29, 8); ctx.lineTo(29, 8); ctx.lineTo(1, 24); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C.hatD; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(1, 24); ctx.lineTo(-12, 8); ctx.moveTo(1, 24); ctx.lineTo(14, 8); ctx.stroke();
    ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-29, 8); ctx.lineTo(29, 8); ctx.stroke();
  }
  if (head === "hood") { ctx.fillStyle = C.band; ctx.fillRect(-2, 8, 12, 2.5); }
  ctx.restore();
  seg(nk.x - 4, nk.y + 1, nk.x + 5, nk.y + 2, 12, C.scarf);
  arm("F", false);
}
function drawMonk(sk, f) {
  const C = PAL, L = f.look;
  const arm = (s, back) => { const up = sk["arm" + s], fo = sk["fore" + s], ha = sk["hand" + s];
    seg(up.x, up.y, up.ex, up.ey, 13, back ? C.robeB : C.robe); const [mx, my] = lerpP(fo, .62);
    seg(fo.x, fo.y, mx, my, 13, back ? C.robeB : C.robe); seg(mx, my, fo.ex, fo.ey, 8, back ? C.gloveB : C.glove);
    ctx.fillStyle = back ? C.gloveB : C.glove; ctx.beginPath(); ctx.arc(...lerpP(ha, .4), 5.4, 0, TAU); ctx.fill(); };
  const leg = (s, back) => { const th = sk["leg" + s], sh = sk["shin" + s], ft = sk["foot" + s];
    seg(th.x, th.y, th.ex, th.ey, 15, back ? C.bootB : C.boot); seg(sh.x, sh.y, sh.ex, sh.ey, 11, back ? C.bootB : C.boot); seg(ft.x, ft.y, ft.ex, ft.ey, 9, back ? C.bootB : C.boot); };
  arm("B", true); leg("B", true); leg("F", false);
  const hip = sk.hips, kF = sk.legF, kB = sk.legB, hw = hip.a * D2R, nx = Math.cos(hw + Math.PI / 2), ny = Math.sin(hw + Math.PI / 2);
  const wB = [hip.x + nx * 15 + Math.cos(hw) * 8, hip.y + ny * 15 + Math.sin(hw) * 8], wF = [hip.x - nx * 15 + Math.cos(hw) * 8, hip.y - ny * 15 + Math.sin(hw) * 8];
  const hB = [kB.ex - 12, kB.ey - 8], hF = [kF.ex + 12, kF.ey - 8], cy0 = Math.min(hB[1], hF[1]) - 6;
  ctx.fillStyle = C.robe; ctx.beginPath(); ctx.moveTo(...wB); ctx.lineTo(...hB); ctx.quadraticCurveTo((hB[0] + hF[0]) / 2, cy0, ...hF); ctx.lineTo(...wF); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = C.trim; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(...hB); ctx.quadraticCurveTo((hB[0] + hF[0]) / 2, cy0, ...hF); ctx.stroke();
  ctx.strokeStyle = C.robe; ctx.lineWidth = 31; ctx.beginPath(); ctx.moveTo(sk.spine.x, sk.spine.y); ctx.lineTo(sk.chest.x, sk.chest.y); ctx.lineTo(sk.chest.ex, sk.chest.ey); ctx.stroke();
  const ca = sk.chest.a * D2R;
  seg(sk.chest.ex + Math.cos(ca + 1.57) * 2, sk.chest.ey + Math.sin(ca + 1.57) * 2, sk.chest.x + Math.cos(ca - 1.2) * 9, sk.chest.y + Math.sin(ca - 1.2) * 9, 2.4, C.trim);
  ctx.lineCap = "butt"; seg(hip.x + Math.cos(hw) * 9, hip.y + Math.sin(hw) * 9, hip.x + Math.cos(hw) * 14, hip.y + Math.sin(hw) * 14, 32, C.cord); ctx.lineCap = "round";
  const h = sk.head, nk = sk.neck; seg(nk.x, nk.y, nk.ex, nk.ey, 11, C.hood);
  const [hx, hy] = lerpP(h, .5); ctx.save(); ctx.translate(hx, hy); ctx.rotate((h.a - 90) * D2R);
  ctx.fillStyle = C.hood; ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-6, 13); ctx.quadraticCurveTo(-22, 16, -30, 2); ctx.quadraticCurveTo(-18, 2, -12, -8); ctx.closePath(); ctx.fill();
  if (L.horns) { ctx.fillStyle = C.horn; ctx.beginPath(); ctx.moveTo(3, 9); ctx.lineTo(0, 20); ctx.lineTo(8, 10); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(10, 8); ctx.lineTo(13, 17); ctx.lineTo(15, 7); ctx.closePath(); ctx.fill(); }
  ctx.fillStyle = C.mask; ctx.beginPath(); ctx.ellipse(8, 0, 9, 12, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = C.maskRed; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(8, 9); ctx.lineTo(14, 5); ctx.moveTo(4, -6); ctx.lineTo(12, -9); ctx.moveTo(10, -3); ctx.lineTo(16, -4); ctx.stroke();
  ctx.fillStyle = C.eye; ctx.beginPath(); ctx.ellipse(12, 2, 3.2, 1.4, -.15, 0, TAU); ctx.fill();
  ctx.globalCompositeOperation = "lighter"; glow(12, 2, 9, L.glow, .7 + .3 * Math.sin(G.time * 5)); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  ctx.restore();
  const ha = sk.handF, a = (ha.a + 90 + (f.cur.staff || 0)) * D2R, [gx, gy] = lerpP(ha, .4);
  const tx = gx + Math.cos(a) * 62, ty = gy + Math.sin(a) * 62, bx = gx - Math.cos(a) * 56, by = gy - Math.sin(a) * 56;
  seg(bx, by, tx, ty, 4.5, C.staff); seg(tx - Math.cos(a) * 6, ty - Math.sin(a) * 6, tx, ty, 7, C.staffD);
  ctx.globalCompositeOperation = "lighter"; glow(tx + Math.cos(a) * 5, ty + Math.sin(a) * 5, f.status.charging ? 30 : 16, L.glow, .9); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = C.orb; ctx.beginPath(); ctx.arc(tx + Math.cos(a) * 5, ty + Math.sin(a) * 5, 5, 0, TAU); ctx.fill();
  arm("F", false);
}
function drawShield(f) {
  const [cx, cy] = chestW(f), col = f.look.glow, hit = f.shieldHit, sh = .55 + .15 * Math.sin(G.time * 4), r = 74 * f.scale;
  ctx.globalCompositeOperation = "lighter"; ctx.save(); ctx.translate(cx + f.dir * 6, cy - 10); ctx.scale(f.dir, 1);
  ctx.globalAlpha = .08 + hit * .25; ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, 0, r * .62, r * 1.05, 0, -Math.PI / 2, Math.PI / 2); ctx.fill();
  ctx.globalAlpha = (sh + hit) * .7; ctx.strokeStyle = col; ctx.lineWidth = 2.5 + hit * 4; ctx.beginPath(); ctx.ellipse(0, 0, r * .62, r * 1.05, 0, -Math.PI / 2, Math.PI / 2); ctx.stroke();
  ctx.globalAlpha = .25 + hit * .4; ctx.lineWidth = 1;
  for (let i = -3; i <= 3; i++) { const yy = i * r * .27, xx = Math.sqrt(Math.max(0, 1 - Math.pow(yy / (r * 1.05), 2))) * r * .62; ctx.beginPath(); ctx.moveTo(xx * .55, yy); ctx.lineTo(xx, yy); ctx.stroke(); }
  if (hit > .05) { ctx.globalAlpha = hit; ctx.lineWidth = 3; const k = 1.4 - hit * .4; ctx.beginPath(); ctx.ellipse(0, 0, r * .62 * k, r * 1.05 * k, 0, -Math.PI / 2, Math.PI / 2); ctx.stroke(); }
  ctx.restore(); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
}
function drawFighter(f) {
  const sk = f.skel; if (!sk) return;
  PAL = palette(f);
  for (const c of f.chains) { ctx.strokeStyle = PAL[c.col];
    for (let i = 1; i < c.n; i++) { const a = c.pts[i - 1], b = c.pts[i]; ctx.lineWidth = (c.w0 + (c.w1 - c.w0) * (i / (c.n - 1))) * f.scale; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } }
  ctx.save(); ctx.translate(f.x, f.lift); ctx.scale(f.dir * f.scale, f.scale);
  if (f.style === "monk") drawMonk(sk, f); else drawNinja(sk, f);
  ctx.restore();
  if (f.status.charging) { const [cx, cy] = chestW(f), p = .5 + .5 * Math.sin(G.time * 6);
    ctx.globalCompositeOperation = "lighter"; glow(cx, cy, 120 + p * 20, f.look.glow2, .35); glow(cx, 3, 90, "#8fb8ff", .25); ctx.globalCompositeOperation = "source-over";
    for (const a of f.arcs) drawBolt(a, .8, "#f0e8ff", f.look.glow, .45); }
  if (f.shocked > 0 && Math.random() < .5) { const [x0, y0] = boneW(f, pick(BONE_NAMES), Math.random()); drawBolt(boltPts(x0, y0, x0 + rnd(-25, 25), y0 + rnd(-25, 25), 8, 3), .9, "#fff", "#9fc4ff", .4); }
  if (f.status.stun) { const [hx, hy] = boneW(f, "head", 1); ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) { const a = G.time * 5 + i * TAU / 3; glow(hx + Math.cos(a) * 18, hy + 14 + Math.sin(a) * 5, 7, "#ffe9a8", .95); }
    ctx.globalCompositeOperation = "source-over"; }
  if (f.status.guard) drawShield(f);
  ctx.globalAlpha = 1;
}
function draw() {
  const sx = G.shake ? rnd(-G.shake, G.shake) : 0, sy = G.shake ? rnd(-G.shake, G.shake) : 0;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(bg, 0, 0);
  ctx.setTransform(dpr * S, 0, 0, -dpr * S, dpr * (CX + sx), dpr * (GY + sy));
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const o of fx) if (o.back) { o.draw(); ctx.globalAlpha = 1; }
  if (P && E) {
    for (const f of [P, E]) { const lift = Math.max(0, f.lift + f.cur.y * f.scale), k = clamp(1 - lift / 220, .3, 1);
      ctx.fillStyle = `rgba(0,0,0,${.38 * k})`; ctx.beginPath(); ctx.ellipse(f.x, 1, 30 * k * f.scale, 5 * k, 0, 0, TAU); ctx.fill(); }
    for (const f of (G.active === E ? [P, E] : [E, P])) drawFighter(f);
  }
  if (G.dim > .01) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = `rgba(6,8,22,${G.dim})`; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore(); }
  for (const o of fx) if (!o.back) { o.draw(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; }
  ctx.globalCompositeOperation = "lighter";
  for (const p of parts) { const u = p.life / p.max, s = p.size + (p.size1 - p.size) * u, a = p.alpha * (1 - u);
    if (p.kind === "glow") glow(p.x, p.y, s, p.col, a);
    else if (p.kind === "spark") { ctx.globalAlpha = a; ctx.strokeStyle = p.col; ctx.lineWidth = s; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * .035, p.y - p.vy * .035); ctx.stroke(); } }
  ctx.globalCompositeOperation = "source-over";
  for (const p of parts) if (p.kind === "smoke") { const u = p.life / p.max; ctx.globalAlpha = p.alpha * (1 - u) * .6; ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, p.size + (p.size1 - p.size) * u, 0, TAU); ctx.fill(); }
  ctx.globalAlpha = 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const fs = clamp(S * 1.1, .7, 1.3);
  for (const o of G.floaters) {
    const u = o.t / o.max, pop = 1 + .7 * Math.max(0, 1 - o.t / .13), a = u < .7 ? 1 : 1 - (u - .7) / .3;
    const X = CX + sx + o.x * S, Y = GY + sy - (o.y + 34 * easeOut(u)) * S;
    ctx.globalAlpha = a; ctx.font = `800 ${Math.round(o.size * fs * pop)}px 'IBM Plex Sans', system-ui, sans-serif`;
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(10,8,16,.85)"; ctx.strokeText(o.text, X, Y); ctx.fillStyle = o.col; ctx.fillText(o.text, X, Y);
    if (o.sub) { ctx.font = `700 ${Math.round(11 * fs)}px 'IBM Plex Sans', system-ui, sans-serif`; ctx.strokeText(o.sub, X, Y - o.size * fs * .75); ctx.fillText(o.sub, X, Y - o.size * fs * .75); }
  }
  ctx.globalAlpha = 1;
  if (G.flashA > .01) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = G.flashA; ctx.fillStyle = G.flashCol; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.globalAlpha = 1; }
}
let last = performance.now(), running = false;
function frame(now) {
  if (!running) return;
  const rdt = Math.min(.034, Math.max(0, (now - last) / 1000)); last = now;
  let dt = rdt;
  if (G.freeze > 0) { G.freeze -= rdt; dt = rdt * .06; }
  G.time += dt;
  for (let i = G.timers.length - 1; i >= 0; i--) if (G.time >= G.timers[i].at) G.timers.splice(i, 1)[0].res();
  if (P && E) { updateFighter(P, dt); updateFighter(E, dt); }
  for (let i = fx.length - 1; i >= 0; i--) if (!fx[i].update(dt)) fx.splice(i, 1);
  for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.life += dt; if (p.life >= p.max) { parts.splice(i, 1); continue; }
    if (p.drag) { const d = Math.exp(-p.drag * dt); p.vx *= d; p.vy *= d; } p.vy -= p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  for (let i = G.floaters.length - 1; i >= 0; i--) { G.floaters[i].t += rdt; if (G.floaters[i].t > G.floaters[i].max) G.floaters.splice(i, 1); }
  G.shake *= Math.exp(-rdt * 9); if (G.shake < .2) G.shake = 0;
  G.flashA *= Math.exp(-rdt * 7);
  G.dim += (G.dimT - G.dim) * (1 - Math.exp(-rdt * 6));
  draw();
  requestAnimationFrame(frame);
}

/* =================== HIT PLAYBACK =================== */
let hooks = { hud() {}, log() {} };
function applyHit(m, fxKind = "impact") {
  const h = m.hits[m.hi++]; if (!h) return null;
  const a = m.a, d = sideOf(h.target);
  if (h.miss) {
    floater(d, "Miss", "#dfe4ea", 22, m.evaded ? "DODGED" : null); smokePuff(d.x, 8, 50); play(d, "dodge");
    return h;
  }
  d.hp = Math.max(0, d.hp - h.amount);
  floater(d, h.amount, h.crit ? "#ffd25e" : h.guarded ? "#c3ccd6" : "#ffffff", h.crit ? 32 : h.guarded ? 19 : 25, h.crit ? "CRITICAL" : h.guarded ? "GUARDED" : null);
  d.flash = 1; d.flashCol = m.flash || [255, 255, 255];
  if (h.shieldBreak) { d.status.guard = false; shards(...chestW(d), d.look.glow); floater(d, "Guard shattered", "#c9fff6", 15, null, 26); hooks.log(`${d.name}'s guard shatters.`, "w"); }
  if (h.guarded) d.shieldHit = 1;
  if (h.broke) {
    d.status.charging = false; G.dimT = 0; floater(d, "Storm broken", "#bcd6ff", 17, null, 26);
    ring(...chestW(d), 120, "#a9cbff", .5, 6); play(d, "stagger"); hooks.log(`${a.name} breaks the storm.`, "w");
  } else play(d, d.hurtAnim);
  if (h.burn) { d.status.burn = Math.max(d.status.burn, h.burn); floater(d, "Burning", "#ffae6b", 14, null, 26); }
  if (h.stun) { d.status.stun = true; floater(d, "Stunned", "#cfe0ff", 15, null, 46); hooks.log(`${d.name} is stunned.`, "w"); }
  if (h.drain) { d.energy = Math.max(0, d.energy - h.drain); floater(d, `−${h.drain} energy`, "#8fd3ff", 13, null, 66); d.shocked = .9; }
  const self = (n, label, col, kind) => setTimeout(() => { if (m.ep !== G.epoch) return;
    a.hp = Math.max(0, a.hp - n); a.flash = .9; a.flashCol = col; floater(a, n, "#ffffff", 20, label); burst(...chestW(a), kind, .5); hooks.hud(); }, 120);
  if (h.counter) self(h.counter, "COUNTER", [255, 220, 140], "impact");
  if (h.shock) self(h.shock, "SHOCKED", [170, 200, 255], "bolt");
  shake(Math.min(15, 3 + h.amount * .35)); if (h.amount >= 14 || h.crit) freeze(h.crit ? .1 : .065);
  hooks.hud();
  return h;
}
function applyHeal(m, col = "#9ff0b8") {
  const h = m.heals[m.li++]; if (!h) return;
  const f = sideOf(h.target); f.hp = Math.min(f.maxHp, f.hp + h.amount);
  floater(f, "+" + h.amount, col, 24, "HEAL"); hooks.hud();
}
function projectile({ from, to, dur, arc = 0, drawP, trail, onHit }) {
  return new Promise(res => { addFx({ t: 0, x: from[0], y: from[1], update(dt) {
    this.t += dt; const u = Math.min(1, this.t / dur), e = Math.pow(u, 1.25);
    this.x = from[0] + (to[0] - from[0]) * e; this.y = from[1] + (to[1] - from[1]) * e + Math.sin(Math.PI * e) * arc;
    if (trail) trail(this, dt);
    if (u >= 1) { onHit && onHit(this.x, this.y); res(); return false; } return true; }, draw() { drawP(this); } }); });
}
function curveProjectile({ from, ctrl, to, dur, drawP, trail, onHit }) {
  return new Promise(res => { addFx({ t: 0, x: from[0], y: from[1], update(dt) {
    this.t += dt; const u = Math.pow(Math.min(1, this.t / dur), 1.3), v = 1 - u;
    this.x = v * v * from[0] + 2 * v * u * ctrl[0] + u * u * to[0]; this.y = v * v * from[1] + 2 * v * u * ctrl[1] + u * u * to[1];
    if (trail) trail(this, dt);
    if (this.t >= dur) { onHit && onHit(this.x, this.y); res(); return false; } return true; }, draw() { drawP(this); } }); });
}
const homeRetreat = f => Promise.all([play(f, "flip"), tween(f, "x", f.home, .95)]);
const delay = ms => new Promise(r => setTimeout(r, ms));
const fireCols = ["#ff6a1f", "#ffb347", "#ff3d1a", "#ffe1a0"];

/* =================== MOVE ANIMATIONS =================== */
const MOVES = {
  async strike(m) {
    const { a, d } = m;
    await play(a, "run", { target: d.x - a.dir * 62 * d.scale });
    await play(a, "punch", { events: [[.22, () => { burst(...boneW(a, "handF", 1), "impact", .6); applyHit(m); }]] });
    await play(a, "kick", { events: [[.26, () => { burst(...boneW(a, "footF", 1), "impact", .8); applyHit(m); }]] });
    await gsleep(.1); await homeRetreat(a);
  },
  async shuriken(m) {
    const { a, d } = m, flights = [];
    for (let i = 0; i < 3; i++) {
      await play(a, "throw", { rate: 1.8, events: [[.27, () => {
        const from = boneW(a, "handF", 1), [cx, cy] = chestW(d);
        flights.push(projectile({ from, to: [cx - d.dir * 4, cy + rnd(-18, 22)], dur: .26, arc: rnd(-6, 10),
          drawP: p => { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(G.time * 30 * a.dir); ctx.fillStyle = "#d4d8dc"; ctx.beginPath();
            for (let k = 0; k < 8; k++) { const rr = k % 2 ? 2.6 : 9, an = k * Math.PI / 4; ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); } ctx.closePath(); ctx.fill();
            ctx.fillStyle = "#3a3f45"; ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, TAU); ctx.fill(); ctx.restore(); },
          trail: p => emit({ x: p.x, y: p.y, max: .14, size: 6, size1: 1, col: "#cfe3ff", alpha: .5 }),
          onHit: (x, y) => { burst(x, y, "impact", .5); applyHit(m); } }));
      }]] });
    }
    await Promise.all(flights); await gsleep(.25);
  },
  async fireball(m) {
    const { a, d } = m; play(a, "seal"); let gather = true;
    addFx({ t: 0, update(dt) { this.t += dt; const [hx, hy] = boneW(a, "handF", .5);
      for (let i = 0; i < 3; i++) { const an = rnd(0, TAU), r = rnd(30, 60); emit({ x: hx + Math.cos(an) * r, y: hy + Math.sin(an) * r, vx: -Math.cos(an) * r * 3, vy: -Math.sin(an) * r * 3, max: .32, size: rnd(4, 8), size1: 1, col: pick(["#ffb347", "#ff7a2f", "#ffe1a0"]) }); }
      emit({ x: hx, y: hy, max: .12, size: 10 + this.t * 30, size1: 4, col: "#ffcf7a", alpha: .8 }); return gather; }, draw() {} });
    groundGlow(a.x, "#ff9a3c", 90, .9, .35);
    await gsleep(.7); gather = false;
    let flight;
    await play(a, "palm", { events: [[.12, () => {
      const from = boneW(a, "handF", 1); shake(3);
      flight = projectile({ from, to: chestW(d), dur: .55, arc: 16,
        drawP: p => { ctx.globalCompositeOperation = "lighter"; const fl = .85 + .15 * Math.sin(G.time * 40);
          glow(p.x, 3, 50, "#ff8a3a", .18); glow(p.x, p.y, 62 * fl, "#ff5a1f", .55); glow(p.x, p.y, 36 * fl, "#ffb347", .85); glow(p.x, p.y, 17, "#fff4d6", 1); ctx.globalCompositeOperation = "source-over"; },
        trail: p => { for (let i = 0; i < 6; i++) emit({ x: p.x + rnd(-6, 6), y: p.y + rnd(-6, 6), vx: -a.dir * rnd(60, 180), vy: rnd(-20, 60), max: rnd(.25, .5), size: rnd(8, 16), size1: 1, col: pick(fireCols), drag: 2 });
          if (Math.random() < .5) emit({ x: p.x, y: p.y, vx: -a.dir * 40, vy: 30, max: .8, size: 8, size1: 20, kind: "smoke", col: "#3b302b", alpha: .35 }); },
        onHit: (x, y) => { burst(x, y, "fire", 1.25); screenFlash("#ff9a4a", .25); m.flash = [255, 190, 120]; applyHit(m); } });
    }]] });
    await flight; await gsleep(.35);
  },
  async guard(m) { const { a } = m; a.status.guard = true; syncIdle(a); a.shieldHit = 1; ring(...chestW(a), 80, a.look.glow, .5, 5); await gsleep(.6); },
  async barrier(m) { return MOVES.guard(m); },
  async meditate(m) {
    const { a } = m; play(a, "meditate"); let on = true;
    addFx({ update() { if (Math.random() < .7) emit({ x: a.x + rnd(-40, 40), y: rnd(0, 30), vx: rnd(-6, 6), vy: rnd(40, 90), max: rnd(.8, 1.3), size: rnd(3, 6), size1: 1, col: pick(["#b8f5c8", "#ffe7a8", "#d6ffe0"]) }); return on; }, draw() {} });
    ring(a.x, 3, 120, "#b8f5c8", 1.2, 4, .2); groundGlow(a.x, "#9ff0b8", 120, 1.8, .35);
    await gsleep(1.1); applyHeal(m);
    if (m.ev.cleansed) { a.status.burn = 0; floater(a, "Cleansed", "#c8f7d4", 14, null, 30); }
    ring(...chestW(a), 70, "#d6ffe0", .6, 4); await gsleep(.7); on = false;
  },
  async smoke(m) {
    const { a } = m; await play(a, "throw", { rate: 1.6, events: [[.27, () => { smokePuff(a.x, 26, 20); screenFlash("#c9ccd1", .15); }]] });
    a.status.smoke = true; floater(a, "Hidden", "#dfe4ea", 16); await gsleep(.5);
  },
  async windblade(m) {
    const { a, d } = m; let flight;
    await play(a, "swipe", { events: [[.26, () => {
      const [hx, hy] = boneW(a, "handF", 1), [cx, cy] = chestW(d);
      flight = projectile({ from: [hx, hy], to: [cx, cy], dur: .38, arc: 0,
        drawP: p => { ctx.save(); ctx.translate(p.x, p.y); ctx.scale(a.dir, 1); ctx.globalCompositeOperation = "lighter";
          for (const [w, al, col] of [[14, .2, "#8fe3dc"], [6, .6, "#c9fff6"], [2, 1, "#ffffff"]]) { ctx.globalAlpha = al; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(-18, 0, 40, -1.1, 1.1); ctx.stroke(); }
          ctx.restore(); ctx.globalCompositeOperation = "source-over"; },
        trail: p => { for (let i = 0; i < 3; i++) emit({ x: p.x - a.dir * rnd(0, 20), y: p.y + rnd(-36, 36), vx: -a.dir * rnd(80, 200), vy: rnd(-10, 10), max: .3, size: rnd(1, 2), kind: "spark", col: "#e8fffb", drag: 3 }); },
        onHit: (x, y) => { burst(x, y, "wind", .9); applyHit(m); } });
    }]] });
    await flight; await gsleep(.3);
  },
  async phoenix(m) {
    const { a, d } = m; play(a, "seal"); let aura = true;
    addFx({ update() { for (let i = 0; i < 3; i++) emit({ x: a.x + rnd(-30, 30), y: rnd(0, 20), vx: rnd(-10, 10), vy: rnd(90, 200), max: rnd(.4, .7), size: rnd(8, 14), size1: 2, col: pick(fireCols) }); return aura; }, draw() {} });
    groundGlow(a.x, "#ff7a2f", 150, 1.2, .5); shake(2);
    await gsleep(.75); aura = false;
    play(a, "leap"); await tween(a, "lift", 230, .5, easeOut); await gsleep(.08);
    play(a, "dive"); G.dimT = .35; let diving = true;
    addFx({ update() { if (!diving) return false; const [cx, cy] = chestW(a);
      for (let i = 0; i < 8; i++) emit({ x: cx + rnd(-10, 10), y: cy + rnd(-10, 10), vx: rnd(-60, 60), vy: rnd(40, 160), max: rnd(.3, .6), size: rnd(12, 22), size1: 2, col: pick([...fireCols, "#fff1c2"]), drag: 2 });
      for (const s of [1, -1]) emit({ x: cx, y: cy, vx: -a.dir * rnd(80, 160), vy: s * rnd(160, 260), max: .45, size: rnd(10, 16), size1: 1, col: pick(["#ffb347", "#ff8a3a"]), drag: 3 });
      return true; }, draw() { const [cx, cy] = chestW(a); ctx.globalCompositeOperation = "lighter"; glow(cx, cy, 90, "#ff6a1f", .6); glow(cx, cy, 40, "#fff1c2", .9); ctx.globalCompositeOperation = "source-over"; } });
    await Promise.all([tween(a, "x", d.x - a.dir * 26, .3, easeIn), tween(a, "lift", 0, .3, easeIn)]);
    diving = false; G.dimT = 0;
    const [cx, cy] = chestW(d);
    burst(cx, cy, "fire", 2.4); burst(d.x, 10, "fire", 1.5); screenFlash("#ffb06a", .6); freeze(.14); shake(18);
    addFx({ t: 0, update(dt) { this.t += dt; if (this.t < .7) for (let i = 0; i < 5; i++) emit({ x: d.x + rnd(-25, 25), y: rnd(0, 20), vx: rnd(-15, 15), vy: rnd(150, 320), max: rnd(.4, .7), size: rnd(10, 18), size1: 2, col: pick(fireCols) }); return this.t < .8; }, draw() {} });
    m.flash = [255, 180, 110]; applyHit(m);
    await gsleep(.25); await homeRetreat(a);
  },
  async thunderpalm(m) {
    const { a, d } = m; play(a, "seal"); let charge = true;
    addFx({ update() { const [hx, hy] = boneW(a, "handF", .6); if (Math.random() < .6) drawLater.push(() => drawBolt(boltPts(hx, hy, hx + rnd(-26, 26), hy + rnd(-26, 26), 8, 3), 1, "#fff", "#9fc4ff", .5));
      emit({ x: hx, y: hy, max: .1, size: 22, size1: 6, col: "#cfe0ff", alpha: .8 }); return charge; }, draw() {} });
    await gsleep(.55);
    await play(a, "run", { target: d.x - a.dir * 58 * d.scale });
    await play(a, "palm", { events: [[.12, () => { charge = false; const [hx, hy] = boneW(a, "handF", 1);
      for (let i = 0; i < 4; i++) { const pts = boltPts(hx, hy, hx + a.dir * rnd(40, 90), hy + rnd(-50, 50), 18, 4); addFx({ t: 0, update(dt) { this.t += dt; return this.t < .25; }, draw() { drawBolt(pts, 1 - this.t / .25, "#fff", "#9fc4ff", .8); } }); }
      burst(hx, hy, "bolt", 1.2); screenFlash("#e8f0ff", .45); m.flash = [200, 225, 255]; applyHit(m); }]] });
    charge = false; await gsleep(.15); await homeRetreat(a);
  },
  async staff(m) {
    const { a, d } = m;
    await play(a, "glide", { target: d.x - a.dir * 74 * d.scale });
    await play(a, "v_swing", { events: [[.34, () => { const [x, y] = staffTip(a); burst(x, y - 20, "void", .7, a.look); m.flash = [220, 190, 255]; applyHit(m); }]] });
    await play(a, "glideBack", { target: a.home, keepFacing: true });
  },
  async bolt(m) {
    const { a, d } = m; play(a, "v_raise"); G.dimT = .55;
    await gsleep(.45);
    const tip = staffTip(a), top = GY / S + 40;
    addFx({ t: 0, pts: null, update(dt) { this.t += dt; if (!this.pts || Math.random() < .3) this.pts = boltPts(tip[0], tip[1], tip[0] + rnd(-30, 30), top, 22, 5); return this.t < .25; },
      draw() { drawBolt(this.pts, 1 - this.t / .25, "#f2eaff", a.look.glow, .7); } });
    await gsleep(.35);
    const [cx, cy] = chestW(d), tx = cx + rnd(-8, 8); let strikes = 0;
    addFx({ t: 0, pts: null, br: [], regen: 0, update(dt) { this.t += dt; this.regen -= dt;
      if (this.regen <= 0) { this.regen = .055; this.pts = boltPts(tx + rnd(-60, 60), top, tx, cy, 55, 6);
        this.br = Array.from({ length: 3 }, () => { const s = this.pts[irnd(4, this.pts.length - 12)]; return boltPts(s[0], s[1], s[0] + rnd(-90, 90), s[1] - rnd(40, 120), 20, 4); }); if (++strikes % 2 === 0) screenFlash("#e8f0ff", .35); }
      return this.t < .42; },
      draw() { const a2 = this.t < .3 ? 1 : 1 - (this.t - .3) / .12; drawBolt(this.pts, a2, "#ffffff", "#9fc4ff", 1.2); for (const b of this.br) drawBolt(b, a2 * .6, "#ffffff", "#9fc4ff", .6);
        ctx.globalCompositeOperation = "lighter"; glow(tx, cy, 90, "#cfe0ff", a2 * .6); ctx.globalCompositeOperation = "source-over"; } });
    screenFlash("#ffffff", .85); freeze(.08); shake(12); burst(tx, cy, "bolt", 1.3); burst(d.x, 6, "bolt", .8);
    m.flash = [200, 225, 255]; applyHit(m);
    await gsleep(.6); G.dimT = 0; await gsleep(.25);
  },
  async orbs(m) {
    const { a, d } = m, L = a.look; play(a, "v_cast");
    const tip = staffTip(a), orbs = [0, 1, 2].map(i => ({ a: i * TAU / 3, r: 0 }));
    let orbit = true;
    addFx({ update(dt) { for (const o of orbs) { o.a += dt * 5; o.r = Math.min(34, o.r + dt * 90); } return orbit; },
      draw() { ctx.globalCompositeOperation = "lighter"; for (const o of orbs) { const x = tip[0] + Math.cos(o.a) * o.r, y = tip[1] + Math.sin(o.a) * o.r * .7; glow(x, y, 26, L.glow2, .7); glow(x, y, 11, "#f1e8ff", 1); } ctx.globalCompositeOperation = "source-over"; } });
    await gsleep(.7); orbit = false;
    const flights = orbs.map((o, i) => delay(i * 140).then(() => {
      const from = [tip[0] + Math.cos(o.a) * o.r, tip[1] + Math.sin(o.a) * o.r * .7], [cx, cy] = chestW(d);
      return curveProjectile({ from, ctrl: [(from[0] + cx) / 2 + rnd(-40, 40), [190, -10, 120][i]], to: [cx + rnd(-6, 6), cy + rnd(-16, 18)], dur: .5,
        drawP: p => { ctx.globalCompositeOperation = "lighter"; glow(p.x, p.y, 26, L.glow2, .75); glow(p.x, p.y, 11, "#f1e8ff", 1); ctx.globalCompositeOperation = "source-over"; },
        trail: p => emit({ x: p.x, y: p.y, max: .35, size: 12, size1: 1, col: pick([L.glow2, L.glow]), alpha: .8 }),
        onHit: (x, y) => { burst(x, y, "void", .7, L); m.flash = [215, 190, 255]; applyHit(m); } });
    }));
    await Promise.all(flights);
    if (m.heals.length) {
      const [sx, sy] = chestW(d), [ex, ey] = chestW(a);
      for (let i = 0; i < 14; i++) setTimeout(() => curveProjectile({ from: [sx + rnd(-15, 15), sy + rnd(-15, 15)], ctrl: [(sx + ex) / 2 + rnd(-40, 40), Math.max(sy, ey) + rnd(40, 110)], to: [ex, ey], dur: .55,
        drawP: p => { ctx.globalCompositeOperation = "lighter"; glow(p.x, p.y, 9, L.glow, .9); ctx.globalCompositeOperation = "source-over"; }, trail: p => emit({ x: p.x, y: p.y, max: .25, size: 6, size1: 1, col: L.glow2, alpha: .6 }) }), i * 35);
      await gsleep(.85); applyHeal(m, "#d9c3ff");
    }
    await gsleep(.3);
  },
  async storm(m) {
    const { a } = m; play(a, "v_raise"); G.dimT = .25;
    addFx({ t: 0, update(dt) { this.t += dt; const [cx, cy] = chestW(a);
      for (let i = 0; i < 4; i++) { const an = rnd(0, TAU), r = rnd(120, 200); emit({ x: cx + Math.cos(an) * r, y: cy + Math.sin(an) * r, vx: -Math.cos(an) * r * 1.8, vy: -Math.sin(an) * r * 1.8, max: .5, size: rnd(4, 8), size1: 1, col: pick([a.look.glow, "#8fb8ff", "#efe6ff"]) }); }
      return this.t < 1; }, draw() {} });
    await gsleep(1); a.status.charging = true; syncIdle(a); ring(...chestW(a), 140, a.look.glow, .6, 6); shake(4);
    hooks.log(`${a.name} is gathering a storm. Thunderfall lands next turn.`, "e"); await gsleep(.3);
  },
  async thunderfall(m) {
    const { a, d } = m; a.status.charging = false; syncIdle(a); play(a, "v_raise"); G.dimT = .7;
    await gsleep(.4);
    const top = GY / S + 40, n = m.hits.length;
    for (let i = 0; i < n; i++) {
      const big = i === n - 1, [cx, cy] = chestW(d), tx = cx + (big ? 0 : rnd(-26, 26));
      addFx({ t: 0, pts: null, regen: 0, update(dt) { this.t += dt; this.regen -= dt; if (this.regen <= 0) { this.regen = .05; this.pts = boltPts(tx + rnd(-50, 50), top, tx, big ? 4 : cy, 50, 6); } return this.t < (big ? .45 : .22); },
        draw() { drawBolt(this.pts, 1 - this.t / (big ? .45 : .22), "#ffffff", big ? a.look.glow : "#9fc4ff", big ? 1.7 : 1); } });
      screenFlash(big ? "#f3ecff" : "#e8f0ff", big ? .9 : .4); shake(big ? 18 : 8); if (big) freeze(.12);
      burst(tx, cy, "bolt", big ? 1.8 : .8); if (big) burst(d.x, 6, "void", 1.4, a.look);
      m.flash = [200, 225, 255]; applyHit(m);
      await gsleep(big ? .5 : .2);
    }
    G.dimT = 0; await gsleep(.3);
  },
  async mend(m) {
    const { a } = m; play(a, "v_cast"); let on = true;
    addFx({ t: 0, update(dt) { this.t += dt; const an = this.t * 9; for (let k = 0; k < 2; k++) { const aa = an + k * Math.PI; emit({ x: a.x + Math.cos(aa) * 40, y: 10 + this.t * 110, vy: 30, max: .6, size: 8, size1: 1, col: pick(["#9ff0d0", a.look.glow]) }); } return on; }, draw() {} });
    groundGlow(a.x, a.look.glow, 120, 1.5, .4);
    await gsleep(1); applyHeal(m, "#d9c3ff"); on = false; await gsleep(.4);
  },
};
const drawLater = [];

/* =================== PUBLIC API =================== */
const banner = { el: null };
function showBanner(text, foe) {
  const b = banner.el; if (!b) return gsleep(0);
  b.textContent = text; b.className = "banner" + (foe ? " foe" : ""); void b.offsetWidth; b.className += " show";
  return gsleep(REDUCED ? .3 : .75);
}
function applySnap(snap) {
  if (!snap) return;
  for (const [f, s] of [[P, snap.p], [E, snap.e]]) {
    f.hp = s.hp; f.energy = s.energy; f.status = { ...s.status }; f.cooldowns = { ...(s.cooldowns || {}) };
    syncIdle(f);
  }
  hooks.hud();
}
async function playEvent(ev) {
  const ep = G.epoch;
  if (ev.kind === "turnStart") {
    const f = sideOf(ev.actor);
    G.active = f;
    if (ev.actor === "p") { hooks.log(`— Turn ${ev.turn} —`, "t"); await showBanner(`Turn ${ev.turn}`, false); }
    if (ev.burnTick) {
      burst(...chestW(f), "fire", .6); f.hp = Math.max(0, f.hp - ev.burnTick); f.flash = .8; f.flashCol = [255, 170, 100];
      floater(f, ev.burnTick, "#ffae6b", 22, "BURN"); play(f, "hurt"); hooks.log(`${f.name} takes ${ev.burnTick} from Burn.`, ev.actor); hooks.hud();
      await gsleep(.7);
    }
  } else if (ev.kind === "skip") {
    const f = sideOf(ev.actor); floater(f, "Stunned", "#cfe0ff", 20); hooks.log(`${f.name} is stunned and loses the turn.`, "w"); await gsleep(1.1);
  } else if (ev.kind === "move") {
    const a = sideOf(ev.actor), d = other(a); G.active = a;
    hooks.log(`${a.name} uses ${hooks.moveName(ev.move)}.`, ev.actor);
    hooks.acting && hooks.acting(a, ev.move);
    const m = { ev, a, d, ep, hits: ev.hits || [], heals: ev.heals || [], hi: 0, li: 0, evaded: ev.evaded };
    if (ev.evaded) hooks.log(`${d.name} vanishes into smoke. The attack misses.`, "w");
    const fn = MOVES[ev.move];
    try { if (fn) await fn(m); } catch (e) { console.error(e); }
    while (m.hi < m.hits.length) applyHit(m);
    while (m.li < m.heals.length) applyHeal(m);
  } else if (ev.kind === "end") {
    applySnap(ev.snap);
    const loser = ev.winner === "p" ? E : P, win = other(loser);
    for (const k in loser.status) loser.status[k] = false;
    G.dimT = 0; setIdle(loser, "down"); loser.anim = loser.idleAnim();
    setIdle(win, win.style === "monk" ? "v_victory" : "victory");
    hooks.log(ev.winner === "p" ? `${E.name} falls. You win.` : `Koda falls. ${E.name} wins.`, "w");
    hooks.hud(); return;
  }
  if (ep !== G.epoch) return;
  applySnap(ev.snap);
}

window.KodaEngine = {
  mount(canvasEl, wrapEl, bannerEl) {
    canvas = canvasEl; wrap = wrapEl; banner.el = bannerEl; ctx = canvas.getContext("2d"); bg = document.createElement("canvas");
    new ResizeObserver(resize).observe(wrap); resize();
  },
  setHooks(h) { hooks = { ...hooks, ...h }; },
  setup(state) {
    G.epoch++; G.timers.length = 0; fx.length = 0; parts.length = 0; G.floaters.length = 0; G.dim = G.dimT = 0; G.flashA = 0; G.shake = 0;
    addFx({ update() { return true; }, draw() { while (drawLater.length) drawLater.shift()(); } });
    P = new Fighter(state.p, "p"); E = new Fighter(state.e, "e");
    if (state.phase === "over") { const loser = state.winner === "p" ? E : P; loser.hp = 0; syncIdle(loser); }
    hooks.hud();
  },
  async playEvents(events) { const ep = G.epoch; for (const ev of events) { if (ep !== G.epoch) return; await playEvent(ev); } },
  start() { if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); } resize(); },
  stop() { running = false; },
  get P() { return P; }, get E() { return E; },
};
})();
