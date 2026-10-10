'use strict';

// ---- Configuration -------------------------------------------------------

// Logical screen size. The canvas is scaled to fit, so the layout and
// difficulty are the same on every screen.
const W = 1600;
const H = 1000;

const DIFFICULTY = {
  // balance*: degrees and degrees per second. redGap*: seconds with no red
  // square between two of them. colorChange: seconds each colour row stays
  // up. audioGap*: seconds between number pairs.
  easy:   { balanceUnstable: 0.5, balanceNoise: 6,  balanceRate: 90,  redGapMin: 1.5, redGapMax: 5, colorChange: 3.5, audioGapMin: 35, audioGapMax: 55 },
  normal: { balanceUnstable: 0.8, balanceNoise: 10, balanceRate: 100, redGapMin: 1.0, redGapMax: 4, colorChange: 3.0, audioGapMin: 25, audioGapMax: 45 },
  hard:   { balanceUnstable: 1.1, balanceNoise: 14, balanceRate: 110, redGapMin: 0.5, redGapMax: 3, colorChange: 2.5, audioGapMin: 20, audioGapMax: 35 },
};

// Balance square: a square standing on one corner, turning around its centre.
const SQUARE_CENTER = { x: W / 2, y: 520 };
const SQUARE_HALF_DIAGONAL = 110;
const BALANCE_OK = 8;     // degrees: counts as balanced within ±this
const BALANCE_MAX = 45;   // degrees: it can't turn further than this
const CONTROL = { x: W / 2, y: 760, halfWidth: 260, height: 56 }; // mouse area

// Towers: a column of cells on each side, with an arm from the middle cell
// reaching towards the centre. One red square at a time moves through them.
const CELL = 30;
const PITCH = 42;
const TOWER_CELLS = 15;
const MIDDLE_CELL = 7;
const ARM_CELLS = 8;
const TOWER_X = [110, W - 110];
const TOWER_TOP = 550 - MIDDLE_CELL * PITCH;
const RED_STEP = 0.30;    // seconds per cell
const TURN_CHANCE = 0.2;  // how often the red square turns towards the middle
const TOWER_GRACE = 0.4;  // seconds after a turning square leaves to still press

// Colour row at the top, and the pattern to look for.
const ROW_CELLS = 6;
const ROW_SIZE = 50;
const ROW_GAP = 14;
const ROW_Y = 100;
const COLORS = {
  red:    { name: 'red',    fill: '#ff4d4d' },
  blue:   { name: 'blue',   fill: '#4f8bff' },
  green:  { name: 'green',  fill: '#3ccf6e' },
  yellow: { name: 'yellow', fill: '#ffd34d' },
};
const COLOR_KEYS = Object.keys(COLORS);
const MATCH_CHANCE = 0.3;  // how often a new row is forced to match
const COLOR_GRACE = 0.4;   // seconds after a matching row disappears to still press
const TARGET_VISIBLE = 8;  // seconds a new pattern stays on screen
const TARGET_EVERY_MIN = 40;
const TARGET_EVERY_MAX = 60;

// Numbers.
const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const AUDIO_PAUSE = 2.5;   // seconds between the two sequences
const AUDIO_ANSWER = 5;    // seconds to answer after the second sequence
const REVERSED_CHANCE = 0.45;

const FALSE_PRESS_PENALTY = 2; // score points per press with nothing to answer

// ---- DOM -----------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');

const ui = {
  menu: $('menu'), briefing: $('briefing'), pause: $('pause'), results: $('results'),
  hud: $('hud'), hudTime: $('hud-time'), briefingCount: $('briefing-count'),
  resultsBody: $('results-body'), history: $('history'),
  duration: $('opt-duration'), difficulty: $('opt-difficulty'), voice: $('opt-voice'),
  invert: $('opt-invert'), feedback: $('opt-feedback'), voiceWarning: $('voice-warning'),
  tasks: { balance: $('task-balance'), towers: $('task-towers'), colors: $('task-colors'), audio: $('task-audio') },
};

// ---- Settings & history (saved in this browser only) ---------------------

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

const settings = Object.assign(
  { duration: '180', difficulty: 'normal', voice: '', invert: false, feedback: true,
    tasks: { balance: true, towers: true, colors: true, audio: true } },
  load('fourInOne.settings', {}),
);
let history = load('fourInOne.history', []);

