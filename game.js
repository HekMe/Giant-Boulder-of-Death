/* =========================================================================
   ROCKFALL — endless downhill boulder run
   Pure Babylon.js + Web Audio. All content procedural. No external assets.
   ========================================================================= */
"use strict";

/* ---------- tiny helpers ---------- */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const fmt = (n) => Math.floor(n).toLocaleString("en-US");

function fatal(msg) {
  try {
    const ov = $("ovFatal");
    if (ov) { $("fatalMsg").textContent = String(msg); ov.classList.remove("hidden"); }
  } catch (e) { /* last resort */ alert(msg); }
  console.error("[ROCKFALL fatal]", msg);
}
window.addEventListener("error", (e) => {
  if (!window.__rfBooted) fatal("Startup error: " + (e.message || e.type));
});

function hex3(c) { return BABYLON.Color3.FromHexString(c); }
function lerpC(a, b, t) { return new BABYLON.Color3(lerp(a.r, b.r, t), lerp(a.g, b.g, t), lerp(a.b, b.b, t)); }

/* deterministic hash -> [0,1) */
function hash01(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

/* ---------- config loading (multi-path, inline fallback) ---------- */
const CFG_FILES = ["balance", "objects", "biomes", "upgrades", "spinner", "goals"];
const CFG_PATHS = ["config/", "./config/", "public/config/", "/public/config/", "/config/"];

async function loadConfig() {
  if (window.__INLINE_CONFIG__) return window.__INLINE_CONFIG__;
  let lastErr = null;
  for (const base of CFG_PATHS) {
    try {
      const out = {};
      for (const f of CFG_FILES) {
        const r = await fetch(base + f + ".json", { cache: "no-cache" });
        if (!r.ok) throw new Error(base + f + ".json → HTTP " + r.status);
        out[f] = await r.json();
      }
      console.info("[ROCKFALL] config from:", base);
      return out;
    } catch (e) { lastErr = e; }
  }
  if (window.__FALLBACK_CONFIG__) {
    console.warn("[ROCKFALL] fetch failed everywhere — using bundled fallback config.", lastErr);
    return window.__FALLBACK_CONFIG__;
  }
  throw new Error("Could not load the game config from any path. " + (lastErr ? lastErr.message : ""));
}

/* ---------- persistent save ---------- */
const SAVE_KEY = "rockfall_save_v1";
function defaultSave() {
  return {
    v: 1, coins: 0, gems: 5,
    upgrades: {}, goalIndex: 0, goalsDone: [],
    skins: ["skinRock"], activeSkin: "skinRock",
    stats: { bestDist: 0, bestScore: 0, runs: 0, smashed: 0, overdrives: 0, gaps: 0, totalCoins: 0, totalDist: 0 },
    settings: { sens: 1, volume: 0.7, music: true, quality: "high", gyro: false, gyroTouched: false, reducedMotion: false },
    highscores: []
  };
}
let SAVE = defaultSave();
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (validateSave(s)) SAVE = Object.assign(defaultSave(), s,
        { stats: Object.assign(defaultSave().stats, s.stats || {}),
          settings: Object.assign(defaultSave().settings, s.settings || {}) });
    }
  } catch (e) { console.warn("save load failed", e); }
}
function persistSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(SAVE)); } catch (e) { console.warn(e); }
}
function validateSave(s) {
  return s && typeof s === "object" && s.v === 1 &&
    typeof s.coins === "number" && typeof s.gems === "number" &&
    typeof s.upgrades === "object" && Array.isArray(s.skins);
}
function upLevel(id) { return SAVE.upgrades[id] || 0; }
function upBonus(id) {
  const def = CFG.upgrades.upgrades.find((u) => u.id === id);
  return def ? upLevel(id) * def.bonus : 0;
}

/* ---------- procedural audio (Web Audio) ---------- */
const AudioFX = {
  ctx: null, master: null, musicGain: null, musicNodes: [],
  ensure() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = SAVE.settings.volume;
      this.master.connect(this.ctx.destination);
    } catch (e) { console.warn("audio unavailable", e); }
  },
  setVolume(v) { if (this.master) this.master.gain.value = v; },
  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },
  suspend() { if (this.ctx && this.ctx.state === "running") this.ctx.suspend(); },
  noiseBuf: null,
  getNoise() {
    if (!this.noiseBuf) {
      const len = this.ctx.sampleRate * 1.2, b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = b;
    }
    return this.noiseBuf;
  },
  env(gainNode, t0, peak, dur) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0); g.exponentialRampToValueAtTime(peak, t0 + 0.012);
    g.exponentialRampToValueAtTime(0.0001, t0 + dur);
  },
  tone(type, f0, f1, dur, peak) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, peak, dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  },
  noise(dur, peak, lpFrom, lpTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, s = this.ctx.createBufferSource(); s.buffer = this.getNoise();
    const f = this.ctx.createBiquadFilter(); f.type = "lowpass";
    f.frequency.setValueAtTime(lpFrom, t); f.frequency.exponentialRampToValueAtTime(Math.max(60, lpTo), t + dur);
    const g = this.ctx.createGain(); this.env(g, t, peak, dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + 0.05);
  },
  click() { this.ensure(); this.resume(); this.tone("square", 700, 500, 0.06, 0.12); },
  jump() { this.tone("sine", 240, 560, 0.22, 0.22); },
  land(power) { this.noise(0.3, clamp(0.2 + power * 0.4, 0.2, 0.7), 900, 120); this.tone("sine", 130, 45, 0.3, 0.4); },
  smash(size) {
    const p = clamp(1.6 - size * 0.4, 0.5, 1.5);
    this.noise(0.22, 0.32, 2400 * p, 200);
    this.tone("triangle", 320 * p, 90 * p, 0.18, 0.2);
  },
  explosion() { this.noise(0.7, 0.7, 500, 60); this.tone("sawtooth", 110, 30, 0.6, 0.35); },
  scrape() { this.noise(0.25, 0.2, 1400, 700); },
  coin() { this.tone("square", 880, 880, 0.07, 0.14); this.tone("square", 1320, 1320, 0.09, 0.12); },
  gem() { this.tone("sine", 1180, 1760, 0.25, 0.18); },
  overdrive() { this.tone("sawtooth", 160, 760, 0.7, 0.3); this.noise(0.5, 0.2, 300, 3200); },
  nearmiss() { this.tone("sine", 950, 1500, 0.12, 0.12); },
  death() { this.noise(0.9, 0.6, 700, 50); this.tone("sawtooth", 200, 28, 0.9, 0.3); },
  musicTimer: null, musicStep: 0,
  startMusic() {
    if (!this.ctx || !SAVE.settings.music || this.musicTimer) return;
    this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.14;
    this.musicGain.connect(this.master);
    // soft low pad: two slightly detuned sines through a dark lowpass
    const padLp = this.ctx.createBiquadFilter(); padLp.type = "lowpass"; padLp.frequency.value = 260;
    const padG = this.ctx.createGain(); padG.gain.value = 0.3;
    padLp.connect(padG); padG.connect(this.musicGain);
    [110, 110.6].forEach((f) => {
      const o = this.ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
      o.connect(padLp); o.start();
      this.musicNodes.push(o);
    });
    // gentle A-minor pentatonic arpeggio, occasional rests, drops a fourth every phrase
    const scale = [220, 261.63, 293.66, 329.63, 392, 440, 523.25];
    const pattern = [0, 2, 4, 6, 4, 2, 3, 5];
    this.musicStep = 0;
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== "running" || !SAVE.settings.music) return;
      const i = this.musicStep++ % pattern.length;
      if (hash01(this.musicStep * 11) < 0.22) return; // rests keep it airy
      const f = scale[pattern[i]] * (this.musicStep % 32 < 16 ? 1 : 0.749);
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = "triangle"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      o.connect(g); g.connect(this.musicGain);
      o.start(t); o.stop(t + 0.6);
    }, 290);
  },
  stopMusic() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
    this.musicNodes.forEach((n) => { try { n.stop(); } catch (e) {} });
    this.musicNodes = [];
  }
};

/* ---------- terrain mathematics (shared by mesh + physics + spawning) ---------- */
let CFG = null;
let T = null, GP = null; // terrain params, gap params

function centerX(z) {
  return T.windAmp1 * Math.sin(z * T.windFreq1 * Math.PI * 2) +
         T.windAmp2 * Math.sin(z * T.windFreq2 * Math.PI * 2 + 1.7);
}
function baseProfile(z) {
  return -T.grade * z -
    T.hillAmp1 * Math.sin(z * T.hillFreq1 * Math.PI * 2) -
    T.hillAmp2 * Math.sin(z * T.hillFreq2 * Math.PI * 2 + 2.1);
}
function terrainY(x, z) {
  const dxn = (x - centerX(z)) / T.halfWidth;
  let y = baseProfile(z) + T.chuteDepth * dxn * dxn +
    T.rippleAmp * Math.sin(x * T.rippleFreqX) * Math.sin(z * T.rippleFreqZ);
  // canyon walls: the ground itself climbs steeply beyond the track edge,
  // plateauing at wallHeight — the wall is real geometry, not just decoration
  const over = Math.abs(dxn) - 1;
  if (over > 0) y += T.wallHeight * (1 - Math.exp(-T.wallSharpness * over * over));
  return y;
}
/* downhill slope (positive = descending) along the centreline */
function slopeAt(z) {
  const d = 4;
  return (terrainY(centerX(z), z) - terrainY(centerX(z + d), z + d)) / d;
}

/* ----- deterministic gap map: every segment may contain one crevasse ----- */
function gapForSegment(i) {
  const segStart = i * GP.interval;
  if (segStart < GP.firstGapAt) return null;
  const chance = Math.min(0.88, GP.chance + segStart * 0.00004);
  if (hash01(i * 3 + 1) > chance) return null;
  const width = Math.min(GP.maxWidth, GP.baseWidth + (segStart / 1000) * GP.widthPer1000m);
  const start = segStart + GP.interval * (0.3 + hash01(i * 7 + 2) * 0.3);
  return { start, end: start + width, width };
}
function gapAtZ(z) {
  const g = gapForSegment(Math.floor(z / GP.interval));
  return (g && z >= g.start && z <= g.end) ? g : null;
}
function gapsInRange(z0, z1) {
  const out = [];
  for (let i = Math.floor(z0 / GP.interval) - 1; i <= Math.floor(z1 / GP.interval) + 1; i++) {
    const g = gapForSegment(i);
    if (g && g.end >= z0 && g.start <= z1) out.push(g);
  }
  return out;
}
function nearGap(z, margin) {
  for (const g of gapsInRange(z - margin, z + margin))
    if (z > g.start - margin && z < g.end + margin) return true;
  return false;
}

/* =========================================================================
   ENGINE / SCENE
   ========================================================================= */
let engine = null, scene = null, camera = null, sun = null, hemi = null, shadowGen = null;
let boulder = null, boulderMat = null, auraPS = null, trailPS = null;
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

