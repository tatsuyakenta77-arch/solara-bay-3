// Meridian Heat — original open-world crime game for Port Meridian.
// Single-file game logic (fresh implementation): world, driving, police,
// missions, combat, HUD/minimap, synth audio, particles, save, staged shots.
import * as THREE from 'three';
import { CFG, MISSIONS, clamp, dist2d, angleLerp, mulberry32 } from './config.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'meridianHeatSaveV2';
const params = new URLSearchParams(location.search);

// ---------- state ----------
const W = {
  started: false, paused: false, running: false, muted: false,
  cash: CFG.startCash, health: CFG.maxHealth, ammo: CFG.startAmmo,
  wanted: 0, wantedTimer: 0, missionIndex: 0, missionStep: 0, missionsDone: 0,
  missionState: 'idle', camYaw: Math.PI, camPitch: 0.32, bustedTimer: 0,
  time: 0, traffic: [], parkedCars: [], peds: [], cops: [], enemies: [],
  particles: [], bullets: [], buildings: [], msgTimer: 0,
};
window.__MH = W;

// ---------- audio (all synthesized, no files) ----------
let AC = null, engineOsc = null, engineGain = null, sirenOsc = null, sirenGain = null, bassTimer = null;
function audioInit() {
  if (AC) return;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    engineOsc = AC.createOscillator(); engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 55;
    engineGain = AC.createGain(); engineGain.gain.value = 0.0;
    engineOsc.connect(engineGain); engineGain.connect(AC.destination); engineOsc.start();
    sirenOsc = AC.createOscillator(); sirenOsc.type = 'triangle'; sirenOsc.frequency.value = 700;
    sirenGain = AC.createGain(); sirenGain.gain.value = 0.0;
    sirenOsc.connect(sirenGain); sirenGain.connect(AC.destination); sirenOsc.start();
    // low bass loop
    const notes = [55, 55, 65.4, 49];
    let i = 0;
    bassTimer = setInterval(() => {
      if (!AC || W.muted || !W.started) return;
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = 'square'; o.frequency.value = notes[i++ % notes.length];
      g.gain.setValueAtTime(0.05, AC.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.42);
      o.connect(g); g.connect(AC.destination); o.start(); o.stop(AC.currentTime + 0.45);
    }, 450);
  } catch (e) { AC = null; }
}
function beep(freq, dur, type, vol) {
  if (!AC || W.muted) return;
  try {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.15, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
    o.connect(g); g.connect(AC.destination); o.start(); o.stop(AC.currentTime + dur);
  } catch (e) {}
}
function noiseBurst(dur, vol) {
  if (!AC || W.muted) return;
  try {
    const len = Math.floor(AC.sampleRate * dur), buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = AC.createBufferSource(), g = AC.createGain();
    s.buffer = buf; g.gain.value = vol || 0.25; s.connect(g); g.connect(AC.destination); s.start();
  } catch (e) {}
}
const sfx = {
  shoot() { noiseBurst(0.12, 0.3); beep(180, 0.08, 'square', 0.12); },
  punch() { noiseBurst(0.08, 0.2); },
  pickup() { beep(880, 0.12, 'sine', 0.2); setTimeout(() => beep(1320, 0.18, 'sine', 0.2), 90); },
  cash() { [660, 880, 1100].forEach((f, i) => setTimeout(() => beep(f, 0.15, 'sine', 0.2), i * 90)); },
  mission() { [440, 554, 659, 880].forEach((f, i) => setTimeout(() => beep(f, 0.2, 'triangle', 0.18), i * 110)); },
  crash() { noiseBurst(0.25, 0.35); },
  busted() { [392, 311, 233].forEach((f, i) => setTimeout(() => beep(f, 0.3, 'sawtooth', 0.15), i * 160)); },
  explode() { noiseBurst(0.6, 0.45); beep(60, 0.5, 'sine', 0.3); },
};

// ---------- three setup ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
$('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5d6);
scene.fog = new THREE.Fog(0x9db8c8, 120, 420);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 900);
camera.position.set(0, 8, 30);
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x3a5a3a, 0.95));
const sun = new THREE.DirectionalLight(0xfff2cc, 1.6);
sun.position.set(120, 180, 60); scene.add(sun);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- helpers ----------
function box(w, h, d, color, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z); (parent || scene).add(m); return m;
}
function windowTexture(seed) {
  const rnd = mulberry32(seed), c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d'); g.fillStyle = '#2b3542'; g.fillRect(0, 0, 64, 128);
  for (let y = 6; y < 122; y += 12) for (let x = 6; x < 58; x += 12) {
    g.fillStyle = rnd() < 0.45 ? '#ffd76a' : (rnd() < 0.5 ? '#9fd8ff' : '#1a2230');
    g.fillRect(x, y, 8, 7);
  }
  const t = new THREE.CanvasTexture(c); return t;
}