ui.duration.value = settings.duration;
ui.difficulty.value = settings.difficulty;
ui.invert.checked = settings.invert;
ui.feedback.checked = settings.feedback;
for (const k in ui.tasks) ui.tasks[k].checked = settings.tasks[k] !== false;

function readSettings() {
  settings.duration = ui.duration.value;
  settings.difficulty = ui.difficulty.value;
  settings.voice = ui.voice.value;
  settings.invert = ui.invert.checked;
  settings.feedback = ui.feedback.checked;
  for (const k in ui.tasks) settings.tasks[k] = ui.tasks[k].checked;
  save('fourInOne.settings', settings);
}
for (const el of [ui.duration, ui.difficulty, ui.voice, ui.invert, ui.feedback, ...Object.values(ui.tasks)]) {
  el.addEventListener('change', readSettings);
}

// ---- Voice ---------------------------------------------------------------

const speech = window.speechSynthesis;
const isEnglish = (v) => v.lang.toLowerCase().startsWith('en');

function refreshVoices() {
  if (!speech) {
    ui.voice.innerHTML = '<option value="">Speech not supported</option>';
    ui.voiceWarning.textContent = 'This browser cannot speak. Use Microsoft Edge or Chrome for the numbers task.';
    ui.voiceWarning.hidden = false;
    return;
  }
  const voices = speech.getVoices();
  const english = voices.filter(isEnglish);
  const others = voices.filter((v) => !isEnglish(v));
  const option = (v) => `<option value="${v.name.replace(/"/g, '&quot;')}">${v.name} (${v.lang})</option>`;
  ui.voice.innerHTML = '<option value="">Default voice</option>' + english.map(option).join('') +
    (others.length ? `<optgroup label="Other languages">${others.map(option).join('')}</optgroup>` : '');
  if (voices.some((v) => v.name === settings.voice)) ui.voice.value = settings.voice;
  else if (english.length) ui.voice.value = english[0].name;
}
if (speech) speech.addEventListener('voiceschanged', refreshVoices);
refreshVoices();

function selectedVoice() {
  return speech ? speech.getVoices().find((v) => v.name === ui.voice.value) : null;
}

// Speaks one word and calls onDone when finished.
function say(text, onDone) {
  if (!speech) { onDone(); return; }
  const u = new SpeechSynthesisUtterance(text);
  const voice = selectedVoice();
  if (voice) u.voice = voice;
  u.lang = voice ? voice.lang : 'en-US';
  u.rate = 0.9;
  u.onend = onDone;
  u.onerror = onDone;
  speech.speak(u);
}

$('test-voice').addEventListener('click', () => {
  if (!speech) return;
  speech.cancel();
  say('one, two, three, four', () => {});
});

// ---- Input ---------------------------------------------------------------

let mouseX = W / 2; // in logical coordinates

addEventListener('mousemove', (e) => {
  const dpr = window.devicePixelRatio || 1;
  mouseX = (e.clientX * dpr - view.ox) / view.scale;
});

addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { togglePause(); return; }
  if (state !== 'playing') return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) pressSpace();
  }
});
addEventListener('blur', () => { if (state === 'playing') togglePause(); });

// Mouse offset from the middle of the control area, -1..1.
function mouseControl() {
  const v = Math.max(-1, Math.min(1, (mouseX - CONTROL.x) / CONTROL.halfWidth));
  return settings.invert ? -v : v;
}

// ---- Helpers -------------------------------------------------------------

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);

// ---- Game state ----------------------------------------------------------

let state = 'menu'; // menu | briefing | playing | paused | results
let cfg = DIFFICULTY.normal;
let game = null;

// A target like { red: 2, blue: 1 }: two colours, 1-3 of each.
function newTarget(previous) {
  let target;
  do {
    const [a, b] = shuffle([...COLOR_KEYS]);
    const na = randInt(1, 3);
    const nb = randInt(1, Math.min(3, 5 - na));
    target = { [a]: na, [b]: nb };
  } while (previous && JSON.stringify(target) === JSON.stringify(previous));
  return target;
}