function initEngine() {
  if (typeof BABYLON === "undefined" || !BABYLON.Engine)
    throw new Error("Babylon.js failed to load from the CDN. Check your connection / script blockers.");
  const canvas = $("renderCanvas");
  engine = new BABYLON.Engine(canvas, true, { stencil: false, preserveDrawingBuffer: false });
  scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.6, 0.78, 0.91, 1);
  scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.007;

  hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0.2, 1, 0.1), scene);
  hemi.intensity = 0.75;
  sun = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-0.45, -0.8, 0.45), scene);
  sun.intensity = 0.95;

  camera = new BABYLON.UniversalCamera("cam", new BABYLON.Vector3(0, 40, -20), scene);
  camera.minZ = 0.4; camera.maxZ = 900; camera.fov = CFG.balance.camera.fovBase;

  applyQuality();
  window.addEventListener("resize", () => engine.resize());
}

function applyQuality() {
  const high = SAVE.settings.quality === "high";
  engine.setHardwareScalingLevel(high ? 1 : 1.5);
  if (high && !shadowGen) {
    shadowGen = new BABYLON.ShadowGenerator(1024, sun);
    shadowGen.usePercentageCloserFiltering = false;
    shadowGen.useExponentialShadowMap = true;
    if (boulder) shadowGen.addShadowCaster(boulder);
  } else if (!high && shadowGen) {
    shadowGen.dispose(); shadowGen = null;
  }
}

/* ---------- materials ---------- */
const MATS = {};
function mat(name, hex, opts = {}) {
  if (MATS[name]) return MATS[name];
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = hex3(hex);
  m.specularColor = new BABYLON.Color3(0.06, 0.06, 0.06);
  if (opts.emissive) m.emissiveColor = hex3(opts.emissive);
  if (opts.alpha) m.alpha = opts.alpha;
  MATS[name] = m;
  return m;
}
let biomeRockMats = [];
function buildBiomeMaterials() {
  biomeRockMats = CFG.biomes.biomes.map((b, i) => mat("rock_" + b.id, b.rock));
}

/* ---------- generic pool ---------- */
class Pool {
  constructor(factory) { this.factory = factory; this.free = []; }
  get() {
    let n = this.free.pop();
    if (!n) n = this.factory();
    n.setEnabled(true);
    return n;
  }
  put(n) { n.setEnabled(false); n.parent = null; this.free.push(n); }
}
const pools = {};
function pooled(kind, factory) {
  if (!pools[kind]) pools[kind] = new Pool(factory);
  return pools[kind].get();
}
function unpool(kind, node) { pools[kind].put(node); }

/* ---------- primitive shorthands ---------- */
function box(name, w, h, d, m, parent) {
  const b = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  b.material = m; if (parent) b.parent = parent; return b;
}
function cyl(name, h, dTop, dBot, m, parent, tess = 12) {
  const c = BABYLON.MeshBuilder.CreateCylinder(name, { height: h, diameterTop: dTop, diameterBottom: dBot, tessellation: tess }, scene);
  c.material = m; if (parent) c.parent = parent; return c;
}
function sph(name, d, m, parent, seg = 10) {
  const s = BABYLON.MeshBuilder.CreateSphere(name, { diameter: d, segments: seg }, scene);
  s.material = m; if (parent) s.parent = parent; return s;
}
function root(name) { const r = new BABYLON.TransformNode(name, scene); return r; }

/* =========================================================================
   PROCEDURAL BUILDERS — boulder, rocks, destructibles, decor, hazards
   ========================================================================= */
function buildBoulder() {
  const r = CFG.balance.physics.boulderRadius;
  boulder = BABYLON.MeshBuilder.CreatePolyhedron("boulder", { type: 3, size: r * 0.62 }, scene);
  // lumpy displacement for a rock silhouette
  const pos = boulder.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  for (let i = 0; i < pos.length; i += 3) {
    const k = 1 + (hash01(i) - 0.5) * 0.3;
    pos[i] *= k; pos[i + 1] *= k; pos[i + 2] *= k;
  }
  boulder.setVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
  boulder.createNormals(true);
  boulderMat = new BABYLON.StandardMaterial("boulderMat", scene);
  boulderMat.specularColor = new BABYLON.Color3(0.12, 0.12, 0.12);
  boulder.material = boulderMat;
  applySkin();
  if (shadowGen) shadowGen.addShadowCaster(boulder);

  // overdrive aura
  auraPS = new BABYLON.ParticleSystem("aura", 220, scene);
  auraPS.particleTexture = makeFlareTexture();
  auraPS.emitter = boulder;
  auraPS.minEmitBox = new BABYLON.Vector3(-r, -r, -r);
  auraPS.maxEmitBox = new BABYLON.Vector3(r, r, r);
  auraPS.color1 = new BABYLON.Color4(1, 0.62, 0.2, 0.9);
  auraPS.color2 = new BABYLON.Color4(1, 0.85, 0.4, 0.8);
  auraPS.colorDead = new BABYLON.Color4(1, 0.3, 0.05, 0);
  auraPS.minSize = 0.5; auraPS.maxSize = 1.4;
  auraPS.minLifeTime = 0.15; auraPS.maxLifeTime = 0.4;
  auraPS.emitRate = 160; auraPS.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
  auraPS.gravity = new BABYLON.Vector3(0, 2, 0);

  // speed trail
  trailPS = new BABYLON.ParticleSystem("trail", 260, scene);
  trailPS.particleTexture = makeFlareTexture();
  trailPS.emitter = boulder;
  trailPS.minEmitBox = new BABYLON.Vector3(-0.4, -r * 0.6, -0.4);
  trailPS.maxEmitBox = new BABYLON.Vector3(0.4, 0, 0.4);
  trailPS.color1 = new BABYLON.Color4(0.85, 0.82, 0.75, 0.5);
  trailPS.color2 = new BABYLON.Color4(0.7, 0.66, 0.6, 0.35);
  trailPS.colorDead = new BABYLON.Color4(0.6, 0.58, 0.52, 0);
  trailPS.minSize = 0.5; trailPS.maxSize = 1.7;
  trailPS.minLifeTime = 0.25; trailPS.maxLifeTime = 0.6;
  trailPS.emitRate = 0; trailPS.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
  trailPS.direction1 = new BABYLON.Vector3(-1, 0.5, -3);
  trailPS.direction2 = new BABYLON.Vector3(1, 1.5, -5);
  trailPS.start();
  auraPS.start(); auraPS.emitRate = 0;
}
function applySkin() {
  const skin = CFG.goals.skins.find((s) => s.id === SAVE.activeSkin) || CFG.goals.skins[0];
  boulderMat.diffuseColor = hex3(skin.color);
  boulderMat.emissiveColor = skin.id === "skinMagma" ? hex3("#5a1d05")
    : skin.id === "skinGold" ? hex3("#3a2c08")
    : skin.id === "skinIce" ? hex3("#16242e") : new BABYLON.Color3(0, 0, 0);
}

/* procedural radial flare texture for particles (no asset files) */
let flareTex = null;
function makeFlareTexture() {
  if (flareTex) return flareTex;
  const size = 64;
  flareTex = new BABYLON.DynamicTexture("flare", { width: size, height: size }, scene, false);
  const c = flareTex.getContext();
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g; c.fillRect(0, 0, size, size);
  flareTex.update();
  flareTex.hasAlpha = true;
  return flareTex;
}

/* ----- canyon rock variants (templates cloned per chunk) ----- */
const rockTemplates = [];
function buildRockTemplates() {
  for (let v = 0; v < 6; v++) {
    const node = root("rockT" + v);
    const n = 2 + (v % 3);
    for (let i = 0; i < n; i++) {
      const r = BABYLON.MeshBuilder.CreatePolyhedron("rt", { type: (v + i) % 4, size: rand(1.6, 3.4) }, scene);
      const pos = r.getVerticesData(BABYLON.VertexBuffer.PositionKind);
      for (let k = 0; k < pos.length; k += 3) {
        const j = 1 + (hash01(k + v * 31 + i * 7) - 0.5) * 0.45;
        pos[k] *= j * rand(0.8, 1.5); pos[k + 1] *= j * rand(1.0, 2.2); pos[k + 2] *= j;
      }
      r.setVerticesData(BABYLON.VertexBuffer.PositionKind, pos);
      r.createNormals(true);
      r.position.set(rand(-1.6, 1.6), rand(0.4, 2.4), rand(-1.6, 1.6));
      r.rotation.set(rand(0, 1), rand(0, 3.14), rand(0, 1));
      r.parent = node;
    }
    node.setEnabled(false);
    rockTemplates.push(node);
  }
}
function rockFactory() {
  const t = rockTemplates[randi(0, rockTemplates.length - 1)];
  const node = root("rock");
  t.getChildMeshes().forEach((m) => {
    const c = m.clone("rc", node);
    c.isPickable = false;
  });
  node.metadata = { kind: "rock" };
  return node;
}
function setRockMaterial(node, m) { node.getChildMeshes().forEach((c) => (c.material = m)); }