// ---------- world ----------
const ROAD_LINES = [];
for (let i = -CFG.blocks; i <= CFG.blocks; i++) ROAD_LINES.push(i * CFG.pitch);
function buildWorld() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(CFG.groundSize, CFG.groundSize),
    new THREE.MeshLambertMaterial({ color: 0x3f6b3a }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  // roads
  for (const v of ROAD_LINES) {
    const r1 = new THREE.Mesh(new THREE.PlaneGeometry(CFG.groundSize, CFG.road), new THREE.MeshLambertMaterial({ color: 0x2c2f36 }));
    r1.rotation.x = -Math.PI / 2; r1.position.set(0, 0.02, v); scene.add(r1);
    const r2 = new THREE.Mesh(new THREE.PlaneGeometry(CFG.road, CFG.groundSize), new THREE.MeshLambertMaterial({ color: 0x2c2f36 }));
    r2.rotation.x = -Math.PI / 2; r2.position.set(v, 0.02, 0); scene.add(r2);
    // centre dashes
    for (let d = -200; d <= 200; d += 16) {
      box(0.6, 0.05, 3, 0xd8d8d8, d, 0.04, v); box(3, 0.05, 0.6, 0xd8d8d8, v, 0.04, d);
    }
  }
  // marina / beach south (z > 190): water, sand, pier, boats
  const water = new THREE.Mesh(new THREE.PlaneGeometry(460, 90), new THREE.MeshLambertMaterial({ color: 0x1e6f8e }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, 0.03, 235); scene.add(water);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(460, 22), new THREE.MeshLambertMaterial({ color: 0xd8c28a }));
  sand.rotation.x = -Math.PI / 2; sand.position.set(0, 0.04, 182); scene.add(sand);
  box(6, 0.6, 46, 0x8a6b45, -40, 0.3, 215); // pier
  for (let i = 0; i < 5; i++) {
    const bx = -120 + i * 55, bz = 222 + (i % 2) * 12;
    const hull = box(7, 2, 3, [0xffffff, 0xff5533, 0x33aaff, 0xffcc00, 0x88ff88][i], bx, 0.8, bz);
    hull.rotation.y = 0.2 * i; box(0.4, 5, 0.4, 0x663311, bx, 4, bz);
  }
  // buildings: one tower per block cell, skip plaza (0,0 cell), garage corner, marina
  let seed = 11;
  // buildings sit at BLOCK centres (offset half a pitch from the road lines)
  for (let gx = -3; gx <= 2; gx++) for (let gz = -3; gz <= 2; gz++) {
    const cx = gx * CFG.pitch + CFG.pitch / 2, cz = gz * CFG.pitch + CFG.pitch / 2;
    if (Math.abs(cx) < 42 && Math.abs(cz) < 42) continue; // central plaza
    if (cz > 160) continue; // marina
    if (Math.abs(cx + 116) < 34 && Math.abs(cz + 58) < 34) continue; // garage lot
    const rnd = mulberry32(seed++);
    const w = 18 + rnd() * 14, d = 18 + rnd() * 14, h = 14 + rnd() * 42;
    const tex = windowTexture(seed * 7 + 3);
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color: [0x8a7f72, 0x6a7a8a, 0x9a8a6a, 0x7a6a8a, 0x5a6a7a][seed % 5], map: tex }));
    b.position.set(cx + (rnd() - 0.5) * 6, h / 2, cz + (rnd() - 0.5) * 6); scene.add(b);
    W.buildings.push({ x: b.position.x, z: b.position.z, hw: w / 2 + 1, hd: d / 2 + 1 });
    // rooftop box
    box(w * 0.3, 2, d * 0.3, 0x444444, b.position.x, h + 1, b.position.z);
  }
  // plaza: fountain + benches at centre
  const f = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, 1.2, 20), new THREE.MeshLambertMaterial({ color: 0x9aa0a8 }));
  f.position.set(0, 0.6, 0); scene.add(f);
  const fw = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 0.4, 20), new THREE.MeshLambertMaterial({ color: 0x3fa8d8 }));
  fw.position.set(0, 1.2, 0); scene.add(fw);
  // lamps + trees along roads
  for (let i = 0; i < 40; i++) {
    const rnd = mulberry32(100 + i);
    const x = ROAD_LINES[Math.floor(rnd() * ROAD_LINES.length)] + 9, z = -180 + rnd() * 360;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 6), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    pole.position.set(x, 2.5, z); scene.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
    lamp.position.set(x, 5.1, z); scene.add(lamp);
  }
  for (let i = 0; i < 26; i++) {
    const rnd = mulberry32(300 + i);
    const x = -170 + rnd() * 340, z = -170 + rnd() * 330;
    if (Math.abs(x % CFG.pitch) < 9 || Math.abs(z % CFG.pitch) < 9) continue;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2.5, 6), new THREE.MeshLambertMaterial({ color: 0x6b4a2a }));
    trunk.position.set(x, 1.25, z); scene.add(trunk);
    const top = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 8), new THREE.MeshLambertMaterial({ color: 0x2f7a33 }));
    top.position.set(x, 4, z); scene.add(top);
  }
}

// ---------- cars ----------
function makeCar(color, opts = {}) {
  const g = new THREE.Group();
  const body = box(2.1, 0.65, 4.4, color, 0, 0.55, 0, g);
  box(1.8, 0.55, 2.2, 0x1c2733, 0, 1.1, -0.2, g); // cabin
  box(2.14, 0.18, 0.9, 0x111111, 0, 0.75, 2.0, g); // front grille area
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 12);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const wheels = [];
  for (const [wx, wz] of [[-1.0, 1.45], [1.0, 1.45], [-1.0, -1.45], [1.0, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat); w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.42, wz); g.add(w); wheels.push(w);
  }
  // headlights
  box(0.35, 0.15, 0.1, 0xfff6b0, -0.7, 0.6, 2.22, g); box(0.35, 0.15, 0.1, 0xfff6b0, 0.7, 0.6, 2.22, g);
  g.position.set(opts.x || 0, 0, opts.z || 0);
  g.rotation.y = opts.heading || 0;
  scene.add(g);
  const car = { group: g, body, wheels, color, heading: opts.heading || 0, speed: 0,
    parked: !!opts.parked, isPlayer: false, isCop: !!opts.cop, health: 100, smoke: 0 };
  return car;
}
function collideBuildings(x, z, r) {
  for (const b of W.buildings) {
    if (Math.abs(x - b.x) < b.hw + r && Math.abs(z - b.z) < b.hd + r) return b;
  }
  return null;
}
function clampToCity(x, z) {
  return [clamp(x, -225, 225), clamp(z, -225, 258)];
}