function newGame() {
  cfg = DIFFICULTY[settings.difficulty];
  return {
    tasks: { ...settings.tasks },
    duration: Number(settings.duration),
    t: 0,
    balance: { angle: 0, drift: 0 },
    // red: null, or { side, cell, arm (-1 while in the tower), turning, leftAt }
    towers: { red: null, nextAt: rand(1, 3), stepAcc: 0 },
    colors: {
      target: null, targetShownUntil: 0, nextTargetAt: 1,
      row: [], matched: false, answered: false, changeAt: 0, prev: null,
    },
    audio: { stage: 'wait', at: rand(6, 10), token: 0 },
    flashes: [], // { area, good, until }
    stats: {
      balanceIn: 0, balanceTime: 0, angleSum: 0,
      towerHits: 0, towerMisses: 0,
      colorHits: 0, colorMisses: 0,
      audioHits: 0, audioMisses: 0, audioFalse: 0, audioCorrectReject: 0, audioTrials: 0,
      falsePresses: 0,
    },
  };
}

function flash(area, good) {
  if (settings.feedback) game.flashes.push({ area, good, until: game.t + 0.6 });
}

// ---- Task: balance -------------------------------------------------------

function updateBalance(dt) {
  const b = game.balance;
  const s = game.stats;
  // A random push that wanders over time, plus a pull further over once it
  // tips. Moving the mouse towards the side it tips to brings it back.
  b.drift += (Math.random() * 2 - 1) * cfg.balanceNoise * 3 * dt;
  b.drift *= 1 - 0.5 * dt;
  b.drift = Math.max(-cfg.balanceNoise, Math.min(cfg.balanceNoise, b.drift));
  b.angle += (b.drift + b.angle * cfg.balanceUnstable - mouseControl() * cfg.balanceRate) * dt;
  b.angle = Math.max(-BALANCE_MAX, Math.min(BALANCE_MAX, b.angle));

  s.balanceTime += dt;
  s.angleSum += Math.abs(b.angle) * dt;
  if (Math.abs(b.angle) <= BALANCE_OK) s.balanceIn += dt;
}

// ---- Task: towers --------------------------------------------------------

function updateTowers(dt) {
  const tw = game.towers;

  if (!tw.red) {
    if (game.t >= tw.nextAt) {
      tw.red = { side: randInt(0, 1), cell: 0, arm: -1, turning: Math.random() < TURN_CHANCE, leftAt: null };
      tw.stepAcc = 0;
    }
    return;
  }

  const r = tw.red;
  if (r.leftAt === null) {
    tw.stepAcc += dt;
    while (tw.stepAcc >= RED_STEP && r.leftAt === null) {
      tw.stepAcc -= RED_STEP;
      if (r.arm >= 0) r.arm += 1;
      else if (r.turning && r.cell === MIDDLE_CELL) r.arm = 0;
      else r.cell += 1;
      if (r.arm >= ARM_CELLS || r.cell >= TOWER_CELLS) r.leftAt = game.t;
    }
  }

  if (r.leftAt !== null) {
    // A turning square that wasn't answered gets a short grace period.
    if (!r.turning || game.t - r.leftAt > TOWER_GRACE) {
      if (r.turning) { game.stats.towerMisses += 1; flash('towers', false); }
      clearRed();
    }
  }
}

function clearRed() {
  game.towers.red = null;
  game.towers.nextAt = game.t + rand(cfg.redGapMin, cfg.redGapMax);
}

// ---- Task: colours -------------------------------------------------------

function rowMatches(row, target) {
  if (!target) return false;
  const counts = {};
  for (const c of row) counts[c] = (counts[c] || 0) + 1;
  return Object.entries(target).every(([c, n]) => (counts[c] || 0) === n);
}

function newRow(target) {
  if (target && Math.random() < MATCH_CHANCE) {
    const row = [];
    for (const [c, n] of Object.entries(target)) for (let i = 0; i < n; i++) row.push(c);
    const others = COLOR_KEYS.filter((c) => !(c in target));
    while (row.length < ROW_CELLS) row.push(others[randInt(0, others.length - 1)]);
    return shuffle(row);
  }
  return Array.from({ length: ROW_CELLS }, () => COLOR_KEYS[randInt(0, COLOR_KEYS.length - 1)]);
}

