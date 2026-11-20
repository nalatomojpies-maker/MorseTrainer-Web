"use strict";
// MT: Morse trainer in the browser. Web port of morse.py (same behaviour and settings).

const DATA = window.MT_DATA;
const STORAGE_KEY = "mt-config";
const NOISE_LEAD_IN_MS = 1000;
const VOICE_GAP_S = 0;
const NOISE_LOOP_SECONDS = 6;
const BEEP_GAIN = 0.6;

const DEFAULTS = {
  wpm: 15, effective_wpm: 10, tone_hz: 600, pause_seconds: 3, group_length: 1, noise_volume: 3,
  use_letters: true, use_digits: false, use_punctuation: false,
  language: "pl", spelling: false, spell_answer: false, mode: "listen",
  char_pool: "custom", extra_char_gap: 0, noise_enabled: true,
};
const NUMBER_KEYS = ["wpm", "effective_wpm", "tone_hz", "pause_seconds", "group_length", "noise_volume", "extra_char_gap"];
const CHECKBOX_KEYS = ["use_letters", "use_digits", "use_punctuation", "spelling", "spell_answer", "noise_enabled"];
const RADIO_KEYS = ["language", "mode", "char_pool"];
const POOL_PRESETS = {
  letters_digits: { use_letters: true, use_digits: true, use_punctuation: false },
  letters_digits_punctuation: { use_letters: true, use_digits: true, use_punctuation: true },
};

const $ = (id) => document.getElementById(id);
let config = loadConfig();
let audioContext = null;
let runId = 0; // incremented to cancel the running session
let currentGroup = "";
let correct = 0;
let total = 0;
let noiseSource = null;
let wakeLock = null;
const activeSources = new Set();
const clipCache = new Map();

// ---------- config & ui ----------

function loadConfig() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveConfig() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // storage unavailable: settings just won't persist
  }
}

function applyConfigToUi() {
  NUMBER_KEYS.forEach((key) => { $(key).value = config[key]; });
  CHECKBOX_KEYS.forEach((key) => { $(key).checked = Boolean(config[key]); });
  RADIO_KEYS.forEach((key) => {
    const radio = document.querySelector(`input[name=${key}][value=${config[key]}]`);
    if (radio) radio.checked = true;
  });
}

/** Copies the form into `config`; returns false when a number is invalid. */
function syncConfigFromUi() {
  const next = { ...config };
  for (const key of NUMBER_KEYS) {
    const value = parseFloat($(key).value);
    if (Number.isNaN(value)) {
      setStatus("Niepoprawna wartość w ustawieniach.", "bad");
      return false;
    }
    next[key] = value;
  }
  CHECKBOX_KEYS.forEach((key) => { next[key] = $(key).checked; });
  RADIO_KEYS.forEach((key) => { next[key] = document.querySelector(`input[name=${key}]:checked`).value; });
  next.wpm = Math.max(5, next.wpm);
  next.effective_wpm = Math.max(2, Math.min(next.effective_wpm, next.wpm));
  next.group_length = Math.max(1, Math.round(next.group_length));
  next.noise_volume = Math.max(0, Math.min(100, next.noise_volume));
  next.extra_char_gap = Math.max(0, Math.min(20, next.extra_char_gap));
  config = next;
  return true;
}

function readSettings() {
  if (!syncConfigFromUi()) return false;
  if (buildPool().length === 0) {
    setStatus("Wybierz co najmniej jedną pulę znaków.", "bad");
    return false;
  }
  applyConfigToUi();
  saveConfig();
  return true;
}

function setStatus(text, kind = "") {
  const status = $("status");
  status.textContent = text;
  status.className = kind;
}

function buildPool() {
  return [
    ...(config.use_letters ? DATA.letters : []),
    ...(config.use_digits ? DATA.digits : []),
    ...(config.use_punctuation ? DATA.punctuation : []),
  ];
}

function drawGroup() {
  const pool = buildPool();
  return Array.from({ length: config.group_length }, () => pool[Math.floor(Math.random() * pool.length)]).join("");
}

// ---------- audio ----------

function ensureAudio() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}

function track(node) {
  activeSources.add(node);
  node.onended = () => activeSources.delete(node);
}

function stopAllSounds() {
  for (const node of activeSources) {
    try { node.stop(); } catch { /* already stopped */ }
  }
  activeSources.clear();
}

/** Sleeps in short slices; resolves false as soon as the session token is cancelled. */
async function sleep(ms, token) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (token !== runId) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.min(30, end - performance.now()))));
  }
  return token === runId;
}

function scheduleBeep(start, duration) {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const ramp = 0.005;
  oscillator.frequency.value = config.tone_hz;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(BEEP_GAIN, start + ramp);
  gain.gain.setValueAtTime(BEEP_GAIN, start + duration - ramp);
  gain.gain.linearRampToValueAtTime(0, start + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.01);
  track(oscillator);
}