// ---------- player ----------
function makePerson(shirt, pants) {
  const g = new THREE.Group();
  box(0.7, 0.9, 0.4, shirt, 0, 1.05, 0, g); // torso
  box(0.3, 0.7, 0.32, pants, -0.18, 0.35, 0, g); box(0.3, 0.7, 0.32, pants, 0.18, 0.35, 0, g);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 10), new THREE.MeshLambertMaterial({ color: 0xe8b98a }));
  head.position.y = 1.75; g.add(head);
  box(0.56, 0.12, 0.56, 0x222222, 0, 1.95, 0, g); // hair cap
  scene.add(g); return g;
}
const player = {
  group: makePerson(0x2a6fd8, 0x222831), pos: new THREE.Vector3(-116, 0, -40),
  heading: 0, vy: 0, onGround: true, car: null, punchTimer: 0, hurtTimer: 0,
};
player.group.position.copy(player.pos);
W.player = player;

function nearestCar(maxD) {
  let best = null, bd = maxD;
  for (const c of [...W.parkedCars, ...W.traffic, W.starterCar, W.targetCoupe, ...W.cops].filter(Boolean)) {
    const d = dist2d(player.pos.x, player.pos.z, c.group.position.x, c.group.position.z);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
function enterCar(car) {
  if (!car) return;
  if (car.isCop) return;
  const wasParked = car.parked;
  car.parked = false; car.isPlayer = true; player.car = car;
  player.group.visible = false;
  W.traffic = W.traffic.filter((t) => t !== car);
  if (wasParked && car !== W.starterCar) { setWanted(W.wanted + 1); showMessage('CAR STOLEN — the PD noticed!', 2500); }
  if (car === W.targetCoupe) { setWanted(Math.max(W.wanted, 2)); showMessage("That's Mara's coupe — GO!", 2500); }
  sfx.pickup();
}
function exitCar() {
  const car = player.car; if (!car) return;
  car.isPlayer = false; player.car = null;
  player.pos.set(car.group.position.x + 2.5, 0, car.group.position.z + 1);
  player.group.position.copy(player.pos); player.group.visible = true;
  player.heading = car.heading;
}

// ---------- traffic & pedestrians ----------
function spawnTraffic() {
  const colors = [0xcc3333, 0x33aa55, 0xdddddd, 0x3355cc, 0xff8800, 0xaa33cc, 0x888888, 0x22cccc];
  for (let i = 0; i < 10; i++) {
    const road = ROAD_LINES[i % ROAD_LINES.length];
    const alongRoad = i % 2 === 0;
    const car = makeCar(colors[i % colors.length], {
      x: alongRoad ? -180 + i * 36 : road + 3.5, z: alongRoad ? road + 3.5 : -180 + i * 36,
      heading: alongRoad ? Math.PI / 2 : 0,
    });
    car.parked = false; car.trafficDir = alongRoad ? 'x' : 'z'; car.lane = road + 3.5;
    W.traffic.push(car);
  }
}
function spawnParked() {
  const spots = [[-110, -52, 0], [-104, -52, 0], [29, 29, 0], [58, 29, Math.PI / 2], [-58, 116, Math.PI], [116, 58, -Math.PI / 2], [0, 116, 0]];
  const colors = [0xffcc00, 0x2255cc, 0xcc3333, 0xeeeeee, 0x33aa55, 0xff6600, 0x8833aa];
  spots.forEach(([x, z, h], i) => {
    const c = makeCar(colors[i], { x, z, heading: h, parked: true });
    W.parkedCars.push(c);
  });
  W.targetCoupe = W.parkedCars[0]; // yellow coupe in the plaza area
  W.starterCar = makeCar(0xdd2222, { x: -116, z: -46, heading: Math.PI / 2, parked: true });
  W.parkedCars.push(W.starterCar);
}
function spawnPeds() {
  for (let i = 0; i < 14; i++) {
    const rnd = mulberry32(900 + i);
    const g = makePerson([0xff8800, 0x33cc88, 0xcc44aa, 0xeeeeee, 0x4488ff][i % 5], 0x333333);
    const p = { group: g, x: -150 + rnd() * 300, z: -150 + rnd() * 300, heading: rnd() * Math.PI * 2,
      speed: 1.2 + rnd() * 1.2, alive: true, timer: 2 + rnd() * 3 };
    g.position.set(p.x, 0, p.z); W.peds.push(p);
  }
}
function updatePeds(dt) {
  for (const p of W.peds) {
    if (!p.alive) continue;
    p.timer -= dt;
    if (p.timer <= 0) { p.heading = Math.random() * Math.PI * 2; p.timer = 2 + Math.random() * 4; }
    // flee from player car
    const px = player.car ? player.car.group.position.x : player.pos.x;
    const pz = player.car ? player.car.group.position.z : player.pos.z;
    const d = dist2d(p.x, p.z, px, pz);
    if (d < 12 && player.car) p.heading = Math.atan2(p.x - px, p.z - pz);
    p.x += Math.sin(p.heading) * p.speed * dt; p.z += Math.cos(p.heading) * p.speed * dt;
    [p.x, p.z] = clampToCity(p.x, p.z);
    if (collideBuildings(p.x, p.z, 1)) { p.heading += Math.PI / 2; }
    p.group.position.set(p.x, 0, p.z); p.group.rotation.y = p.heading;
    // run over by player car
    if (player.car && d < 2.2) {
      p.alive = false; p.group.rotation.x = Math.PI / 2; p.group.position.y = 0.4;
      setWanted(W.wanted + 1); showMessage('PEDESTRIAN HIT — wanted level up!', 2500);
      burst(p.x, 1, p.z, 0xcc0000, 12); sfx.crash();
    }
  }
}
function updateTraffic(dt) {
  for (const c of W.traffic) {
    const sp = CFG.trafficSpeed;
    if (c.trafficDir === 'x') {
      c.group.position.x += Math.sin(c.heading) * sp * dt;
      c.group.position.z += Math.cos(c.heading) * sp * dt;
      if (c.group.position.x > 210 || c.group.position.x < -210) c.heading += Math.PI;
    } else {
      c.group.position.x += Math.sin(c.heading) * sp * dt;
      c.group.position.z += Math.cos(c.heading) * sp * dt;
      if (c.group.position.z > 200 || c.group.position.z < -210) c.heading += Math.PI;
    }
    // turn at intersections sometimes
    if (Math.random() < dt * 0.05) c.heading += (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
    c.group.rotation.y = c.heading;
  }
}

// ---------- police ----------
function spawnCops() {
  for (let i = 0; i < 6; i++) {
    const c = makeCar(0x111111, { x: 200 + i * 10, z: 200, heading: 0, cop: true });
    box(2.14, 0.12, 1.2, 0xffffff, 0, 0.95, 0, c.group); // white doors band
    const bar = box(1.2, 0.18, 0.5, 0xff0000, 0, 1.5, -0.2, c.group);
    c.lightBar = bar; c.active = false; c.bustTimer = 0; scene.add(c.group); W.cops.push(c);
  }
}
function setWanted(n) {
  W.wanted = clamp(n, 0, 5);
  if (W.wanted > 0) W.wantedTimer = 0;
}
W.setWanted = setWanted;
function updatePolice(dt) {
  const want = Math.min(W.wanted + 1, 4);
  const tx = player.car ? player.car.group.position.x : player.pos.x;
  const tz = player.car ? player.car.group.position.z : player.pos.z;
  const pSpeed = player.car ? Math.abs(player.car.speed) : 0;
  W.cops.forEach((cop, i) => {
    cop.active = i < want && W.wanted > 0;
    if (!cop.active) { cop.group.position.y = -50; return; }
    cop.group.position.y = 0;
    const d = dist2d(cop.group.position.x, cop.group.position.z, tx, tz);
    if (d > 130) { // respawn near player
      cop.group.position.set(tx + (i % 2 ? 45 : -45), 0, tz - 50 - i * 8);
    }
    const target = Math.atan2(tx - cop.group.position.x, tz - cop.group.position.z);
    cop.heading = angleLerp(cop.heading, target, clamp(dt * 1.6, 0, 1));
    cop.speed = CFG.copSpeed * (d > 25 ? 1 : 0.85);
    cop.group.position.x += Math.sin(cop.heading) * cop.speed * dt;
    cop.group.position.z += Math.cos(cop.heading) * cop.speed * dt;
    cop.group.rotation.y = cop.heading;
    cop.lightBar.material.color.setHex(Math.floor(W.time * 6) % 2 ? 0xff0000 : 0x0000ff);
    if (d < 3.4) { // ram
      if (player.car) { player.car.speed *= 0.55; player.car.health -= 6; burst(tx, 1, tz, 0xffaa00, 8); sfx.crash(); }
      else { damagePlayer(8, dt); }
      cop.group.position.x -= Math.sin(cop.heading) * 3; cop.group.position.z -= Math.cos(cop.heading) * 3;
    }
    // bust: close + slow for 2s
    if (d < 4.5 && pSpeed < 3 && !player.car) cop.bustTimer += dt;
    else if (d < 4.5 && pSpeed < 3) cop.bustTimer += dt * 0.6;
    else cop.bustTimer = Math.max(0, cop.bustTimer - dt);
    if (cop.bustTimer > 2) bustPlayer();
  });
  // wanted decay when no cop near
  if (W.wanted > 0) {
    const near = W.cops.some((c) => c.active && dist2d(c.group.position.x, c.group.position.z, tx, tz) < 45);
    if (!near) { W.wantedTimer += dt; if (W.wantedTimer > CFG.wantedDecay) { W.wanted--; W.wantedTimer = 0; showMessage('The heat is cooling off…', 2000); } }
    else W.wantedTimer = 0;
  }
}
function bustPlayer() {
  if (W.bustedTimer > 0) return;
  W.bustedTimer = 3; sfx.busted();
  const fine = Math.min(W.cash, 200); W.cash -= fine; setWanted(0);
  if (player.car) { player.car.isPlayer = false; player.car = null; player.group.visible = true; }
  player.pos.set(0, 0, 58); player.group.position.copy(player.pos);
  W.health = CFG.maxHealth;
  $('bustedText').textContent = `The Port Meridian PD caught you. Fine paid: $${fine}.`;
  $('busted').style.display = 'flex'; W.paused = true; saveGame();
}
function damagePlayer(n, dt) {
  if (W.bustedTimer > 0) return;
  W.health -= n * (dt ? 1 : 1);
  $('vignette').classList.add('hurt');
  setTimeout(() => $('vignette').classList.remove('hurt'), 250);
  if (W.health <= 0) { W.health = CFG.maxHealth; bustPlayer(); }
}

// ---------- enemies / combat ----------
function spawnEnemies(x, z, count) {
  clearEnemies();
  for (let i = 0; i < count; i++) {
    const g = makePerson(0xcc2222, 0x222222);
    const e = { group: g, x: x + (i - 1) * 5, z: z + (i % 2) * 4, health: 60, alive: true, hitTimer: 0 };
    g.position.set(e.x, 0, e.z); W.enemies.push(e);
  }
}
W.spawnEnemies = spawnEnemies;
function clearEnemies() { for (const e of W.enemies) scene.remove(e.group); W.enemies = []; }
function updateEnemies(dt) {
  for (const e of W.enemies) {
    if (!e.alive) continue;
    const d = dist2d(e.x, e.z, player.pos.x, player.pos.z);
    const h = Math.atan2(player.pos.x - e.x, player.pos.z - e.z);
    if (d > 2) { e.x += Math.sin(h) * 3.2 * dt; e.z += Math.cos(h) * 3.2 * dt; }
    else if (Math.random() < dt * 0.8) { damagePlayer(6); showMessage('Rival crew hit you!', 1200); }
    e.group.position.set(e.x, 0, e.z); e.group.rotation.y = h;
  }
}
function shoot() {
  if (!W.started || W.paused || W.ammo <= 0 || player.car) return;
  W.ammo--; sfx.shoot();
  const dir = new THREE.Vector3(Math.sin(player.heading), 0, Math.cos(player.heading));
  // tracer
  const from = player.pos.clone(); from.y = 1.4;
  const to = from.clone().add(dir.clone().multiplyScalar(40));
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffee55 }));
  scene.add(line); setTimeout(() => scene.remove(line), 70);
  burst(from.x + dir.x * 2, 1.4, from.z + dir.z * 2, 0xffee55, 5);
  let hit = false;
  for (const e of W.enemies) {
    if (!e.alive) continue;
    const ex = e.x - player.pos.x, ez = e.z - player.pos.z;
    const along = ex * dir.x + ez * dir.z;
    const perp = Math.abs(ex * dir.z - ez * dir.x);
    if (along > 0 && along < 45 && perp < 2.2) {
      e.health -= 34; hit = true; burst(e.x, 1.2, e.z, 0xff0000, 8);
      if (e.health <= 0) { e.alive = false; e.group.rotation.x = Math.PI / 2; e.group.position.y = 0.4; W.cash += 50; }
      break;
    }
  }
  if (!hit) setWanted(Math.max(W.wanted, 1));
}
function punch() {
  if (!W.started || W.paused || player.car || player.punchTimer > 0) return;
  player.punchTimer = 0.45; sfx.punch();
  for (const e of W.enemies) {
    if (!e.alive) continue;
    if (dist2d(e.x, e.z, player.pos.x, player.pos.z) < 2.6) {
      e.health -= 25; burst(e.x, 1.2, e.z, 0xffaa00, 6);
      if (e.health <= 0) { e.alive = false; e.group.rotation.x = Math.PI / 2; e.group.position.y = 0.4; W.cash += 50; }
    }
  }
}