function updateColors() {
  const c = game.colors;

  if (game.t >= c.nextTargetAt) {
    c.target = newTarget(c.target);
    c.targetShownUntil = game.t + TARGET_VISIBLE;
    c.nextTargetAt = game.t + rand(TARGET_EVERY_MIN, TARGET_EVERY_MAX);
    c.changeAt = game.t; // start a fresh row for the new pattern
  }

  if (game.t >= c.changeAt) {
    if (c.matched && !c.answered) c.prev = { until: game.t + COLOR_GRACE };
    c.row = newRow(c.target);
    c.matched = rowMatches(c.row, c.target);
    c.answered = false;
    c.changeAt = game.t + cfg.colorChange;
  }

  if (c.prev && game.t > c.prev.until) {
    c.prev = null;
    game.stats.colorMisses += 1;
    flash('colors', false);
  }
}

// ---- Task: numbers -------------------------------------------------------

function newSequences() {
  const first = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 4);
  const reversed = [...first].reverse();
  if (Math.random() < REVERSED_CHANCE) return { first, second: reversed, isReversed: true };

  // Something close to the reverse, so it has to be listened to carefully.
  let second;
  const kind = randInt(0, 2);
  if (kind === 0) {
    second = [...first]; // same order, not reversed
  } else if (kind === 1) {
    second = [...reversed];
    const i = randInt(0, 2);
    [second[i], second[i + 1]] = [second[i + 1], second[i]];
  } else {
    second = [...reversed];
    const i = randInt(0, 3);
    const unused = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => !first.includes(d));
    second[i] = unused[randInt(0, unused.length - 1)];
  }
  return { first, second, isReversed: false };
}

// Reads all four digits in one go and moves on when the voice finishes.
function startSequence(stage, digits) {
  const a = game.audio;
  const token = ++a.token;
  Object.assign(a, { stage, speaking: true, at: game.t + 10 });
  say(digits.map((d) => DIGIT_WORDS[d]).join(', '), () => {
    if (game && game.audio === a && a.token === token && a.speaking) sequenceDone();
  });
}

function sequenceDone() {
  const a = game.audio;
  a.speaking = false;
  if (a.stage === 'first') { a.stage = 'pause'; a.at = game.t + AUDIO_PAUSE; }
  else { a.stage = 'answer'; a.at = game.t + AUDIO_ANSWER; }
}

function updateAudio() {
  const a = game.audio;
  const t = game.t;

  if (a.stage === 'wait' && t >= a.at) {
    Object.assign(a, newSequences(), { answered: false });
    startSequence('first', a.first);
  } else if (a.stage === 'pause' && t >= a.at) {
    startSequence('second', a.second);
  } else if (a.stage === 'answer' && t >= a.at) {
    finishAudioTrial();
  } else if ((a.stage === 'first' || a.stage === 'second') && t >= a.at) {
    // Safety net in case the browser never reports the end of speech.
    speech?.cancel();
    sequenceDone();
  }
}

function finishAudioTrial() {
  const a = game.audio;
  const s = game.stats;
  s.audioTrials += 1;
  if (a.isReversed && !a.answered) { s.audioMisses += 1; flash('audio', false); }
  if (!a.isReversed && !a.answered) s.audioCorrectReject += 1;
  a.stage = 'wait';
  a.at = game.t + rand(cfg.audioGapMin, cfg.audioGapMax);
}

// ---- Responses -----------------------------------------------------------

// Space answers every task with something open right now.
function pressSpace() {
  let answered = false;

  if (game.tasks.towers) {
    const r = game.towers.red;
    if (r && r.turning && r.arm >= 0) {
      game.stats.towerHits += 1;
      flash('towers', true);
      clearRed();
      answered = true;
    }
  }

  if (game.tasks.colors) {
    const c = game.colors;
    if ((c.matched && !c.answered) || c.prev) {
      if (c.matched && !c.answered) c.answered = true;
      else c.prev = null;
      game.stats.colorHits += 1;
      flash('colors', true);
      answered = true;
    }
  }

  let audioWrong = false;
  if (game.tasks.audio) {
    const a = game.audio;
    if ((a.stage === 'second' || a.stage === 'answer') && !a.answered) {
      if (a.isReversed) {
        a.answered = true;
        game.stats.audioHits += 1;
        flash('audio', true);
        answered = true;
      } else {
        audioWrong = true;
      }
    }
  }

  if (answered) return;
  // Nothing else was open: a press during a non-reversed pair is a wrong
  // answer to the numbers, otherwise it's a press with nothing to answer.
  if (audioWrong) {
    game.audio.answered = true;
    game.stats.audioFalse += 1;
    flash('audio', false);
  } else {
    game.stats.falsePresses += 1;
    flash('space', false);
  }
}

