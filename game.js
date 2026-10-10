'use strict';

// ---- Configuration -------------------------------------------------------

// Logical arena size. The canvas is scaled to fit, so difficulty is the
// same on every screen size.
const W = 1600;
const H = 1000;

// Speeds are in arena pixels per second, angles in degrees (per second).
// Wing values are scaled by the "wing sensitivity" setting (see update()).
// speedDrift is how fast the speed target wanders, in throttle units per second.
const DIFFICULTY = {
  easy:   { dotSpeed: 60,  dotTurn: 1.0, radius: 90, moveSpeed: 450, rollNoise: 20, rollDiverge: 0.0, rollRate: 70, speedDrift: 0.15 },
  normal: { dotSpeed: 100, dotTurn: 1.6, radius: 75, moveSpeed: 500, rollNoise: 35, rollDiverge: 0.3, rollRate: 80, speedDrift: 0.25 },
  hard:   { dotSpeed: 150, dotTurn: 2.4, radius: 60, moveSpeed: 550, rollNoise: 55, rollDiverge: 0.6, rollRate: 90, speedDrift: 0.4 },
};

const WING_LENGTH = 70;     // how far each wing sticks out past the circle
const LEVEL_TOLERANCE = 5;  // wings count as level within ±this many degrees
const DEADZONE = 0.08;
const EDGE_MARGIN = 140;    // the dot starts turning back this close to the edge
const SPEED_SCALE = 160;    // speed vector length in pixels for a full-range error
const SPEED_HIDDEN = 0.03;  // speed errors smaller than this draw no vector
const KEY_THROTTLE_RATE = 0.8; // how fast W / S move the keyboard throttle

// ---- DOM -----------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');

const ui = {
  menu: $('menu'), pause: $('pause'), results: $('results'),
  hud: $('hud'), hudTime: $('hud-time'), hudLive: $('hud-live'),
  countdown: $('countdown'), resultsBody: $('results-body'),
  duration: $('opt-duration'), difficulty: $('opt-difficulty'),
  roll: $('opt-roll'), speed: $('opt-speed'), invert: $('opt-invert'),
  invertSpeed: $('opt-invert-speed'), live: $('opt-live'),
  sensitivity: $('opt-sensitivity'), sensitivityValue: $('opt-sensitivity-value'),
  padStatus: $('pad-status'), axes: $('axes'), history: $('history'),
};

// ---- Settings & history (saved in this browser only) ---------------------

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

const settings = Object.assign(
  { duration: '120', difficulty: 'normal', roll: 'auto', speed: '6', invert: false,
    invertSpeed: false, live: true, sensitivity: '3.5' },
  load('bird.settings', {}),
);
let history = load('bird.history', []);

ui.duration.value = settings.duration;
ui.difficulty.value = settings.difficulty;
ui.invert.checked = settings.invert;
ui.invertSpeed.checked = settings.invertSpeed;
ui.live.checked = settings.live;
ui.sensitivity.value = settings.sensitivity;
ui.sensitivityValue.textContent = `${Number(settings.sensitivity).toFixed(1)}×`;

function readSettings() {
  settings.duration = ui.duration.value;
  settings.difficulty = ui.difficulty.value;
  settings.roll = ui.roll.value;
  settings.speed = ui.speed.value;
  settings.invert = ui.invert.checked;
  settings.invertSpeed = ui.invertSpeed.checked;
  settings.live = ui.live.checked;
  settings.sensitivity = ui.sensitivity.value;
  ui.sensitivityValue.textContent = `${Number(settings.sensitivity).toFixed(1)}×`;
  save('bird.settings', settings);
}
for (const el of [ui.duration, ui.difficulty, ui.roll, ui.speed, ui.invert, ui.invertSpeed, ui.live]) {
  el.addEventListener('change', readSettings);
}
ui.sensitivity.addEventListener('input', readSettings);

// ---- Input ---------------------------------------------------------------

const keys = new Set();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code.startsWith('Arrow')) e.preventDefault();
  if (e.code === 'Escape') togglePause();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); if (state === 'playing') togglePause(); });

function getPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) if (p && p.connected) return p;
  return null;
}

function deadzone(v) {
  if (Math.abs(v) < DEADZONE) return 0;
  return Math.sign(v) * (Math.abs(v) - DEADZONE) / (1 - DEADZONE);
}

// Which gamepad axis tilts the wings. "auto" picks the right stick on a
// standard gamepad, otherwise axis 2 (often the twist on flight sticks).
function rollAxisIndex(pad) {
  const r = settings.roll;
  if (r === 'combined' || r === 'keyboard') return -1;
  if (r === 'auto') {
    if (!pad) return -1;
    return pad.axes.length > 2 ? 2 : -1;
  }
  return Number(r);
}

// The speed control is a throttle lever: it stays where it is put, so its
// position is used directly. On the keyboard, W / S slide a virtual lever.
let keyThrottle = 0;

function speedAxisIndex() {
  return settings.speed === 'keyboard' ? -1 : Number(settings.speed);
}

// Returns { x, y, roll, throttle } each in -1..1.
function readInput(dt = 0) {
  let x = 0, y = 0, roll = 0, throttle = 0;
  const pad = getPad();

  if (pad && settings.roll !== 'keyboard') {
    x = deadzone(pad.axes[0] ?? 0);
    y = deadzone(pad.axes[1] ?? 0);
    const ri = rollAxisIndex(pad);
    if (settings.roll === 'combined') roll = x;
    else if (ri >= 0 && ri < pad.axes.length) roll = deadzone(pad.axes[ri]);
  }

  const si = speedAxisIndex();
  if (pad && si >= 0 && si < pad.axes.length) {
    throttle = pad.axes[si];
  } else {
    if (keys.has('KeyW')) keyThrottle += KEY_THROTTLE_RATE * dt;
    if (keys.has('KeyS')) keyThrottle -= KEY_THROTTLE_RATE * dt;
    keyThrottle = Math.max(-1, Math.min(1, keyThrottle));
    throttle = keyThrottle;
  }
  if (settings.invertSpeed) throttle = -throttle;

  if (keys.has('ArrowLeft')) x -= 1;
  if (keys.has('ArrowRight')) x += 1;
  if (keys.has('ArrowUp')) y -= 1;
  if (keys.has('ArrowDown')) y += 1;
  if (keys.has('KeyQ')) roll -= 1;
  if (keys.has('KeyE')) roll += 1;

  if (settings.invert) y = -y;
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  return { x: clamp(x), y: clamp(y), roll: clamp(roll), throttle: clamp(throttle) };
}

// Rebuild the "wings controlled by" list when a joystick connects, and
// show live axis bars so the user can see which axis is which.
let lastAxisCount = -1;
function refreshPadUI() {
  const pad = getPad();
  const count = pad ? pad.axes.length : 0;

  if (count !== lastAxisCount) {
    lastAxisCount = count;
    const opts = [['auto', 'Automatic'], ['combined', 'Same stick, left/right']];
    for (let i = 2; i < count; i++) opts.push([String(i), `Joystick axis ${i}`]);
    opts.push(['keyboard', 'Keyboard only (Q / E)']);
    ui.roll.innerHTML = opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    ui.roll.value = opts.some(([v]) => v === settings.roll) ? settings.roll : 'auto';

    // Always offer axis 6, the throttle on many flight sticks, even before
    // a joystick is detected, so the saved choice survives.
    const speedOpts = [];
    for (let i = 2; i < Math.max(count, 7); i++) speedOpts.push([String(i), `Joystick axis ${i}`]);
    speedOpts.push(['keyboard', 'Keyboard only (W / S)']);
    ui.speed.innerHTML = speedOpts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    ui.speed.value = speedOpts.some(([v]) => v === settings.speed) ? settings.speed : 'keyboard';

    ui.axes.innerHTML = '';
    for (let i = 0; i < count; i++) {
      ui.axes.insertAdjacentHTML('beforeend',
        `<div class="axis" data-i="${i}"><span>Axis ${i}</span><div class="bar"><i></i></div><span class="v"></span></div>`);
    }
  }

  if (pad) {
    ui.padStatus.textContent = `Joystick connected: ${pad.id}. Move it to see which axis is which.`;
    ui.padStatus.classList.add('on');
    const ri = settings.roll === 'combined' ? 0 : rollAxisIndex(pad);
    ui.axes.querySelectorAll('.axis').forEach((row) => {
      const i = Number(row.dataset.i);
      const v = pad.axes[i] ?? 0;
      const bar = row.querySelector('i');
      bar.style.left = `${50 + Math.min(0, v) * 50}%`;
      bar.style.width = `${Math.abs(v) * 50}%`;
      row.querySelector('.v').textContent = v.toFixed(2);
      row.classList.toggle('roll', i === ri || i === speedAxisIndex());
    });
  } else {
    ui.padStatus.textContent = 'No joystick detected. Plug one in and press any button on it.';
    ui.padStatus.classList.remove('on');
  }
}