// ---------- particles ----------
function burst(x, y, z, color, n) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, y, z); scene.add(m);
    W.particles.push({ mesh: m, vx: (Math.random() - 0.5) * 8, vy: Math.random() * 6, vz: (Math.random() - 0.5) * 8, life: 0.6 + Math.random() * 0.4 });
  }
}
function updateParticles(dt) {
  for (let i = W.particles.length - 1; i >= 0; i--) {
    const p = W.particles[i]; p.life -= dt;
    if (p.life <= 0) { scene.remove(p.mesh); W.particles.splice(i, 1); continue; }
    p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
    p.vy -= 9 * dt;
  }
}

// ---------- missions ----------
let marker, markerRing;
function initMissions() {
  if (marker) { scene.remove(marker); scene.remove(markerRing); }
  marker = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.25, 24), new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.75 }));
  marker.visible = false; scene.add(marker);
  markerRing = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.18, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffee55 }));
  markerRing.rotation.x = Math.PI / 2; markerRing.visible = false; scene.add(markerRing);
  W.marker = marker; startMission(W.missionIndex, true);
}
const currentMission = () => MISSIONS[Math.min(W.missionIndex, MISSIONS.length - 1)];
const currentStep = () => currentMission().steps[Math.min(W.missionStep, currentMission().steps.length - 1)];
function setObjective(t) { $('hudObjective').textContent = t; }
function setMissionLabel(t) { $('hudMission').textContent = t; }
function showMessage(t, ms) { const el = $('hudMessage'); el.textContent = t; el.style.display = 'block'; W.msgTimer = (ms || 3000) / 1000; }
W.setObjective = setObjective; W.setMissionLabel = setMissionLabel; W.showMessage = showMessage;
W.setMissionMarker = (x, z) => { marker.position.set(x, 0.15, z); markerRing.position.set(x, 0.4, z); marker.visible = true; markerRing.visible = true; };
function startMission(idx, silent) {
  if (idx >= MISSIONS.length) {
    W.missionState = 'done'; marker.visible = false; markerRing.visible = false;
    setObjective('All missions complete — Port Meridian is yours. Free roam!');
    setMissionLabel('CITY YOURS'); return;
  }
  W.missionIndex = idx; W.missionStep = 0; W.missionState = 'active';
  const m = MISSIONS[idx];
  setMissionLabel(`MISSION ${m.id} · ${m.name.toUpperCase()}`);
  setObjective(`Mission ${m.id}: ${m.name} — ${m.steps[0].text}`);
  if (!silent) { showMessage(`MISSION ${m.id} — ${m.name}`, 3200); sfx.mission(); }
  placeMarker();
}
W.startMission = startMission;
function placeMarker() {
  const s = currentStep(); const hasPos = s.x !== undefined;
  marker.visible = hasPos; markerRing.visible = hasPos;
  if (hasPos) { marker.position.set(s.x, 0.15, s.z); markerRing.position.set(s.x, 0.4, s.z); }
  if (s.type === 'fight') spawnEnemies(s.x, s.z, s.count || 3);
  if (s.type === 'steal' && W.targetCoupe) { W.targetCoupe.group.position.set(s.x, 0, s.z); W.targetCoupe.parked = true; }
  if (s.type === 'deliver' && W.missionIndex === 4) setWanted(3);
  if (s.type === 'deliver' && W.missionIndex === 5) setWanted(4);
}
function advanceMission() {
  const m = currentMission(); W.missionStep++;
  if (W.missionStep >= m.steps.length) {
    W.cash += m.pay; W.missionsDone++;
    sfx.cash(); showMessage(`MISSION COMPLETE — ${m.name}  +$${m.pay}`, 4200);
    setObjective(`Mission complete! +$${m.pay}`); saveGame();
    W.missionStep = m.steps.length - 1; W.missionState = 'complete';
    setTimeout(() => { if (W.running) startMission(W.missionIndex + 1); }, 2500);
    return;
  }
  const s = currentStep();
  setObjective(`Mission ${m.id}: ${m.name} — ${s.text}`); placeMarker(); sfx.pickup();
}
function updateMissions(dt) {
  if (W.missionState !== 'active') return;
  const s = currentStep();
  const px = player.car ? player.car.group.position.x : player.pos.x;
  const pz = player.car ? player.car.group.position.z : player.pos.z;
  if (marker.visible) {
    const t = performance.now() * 0.004;
    markerRing.position.y = 0.4 + Math.sin(t) * 0.25; markerRing.scale.setScalar(1 + Math.sin(t) * 0.08);
  }
  switch (s.type) {
    case 'enterCar': if (player.car) advanceMission(); break;
    case 'goto': case 'deliver': if (dist2d(px, pz, s.x, s.z) < (s.r || 8)) advanceMission(); break;
    case 'collect': if (!player.car && dist2d(px, pz, s.x, s.z) < (s.r || 8)) advanceMission(); break;
    case 'steal': if (player.car === W.targetCoupe) advanceMission(); break;
    case 'fight': if (W.enemies.filter((e) => e.alive).length === 0) advanceMission(); break;
  }
}