// ---- Update --------------------------------------------------------------

function update(dt) {
  game.t += dt;
  if (game.tasks.balance) updateBalance(dt);
  if (game.tasks.towers) updateTowers(dt);
  if (game.tasks.colors) updateColors();
  if (game.tasks.audio) updateAudio();
  game.flashes = game.flashes.filter((f) => f.until > game.t);
  if (game.t >= game.duration) finish();
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

const OFF = '#22384d';
const RED = '#ff4d4d';

function flashColor(area) {
  const f = game.flashes.find((x) => x.area === area);
  return f ? (f.good ? '#4cd18a' : '#ff6b6b') : null;
}

function outlineRect(x, y, w, h, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
}

function cellRect(x, y, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(x - CELL / 2, y - CELL / 2, CELL, CELL);
}

function drawTowers() {
  const r = game.towers.red;
  const outline = flashColor('towers') || flashColor('space');
  TOWER_X.forEach((x, side) => {
    const dir = side === 0 ? 1 : -1;
    const lit = r && r.side === side && r.leftAt === null ? r : null;
    for (let i = 0; i < TOWER_CELLS; i++) {
      cellRect(x, TOWER_TOP + i * PITCH, lit && lit.arm < 0 && lit.cell === i ? RED : OFF);
    }
    for (let i = 0; i < ARM_CELLS; i++) {
      cellRect(x + dir * (i + 1) * PITCH, TOWER_TOP + MIDDLE_CELL * PITCH, lit && lit.arm === i ? RED : OFF);
    }
    if (outline) outlineRect(x - CELL, TOWER_TOP - CELL, CELL * 2, (TOWER_CELLS - 1) * PITCH + CELL * 2, outline);
  });
}

function drawColors() {
  const c = game.colors;
  const total = ROW_CELLS * ROW_SIZE + (ROW_CELLS - 1) * ROW_GAP;
  const left = W / 2 - total / 2;
  for (let i = 0; i < ROW_CELLS; i++) {
    ctx.fillStyle = c.row[i] ? COLORS[c.row[i]].fill : OFF;
    ctx.fillRect(left + i * (ROW_SIZE + ROW_GAP), ROW_Y - ROW_SIZE / 2, ROW_SIZE, ROW_SIZE);
  }
  const outline = flashColor('colors') || flashColor('space');
  if (outline) outlineRect(left - 10, ROW_Y - ROW_SIZE / 2 - 10, total + 20, ROW_SIZE + 20, outline);

  // A new pattern to look for is shown for a few seconds under the row.
  if (c.target && game.t < c.targetShownUntil) {
    const entries = Object.entries(c.target);
    ctx.font = '600 30px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'middle';
    const parts = entries.map(([k, n]) => ({ k, text: `${n} ${COLORS[k].name}` }));
    const swatch = 26;
    const gap = 40;
    const widths = parts.map((p) => swatch + 10 + ctx.measureText(p.text).width);
    let x = W / 2 - (widths.reduce((a, b) => a + b, 0) + gap * (parts.length - 1)) / 2;
    const y = ROW_Y + 75;
    parts.forEach((p, i) => {
      ctx.fillStyle = COLORS[p.k].fill;
      ctx.fillRect(x, y - swatch / 2, swatch, swatch);
      ctx.fillStyle = '#e6eef5';
      ctx.fillText(p.text, x + swatch + 10, y);
      x += widths[i] + gap;
    });
  }
}

function drawBalance() {
  const b = game.balance;
  const s = SQUARE_HALF_DIAGONAL;

  // Square on one corner, split corner to corner across the middle, turning
  // around its centre.
  ctx.save();
  ctx.translate(SQUARE_CENTER.x, SQUARE_CENTER.y);
  ctx.rotate((b.angle * Math.PI) / 180);
  ctx.fillStyle = '#e6eef5';
  ctx.beginPath();
  ctx.moveTo(-s, 0); ctx.lineTo(0, -s); ctx.lineTo(s, 0); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#4f7ea8';
  ctx.beginPath();
  ctx.moveTo(-s, 0); ctx.lineTo(0, s); ctx.lineTo(s, 0); ctx.closePath();
  ctx.fill();
  const outline = flashColor('balance');
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-s, 0); ctx.lineTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(0, s); ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();

  // Mouse area with a marker where the mouse is.
  const left = CONTROL.x - CONTROL.halfWidth;
  ctx.fillStyle = '#0f1e2b';
  ctx.fillRect(left, CONTROL.y, CONTROL.halfWidth * 2, CONTROL.height);
  ctx.strokeStyle = '#2c4560';
  ctx.lineWidth = 2;
  ctx.strokeRect(left, CONTROL.y, CONTROL.halfWidth * 2, CONTROL.height);
  ctx.beginPath();
  ctx.moveTo(CONTROL.x, CONTROL.y);
  ctx.lineTo(CONTROL.x, CONTROL.y + CONTROL.height);
  ctx.stroke();
  const mx = Math.max(left, Math.min(left + CONTROL.halfWidth * 2, mouseX));
  ctx.fillStyle = '#4fb3ff';
  ctx.fillRect(mx - 4, CONTROL.y + 6, 8, CONTROL.height - 12);
}