/* ----- destructible templates from primitives ----- */
const destructibleBuilders = {
  fence(d) {
    const n = root("fence"); const wood = mat("wood", "#8a6a44"), dark = mat("woodD", "#6e5436");
    for (let i = -1; i <= 1; i++) box("p", 0.22, 1.3, 0.22, dark, n).position.set(i * 1.4, 0.65, 0);
    box("r1", 3.2, 0.18, 0.14, wood, n).position.set(0, 1.05, 0);
    box("r2", 3.2, 0.18, 0.14, wood, n).position.set(0, 0.55, 0);
    return n;
  },
  hay(d) {
    const n = root("hay");
    const c = cyl("h", 1.5, 1.5, 1.5, mat("hayM", "#c9a83f"), n, 14);
    c.rotation.z = Math.PI / 2; c.position.y = 0.78;
    const band = cyl("b", 0.25, 1.56, 1.56, mat("hayB", "#9a7c22"), n, 14);
    band.rotation.z = Math.PI / 2; band.position.y = 0.78;
    return n;
  },
  barrel(d) {
    const n = root("barrel");
    cyl("b", 1.5, 1.0, 1.1, mat("barrelM", "#7a4f2a"), n, 12).position.y = 0.75;
    cyl("r1", 0.1, 1.16, 1.16, mat("iron", "#3c3c40"), n, 12).position.y = 0.35;
    cyl("r2", 0.1, 1.12, 1.12, mat("iron", "#3c3c40"), n, 12).position.y = 1.15;
    return n;
  },
  crates(d) {
    const n = root("crates"); const m1 = mat("crate", "#a07a4a"), m2 = mat("crate2", "#8a653a");
    box("c1", 1.2, 1.2, 1.2, m1, n).position.set(0, 0.6, 0);
    box("c2", 1.1, 1.1, 1.1, m2, n).position.set(1.0, 0.55, 0.3);
    const t = box("c3", 1.0, 1.0, 1.0, m1, n); t.position.set(0.45, 1.65, 0.1); t.rotation.y = 0.4;
    return n;
  },
  sign(d) {
    const n = root("sign");
    cyl("p", 2.2, 0.16, 0.2, mat("woodD", "#6e5436"), n, 8).position.y = 1.1;
    const a = box("a", 1.6, 0.5, 0.1, mat("signM", "#c9b27a"), n);
    a.position.set(0.5, 1.8, 0); a.rotation.y = 0.25;
    return n;
  },
  tree(d) {
    const n = root("tree");
    cyl("t", 1.0, 0.3, 0.42, mat("trunk", "#5a4226"), n, 8).position.y = 0.5;
    const g = mat("pineM", "#3e6b35");
    cyl("c1", 1.6, 0.02, 2.0, g, n, 9).position.y = 1.7;
    cyl("c2", 1.3, 0.02, 1.5, g, n, 9).position.y = 2.7;
    cyl("c3", 1.0, 0.02, 1.0, g, n, 9).position.y = 3.5;
    return n;
  },
  cart(d) {
    const n = root("cart"); const w = mat("cartM", "#8c5a30");
    box("b", 2.4, 0.8, 1.4, w, n).position.y = 1.0;
    const wh = mat("wheel", "#4a3a26");
    const w1 = cyl("w1", 0.2, 1.0, 1.0, wh, n, 10); w1.rotation.z = Math.PI / 2; w1.position.set(0, 0.5, 0.75);
    const w2 = cyl("w2", 0.2, 1.0, 1.0, wh, n, 10); w2.rotation.z = Math.PI / 2; w2.position.set(0, 0.5, -0.75);
    const h = box("h", 1.4, 0.12, 0.12, w, n); h.position.set(-1.7, 1.0, 0); h.rotation.z = 0.2;
    return n;
  },
  hut(d) {
    const n = root("hut");
    box("w", 2.6, 1.8, 2.4, mat("hutW", "#6b4a2e"), n).position.y = 0.9;
    const roofM = mat("hutR", "#4a3320");
    const roof = cyl("r", 2.8, 2.4, 2.4, roofM, n, 3);
    roof.rotation.z = Math.PI / 2; roof.rotation.y = Math.PI / 2;
    roof.position.y = 2.25; roof.scaling.y = 1.0; roof.scaling.x = 0.85;
    box("d", 0.7, 1.1, 0.1, mat("hutD", "#3c2a18"), n).position.set(0, 0.55, 1.21);
    return n;
  },
  totem(d) {
    const n = root("totem"); const s = mat("stone", "#8d8d96"), s2 = mat("stone2", "#73737c");
    box("b1", 1.4, 1.0, 1.4, s, n).position.y = 0.5;
    const b2 = box("b2", 1.1, 1.0, 1.1, s2, n); b2.position.y = 1.5; b2.rotation.y = 0.3;
    const b3 = box("b3", 0.8, 0.9, 0.8, s, n); b3.position.y = 2.4; b3.rotation.y = -0.2;
    sph("e", 0.5, mat("stoneEye", "#b9b9c4"), n).position.set(0, 2.4, 0.42);
    return n;
  },
  idol(d) {
    const n = root("idol"); const g = mat("gold", "#e7c34a", { emissive: "#6a5210" });
    cyl("b", 1.2, 0.7, 1.0, g, n, 10).position.y = 0.6;
    sph("h", 0.9, g, n).position.y = 1.6;
    const halo = cyl("halo", 0.06, 1.5, 1.5, mat("goldH", "#ffe9a0", { emissive: "#8a6c1a" }), n, 18);
    halo.position.y = 1.6;
    return n;
  }
};

function destructibleFactory(def) {
  const n = destructibleBuilders[def.id](def);
  n.scaling.setAll(def.size);
  n.metadata = { kind: "destructible", def, radius: 1.4 * def.size, alive: true };
  return n;
}

/* ----- decoration builders (non-colliding) ----- */
const decorBuilders = {
  pine() { return destructibleBuilders.tree(); },
  bush() { const n = root("bush"); sph("b", rand(0.8, 1.4), mat("bushM", "#46743c"), n, 6).position.y = 0.4; return n; },
  flower() { const n = root("fl"); cyl("s", 0.5, 0.05, 0.05, mat("stem", "#4a7a3a"), n, 6).position.y = 0.25;
    sph("f", 0.22, mat("flM", "#e06a9a", { emissive: "#601a3a" }), n, 6).position.y = 0.55; return n; },
  spire() { const n = root("sp"); const c = cyl("c", rand(2.5, 5), 0.1, rand(0.8, 1.6), mat("spireM", "#6d6a70"), n, 7);
    c.position.y = 1.4; c.rotation.z = rand(-0.15, 0.15); return n; },
  boulder() { const n = root("bd"); sph("b", rand(0.9, 1.8), mat("bdM", "#7a766e"), n, 6).position.y = 0.4; return n; },
  icepine() { const n = root("ip"); cyl("t", 0.8, 0.2, 0.3, mat("trunkI", "#7a8a9a"), n, 7).position.y = 0.4;
    cyl("c", 2.2, 0.02, 1.6, mat("iceP", "#dbe9f4"), n, 8).position.y = 1.8; return n; },
  icerock() { const n = root("ir"); const s = sph("b", rand(0.8, 1.6), mat("iceR", "#bfd6ea", { emissive: "#1a2733" }), n, 5);
    s.position.y = 0.35; s.scaling.y = 0.7; return n; },
  obsidian() { const n = root("ob"); const c = cyl("c", rand(1.5, 3.2), 0.05, rand(0.6, 1.2), mat("obsM", "#221c22", { emissive: "#180a12" }), n, 5);
    c.position.y = 0.9; c.rotation.z = rand(-0.2, 0.2); return n; },
  ember() { const n = root("em"); sph("e", rand(0.3, 0.6), mat("embM", "#ff6a2a", { emissive: "#c2410a" }), n, 6).position.y = 0.3; return n; },
  crystal() { const n = root("cr"); const c = BABYLON.MeshBuilder.CreatePolyhedron("c", { type: 1, size: rand(0.5, 1.0) }, scene);
    c.material = mat("cryM", "#8fa8ff", { emissive: "#2a3a8a" }); c.parent = n; c.position.y = 0.7; c.rotation.x = 0.6; return n; }
};

/* ----- hazards ----- */
const hazardBuilders = {
  spikes() {
    const n = root("spikes"); const m = mat("spikeM", "#43363a", { emissive: "#3a0d10" });
    for (let i = 0; i < 6; i++) {
      const c = cyl("s", rand(1.0, 1.7), 0.01, rand(0.35, 0.5), m, n, 6);
      c.position.set(rand(-1.6, 1.6), 0.6, rand(-1.2, 1.2));
      c.rotation.set(rand(-0.2, 0.2), 0, rand(-0.2, 0.2));
    }
    return n;
  },
  mine() {
    const n = root("mine"); const m = mat("mineM", "#5a1d1d", { emissive: "#7a1212" });
    sph("b", 1.5, m, n, 8).position.y = 0.8;
    const spike = mat("mineS", "#2c2c30");
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const s = cyl("sp", 0.5, 0.02, 0.16, spike, n, 5);
      s.position.set(Math.cos(a) * 0.8, 0.8, Math.sin(a) * 0.8);
      s.rotation.z = -Math.cos(a) * 1.4; s.rotation.x = Math.sin(a) * 1.4;
    }
    const lamp = sph("l", 0.3, mat("mineL", "#ff4a3a", { emissive: "#ff3a14" }), n, 6);
    lamp.position.y = 1.6;
    return n;
  },
  roller() {
    const n = root("roller");
    const s = sph("r", 2.6, mat("rollM", "#5e5a52"), n, 8);
    s.position.y = 1.3;
    const band = cyl("b", 0.2, 2.66, 2.66, mat("rollB", "#3e3a34"), n, 12);
    band.rotation.z = Math.PI / 2; band.position.y = 1.3;
    return n;
  }
};
function hazardFactory(type) {
  const n = hazardBuilders[type]();
  // pulsing red danger ring on the ground — instantly readable "do not touch"
  const ringD = type === "roller" ? 6.0 : type === "mine" ? 5.6 : 5.2;
  const ring = cyl("warnring", 0.07, ringD, ringD,
    mat("dangerRing", "#ff2a2a", { emissive: "#d11414", alpha: 0.5 }), n, 22);
  ring.position.y = 0.08;
  n.metadata = { kind: "hazard", type, radius: type === "roller" ? 2.0 : type === "mine" ? CFG.balance.hazards.mineRadius : CFG.balance.hazards.spikeRadius, dir: 1, passed: false, dead: false, ring };
  return n;
}

/* ----- pickups ----- */
function coinFactory() {
  const n = root("coin");
  const c = cyl("c", 0.14, 0.9, 0.9, mat("coinM", "#f2c94c", { emissive: "#6a5210" }), n, 14);
  c.rotation.x = Math.PI / 2; c.position.y = 1.0;
  n.metadata = { kind: "coin", radius: 1.2, taken: false };
  return n;
}
function gemFactory() {
  const n = root("gem");
  const g = BABYLON.MeshBuilder.CreatePolyhedron("g", { type: 1, size: 0.55 }, scene);
  g.material = mat("gemM", "#5ad0e0", { emissive: "#0e4a55" });
  g.parent = n; g.position.y = 1.2;
  n.metadata = { kind: "gem", radius: 1.4, taken: false };
  return n;
}
/* gap warning marker */
function warnFactory() {
  const n = root("warn");
  const m = mat("warnM", "#e8311c", { emissive: "#b81e0e" });
  const m2 = mat("warnM2", "#e8d8c0", { emissive: "#6a5a40" });
  for (let i = -3; i <= 3; i++) {
    const b = box("w", 2.4, 0.32, 1.1, i % 2 ? m : m2, n);
    b.position.set(i * 2.6, 0.16, 0);
  }
  n.metadata = { kind: "warn" };
  return n;
}

/* =========================================================================
   DEBRIS + DUST + POPUPS
   ========================================================================= */
const debris = [];
function buildDebrisPool() {
  for (let i = 0; i < 46; i++) {
    const b = BABYLON.MeshBuilder.CreateBox("deb", { size: 0.42 }, scene);
    b.setEnabled(false);
    b.material = new BABYLON.StandardMaterial("debM" + i, scene);
    b.material.specularColor = new BABYLON.Color3(0, 0, 0);
    debris.push({ mesh: b, life: 0, vel: new BABYLON.Vector3(), spin: new BABYLON.Vector3() });
  }
}
function burstDebris(pos, color, count, power) {
  let used = 0;
  for (const d of debris) {
    if (d.life > 0) continue;
    d.life = rand(0.6, 1.1);
    d.mesh.setEnabled(true);
    d.mesh.material.diffuseColor = color;
    d.mesh.position.copyFrom(pos);
    d.mesh.scaling.setAll(rand(0.5, 1.4));
    d.vel.set(rand(-1, 1) * power, rand(0.5, 1.6) * power, rand(-0.5, 1.5) * power);
    d.spin.set(rand(-6, 6), rand(-6, 6), rand(-6, 6));
    if (++used >= count) break;
  }
}
function updateDebris(dt) {
  for (const d of debris) {
    if (d.life <= 0) continue;
    d.life -= dt;
    if (d.life <= 0) { d.mesh.setEnabled(false); continue; }
    d.vel.y -= 28 * dt;
    d.mesh.position.addInPlace(d.vel.scale(dt));
    d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.mesh.rotation.z += d.spin.z * dt;
  }
}