// ---------- save ----------
function saveGame() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ cash: W.cash, missionIndex: W.missionIndex, missionsDone: W.missionsDone, health: W.health, ammo: W.ammo })); } catch (e) {}
}
function loadSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); return s; } catch (e) { return null; }
}
W.saveGame = saveGame;

// ---------- HUD / minimap ----------
const mm = $('minimap').getContext('2d');
function drawMinimap() {
  const S = 180, scale = S / 480;
  mm.clearRect(0, 0, S, S); mm.fillStyle = '#16324a'; mm.fillRect(0, 0, S, S);
  mm.fillStyle = '#2c2f36';
  for (const v of ROAD_LINES) {
    mm.fillRect(0, (v + 240) * scale, S, CFG.road * scale);
    mm.fillRect((v + 240) * scale, 0, CFG.road * scale, S);
  }
  mm.fillStyle = '#1e6f8e'; mm.fillRect(0, (190 + 240) * scale, S, 50 * scale);
  const dot = (x, z, color, r) => { mm.fillStyle = color; mm.beginPath(); mm.arc((x + 240) * scale, (z + 240) * scale, r, 0, 7); mm.fill(); };
  if (marker.visible) dot(marker.position.x, marker.position.z, '#ffcc00', 6);
  for (const e of W.enemies) if (e.alive) dot(e.x, e.z, '#ff2222', 3);
  for (const c of W.cops) if (c.active) dot(c.group.position.x, c.group.position.z, '#3388ff', 3);
  const px = player.car ? player.car.group.position.x : player.pos.x;
  const pz = player.car ? player.car.group.position.z : player.pos.z;
  dot(px, pz, '#ffffff', 4);
}
function updateHUD() {
  $('hudCash').textContent = '$' + W.cash;
  $('hudStars').textContent = '★'.repeat(W.wanted) + '☆'.repeat(5 - W.wanted);
  $('hudHealth').textContent = Math.max(0, Math.round(W.health));
  $('healthBar').style.width = clamp(W.health, 0, 100) + '%';
  $('hudAmmo').textContent = W.ammo;
  const sp = player.car ? Math.abs(player.car.speed) * 3.6 : 0;
  $('hudSpeed').textContent = Math.round(sp) + ' km/h';
  drawMinimap();
  if (W.msgTimer > 0) { W.msgTimer -= 1 / 60; if (W.msgTimer <= 0) $('hudMessage').style.display = 'none'; }
}