function drawAudio() {
  const a = game.audio;
  const outline = flashColor('audio');
  const speaking = a.stage === 'first' || a.stage === 'second';
  const reading = speaking || a.stage === 'pause';
  // Small speaker sign at the bottom so it's clear when numbers are read.
  const x = W / 2;
  const y = 920;
  ctx.fillStyle = reading ? '#e6eef5' : a.stage === 'answer' ? '#8fa6ba' : '#2c4560';
  ctx.beginPath();
  ctx.moveTo(x - 22, y - 8); ctx.lineTo(x - 12, y - 8); ctx.lineTo(x, y - 20);
  ctx.lineTo(x, y + 20); ctx.lineTo(x - 12, y + 8); ctx.lineTo(x - 22, y + 8);
  ctx.closePath();
  ctx.fill();
  if (speaking && a.speaking) {
    ctx.strokeStyle = '#e6eef5';
    ctx.lineWidth = 3;
    for (const r of [12, 22]) {
      ctx.beginPath();
      ctx.arc(x + 2, y, r, -0.7, 0.7);
      ctx.stroke();
    }
  }
  if (outline) outlineRect(x - 40, y - 34, 80, 68, outline);
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0e1a24';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
  ctx.fillStyle = '#13283a';
  ctx.fillRect(0, 0, W, H);

  if (!game) return;
  if (game.tasks.towers) drawTowers();
  if (game.tasks.colors) drawColors();
  if (game.tasks.balance) drawBalance();
  if (game.tasks.audio) drawAudio();
}

// ---- Flow ----------------------------------------------------------------

function show(el, on) { el.hidden = !on; }

let briefingTimer = null;

function startGame() {
  readSettings();
  if (!Object.values(settings.tasks).some(Boolean)) {
    ui.tasks.balance.checked = true;
    readSettings();
  }
  document.activeElement?.blur();
  speech?.cancel();
  game = newGame();
  show(ui.menu, false);
  show(ui.results, false);
  show(ui.pause, false);

  let n = 3;
  ui.briefingCount.textContent = n;
  show(ui.briefing, true);
  state = 'briefing';
  clearInterval(briefingTimer);
  briefingTimer = setInterval(() => {
    n -= 1;
    if (n > 0) { ui.briefingCount.textContent = n; return; }
    clearInterval(briefingTimer);
    show(ui.briefing, false);
    if (state !== 'briefing') return;
    state = 'playing';
    show(ui.hud, true);
    document.body.classList.add('playing');
  }, 1000);
}

function togglePause() {
  if (state === 'playing') {
    state = 'paused';
    document.body.classList.remove('playing');
    show(ui.pause, true);
    // Stop any numbers being read; a fresh pair starts after resuming.
    speech?.cancel();
    const a = game.audio;
    if (a.stage !== 'wait') { a.stage = 'wait'; a.at = game.t + 3; a.token += 1; a.speaking = false; }
  } else if (state === 'paused') {
    state = 'playing';
    document.body.classList.add('playing');
    show(ui.pause, false);
  }
}