let dustPS = null;
function buildDust() {
  dustPS = new BABYLON.ParticleSystem("dust", 300, scene);
  dustPS.particleTexture = makeFlareTexture();
  dustPS.emitter = new BABYLON.Vector3(0, 0, 0);
  dustPS.minEmitBox = new BABYLON.Vector3(-1.5, 0, -1.5);
  dustPS.maxEmitBox = new BABYLON.Vector3(1.5, 0.5, 1.5);
  dustPS.color1 = new BABYLON.Color4(0.75, 0.7, 0.6, 0.7);
  dustPS.color2 = new BABYLON.Color4(0.6, 0.56, 0.48, 0.5);
  dustPS.colorDead = new BABYLON.Color4(0.55, 0.52, 0.45, 0);
  dustPS.minSize = 0.8; dustPS.maxSize = 2.6;
  dustPS.minLifeTime = 0.4; dustPS.maxLifeTime = 1.1;
  dustPS.emitRate = 0;
  dustPS.direction1 = new BABYLON.Vector3(-3, 1, -3);
  dustPS.direction2 = new BABYLON.Vector3(3, 5, 3);
  dustPS.start();
}
function puffDust(pos, amount) {
  if (SAVE.settings.quality === "low") amount = Math.floor(amount * 0.4);
  dustPS.emitter = pos.clone();
  dustPS.manualEmitCount = amount;
}