// ---------- input ----------
const keys = {};
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { togglePause(); return; }
  if (e.key.toLowerCase() === 'm') { W.muted = !W.muted; showMessage(W.muted ? 'Sound muted' : 'Sound on', 1200); return; }
  keys[e.key.toLowerCase()] = true;
  if (e.code === 'Space') e.preventDefault();
  if (e.key.toLowerCase() === 'e' && W.started && !W.paused) {
    if (player.car) exitCar(); else enterCar(nearestCar(4.5));
  }
  if (e.key.toLowerCase() === 'f' && W.started) punch();
});
addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
let dragging = false, lastX = 0, lastY = 0;
renderer.domElement.addEventListener('mousedown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; audioInit(); });
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (e) => {
  if (!dragging) return;
  W.camYaw -= (e.clientX - lastX) * 0.005; W.camPitch = clamp(W.camPitch + (e.clientY - lastY) * 0.003, 0.05, 1.1);
  lastX = e.clientX; lastY = e.clientY;
});
renderer.domElement.addEventListener('click', () => { audioInit(); shoot(); });

// ---------- menus ----------
function startGame(fresh) {
  audioInit();
  if (fresh || !loadSave()) {
    W.cash = CFG.startCash; W.health = CFG.maxHealth; W.ammo = CFG.startAmmo;
    W.missionIndex = 0; W.missionsDone = 0; W.wanted = 0;
    player.pos.set(-116, 0, -40); player.group.position.copy(player.pos);
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  } else {
    const s = loadSave();
    W.cash = s.cash; W.missionIndex = s.missionIndex; W.missionsDone = s.missionsDone;
    W.health = s.health; W.ammo = s.ammo;
  }
  $('startScreen').style.display = 'none'; $('pauseMenu').style.display = 'none'; $('busted').style.display = 'none';
  $('hud').classList.add('on'); W.started = true; W.running = true; W.paused = false;
  initMissions();
  showMessage('Welcome to Port Meridian, Jace.', 3000);
}
function togglePause() {
  if (!W.started) return;
  W.paused = !W.paused;
  $('pauseMenu').style.display = W.paused ? 'flex' : 'none';
}
$('startBtn').onclick = () => startGame(true);
$('continueBtn').onclick = () => startGame(false);
$('howBtn').onclick = () => $('howPanel').classList.toggle('open');
$('resumeBtn').onclick = togglePause;
$('restartBtn').onclick = () => { $('pauseMenu').style.display = 'none'; startGame(true); };
$('quitBtn').onclick = () => { saveGame(); W.started = false; W.running = false; $('pauseMenu').style.display = 'none'; $('hud').classList.remove('on'); $('startScreen').style.display = 'flex'; };
$('bustedBtn').onclick = () => { $('busted').style.display = 'none'; W.paused = false; W.bustedTimer = 0; };
$('continueBtn').style.display = loadSave() ? 'block' : 'none';