function toMenu() {
  clearInterval(briefingTimer);
  speech?.cancel();
  state = 'menu';
  game = null;
  document.body.classList.remove('playing');
  for (const el of [ui.pause, ui.results, ui.hud, ui.briefing]) show(el, false);
  show(ui.menu, true);
  renderHistory();
}

function finish() {
  state = 'results';
  speech?.cancel();
  document.body.classList.remove('playing');
  show(ui.hud, false);
  const s = game.stats;
  const tk = game.tasks;

  const parts = {
    balance: tk.balance ? pct(s.balanceIn, s.balanceTime) : null,
    towers: tk.towers ? pct(s.towerHits, s.towerHits + s.towerMisses) : null,
    colors: tk.colors ? pct(s.colorHits, s.colorHits + s.colorMisses) : null,
    audio: tk.audio ? pct(s.audioHits + s.audioCorrectReject, s.audioTrials) : null,
  };
  const scored = Object.values(parts).filter((v) => v !== null);
  const average = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : 0;
  const score = Math.max(0, Math.round(average - s.falsePresses * FALSE_PRESS_PENALTY));

  const result = { date: new Date().toISOString(), difficulty: settings.difficulty, duration: game.duration, score, ...parts };
  history = [result, ...history].slice(0, 20);
  save('fourInOne.history', history);

  const avgAngle = s.balanceTime ? s.angleSum / s.balanceTime : 0;
  const row = (label, value, detail) =>
    `<div class="stat"><span>${label}<small>${detail}</small></span><b>${value === null ? '–' : `${value}%`}</b></div>`;
  let html = `<div class="score">${score}</div>`;
  if (tk.balance) html += row('Balance', parts.balance, `Within ±${BALANCE_OK}° · average tilt ${avgAngle.toFixed(1)}°`);
  if (tk.towers) html += row('Towers', parts.towers, `${s.towerHits} caught · ${s.towerMisses} missed`);
  if (tk.colors) html += row('Colours', parts.colors, `${s.colorHits} caught · ${s.colorMisses} missed`);
  if (tk.audio) {
    html += row('Numbers', parts.audio,
      `${s.audioHits} reversed caught · ${s.audioMisses} missed · ${s.audioFalse} wrong presses · ${s.audioTrials} pairs`);
  }
  html += `<div class="stat"><span>Presses with nothing to answer<small>−${FALSE_PRESS_PENALTY} points each</small></span><b>${s.falsePresses}</b></div>`;
  ui.resultsBody.innerHTML = html;
  show(ui.results, true);
}

function renderHistory() {
  if (!history.length) { ui.history.innerHTML = ''; return; }
  const cell = (v) => (v === null || v === undefined ? '–' : `${v}%`);
  const rows = history.slice(0, 8).map((r) => `
    <tr><td>${new Date(r.date).toLocaleDateString()}</td><td>${r.difficulty}</td>
    <td>${cell(r.balance)}</td><td>${cell(r.towers)}</td><td>${cell(r.colors)}</td><td>${cell(r.audio)}</td>
    <td><b>${r.score}</b></td></tr>`).join('');
  ui.history.innerHTML = `<h3>Recent results</h3><table>
    <tr><th>Date</th><th>Level</th><th>Balance</th><th>Towers</th><th>Colours</th><th>Numbers</th><th>Score</th></tr>${rows}</table>`;
}

function updateHud() {
  const left = Math.max(0, game.duration - game.t);
  ui.hudTime.textContent = `${Math.floor(left / 60)}:${Math.floor(left % 60).toString().padStart(2, '0')}`;
}

$('start').addEventListener('click', startGame);
$('again').addEventListener('click', startGame);
$('resume').addEventListener('click', togglePause);
$('quit').addEventListener('click', toMenu);
$('to-menu').addEventListener('click', toMenu);

// ---- Main loop -----------------------------------------------------------

let last = performance.now();
function frame(now) {
  // Cap the step so a hidden tab or a slow frame can't jump the game ahead.
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state === 'playing') update(dt);
  if (game) updateHud();
  draw();
  requestAnimationFrame(frame);
}

renderHistory();
requestAnimationFrame(frame);