// ---- Game state ----------------------------------------------------------

let state = 'menu'; // menu | countdown | playing | paused | results
let cfg = DIFFICULTY.normal;
let game = null;

function newGame() {
  cfg = DIFFICULTY[settings.difficulty];
  return {
    duration: Number(settings.duration),
    elapsed: 0,
    dot: { x: W / 2, y: H / 2, heading: Math.random() * Math.PI * 2, turn: 0 },
    player: { x: W / 2, y: H / 2 },
    roll: 0,          // degrees, positive = right wing down
    rollDisturb: 0,   // degrees per second of random lean
    speedTarget: null, // throttle position that hides the speed vector
    speedTargetVel: 0,
    speedError: 0,
    stats: { inside: 0, level: 0, speed: 0, all: 0, rollSum: 0, distSum: 0, time: 0 },
  };
}

function update(dt) {
  const g = game;
  const input = readInput(dt);

  // Dot: wanders with a slowly changing turn rate, steering back from edges.
  const d = g.dot;
  d.turn += (Math.random() * 2 - 1) * cfg.dotTurn * 4 * dt;
  d.turn *= 1 - 1.2 * dt;
  d.turn = Math.max(-cfg.dotTurn, Math.min(cfg.dotTurn, d.turn));
  d.heading += d.turn * dt;

  const nearEdge = d.x < EDGE_MARGIN || d.x > W - EDGE_MARGIN || d.y < EDGE_MARGIN || d.y > H - EDGE_MARGIN;
  if (nearEdge) {
    const toCenter = Math.atan2(H / 2 - d.y, W / 2 - d.x);
    let diff = toCenter - d.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    d.heading += diff * Math.min(1, 2 * dt);
  }
  d.x += Math.cos(d.heading) * cfg.dotSpeed * dt;
  d.y += Math.sin(d.heading) * cfg.dotSpeed * dt;
  d.x = Math.max(10, Math.min(W - 10, d.x));
  d.y = Math.max(10, Math.min(H - 10, d.y));

  // Circle: the joystick sets how fast it moves.
  const p = g.player;
  p.x = Math.max(0, Math.min(W, p.x + input.x * cfg.moveSpeed * dt));
  p.y = Math.max(0, Math.min(H, p.y + input.y * cfg.moveSpeed * dt));

  // Wings: a random lean that drifts over time, plus a tendency to keep
  // leaning further once tilted. The joystick rolls them back.
  g.rollDisturb += (Math.random() * 2 - 1) * cfg.rollNoise * 3 * dt;
  g.rollDisturb *= 1 - 0.4 * dt;
  g.rollDisturb = Math.max(-cfg.rollNoise, Math.min(cfg.rollNoise, g.rollDisturb));
  // Sensitivity sets how fast the wings answer the joystick. It speeds up
  // the random lean only half as much, so the joystick stays stronger than
  // the lean and a partial push is enough to level the wings.
  const sens = Number(settings.sensitivity);
  const leanSens = 1 + (sens - 1) / 2;
  g.roll += ((g.rollDisturb + g.roll * cfg.rollDiverge) * leanSens + input.roll * cfg.rollRate * sens) * dt;
  g.roll = Math.max(-80, Math.min(80, g.roll));

  // Speed: the throttle position that hides the vector wanders up and down.
  // It starts wherever the throttle is, so the vector starts hidden.
  if (g.speedTarget === null) g.speedTarget = Math.max(-0.9, Math.min(0.9, input.throttle));
  g.speedTargetVel += (Math.random() * 2 - 1) * cfg.speedDrift * 4 * dt;
  g.speedTargetVel *= 1 - 0.8 * dt;
  g.speedTargetVel = Math.max(-cfg.speedDrift, Math.min(cfg.speedDrift, g.speedTargetVel));
  g.speedTarget += g.speedTargetVel * dt;
  if (Math.abs(g.speedTarget) > 0.9) {
    g.speedTarget = Math.sign(g.speedTarget) * 0.9;
    g.speedTargetVel = -g.speedTargetVel;
  }
  g.speedError = input.throttle - g.speedTarget;

  // Scoring.
  const dist = Math.hypot(d.x - p.x, d.y - p.y);
  const inside = dist <= cfg.radius;
  const level = Math.abs(g.roll) <= LEVEL_TOLERANCE;
  const speedOk = Math.abs(g.speedError) <= SPEED_HIDDEN;
  const s = g.stats;
  s.time += dt;
  if (inside) s.inside += dt;
  if (level) s.level += dt;
  if (speedOk) s.speed += dt;
  if (inside && level && speedOk) s.all += dt;
  s.rollSum += Math.abs(g.roll) * dt;
  s.distSum += dist * dt;

  g.elapsed += dt;
  if (g.elapsed >= g.duration) finish();
}