// ---------- update loop ----------
const clock = new THREE.Clock();
function updatePlayer(dt) {
  player.punchTimer = Math.max(0, player.punchTimer - dt);
  if (player.car) {
    const car = player.car;
    const fwd = (keys['w'] ? 1 : 0) - (keys['s'] ? 1 : 0);
    if (fwd > 0) car.speed += CFG.carAccel * dt;
    else if (fwd < 0) car.speed -= (car.speed > 0.5 ? CFG.carBrake : CFG.carAccel * 0.6) * dt;
    else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 12 * dt);
    if (keys[' ']) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 30 * dt);
    car.speed = clamp(car.speed, -CFG.carReverseMax, CFG.carMaxSpeed);
    const steer = (keys['a'] ? 1 : 0) - (keys['d'] ? 1 : 0);
    if (Math.abs(car.speed) > 0.5) car.heading += steer * CFG.carTurn * dt * Math.sign(car.speed) * (car.speed > 0 ? 1 : -1) * 0.6;
    let nx = car.group.position.x + Math.sin(car.heading) * car.speed * dt;
    let nz = car.group.position.z + Math.cos(car.heading) * car.speed * dt;
    const hit = collideBuildings(nx, nz, 2.4);
    if (hit) { car.speed *= -0.25; nx = car.group.position.x; nz = car.group.position.z; if (Math.abs(car.speed) > 8) { burst(nx, 1, nz, 0xffaa00, 10); sfx.crash(); } }
    [nx, nz] = clampToCity(nx, nz);
    if (nx !== car.group.position.x + Math.sin(car.heading) * car.speed * dt) car.speed *= 0.5;
    car.group.position.x = nx; car.group.position.z = nz;
    car.group.rotation.y = car.heading;
    car.wheels.forEach((w) => { w.rotation.x += car.speed * dt * 2; });
    // smoke when damaged
    car.health -= 0; // health tracked on rams
    if (car.health < 50 && Math.random() < dt * 8) burst(nx, 1, nz, 0x888888, 1);
    if (Math.random() < dt * 0.5) burst(nx - Math.sin(car.heading) * 2, 0.5, nz - Math.cos(car.heading) * 2, 0x666666, 1);
    // engine audio
    if (engineGain) { engineGain.gain.value = W.muted ? 0 : 0.04 + Math.abs(car.speed) / CFG.carMaxSpeed * 0.05; engineOsc.frequency.value = 50 + Math.abs(car.speed) * 4; }
    if (sirenGain) sirenGain.gain.value = (W.muted || W.wanted === 0) ? 0 : 0.03;
    if (sirenOsc) sirenOsc.frequency.value = 650 + Math.sin(W.time * 5) * 250;
  } else {
    if (engineGain) engineGain.gain.value = 0;
    if (sirenGain) sirenGain.gain.value = (W.muted || W.wanted === 0) ? 0 : 0.03;
    const run = keys['shift'] ? CFG.playerRun : CFG.playerWalk;
    let mx = (keys['d'] ? 1 : 0) - (keys['a'] ? 1 : 0);
    let mz = (keys['w'] ? 1 : 0) - (keys['s'] ? 1 : 0);
    const len = Math.hypot(mx, mz) || 1; mx /= len; mz /= len;
    // movement relative to camera yaw
    const sin = Math.sin(W.camYaw), cos = Math.cos(W.camYaw);
    const vx = (mx * cos - mz * sin) * run, vz = (mx * sin + mz * cos) * run;
    let nx = player.pos.x + vx * dt, nz = player.pos.z + vz * dt;
    if (!collideBuildings(nx, nz, 0.8)) { player.pos.x = nx; player.pos.z = nz; }
    [player.pos.x, player.pos.z] = clampToCity(player.pos.x, player.pos.z);
    if (Math.abs(vx) + Math.abs(vz) > 0.1) { player.heading = Math.atan2(vx, vz); player.group.rotation.y = player.heading; }
    // jump / gravity
    if (keys[' '] && player.onGround) { player.vy = 7; player.onGround = false; }
    player.vy -= 20 * dt; player.pos.y += player.vy * dt;
    if (player.pos.y <= 0) { player.pos.y = 0; player.vy = 0; player.onGround = true; }
    player.group.position.copy(player.pos);
    // walk bob
    player.group.position.y = player.pos.y + (Math.abs(vx) + Math.abs(vz) > 0.1 ? Math.abs(Math.sin(W.time * 10)) * 0.06 : 0);
  }
  // player heading follows camera when shooting on foot
  if (!player.car && dragging) player.heading = W.camYaw;
}
function updateCamera(dt) {
  const focus = player.car ? player.car.group.position : player.pos;
  const heading = player.car ? player.car.heading : W.camYaw;
  // trailing camera: behind the heading direction, orbit offset by camYaw when on foot
  const yaw = player.car ? heading + Math.PI : W.camYaw;
  const dist = player.car ? 13 : 9;
  const h = player.car ? 5.5 : 4;
  const tx = focus.x + Math.sin(yaw) * dist, tz = focus.z + Math.cos(yaw) * dist;
  camera.position.x += (tx - camera.position.x) * Math.min(1, dt * 5);
  camera.position.y += (h - camera.position.y) * Math.min(1, dt * 5);
  camera.position.z += (tz - camera.position.z) * Math.min(1, dt * 5);
  camera.lookAt(focus.x, focus.y + 1.6, focus.z);
}
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  W.time += dt;
  if (W.started && !W.paused && W.running) {
    updatePlayer(dt); updateTraffic(dt); updatePeds(dt); updatePolice(dt);
    updateEnemies(dt); updateMissions(dt); updateParticles(dt); updateCamera(dt); updateHUD();
    if (W.bustedTimer > 0) W.bustedTimer -= dt;
  }
  renderer.render(scene, camera);
}