async function playMorseGroup(group, token) {
  const unit = 1.2 / config.wpm;
  const characterGap = (3 * 1.2) / config.effective_wpm;
  const characters = [...group];
  for (const [position, character] of characters.entries()) {
    if (token !== runId) return false;
    const isLast = position === characters.length - 1;
    const extraGap = isLast ? 0 : config.extra_char_gap;
    let time = audioContext.currentTime + 0.05;
    const begin = time;
    [...DATA.morse[character]].forEach((symbol, index) => {
      if (index > 0) time += unit;
      const length = symbol === "." ? unit : 3 * unit;
      scheduleBeep(time, length);
      time += length;
    });
    if (!(await sleep((time - begin + 0.05) * 1000 + (characterGap + extraGap) * 1000, token))) return false;
  }
  return true;
}

function findClip(character) {
  const spelled = DATA.clips[`${config.language}_spell`][character];
  if (config.spelling && spelled) return { key: `${config.language}_spell:${character}`, clip: spelled };
  const plain = DATA.clips[config.language][character];
  return plain ? { key: `${config.language}:${character}`, clip: plain } : null;
}

async function loadClip(character) {
  const found = findClip(character);
  if (!found) return null;
  if (!clipCache.has(found.key)) {
    const bytes = Uint8Array.from(atob(found.clip.b64), (char) => char.charCodeAt(0));
    const buffer = await audioContext.decodeAudioData(bytes.buffer);
    clipCache.set(found.key, {
      buffer, start: found.clip.start / 1000, length: (found.clip.end - found.clip.start) / 1000,
    });
  }
  return clipCache.get(found.key);
}

async function playVoiceGroup(group, token) {
  const clips = (await Promise.all([...group].map((character) => loadClip(character).catch(() => null)))).filter(Boolean);
  if (token !== runId) return false;
  let time = audioContext.currentTime + 0.05;
  const begin = time;
  for (const clip of clips) {
    const source = audioContext.createBufferSource();
    source.buffer = clip.buffer;
    source.connect(audioContext.destination);
    source.start(time, clip.start);
    track(source);
    time += clip.length + VOICE_GAP_S;
  }
  return sleep((time - begin) * 1000 + 300, token); // let the last character finish
}

/** Radio-style static: hiss with drifting level plus crackles, values in [-1, 1]; loops seamlessly. */
function generateRadioStatic(length, sampleRate) {
  const output = new Float32Array(length);
  let smoothed = 0;
  for (let index = 0; index < length; index++) {
    const white = Math.random() * 2 - 1;
    smoothed += 0.5 * (white - smoothed);
    const fade = 0.7 + 0.2 * Math.sin((2 * Math.PI * 2 * index) / length)
      + 0.1 * Math.sin((2 * Math.PI * 7 * index) / length + 1);
    output[index] = 0.5 * fade * (0.6 * white + 0.4 * smoothed);
  }
  const crackleCount = Math.floor(length / sampleRate) * 4; // ~4 per second
  for (let crackle = 0; crackle < crackleCount; crackle++) {
    const start = Math.floor(Math.random() * length);
    const burstLength = 20 + Math.floor(Math.random() * 181);
    const strength = 0.4 + Math.random() * 0.6;
    for (let offset = 0; offset < Math.min(burstLength, length - start); offset++) {
      output[start + offset] += strength * (1 - offset / burstLength) * (Math.random() * 2 - 1);
    }
  }
  return output.map((value) => Math.max(-1, Math.min(1, value)));
}

function startNoise() {
  stopNoise();
  if (!config.noise_enabled || config.noise_volume <= 0) return;
  const sampleRate = audioContext.sampleRate;
  const buffer = audioContext.createBuffer(1, sampleRate * NOISE_LOOP_SECONDS, sampleRate);
  buffer.copyToChannel(generateRadioStatic(buffer.length, sampleRate), 0);
  const gain = audioContext.createGain();
  gain.gain.value = config.noise_volume / 100;
  noiseSource = audioContext.createBufferSource();
  noiseSource.buffer = buffer;
  noiseSource.loop = true;
  noiseSource.connect(gain).connect(audioContext.destination);
  noiseSource.start();
}

function stopNoise() {
  if (noiseSource) {
    try { noiseSource.stop(); } catch { /* already stopped */ }
    noiseSource = null;
  }
}

async function keepScreenAwake() {
  try {
    if (navigator.wakeLock && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }
  } catch {
    // not supported or denied: not essential
  }
}

// ---------- control ----------

function stop() {
  runId++;
  stopAllSounds();
  stopNoise();
  $("answer").disabled = true;
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
  setStatus("Zatrzymano.");
}

function updateScore() {
  $("score").textContent = `Wynik: ${correct} / ${total}`;
}