// ---- Drawing -------------------------------------------------------------

let view = { scale: 1, ox: 0, oy: 0 };

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  const scale = Math.min(canvas.width / W, canvas.height / H);
  view = { scale, ox: (canvas.width - W * scale) / 2, oy: (canvas.height - H * scale) / 2 };
}
addEventListener('resize', resize);
resize();

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0e1a24';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
  ctx.fillStyle = '#13283a';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#2c4560';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, W, H);

  if (!game) return;
  const { dot, player, roll } = game;
  const inside = Math.hypot(dot.x - player.x, dot.y - player.y) <= cfg.radius;
  const showFeedback = settings.live && state === 'playing';

  // Dot.
  ctx.fillStyle = '#ff5a5a';
  ctx.beginPath();
  ctx.arc(dot.x, dot.y, 9, 0, Math.PI * 2);
  ctx.fill();

  // Circle with wings. The wing line is drawn only outside the circle.
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate((roll * Math.PI) / 180);
  ctx.strokeStyle = showFeedback ? (inside ? '#4cd18a' : '#ffffff') : '#ffffff';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, cfg.radius, 0, Math.PI * 2);
  ctx.stroke();

  const level = Math.abs(roll) <= LEVEL_TOLERANCE;
  ctx.strokeStyle = showFeedback ? (level ? '#4cd18a' : '#ffffff') : '#ffffff';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-cfg.radius, 0);
  ctx.lineTo(-cfg.radius - WING_LENGTH, 0);
  ctx.moveTo(cfg.radius, 0);
  ctx.lineTo(cfg.radius + WING_LENGTH, 0);
  ctx.stroke();

  // Speed vector: sticks up or down from the right wing tip. Hidden when
  // the speed is right.
  if (Math.abs(game.speedError) > SPEED_HIDDEN) {
    const tip = cfg.radius + WING_LENGTH;
    ctx.strokeStyle = '#ffd34d';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(tip, 0);
    ctx.lineTo(tip, -game.speedError * SPEED_SCALE);
    ctx.stroke();
  }
  ctx.restore();
}

// ---- Flow ----------------------------------------------------------------

function show(el, on) { el.hidden = !on; }

function startGame() {
  readSettings();
  game = newGame();
  show(ui.menu, false);
  show(ui.results, false);
  show(ui.pause, false);
  show(ui.hud, true);
  state = 'countdown';
  let n = 3;
  ui.countdown.textContent = n;
  show(ui.countdown, true);
  const tick = setInterval(() => {
    n -= 1;
    if (n > 0) { ui.countdown.textContent = n; return; }
    clearInterval(tick);
    show(ui.countdown, false);
    if (state === 'countdown') state = 'playing';
  }, 800);
}