// ---------- boot ----------
buildWorld(); spawnParked(); spawnTraffic(); spawnPeds(); spawnCops();
// player starts near starter car; missions init on Start (so Continue restores index)
W.marker = null;
animate();

// ---------- staged screenshots (?shot=...) ----------
function applyShot(shot) {
  W.started = true; W.running = true; W.paused = false;
  $('startScreen').style.display = 'none'; $('hud').classList.add('on');
  // ensure a mission is active for HUD text
  if (!W.marker) initMissions();
  const P = player;
  if (shot === 'cover') {
    setWanted(0); P.car = W.starterCar; W.starterCar.isPlayer = true; W.starterCar.parked = false;
    P.group.visible = false; W.starterCar.group.position.set(0, 0, 116); W.starterCar.heading = Math.PI;
    W.starterCar.group.rotation.y = Math.PI; W.starterCar.speed = 8;
    camera.position.set(2, 9, 148); camera.lookAt(0, 3, 60);
    setObjective('Mission 1: First Gear — Drive to the meet point at the north-east corner');
    setMissionLabel('MISSION 1 · FIRST GEAR');
  } else if (shot === 'chase') {
    setWanted(3); P.car = W.starterCar; W.starterCar.isPlayer = true; W.starterCar.parked = false;
    P.group.visible = false; W.starterCar.group.position.set(0, 0, 58); W.starterCar.heading = 0;
    W.starterCar.group.rotation.y = 0; W.starterCar.speed = 26;
    camera.position.set(-12, 8, 24); camera.lookAt(0, 2, 58);
    W.cops.forEach((cop, i) => {
      cop.active = true; cop.group.position.set([-9, 7, -4, 11][i] || 0, 0, 42 - i * 3);
      cop.heading = 0; cop.group.rotation.y = 0; cop.speed = 24;
    });
    setObjective('Lose the cops — 3 stars, Port Meridian PD on your tail');
    setMissionLabel('MISSION 5 · THE GETAWAY');
  } else if (shot === 'mission') {
    setWanted(0); P.pos.set(-28, 0, 195); P.group.position.copy(P.pos);
    P.heading = Math.PI * 0.85; P.group.rotation.y = P.heading;
    camera.position.set(-14, 7, 176); camera.lookAt(-40, 2, 218);
    setObjective('Mission 4: Dockside Trouble — Take out the rival crew (click to shoot, F to punch)');
    setMissionLabel('MISSION 4 · DOCKSIDE TROUBLE');
    spawnEnemies(-40, 218, 3); W.setMissionMarker(-40, 218);
  } else { // street
    setWanted(0); P.pos.set(10, 0, 58); P.group.position.copy(P.pos);
    P.heading = Math.PI / 2; P.group.rotation.y = P.heading;
    camera.position.set(-6, 4.5, 44); camera.lookAt(30, 2, 58);
    setObjective('Free roam — explore Port Meridian on foot or steal a car (E)');
    setMissionLabel('FREE ROAM');
    const car = makeCar(0x2255cc, { x: 24, z: 62, heading: Math.PI / 2, parked: true });
    W.parkedCars.push(car);
  }
  updateHUD();
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__shotReady = true; }));
}
if (params.get('shot')) {
  // freeze the normal camera follow for staged shots by pausing updates after setup
  applyShot(params.get('shot'));
  W.running = false; // staged frame: render once, no simulation drift
  setTimeout(() => { renderer.render(scene, camera); }, 100);
}

// ---------- debug / playtest hooks (also used by the in-page HUD) ----------
W.state = () => ({
  cash: W.cash, health: Math.round(W.health), ammo: W.ammo, wanted: W.wanted,
  missionIndex: W.missionIndex, missionStep: W.missionStep, missionsDone: W.missionsDone,
  missionState: W.missionState, inCar: !!player.car,
  speed: player.car ? Math.abs(player.car.speed) : 0,
  x: player.car ? player.car.group.position.x : player.pos.x,
  z: player.car ? player.car.group.position.z : player.pos.z,
  enemiesAlive: W.enemies.filter((e) => e.alive).length,
  copsActive: W.cops.filter((c) => c.active).length,
  started: W.started, paused: W.paused,
});
W.teleport = (x, z) => {
  if (player.car) { player.car.group.position.set(x, 0, z); player.car.speed = 0; }
  else { player.pos.set(x, 0, z); player.group.position.copy(player.pos); }
  camera.position.set(x + 10, 8, z + 14);
};
W.debug = {
  start: () => startGame(true),
  teleport: W.teleport,
  setWanted: (n) => setWanted(n),
  setMission: (i) => { startMission(i); },
  killEnemies: () => { for (const e of W.enemies) { e.alive = false; e.health = 0; } },
  enterNearestCar: () => enterCar(nearestCar(6)),
  giveAmmo: (n) => { W.ammo = n; },
};
window.__MH = W;