/* HTML score popups */
const popPool = [];
function popScore(worldPos, text, cls) {
  let el = popPool.find((p) => !p.live);
  if (!el) {
    el = { div: document.createElement("div"), live: false, t: 0, pos: new BABYLON.Vector3() };
    el.div.className = "pop"; $("popups").appendChild(el.div); popPool.push(el);
  }
  el.live = true; el.t = 0.9;
  el.pos.copyFrom(worldPos);
  el.div.textContent = text;
  el.div.className = "pop" + (cls ? " " + cls : "");
  el.div.style.opacity = 1;
}
function updatePopups(dt) {
  for (const p of popPool) {
    if (!p.live) { p.div.style.opacity = 0; continue; }
    p.t -= dt;
    if (p.t <= 0) { p.live = false; p.div.style.opacity = 0; continue; }
    p.pos.y += dt * 2.2;
    const sp = BABYLON.Vector3.Project(p.pos, BABYLON.Matrix.Identity(),
      scene.getTransformMatrix(), camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
    if (sp.z > 1 || sp.z < 0) { p.div.style.opacity = 0; continue; }
    p.div.style.left = sp.x / engine.getHardwareScalingLevel() + "px";
    p.div.style.top = sp.y / engine.getHardwareScalingLevel() + "px";
    p.div.style.opacity = Math.min(1, p.t * 2.5);
  }
}

/* =========================================================================
   BIOMES — blended environment sampling
   ========================================================================= */
let biomeCache = [];
function prepBiomes() {
  biomeCache = CFG.biomes.biomes.map((b) => ({
    ...b,
    cGround: hex3(b.ground), cGround2: hex3(b.ground2),
    cFog: hex3(b.fog), cSky: hex3(b.sky), cSkyHi: hex3(b.skyHi),
    cSun: hex3(b.sun), cAmbient: hex3(b.ambient)
  }));
}
function biomeAt(dist) {
  const arr = biomeCache, total = arr.reduce((s, b) => s + b.length, 0);
  let p = ((dist % total) + total) % total;
  let i = 0;
  while (p >= arr[i].length) { p -= arr[i].length; i = (i + 1) % arr.length; }
  const cur = arr[i], nxt = arr[(i + 1) % arr.length];
  const bz = CFG.biomes.blendZone;
  const t = p > cur.length - bz ? (p - (cur.length - bz)) / bz : 0;
  return { cur, nxt, t, index: i };
}
function blendedEnv(dist) {
  const { cur, nxt, t } = biomeAt(dist);
  return {
    ground: lerpC(cur.cGround, nxt.cGround, t),
    ground2: lerpC(cur.cGround2, nxt.cGround2, t),
    fog: lerpC(cur.cFog, nxt.cFog, t),
    sky: lerpC(cur.cSky, nxt.cSky, t),
    sun: lerpC(cur.cSun, nxt.cSun, t),
    ambient: lerpC(cur.cAmbient, nxt.cAmbient, t),
    fogDensity: lerp(cur.fogDensity, nxt.fogDensity, t),
    grip: lerp(cur.grip, nxt.grip, t),
    hazardMult: lerp(cur.hazardMult, nxt.hazardMult, t),
    label: t > 0.5 ? nxt.label : cur.label,
    cur, nxt, t
  };
}

/* =========================================================================
   CHUNK STREAMING
   ========================================================================= */
const chunks = new Map(); // index -> chunk record
let nextHazardZ = 0, nextObjZ = 0;

function buildGroundMesh(ci) {
  const len = T.chunkLength, z0 = ci * len;
  const nx = T.subdivX, nz = T.subdivZ;
  const positions = [], colors = [], indices = [];
  const gaps = gapsInRange(z0, z0 + len);
  const env0 = blendedEnv(z0), env1 = blendedEnv(z0 + len);

  for (let j = 0; j <= nz; j++) {
    const z = z0 + (j / nz) * len;
    const eg = lerpC(env0.ground, env1.ground, j / nz);
    const eg2 = lerpC(env0.ground2, env1.ground2, j / nz);
    for (let i = 0; i <= nx; i++) {
      const xo = (i / nx - 0.5) * 2 * (T.halfWidth + T.meshExtra);
      const x = centerX(z) + xo;
      positions.push(x, terrainY(x, z), z);
      // mottled two-tone ground via deterministic noise
      const m = hash01(Math.floor(x * 0.8) * 13.37 + Math.floor(z * 0.8) * 7.77);
      const c = lerpC(eg, eg2, m * 0.85);
      colors.push(c.r, c.g, c.b, 1);
    }
  }
  const inGapCell = (zA, zB) => {
    for (const g of gaps) if (zB > g.start && zA < g.end) return true;
    return false;
  };
  for (let j = 0; j < nz; j++) {
    const zA = z0 + (j / nz) * len, zB = z0 + ((j + 1) / nz) * len;
    if (inGapCell(zA, zB)) continue; // hole in the road
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const mesh = new BABYLON.Mesh("ground" + ci, scene);
  const vd = new BABYLON.VertexData();
  vd.positions = positions; vd.indices = indices; vd.colors = colors;
  const normals = [];
  BABYLON.VertexData.ComputeNormals(positions, indices, normals);
  vd.normals = normals;
  vd.applyToMesh(mesh);
  let gm = MATS.__ground;
  if (!gm) {
    gm = new BABYLON.StandardMaterial("groundM", scene);
    gm.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);
    gm.backFaceCulling = false;
    MATS.__ground = gm;
  }
  mesh.material = gm;
  mesh.useVertexColors = true;
  mesh.hasVertexAlpha = false;
  mesh.receiveShadows = !!shadowGen;
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();
  return mesh;
}

function spawnChunk(ci) {
  const len = T.chunkLength, z0 = ci * len, z1 = z0 + len;
  const rec = { ground: buildGroundMesh(ci), items: [], statics: [] };
  const env = blendedEnv(z0 + len / 2);
  const biome = env.t > 0.5 ? env.nxt : env.cur;
  const rockMat = MATS["rock_" + biome.id];

  // canyon walls on both edges — two staggered rows hugging the physics boundary
  for (let z = z0; z < z1; z += T.wallSpacing) {
    for (const side of [-1, 1]) {
      const inner = (Math.floor(z / T.wallSpacing) % 2) === 0;
      const node = pooled("rock", rockFactory);
      setRockMaterial(node, rockMat);
      const x = centerX(z) + side * (T.halfWidth + T.wallOffset + (inner ? rand(0, 0.8) : rand(1.6, 3.0)));
      node.position.set(x, terrainY(x, z) - 1.0, z + rand(-1.4, 1.4));
      node.rotation.y = rand(0, Math.PI * 2);
      const s = rand(1.1, 2.0);
      node.scaling.set(s, s * rand(1.1, 2.1), s);
      rec.items.push({ kind: "rock", node });
    }
  }

  // gap warning markers
  for (const g of gapsInRange(z0, z1)) {
    if (g.start >= z0 && g.start < z1) {
      const wz = g.start - GP.warnDistance;
      const node = pooled("warn", warnFactory);
      node.position.set(centerX(wz), terrainY(centerX(wz), wz) + 0.05, wz);
      rec.items.push({ kind: "warn", node });
      // jagged dark rim right at the edge of the crevasse
      const rim = pooled("rim", () => {
        const n = root("rim"); const m = mat("rimM", "#1c1813");
        for (let i = -4; i <= 4; i++) {
          const b = box("rb", 2.2, rand(0.5, 1.1), 1.4, m, n);
          b.position.set(i * 2.7, -0.2, rand(-0.4, 0.4));
          b.rotation.y = rand(-0.3, 0.3);
        }
        n.metadata = { kind: "rim" }; return n;
      });
      rim.position.set(centerX(g.start), terrainY(centerX(g.start), g.start) - 0.1, g.start - 0.5);
      rec.items.push({ kind: "rim", node: rim });
    }
  }

  if (run.active || run.state === "intro") {
    spawnGameplayContent(rec, z0, z1, env, biome);
  }

  // decoration outside the track
  const decorList = biome.decor;
  for (let i = 0; i < CFG.balance.spawning.decorPerChunk; i++) {
    const z = rand(z0, z1);
    if (nearGap(z, 4)) continue;
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = centerX(z) + side * (T.halfWidth + rand(6, 16));
    const kind = decorList[randi(0, decorList.length - 1)];
    const node = pooled("decor_" + kind, () => { const n = decorBuilders[kind](); n.metadata = { kind: "decor" }; return n; });
    node.position.set(x, terrainY(x, z) - 0.3, z);
    node.rotation.y = rand(0, Math.PI * 2);
    rec.items.push({ kind: "decor_" + kind, node });
  }
  chunks.set(ci, rec);
}

function laneX(z, lane) { return centerX(z) + (lane - 1) * T.halfWidth * 0.58; }

function spawnGameplayContent(rec, z0, z1, env, biome) {
  const S = CFG.balance.spawning, H = CFG.balance.hazards;
  const dist = Math.max(0, z0 - run.startZ);
  const hazardBuff = run.buffs.fewerHazards ? 0.65 : 1;

  /* hazards with guaranteed safe lane + reaction spacing */
  while (nextHazardZ < z1) {
    if (nextHazardZ < z0) { nextHazardZ = z0; }
    const hz = nextHazardZ;
    if (hz - run.startZ >= H.firstHazardAt && !nearGap(hz, 14)) {
      const r = Math.random();
      if (r < 0.18) {
        // roller crossing the whole track — telegraphed, all lanes "soft blocked", timing dodge
        const node = pooled("hazard_roller", () => hazardFactory("roller"));
        node.getChildMeshes().forEach((m) => m.setEnabled(true));
        node.metadata.type = "roller"; node.metadata.dead = false; node.metadata.passed = false;
        node.metadata.dir = Math.random() < 0.5 ? -1 : 1;
        node.position.set(laneX(hz, node.metadata.dir < 0 ? 2 : 0), terrainY(laneX(hz, 1), hz), hz);
        rec.items.push({ kind: "hazard_roller", node });
        run.hazards.push(node);
        placeTelegraph(rec, hz);
      } else {
        // block 1–2 of 3 lanes, always leave at least one safe
        const lanes = [0, 1, 2];
        const blockedCount = (dist > 1200 && Math.random() < 0.5) ? 2 : 1;
        for (let k = 0; k < blockedCount; k++) {
          const li = randi(0, lanes.length - 1);
          const lane = lanes.splice(li, 1)[0];
          const type = Math.random() < 0.5 ? "spikes" : "mine";
          const node = pooled("hazard_" + type, () => hazardFactory(type));
          node.getChildMeshes().forEach((m) => m.setEnabled(true));
          node.metadata.type = type; node.metadata.dead = false; node.metadata.passed = false;
          const x = laneX(hz, lane);
          node.position.set(x, terrainY(x, hz), hz);
          rec.items.push({ kind: "hazard_" + type, node });
          run.hazards.push(node);
        }
        placeTelegraph(rec, hz);
      }
    }
    const every = Math.max(H.minEvery, (H.baseEvery - H.shrinkPer1000m * dist / 1000) / (env.hazardMult * hazardBuff));
    const reactGap = CFG.balance.physics.maxSpeed * H.reactionTime * 0.92;
    nextHazardZ += Math.max(every * rand(0.9, 1.3), reactGap);
  }

  /* destructibles */
  const count = Math.min(S.objectsPerChunkMax, Math.floor(S.objectsPerChunkBase + S.objectsRampPer1000m * dist / 1000));
  const defs = CFG.objects.destructibles;
  const totalW = defs.reduce((s, d) => s + d.weight, 0);
  for (let i = 0; i < count; i++) {
    const z = rand(z0 + 4, z1 - 4);
    if (nearGap(z, 6) || nearHazard(z, 9)) continue;
    let w = Math.random() * totalW, def = defs[0];
    for (const d of defs) { w -= d.weight; if (w <= 0) { def = d; break; } }
    const node = pooled("obj_" + def.id, () => destructibleFactory(def));
    node.metadata.alive = true;
    node.getChildMeshes().forEach((m) => m.setEnabled(true));
    const x = centerX(z) + rand(-1, 1) * T.halfWidth * 0.8;
    node.position.set(x, terrainY(x, z) - 0.08, z);
    node.rotation.y = rand(0, Math.PI * 2);
    rec.items.push({ kind: "obj_" + def.id, node });
    run.objects.push(node);
  }

  /* coins + gems */
  for (let i = 0; i < S.coinsPerChunk; i++) {
    const z = rand(z0 + 3, z1 - 3);
    if (nearGap(z, 5)) continue;
    const lane = randi(0, 2);
    for (let k = 0; k < 3; k++) {
      const cz = z + k * 2.4;
      if (nearGap(cz, 3)) break;
      const node = pooled("coin", coinFactory);
      node.metadata.taken = false;
      node.getChildMeshes().forEach((m) => m.setEnabled(true));
      const x = laneX(cz, lane);
      node.position.set(x, terrainY(x, cz), cz);
      rec.items.push({ kind: "coin", node });
      run.pickups.push(node);
    }
  }
  const gemCh = S.gemChance * (run.buffs.gemRate ? 3 : 1);
  if (Math.random() < gemCh * 10) { // per-chunk roll scaled
    const z = rand(z0 + 5, z1 - 5);
    if (!nearGap(z, 5)) {
      const node = pooled("gem", gemFactory);
      node.metadata.taken = false;
      node.getChildMeshes().forEach((m) => m.setEnabled(true));
      const x = centerX(z) + rand(-0.6, 0.6) * T.halfWidth * 0.7;
      node.position.set(x, terrainY(x, z), z);
      rec.items.push({ kind: "gem", node });
      run.pickups.push(node);
    }
  }
}
function placeTelegraph(rec, hz) {
  const wz = hz - 16;
  const node = pooled("tele", () => {
    const n = root("tele");
    const m = mat("teleM", "#ffae3a", { emissive: "#c96d08" });
    const b1 = box("t1", 1.6, 0.14, 0.7, m, n); b1.rotation.y = 0.6;
    const b2 = box("t2", 1.6, 0.14, 0.7, m, n); b2.rotation.y = -0.6;
    n.metadata = { kind: "tele" }; return n;
  });
  node.position.set(centerX(wz), terrainY(centerX(wz), wz) + 0.06, wz);
  rec.items.push({ kind: "tele", node });
}
function nearHazard(z, margin) {
  for (const h of run.hazards) if (Math.abs(h.position.z - z) < margin) return true;
  return false;
}

function disposeChunk(ci) {
  const rec = chunks.get(ci);
  if (!rec) return;
  rec.ground.dispose();
  for (const it of rec.items) {
    unpool(it.kind, it.node);
    const idx1 = run.objects.indexOf(it.node); if (idx1 >= 0) run.objects.splice(idx1, 1);
    const idx2 = run.hazards.indexOf(it.node); if (idx2 >= 0) run.hazards.splice(idx2, 1);
    const idx3 = run.pickups.indexOf(it.node); if (idx3 >= 0) run.pickups.splice(idx3, 1);
  }
  chunks.delete(ci);
}
function ensureChunks() {
  const len = T.chunkLength;
  const ci0 = Math.floor(run.z / len) - T.chunksBehind;
  const ci1 = Math.floor(run.z / len) + T.chunksAhead;
  for (let i = ci0; i <= ci1; i++) if (!chunks.has(i)) spawnChunk(i);
  for (const ci of [...chunks.keys()]) if (ci < ci0 - 1 || ci > ci1 + 1) disposeChunk(ci);
}

/* =========================================================================
   RUN STATE + GAME LOOP
   ========================================================================= */
const run = {
  state: "menu",          // menu | intro | run | over | grace
  active: false,
  z: 0, x: 0, y: 0, vy: 0, vx: 0, speed: 0,
  startZ: 0, dist: 0, score: 0,
  coins: 0, gems: 0, meter: 0,
  combo: 0, comboT: 0, maxCombo: 0,
  overdrive: 0, grace: 0, jumpCd: 0, coyote: 0, airborne: false,
  smashed: 0, gapsCleared: 0, nearMisses: 0, overdrives: 0,
  shake: 0, rollAngle: 0,
  continuesUsed: 0,
  buffs: {},
  objects: [], hazards: [], pickups: [],
  lastGapId: -1, inGapAir: false,
  introT: 0,
  paused: false,
  deathReason: ""
};
let input = { left: false, right: false, jump: false, axis: 0, joyActive: false };

function startRun(continueRun) {
  AudioFX.ensure(); AudioFX.resume(); AudioFX.startMusic();
  if (!continueRun) {
    for (const ci of [...chunks.keys()]) disposeChunk(ci);
    run.objects = []; run.hazards = []; run.pickups = [];
    run.z = 30; run.startZ = 30; run.dist = 0;
    run.score = 0; run.coins = 0; run.gems = 0;
    run.meter = CFG.balance.overdrive.meterMax * upBonus("startMeter") + (run.buffs.headStart ? CFG.balance.overdrive.meterMax : 0);
    run.meter = Math.min(run.meter, CFG.balance.overdrive.meterMax);
    run.combo = 0; run.maxCombo = 0; run.overdrive = 0; run.grace = 0;
    run.smashed = 0; run.gapsCleared = 0; run.nearMisses = 0; run.overdrives = 0;
    run.continuesUsed = 0; run.lastGapId = -1;
    nextHazardZ = run.startZ + CFG.balance.hazards.firstHazardAt;
    run.speed = CFG.balance.physics.startSpeed;
    // sky-drop intro
    run.x = centerX(run.z);
    run.y = terrainY(run.x, run.z) + CFG.balance.intro.dropHeight;
    run.vy = 0; run.vx = 0;
    run.state = "intro"; run.introT = 0;
    camera.position.set(run.x + 4, run.y + CFG.balance.intro.camStartHeight, run.z + CFG.balance.intro.camStartBack);
  } else {
    // revive in place at track centre
    run.x = centerX(run.z + 6); run.z += 6;
    run.y = terrainY(run.x, run.z) + CFG.balance.physics.boulderRadius + 2;
    run.vy = 0; run.vx = 0; run.speed = CFG.balance.physics.startSpeed;
    run.grace = 2.2;
    run.state = "run";
  }
  run.active = true; run.paused = false;
  if (isMobile && SAVE.settings.gyro && typeof DeviceOrientationEvent !== "undefined" &&
      DeviceOrientationEvent.requestPermission && !window.__gyroPerm) {
    window.__gyroPerm = true;
    DeviceOrientationEvent.requestPermission().catch(() => {});
  }
  boulder.setEnabled(true);
  ensureChunks();
  hideAll(); $("hud").classList.remove("hidden");
  if (isMobile) { $("joystick").classList.remove("hidden"); $("btnJump").classList.remove("hidden"); }
  updateHUD(true);
}

function endRun(reason) {
  if (run.state === "over") return;
  run.state = "over"; run.active = false;
  run.deathReason = reason;
  AudioFX.death();
  shake(1.4);
  burstDebris(boulder.position, hex3("#8d8a86"), 14, 12);
  puffDust(boulder.position, 60);
  // rewards
  const coinGain = Math.floor(run.coins * (1 + upBonus("coinGain"))) + Math.floor(run.dist / 100);
  SAVE.coins += coinGain; SAVE.gems += run.gems;
  SAVE.stats.totalCoins += coinGain;
  SAVE.stats.runs++; SAVE.stats.smashed += run.smashed;
  SAVE.stats.totalDist = (SAVE.stats.totalDist || 0) + run.dist;
  SAVE.stats.overdrives += run.overdrives; SAVE.stats.gaps += run.gapsCleared;
  let newBest = false;
  if (run.dist > SAVE.stats.bestDist) { SAVE.stats.bestDist = run.dist; newBest = true; }
  if (run.score > SAVE.stats.bestScore) { SAVE.stats.bestScore = run.score; newBest = true; }
  SAVE.highscores.push({ score: Math.floor(run.score), dist: Math.floor(run.dist), date: new Date().toISOString().slice(0, 10) });
  SAVE.highscores.sort((a, b) => b.score - a.score);
  SAVE.highscores = SAVE.highscores.slice(0, 5);
  const goalMsg = checkGoals();
  persistSave();
  showEndOverlay(coinGain, newBest, goalMsg, reason);
}

/* ---------- scoring ---------- */
function meterMult() { return 1 + run.meter / CFG.balance.overdrive.meterMax; }
function comboMult() { return Math.min(CFG.balance.scoring.comboMax, 1 + run.combo * CFG.balance.scoring.comboStep); }
function addScore(base, pos, label, cls) {
  let v = base * meterMult() * comboMult();
  if (run.overdrive > 0) v *= CFG.balance.overdrive.scoreMult;
  v = Math.floor(v);
  run.score += v;
  if (pos) popScore(pos, (label ? label + " " : "") + "+" + fmt(v), cls);
  return v;
}
function chargeMeter(amount) {
  if (run.overdrive > 0) return;
  amount *= run.buffs.fastMeter ? 1.5 : 1;
  run.meter += amount;
  if (run.meter >= CFG.balance.overdrive.meterMax) {
    run.meter = CFG.balance.overdrive.meterMax;
    triggerOverdrive();
  }
}
function triggerOverdrive() {
  run.overdrive = CFG.balance.overdrive.duration * (1 + upBonus("overdrive"));
  run.overdrives++;
  AudioFX.overdrive();
  auraPS.emitRate = 180;
  boulderMat.emissiveColor = hex3("#ff7a20");
  $("hudState").textContent = "OVERDRIVE";
  shake(0.5);
}
function endOverdrive() {
  run.overdrive = 0;
  run.meter = 0;
  run.grace = Math.max(run.grace, CFG.balance.overdrive.graceTime);
  auraPS.emitRate = 0;
  applySkin();
  $("hudState").textContent = "";
}

function smashObject(node) {
  const def = node.metadata.def;
  node.metadata.alive = false;
  node.getChildMeshes().forEach((m) => m.setEnabled(false));
  run.combo++; run.comboT = CFG.balance.scoring.comboWindow;
  run.maxCombo = Math.max(run.maxCombo, run.combo);
  run.smashed++;
  addScore(def.score, node.position, "", def.score >= 150 ? "big" : "");
  chargeMeter(def.meter);
  burstDebris(node.position.add(new BABYLON.Vector3(0, 1, 0)), hex3(def.color), 6 + Math.floor(def.size * 5), 7 + def.size * 3);
  AudioFX.smash(def.size);
  shake(0.12 + def.size * 0.08);
}
function smashHazard(node) {
  node.metadata.dead = true;
  node.getChildMeshes().forEach((m) => m.setEnabled(false));
  addScore(200, node.position, "DESTROYED!", "big");
  burstDebris(node.position, hex3("#5a3a3a"), 12, 11);
  AudioFX.explosion();
  shake(0.5);
}

/* ---------- camera ---------- */
let shakeAmt = 0;
function shake(a) { if (!SAVE.settings.reducedMotion) shakeAmt = Math.max(shakeAmt, a); }
function updateCamera(dt) {
  const C = CFG.balance.camera;
  const sp = run.speed;
  const look = C.lookAheadBase + sp * C.lookAheadPerSpeed;
  const targetPos = new BABYLON.Vector3(
    lerp(run.x, centerX(run.z - C.back), 0.4),
    Math.max(terrainY(run.x, run.z - C.back), run.y) + C.height,
    run.z - C.back
  );
  const targetLook = new BABYLON.Vector3(
    lerp(run.x, centerX(run.z + look), 0.5),
    terrainY(centerX(run.z + look), run.z + look) + 2,
    run.z + look
  );
  if (run.state === "intro") {
    const t = clamp(run.introT / CFG.balance.intro.blendTime, 0, 1);
    const e = t * t * (3 - 2 * t);
    const fallPos = new BABYLON.Vector3(run.x + 4, run.y + CFG.balance.intro.camStartHeight * (1 - e * 0.6), run.z + CFG.balance.intro.camStartBack + e * (-C.back - CFG.balance.intro.camStartBack));
    camera.position = BABYLON.Vector3.Lerp(fallPos, targetPos, e);
    const lookDown = new BABYLON.Vector3(run.x, terrainY(run.x, run.z + 30), run.z + 30);
    camera.setTarget(BABYLON.Vector3.Lerp(lookDown, targetLook, e));
  } else {
    const k = 1 - Math.exp(-C.smooth * dt);
    camera.position = BABYLON.Vector3.Lerp(camera.position, targetPos, k);
    camera.setTarget(targetLook);
  }
  // speed FOV
  if (!SAVE.settings.reducedMotion) {
    const fovT = clamp(C.fovBase + sp * C.fovPerSpeed, C.fovBase, C.fovMax);
    camera.fov = lerp(camera.fov, fovT, 1 - Math.exp(-4 * dt));
  } else camera.fov = C.fovBase;
  // shake
  if (shakeAmt > 0.001) {
    shakeAmt *= Math.exp(-6 * dt);
    camera.position.x += rand(-1, 1) * shakeAmt;
    camera.position.y += rand(-1, 1) * shakeAmt * 0.7;
  }
}

/* ---------- physics + collisions ---------- */
function updateRun(dt) {
  const P = CFG.balance.physics;
  const env = blendedEnv(run.dist);
  const r = P.boulderRadius;

  /* intro: free fall from the sky */
  if (run.state === "intro") {
    run.introT += dt;
    run.vy -= P.gravity * dt;
    run.y += run.vy * dt;
    run.z += run.speed * 0.35 * dt;
    run.x = lerp(run.x, centerX(run.z), 2 * dt);
    const gy = terrainY(run.x, run.z) + r;
    boulder.position.set(run.x, run.y, run.z);
    boulder.rotation.x += dt * 3;
    if (run.y <= gy) {
      run.y = gy; run.vy = 0;
      run.state = "run";
      AudioFX.land(1);
      shake(1.2);
      puffDust(boulder.position, 120);
      burstDebris(boulder.position, env.ground.scale(0.8), 10, 10);
      $("hudState").textContent = "";
    }
    ensureChunks();
    return;
  }

  /* timers */
  run.jumpCd = Math.max(0, run.jumpCd - dt);
  run.grace = Math.max(0, run.grace - dt);
  if (run.comboT > 0) { run.comboT -= dt; if (run.comboT <= 0) run.combo = 0; }
  if (run.overdrive > 0) { run.overdrive -= dt; run.meter = CFG.balance.overdrive.meterMax * (run.overdrive / (CFG.balance.overdrive.duration * (1 + upBonus("overdrive")))); if (run.overdrive <= 0) endOverdrive(); }

  /* forward speed from slope */
  const s = slopeAt(run.z);
  run.speed += (P.slopeAccel * s - P.drag * run.speed * run.speed * 0.018 - 0.4) * dt;
  // speed cap ramps up with distance — the start stays calm and readable
  const speedCap = lerp(P.speedCapStart, P.maxSpeed, clamp(run.dist / P.speedCapRampDist, 0, 1));
  run.speed = clamp(run.speed, P.minSpeed, speedCap);

  /* steering with inertia; grip per biome */
  const steer = (input.axis || (input.left ? -1 : 0) + (input.right ? 1 : 0)) * SAVE.settings.sens;
  const grip = env.grip;
  const agility = clamp(run.speed / P.maxSpeed, P.lateralFloor, 1);
  run.vx += steer * P.steerAccel * (1 + upBonus("steer")) * grip * agility * dt;
  run.vx -= run.vx * P.steerFriction * grip * dt;
  run.vx = clamp(run.vx, -P.maxLateralSpeed * agility, P.maxLateralSpeed * agility);
  run.x += run.vx * dt;
  run.z += run.speed * dt;
  run.dist = run.z - run.startZ;
  run.score += run.speed * dt * CFG.balance.scoring.distancePointsPerMeter;

  /* gaps + vertical */
  const gap = gapAtZ(run.z);
  const gy = terrainY(run.x, run.z) + r;
  run.vy -= P.gravity * dt;
  run.y += run.vy * dt;

  if (!gap && run.y <= gy) {
    if (run.airborne && run.vy < -6) { AudioFX.land(clamp(-run.vy / 25, 0, 1)); puffDust(new BABYLON.Vector3(run.x, gy - r, run.z), 18); shake(clamp(-run.vy * 0.02, 0, 0.5)); }
    // gap-clear bonus
    if (run.inGapAir) {
      run.inGapAir = false; run.gapsCleared++;
      addScore(CFG.balance.scoring.gapClearBonus, boulder.position, "CREVASSE!", "bonus");
      AudioFX.nearmiss();
    }
    run.y = gy; run.vy = 0;
    run.airborne = false; run.coyote = P.coyoteTime;
  } else {
    run.coyote = Math.max(0, run.coyote - dt);
    run.airborne = true;
    if (gap) {
      run.inGapAir = true;
      if (run.y < gy - P.fallDeathDepth) { endRun("Fell into a crevasse"); return; }
    }
  }

  /* jump */
  if (input.jump) {
    input.jump = false;
    if ((!run.airborne || run.coyote > 0) && run.jumpCd <= 0) {
      run.vy = P.jumpPower * (1 + upBonus("jump"));
      run.jumpCd = P.jumpCooldown; run.coyote = 0; run.airborne = true;
      AudioFX.jump();
    }
  }

  /* canyon walls */
  const dx = run.x - centerX(run.z);
  const limit = T.halfWidth - r * 0.4;
  if (Math.abs(dx) > limit + 4) { endRun("Left the track"); return; }
  if (Math.abs(dx) > limit) {
    if (run.airborne && run.y > terrainY(run.x, run.z) + 7) { endRun("Flew over the canyon wall"); return; }
    const sgn = Math.sign(dx);
    run.x = centerX(run.z) + sgn * limit;
    run.vx = -sgn * Math.max(Math.abs(run.vx) * 0.55, P.wallBounceKick);
    run.speed *= P.wallBouncePenalty;
    AudioFX.scrape();
    shake(0.45);
    puffDust(new BABYLON.Vector3(run.x + sgn * r, run.y, run.z), 16);
  }

  /* boulder transform: rolling proportional to distance */
  boulder.position.set(run.x, run.y, run.z);
  run.rollAngle += (run.speed * dt) / r;
  boulder.rotation.set(run.rollAngle, 0, -run.vx * 0.04);

  /* trail intensity by speed */
  trailPS.emitRate = run.speed > 26 && !run.airborne ? (run.speed - 24) * 7 : 0;
  if (SAVE.settings.quality === "low") trailPS.emitRate *= 0.4;

  collide(dt, env);
  magnet(dt);
  ensureChunks();
}

function collide(dt, env) {
  const r = CFG.balance.physics.boulderRadius;
  const bp = boulder.position;

  /* destructibles */
  for (let i = run.objects.length - 1; i >= 0; i--) {
    const o = run.objects[i];
    if (!o.metadata.alive) continue;
    const dz = o.position.z - bp.z;
    if (dz < -6 || dz > 6) continue;
    const dx = o.position.x - bp.x, dy = o.position.y - bp.y;
    if (dx * dx + dz * dz < Math.pow(r + o.metadata.radius, 2) && Math.abs(dy) < 3.5 + r) smashObject(o);
  }

  /* hazards */
  const NM = CFG.balance.scoring;
  for (let i = run.hazards.length - 1; i >= 0; i--) {
    const h = run.hazards[i];
    const md = h.metadata;
    if (md.dead) continue;
    if (md.ring) {
      const pl = 1 + 0.16 * Math.sin(performance.now() * 0.009 + h.position.z);
      md.ring.scaling.set(pl, 1, pl);
    }
    if (md.type === "roller") {
      h.position.x += md.dir * CFG.balance.hazards.rollerSpeed * dt;
      const rel = h.position.x - centerX(h.position.z);
      if (Math.abs(rel) > T.halfWidth * 0.85) md.dir *= -1;
      h.position.y = terrainY(h.position.x, h.position.z);
      h.getChildMeshes()[0].rotation.z -= md.dir * dt * 3;
    }
    if (md.type === "mine") {
      const lamp = h.getChildMeshes().find((m) => m.name === "l");
      if (lamp) lamp.scaling.setAll(1 + 0.55 * Math.sin(performance.now() * 0.012));
    }
    const dz = h.position.z - bp.z;
    if (dz < -8) {
      if (!md.passed) {
        md.passed = true;
        const lateral = Math.abs(h.position.x - bp.x);
        if (lateral < NM.nearMissRadius + md.radius && lateral > md.radius * 0.6) {
          run.nearMisses++;
          addScore(NM.nearMissBonus, bp, "CLOSE!", "bonus");
          AudioFX.nearmiss();
        }
      }
      continue;
    }
    if (dz > 8) continue;
    const dx = h.position.x - bp.x;
    const hitR = r + md.radius * 0.8;
    const overTop = bp.y - terrainY(bp.x, bp.z) - r > (md.type === "roller" ? 3.4 : 2.0);
    if (dx * dx + dz * dz < hitR * hitR && !overTop) {
      if (run.overdrive > 0) { smashHazard(h); continue; }
      if (run.grace > 0) continue;
      if (md.type === "mine" && run.buffs.dudMines) {
        md.dead = true; h.getChildMeshes().forEach((m) => m.setEnabled(false));
        addScore(50, h.position, "DUD", "bonus");
        puffDust(h.position, 14);
        continue;
      }
      if (md.type === "mine") { AudioFX.explosion(); burstDebris(h.position, hex3("#7a2a1a"), 16, 14); }
      endRun(md.type === "mine" ? "Mine explosion" : md.type === "roller" ? "Hit by a rolling boulder" : "Spikes");
      return;
    }
  }

  /* pickups */
  for (let i = run.pickups.length - 1; i >= 0; i--) {
    const p = run.pickups[i];
    if (p.metadata.taken) continue;
    p.getChildMeshes()[0].rotation.y += dt * 3;
    const dz = p.position.z - bp.z;
    if (dz < -4 || dz > 4) continue;
    const dx = p.position.x - bp.x;
    if (dx * dx + dz * dz < Math.pow(r + p.metadata.radius, 2)) {
      p.metadata.taken = true;
      p.getChildMeshes().forEach((m) => m.setEnabled(false));
      if (p.metadata.kind === "coin") { run.coins++; AudioFX.coin(); popScore(p.position, "+1", "big"); chargeMeter(1); }
      else { run.gems++; AudioFX.gem(); popScore(p.position, "+1 💎", "bonus"); }
    }
  }
}

function magnet(dt) {
  const range = upBonus("magnet") + (run.buffs.coinMagnet ? 5 : 0);
  if (range <= 0) return;
  const bp = boulder.position;
  for (const p of run.pickups) {
    if (p.metadata.taken || p.metadata.kind !== "coin") continue;
    const d = BABYLON.Vector3.Distance(p.position, bp);
    if (d < range + 2 && d > 0.1) {
      const dir = bp.subtract(p.position).normalize();
      p.position.addInPlace(dir.scale(dt * 16));
    }
  }
}

/* ---------- environment lerp each frame ---------- */
function updateEnvironment() {
  const env = blendedEnv(Math.max(0, run.dist));
  scene.fogColor = env.fog;
  scene.fogDensity = env.fogDensity;
  scene.clearColor = new BABYLON.Color4(env.sky.r, env.sky.g, env.sky.b, 1);
  sun.diffuse = env.sun;
  hemi.diffuse = env.ambient;
  hemi.groundColor = env.ground.scale(0.5);
  $("hudBiome").textContent = env.label;
}

/* ---------- HUD ---------- */
function updateHUD(force) {
  $("hudScore").textContent = fmt(run.score);
  $("hudDist").textContent = fmt(run.dist) + " m";
  $("hudCoins").textContent = fmt(run.coins);
  $("hudGems").textContent = fmt(run.gems);
  $("hudCombo").textContent = run.combo > 1 ? "COMBO ×" + comboMult().toFixed(2) : "";
  const pct = (run.meter / CFG.balance.overdrive.meterMax) * 100;
  $("meterFill").style.width = pct + "%";
  document.querySelector(".meter").classList.toggle("full", run.overdrive > 0);
  if (run.overdrive > 0) $("hudState").textContent = "OVERDRIVE " + run.overdrive.toFixed(1) + "s";
  else if (run.grace > 0) $("hudState").textContent = "INVULNERABLE";
  else if (run.state === "intro") $("hudState").textContent = "FREE FALL";
  else $("hudState").textContent = "";
  const act = activeGoals();
  if (act.length) {
    const i = Math.floor(performance.now() / 4000) % act.length;
    const g = act[i];
    $("hudGoal").textContent = "Goal " + (i + 1) + "/" + act.length + ": " + g.label +
      " — " + fmt(Math.min(goalProgress(g), g.target)) + "/" + fmt(g.target);
  } else $("hudGoal").textContent = "All goals complete!";
}

/* ---------- main loop ---------- */
let lastHud = 0;
function tick() {
  const dt = Math.min(engine.getDeltaTime() / 1000, 1 / 20); // clamp slow frames
  if (!run.paused && (run.state === "run" || run.state === "intro")) {
    updateRun(dt);
    updateDebris(dt);
    updatePopups(dt);
    updateCamera(dt);
    updateEnvironment();
    lastHud += dt;
    if (lastHud > 0.07) { updateHUD(); lastHud = 0; }
  } else if (run.state === "over") {
    updateDebris(dt); updatePopups(dt); updateCamera(dt);
  }
  scene.render();
}

/* =========================================================================
   GOALS — up to 5 concurrently active goals
   ========================================================================= */
const ACTIVE_GOALS = 5;
function activeGoals() {
  const out = [];
  for (const g of CFG.goals.goals) {
    if (SAVE.goalsDone.includes(g.id)) continue;
    out.push(g);
    if (out.length >= ACTIVE_GOALS) break;
  }
  return out;
}
function goalProgress(g) {
  switch (g.type) {
    case "runDistance": return run.dist;
    case "runScore": return run.score;
    case "runSmash": return run.smashed;
    case "runGaps": return run.gapsCleared;
    case "runOverdrive": return run.overdrives;
    case "runCombo": return run.maxCombo;
    case "runNearMiss": return run.nearMisses;
    case "totalCoins": return SAVE.stats.totalCoins;
    case "totalSmash": return SAVE.stats.smashed;
    case "totalGaps": return SAVE.stats.gaps;
    case "totalOverdrive": return SAVE.stats.overdrives;
    case "totalRuns": return SAVE.stats.runs;
    case "totalDist": return SAVE.stats.totalDist || 0;
    default: return 0;
  }
}
function checkGoals() {
  let msg = "", changed = true;
  while (changed) {
    changed = false;
    for (const g of activeGoals()) {
      if (goalProgress(g) >= g.target) {
        SAVE.coins += g.coins; SAVE.gems += g.gems;
        SAVE.goalsDone.push(g.id);
        if (g.unlock && !SAVE.skins.includes(g.unlock)) SAVE.skins.push(g.unlock);
        msg += "✔ Goal complete: " + g.label + " (+" + g.coins + " coins" + (g.gems ? ", +" + g.gems + " 💎" : "") + (g.unlock ? ", new skin!" : "") + ")\n";
        changed = true;
        break; // active set shifted — recompute
      }
    }
  }
  return msg;
}

/* =========================================================================
   UI — overlays, menus, meta
   ========================================================================= */
function hideAll() {
  ["ovStart", "ovEnd", "ovPause", "ovUpgrades", "ovSpinner", "ovGoals", "ovSettings"].forEach((id) => $(id).classList.add("hidden"));
}
function showMenu() {
  hideAll();
  run.state = "menu"; run.active = false; run.paused = false;
  $("hud").classList.add("hidden");
  $("joystick").classList.add("hidden"); $("btnJump").classList.add("hidden");
  $("menuCoins").textContent = fmt(SAVE.coins);
  $("menuGems").textContent = fmt(SAVE.gems);
  $("startStats").innerHTML =
    "Best distance: <b>" + fmt(SAVE.stats.bestDist) + " m</b> · Best score: <b>" + fmt(SAVE.stats.bestScore) + "</b><br>" +
    "Runs: " + fmt(SAVE.stats.runs) + " · Objects smashed: " + fmt(SAVE.stats.smashed) +
    " · Overdrives: " + fmt(SAVE.stats.overdrives) + " · Crevasses cleared: " + fmt(SAVE.stats.gaps);
  renderSkins();
  $("ovStart").classList.remove("hidden");
}
function renderSkins() {
  const row = $("skinRow"); row.innerHTML = "";
  for (const s of CFG.goals.skins) {
    const owned = SAVE.skins.includes(s.id);
    const d = document.createElement("button");
    d.className = "skin" + (SAVE.activeSkin === s.id ? " active" : "") + (owned ? "" : " locked");
    d.style.background = "radial-gradient(circle at 32% 28%, #fff8, " + s.color + " 45%, #0008)";
    d.title = s.label + (owned ? "" : " (locked — goal reward)");
    d.onclick = () => {
      if (!owned) return;
      AudioFX.click();
      SAVE.activeSkin = s.id; persistSave(); applySkin(); renderSkins();
    };
    row.appendChild(d);
  }
}

function showEndOverlay(coinGain, newBest, goalMsg, reason) {
  $("hud").classList.add("hidden");
  $("joystick").classList.add("hidden"); $("btnJump").classList.add("hidden");
  $("endTitle").textContent = "RUN OVER — " + reason;
  $("endDist").textContent = fmt(run.dist) + " m";
  $("endScore").textContent = fmt(run.score);
  $("endCoins").textContent = "+" + fmt(coinGain);
  $("endGems").textContent = "+" + fmt(run.gems);
  $("endBest").classList.toggle("hidden", !newBest);
  const eg = $("endGoal");
  if (goalMsg) { eg.textContent = goalMsg; eg.classList.remove("hidden"); } else eg.classList.add("hidden");
  const hs = SAVE.highscores.map((h, i) => (i + 1) + ". <b>" + fmt(h.score) + "</b> · " + fmt(h.dist) + " m · " + h.date).join("<br>");
  $("hsTable").innerHTML = hs ? "<b>Best runs</b><br>" + hs : "";
  const M = CFG.balance.meta;
  const cost = M.continueBaseCost + M.continueCostStep * run.continuesUsed;
  const can = run.continuesUsed < M.continueMaxPerRun && SAVE.gems >= cost;
  const btn = $("btnContinue");
  btn.disabled = !can;
  btn.textContent = run.continuesUsed >= M.continueMaxPerRun
    ? "NO CONTINUES LEFT"
    : "CONTINUE (" + cost + " 💎)";
  $("ovEnd").classList.remove("hidden");
}

function renderUpgrades() {
  $("upCoins").textContent = fmt(SAVE.coins);
  const list = $("upList"); list.innerHTML = "";
  for (const u of CFG.upgrades.upgrades) {
    const lvl = upLevel(u.id);
    const cost = Math.floor(u.baseCost * Math.pow(u.costMult, lvl));
    const maxed = lvl >= u.maxLevel;
    const row = document.createElement("div"); row.className = "up-row";
    row.innerHTML = "<div class='up-info'><b>" + u.label + "</b><span>" + u.desc + "</span></div>" +
      "<div class='up-lvl'>lvl " + lvl + "/" + u.maxLevel + "</div>";
    const btn = document.createElement("button");
    btn.className = "buy-btn";
    btn.textContent = maxed ? "MAX" : cost + " 🪙";
    btn.disabled = maxed || SAVE.coins < cost;
    btn.onclick = () => {
      AudioFX.click();
      if (SAVE.coins >= cost && !maxed) {
        SAVE.coins -= cost;
        SAVE.upgrades[u.id] = lvl + 1;
        persistSave(); renderUpgrades();
      }
    };
    row.appendChild(btn);
    list.appendChild(row);
  }
}

function renderGoals() {
  const list = $("goalList"); list.innerHTML = "";
  const act = activeGoals().map((g) => g.id);
  CFG.goals.goals.forEach((g) => {
    const done = SAVE.goalsDone.includes(g.id);
    const active = act.includes(g.id);
    const row = document.createElement("div");
    row.className = "goal-row" + (done ? " done" : active ? " current" : " locked");
    const prog = done ? g.target : active ? Math.min(goalProgress(g), g.target) : 0;
    row.innerHTML = "<div class='up-info'><b>" + (done ? "✔ " : active ? "▶ " : "🔒 ") + g.label + "</b>" +
      "<span>+" + g.coins + " coins" + (g.gems ? " · +" + g.gems + " 💎" : "") + (g.unlock ? " · skin" : "") + "</span></div>" +
      "<div class='goal-prog'>" + (active || done ? fmt(prog) + " / " + fmt(g.target) : "—") + "</div>";
    list.appendChild(row);
  });
}

/* spinner */
let spinning = false, spinAngle = 0;
function doSpin() {
  if (spinning) return;
  const cost = CFG.spinner.cost;
  if (SAVE.gems < cost) { $("spinResult").textContent = "Not enough gems."; return; }
  AudioFX.click();
  SAVE.gems -= cost; persistSave();
  $("spGems").textContent = fmt(SAVE.gems);
  const buffs = CFG.spinner.buffs;
  const totalW = buffs.reduce((s, b) => s + b.weight, 0);
  let w = Math.random() * totalW, pick = buffs[0], pi = 0;
  for (let i = 0; i < buffs.length; i++) { w -= buffs[i].weight; if (w <= 0) { pick = buffs[i]; pi = i; break; } }
  spinning = true;
  spinAngle += 360 * 4 + (360 / buffs.length) * pi + rand(-18, 18);
  $("spinDisc").style.transform = "rotate(" + spinAngle + "deg)";
  $("spinResult").textContent = "…";
  setTimeout(() => {
    spinning = false;
    applyBuff(pick);
    $("spinResult").textContent = "🎁 " + pick.label + " — " + pick.desc;
    AudioFX.gem();
    persistSave();
    $("spGems").textContent = fmt(SAVE.gems);
  }, 2700);
}
function applyBuff(b) {
  if (b.id === "jackpot") {
    SAVE.coins += 25; SAVE.gems += 5;
    run.buffs = { fewerHazards: 1, coinMagnet: 1, gemRate: 1, dudMines: 1, fastMeter: 1, headStart: 1 };
  } else run.buffs[b.id] = 1;
}

/* settings */
function bindSettings() {
  const st = SAVE.settings;
  $("setSens").value = st.sens; $("setVol").value = st.volume;
  $("setMusic").checked = st.music; $("setQuality").value = st.quality;
  $("setGyro").checked = st.gyro; $("setMotion").checked = st.reducedMotion;
  $("setSens").oninput = (e) => { st.sens = +e.target.value; persistSave(); };
  $("setVol").oninput = (e) => { st.volume = +e.target.value; AudioFX.ensure(); AudioFX.setVolume(st.volume); persistSave(); };
  $("setMusic").onchange = (e) => { st.music = e.target.checked; persistSave(); if (!st.music) AudioFX.stopMusic(); else { AudioFX.ensure(); AudioFX.startMusic(); } };
  $("setQuality").onchange = (e) => { st.quality = e.target.value; persistSave(); applyQuality(); };
  $("setGyro").onchange = (e) => {
    st.gyro = e.target.checked; st.gyroTouched = true; persistSave();
    if (st.gyro && typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission) {
      DeviceOrientationEvent.requestPermission().catch(() => {});
    }
  };
  $("setMotion").onchange = (e) => { st.reducedMotion = e.target.checked; persistSave(); };
}

/* export / import */
function exportSave() {
  AudioFX.click();
  const blob = new Blob([JSON.stringify(SAVE, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "rockfall-save.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importSave(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const s = JSON.parse(rd.result);
      if (!validateSave(s)) throw new Error("Invalid save format.");
      SAVE = Object.assign(defaultSave(), s,
        { stats: Object.assign(defaultSave().stats, s.stats || {}),
          settings: Object.assign(defaultSave().settings, s.settings || {}) });
      persistSave(); bindSettings(); applySkin(); showMenu();
      alert("Save imported. ✔");
    } catch (e) { alert("Import failed: " + e.message); }
  };
  rd.readAsText(file);
}

/* pause */
function setPause(p) {
  if (run.state !== "run" && run.state !== "intro") return;
  run.paused = p;
  $("ovPause").classList.toggle("hidden", !p);
  if (p) AudioFX.suspend(); else { AudioFX.resume(); }
}

/* =========================================================================
   CONTROLS
   ========================================================================= */
function bindControls() {
  window.addEventListener("keydown", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") input.left = true;
    if (e.code === "ArrowRight" || e.code === "KeyD") input.right = true;
    if (e.code === "Space") { input.jump = true; e.preventDefault(); }
    if (e.code === "Escape") setPause(!run.paused);
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") input.left = false;
    if (e.code === "ArrowRight" || e.code === "KeyD") input.right = false;
  });

  /* virtual joystick */
  const joy = $("joystick"), knob = $("joyKnob"), base = $("joyBase");
  let joyId = null, cx0 = 0;
  joy.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0]; joyId = t.identifier; input.joyActive = true;
    const r = base.getBoundingClientRect(); cx0 = r.left + r.width / 2;
    e.preventDefault();
  }, { passive: false });
  joy.addEventListener("touchmove", (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      const dx = clamp((t.clientX - cx0) / 50, -1, 1);
      input.axis = dx;
      knob.style.transform = "translate(calc(-50% + " + dx * 36 + "px), -50%)";
    }
    e.preventDefault();
  }, { passive: false });
  const joyEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      joyId = null; input.axis = 0; input.joyActive = false;
      knob.style.transform = "translate(-50%, -50%)";
    }
  };
  joy.addEventListener("touchend", joyEnd); joy.addEventListener("touchcancel", joyEnd);
  $("btnJump").addEventListener("touchstart", (e) => { input.jump = true; e.preventDefault(); }, { passive: false });

  /* gyro */
  window.addEventListener("deviceorientation", (e) => {
    if (!SAVE.settings.gyro || e.gamma == null || input.joyActive) return;
    input.axis = clamp(e.gamma / 28, -1, 1);
  });
}