function togglePause() {
  if (state === 'playing') { state = 'paused'; show(ui.pause, true); }
  else if (state === 'paused') { state = 'playing'; show(ui.pause, false); }
}

function toMenu() {
  state = 'menu';
  game = null;
  show(ui.pause, false);
  show(ui.results, false);
  show(ui.hud, false);
  show(ui.menu, true);
  renderHistory();
}

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

function finish() {
  state = 'results';
  show(ui.hud, false);
  const s = game.stats;
  const result = {
    date: new Date().toISOString(),
    difficulty: settings.difficulty,
    duration: game.duration,
    inside: pct(s.inside, s.time),
    level: pct(s.level, s.time),
    speed: pct(s.speed, s.time),
    all: pct(s.all, s.time),
    avgRoll: s.time ? s.rollSum / s.time : 0,
    avgDist: s.time ? s.distSum / s.time : 0,
  };
  result.score = Math.round((result.inside + result.level + result.speed) / 3);
  history = [result, ...history].slice(0, 20);
  save('bird.history', history);

  ui.resultsBody.innerHTML = `
    <div class="score">${result.score}</div>
    <div class="stat"><span>Dot inside circle</span><b>${result.inside}%</b></div>
    <div class="stat"><span>Wings level (±${LEVEL_TOLERANCE}°)</span><b>${result.level}%</b></div>
    <div class="stat"><span>Speed vector hidden</span><b>${result.speed}%</b></div>
    <div class="stat"><span>All three at once</span><b>${result.all}%</b></div>
    <div class="stat"><span>Average wing tilt</span><b>${result.avgRoll.toFixed(1)}°</b></div>
    <div class="stat"><span>Average distance from dot</span><b>${Math.round(result.avgDist)} px</b></div>`;
  show(ui.results, true);
}

function renderHistory() {
  if (!history.length) { ui.history.innerHTML = ''; return; }
  const rows = history.slice(0, 8).map((r) => `
    <tr><td>${new Date(r.date).toLocaleDateString()}</td><td>${r.difficulty}</td>
    <td>${r.duration / 60} min</td><td>${r.inside}%</td><td>${r.level}%</td><td>${r.speed ?? '–'}${r.speed == null ? '' : '%'}</td><td><b>${r.score}</b></td></tr>`).join('');
  ui.history.innerHTML = `<h3>Recent results</h3><table>
    <tr><th>Date</th><th>Level</th><th>Time</th><th>Dot</th><th>Wings</th><th>Speed</th><th>Score</th></tr>${rows}</table>`;
}

function updateHud() {
  const left = Math.max(0, game.duration - game.elapsed);
  const m = Math.floor(left / 60);
  const sec = Math.floor(left % 60).toString().padStart(2, '0');
  ui.hudTime.textContent = `${m}:${sec}`;
  const s = game.stats;
  ui.hudLive.textContent = settings.live && s.time > 0
    ? `Dot ${pct(s.inside, s.time)}%  ·  Wings ${pct(s.level, s.time)}%  ·  Speed ${pct(s.speed, s.time)}%`
    : '';
}

$('start').addEventListener('click', startGame);
$('again').addEventListener('click', startGame);
$('resume').addEventListener('click', togglePause);
$('quit').addEventListener('click', toMenu);
$('to-menu').addEventListener('click', toMenu);
addEventListener('gamepadconnected', () => { lastAxisCount = -1; });
addEventListener('gamepaddisconnected', () => { lastAxisCount = -1; });

// ---- Main loop -----------------------------------------------------------

let last = performance.now();
function frame(now) {
  // Cap the step so a hidden tab or a slow frame can't jump the game ahead.
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state === 'menu') refreshPadUI();
  if (state === 'playing') update(dt);
  if (game) updateHud();
  draw();
  requestAnimationFrame(frame);
}

refreshPadUI();
renderHistory();
requestAnimationFrame(frame);