async function start() {
  if (!readSettings()) return;
  stop();
  ensureAudio();
  keepScreenAwake();
  startNoise();
  correct = 0;
  total = 0;
  updateScore();
  const token = runId;
  if (config.noise_enabled && config.noise_volume > 0) {
    setStatus("Szum... zaraz start.");
    if (!(await sleep(NOISE_LEAD_IN_MS, token))) return;
  }
  if (config.mode === "listen") {
    listenLoop(token);
  } else {
    currentGroup = drawGroup();
    typeRound(token);
  }
}

async function listenLoop(token) {
  while (token === runId) {
    const group = drawGroup();
    setStatus("Słuchaj i mów na głos...");
    if (!(await playMorseGroup(group, token))) return;
    if (!(await sleep(config.pause_seconds * 1000, token))) return;
    setStatus(`Odpowiedź: ${group.toUpperCase()}`);
    if (!(await playVoiceGroup(group, token))) return;
    if (!(await sleep(1000, token))) return;
  }
}

async function typeRound(token) {
  setStatus("Słuchaj...");
  if (!(await playMorseGroup(currentGroup, token))) return;
  const answer = $("answer");
  answer.disabled = false;
  answer.value = "";
  answer.focus();
  setStatus("Wpisz znak(i) i naciśnij Enter.");
}

async function checkAnswer() {
  const answerField = $("answer");
  if (answerField.disabled) return;
  const answered = currentGroup;
  total++;
  if (answerField.value.trim().toLowerCase() === answered) {
    correct++;
    setStatus("Dobrze!", "ok");
  } else {
    setStatus(`Błąd. Poprawnie: ${answered.toUpperCase()}`, "bad");
  }
  updateScore();
  answerField.disabled = true;
  currentGroup = drawGroup();
  const token = runId;
  if (config.spell_answer && !(await playVoiceGroup(answered, token))) return;
  if (!(await sleep(1200, token))) return;
  typeRound(token);
}

function replay() {
  if (config.mode === "type" && currentGroup) {
    ensureAudio();
    playMorseGroup(currentGroup, runId);
  }
}

// ---------- cheat sheet ----------

function wordFor(character) {
  const language = DATA.languages[config.language];
  return language.spelling[character] || language.names[character] || "";
}

function renderCheatSheet() {
  const rows = $("cheat-rows");
  rows.textContent = "";
  for (const [character, code] of Object.entries(DATA.morse)) {
    const row = rows.insertRow();
    row.dataset.character = character;
    row.insertCell().textContent = character.toUpperCase();
    const morseCell = row.insertCell();
    morseCell.className = "morse";
    morseCell.textContent = [...code].map((symbol) => (symbol === "." ? "•" : "—")).join(" ");
    row.insertCell().textContent = wordFor(character);
  }
}

async function playSingle(group) {
  syncConfigFromUi();
  stop();
  ensureAudio();
  const token = runId;
  if (!(await playMorseGroup(group, token))) return;
  if (!(await sleep(400, token))) return;
  playVoiceGroup(group, token);
}

function selectRow(character) {
  document.querySelectorAll("#cheat-rows tr.selected").forEach((row) => row.classList.remove("selected"));
  const row = document.querySelector(`#cheat-rows tr[data-character="${CSS.escape(character)}"]`);
  if (row) {
    row.classList.add("selected");
    row.scrollIntoView({ block: "nearest" });
  }
}

function setupCheatSheet() {
  $("cheat-open").addEventListener("click", () => {
    syncConfigFromUi();
    renderCheatSheet();
    $("cheat").showModal();
    $("lookup").focus();
  });
  $("cheat-rows").addEventListener("click", (event) => {
    const row = event.target.closest("tr");
    if (!row) return;
    selectRow(row.dataset.character);
    playSingle(row.dataset.character);
  });
  $("lookup").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const group = [...$("lookup").value.toLowerCase()].filter((character) => character in DATA.morse).join("");
    if (group) {
      selectRow(group[0]);
      playSingle(group);
    }
  });
}

// ---------- init ----------

applyConfigToUi();
document.querySelectorAll("input[name=char_pool]").forEach((radio) => {
  radio.addEventListener("change", () => {
    const preset = POOL_PRESETS[radio.value];
    if (!preset) return;
    Object.entries(preset).forEach(([key, value]) => { $(key).checked = value; });
  });
});
["use_letters", "use_digits", "use_punctuation"].forEach((key) => {
  $(key).addEventListener("change", () => {
    document.querySelector("input[name=char_pool][value=custom]").checked = true;
  });
});
$("start").addEventListener("click", start);
$("stop").addEventListener("click", stop);
$("replay").addEventListener("click", replay);
$("answer").addEventListener("keydown", (event) => { if (event.key === "Enter") checkAnswer(); });
setupCheatSheet();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* offline mode unavailable */ });
}