/* =========================================================================
   UI WIRING + BOOT
   ========================================================================= */
function bindUI() {
  const click = (id, fn) => $(id).addEventListener("click", () => { AudioFX.ensure(); AudioFX.resume(); AudioFX.click(); fn(); });
  click("btnPlay", () => startRun(false));
  click("btnUpgrades", () => { hideAll(); renderUpgrades(); $("ovUpgrades").classList.remove("hidden"); });
  click("btnUpBack", showMenu);
  click("btnSpinner", () => { hideAll(); $("spGems").textContent = fmt(SAVE.gems); $("spCost").textContent = CFG.spinner.cost; $("spinResult").textContent = "A buff applies to your next run."; $("ovSpinner").classList.remove("hidden"); });
  click("btnSpin", doSpin);
  click("btnSpBack", showMenu);
  click("btnGoals", () => { hideAll(); renderGoals(); $("ovGoals").classList.remove("hidden"); });
  click("btnGoalBack", showMenu);
  click("btnSettings", () => { hideAll(); $("ovSettings").classList.remove("hidden"); });
  click("btnSetBack", showMenu);
  click("btnExport", exportSave);
  click("btnImport", () => $("fileImport").click());
  $("fileImport").addEventListener("change", (e) => { if (e.target.files[0]) importSave(e.target.files[0]); e.target.value = ""; });
  click("btnPause", () => setPause(true));
  click("btnResume", () => setPause(false));
  click("btnRestart", () => { setPause(false); run.buffs = {}; startRun(false); });
  click("btnQuitMenu", () => { run.paused = false; showMenu(); });
  click("btnNewRun", () => { run.buffs = {}; startRun(false); $("ovEnd").classList.add("hidden"); });
  click("btnMenu", () => { run.buffs = {}; showMenu(); });
  click("btnContinue", () => {
    const M = CFG.balance.meta;
    const cost = M.continueBaseCost + M.continueCostStep * run.continuesUsed;
    if (SAVE.gems < cost || run.continuesUsed >= M.continueMaxPerRun) return;
    SAVE.gems -= cost; run.continuesUsed++;
    persistSave();
    $("ovEnd").classList.add("hidden");
    startRun(true);
  });
}

async function boot() {
  try {
    loadSave();
    if (isMobile && !SAVE.settings.gyroTouched) SAVE.settings.gyro = true;
    CFG = await loadConfig();
    T = CFG.balance.terrain;
    GP = CFG.balance.gaps;
    initEngine();
    prepBiomes();
    buildBiomeMaterials();
    buildRockTemplates();
    buildBoulder();
    buildDebrisPool();
    buildDust();
    bindUI();
    bindSettings();
    bindControls();
    // idle backdrop behind menu
    run.z = 30; run.x = centerX(30); run.y = terrainY(run.x, 30) + 40;
    ensureChunks();
    camera.position.set(run.x + 10, terrainY(run.x, 10) + 16, 6);
    camera.setTarget(new BABYLON.Vector3(centerX(70), terrainY(centerX(70), 70), 70));
    updateEnvironment();
    showMenu();
    engine.runRenderLoop(tick);
    window.__rfBooted = true;
  } catch (e) {
    fatal(e.message || e);
  }
}
boot();
