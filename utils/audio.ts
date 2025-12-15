// utils/audio.ts
let audioCtx: AudioContext | null = null;

let collisionBuffer: AudioBuffer | null = null;
let potBuffer: AudioBuffer | null = null;
let chalkBuffer: AudioBuffer | null = null;
let welcomeBuffer: AudioBuffer | null = null;

// Works for dev + GitHub Pages + APK
const BASE = import.meta.env.BASE_URL;

const SOUND_FILES = {
  collision: `${BASE}audio/billiard-sound-01-288421.mp3`,
  pot: `${BASE}audio/potting-snooker-balls-102457.mp3`,
  chalk: `${BASE}audio/cue_chalk.mp3`,
  welcome: `${BASE}audio/welcome-sound.mp3`,
};

const safeDecode = async (ctx: AudioContext, url: string): Promise<AudioBuffer | null> => {
  try {
    const res = await fetch(url, { cache: "no-cache" });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // If SW/404 returns index.html, content-type will be text/html
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("audio") && !ct.includes("mpeg") && !ct.includes("mp3")) {
      // Read a tiny bit for debugging (optional)
      throw new Error(`Not audio content-type: "${ct}" for ${url}`);
    }

    const data = await res.arrayBuffer();
    return await ctx.decodeAudioData(data);
  } catch (err) {
    console.warn("[audio] Failed to load:", url, err);
    return null;
  }
};

export const initAudio = async () => {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;
    audioCtx = new AudioContextClass();
  }

  if (audioCtx.state === "suspended") {
    await audioCtx.resume();
  }

  // Preload once (but do not crash if any file fails)
  if (!collisionBuffer && !potBuffer && !chalkBuffer && !welcomeBuffer) {
    const [c, p, ch, w] = await Promise.all([
      safeDecode(audioCtx, SOUND_FILES.collision),
      safeDecode(audioCtx, SOUND_FILES.pot),
      safeDecode(audioCtx, SOUND_FILES.chalk),
      safeDecode(audioCtx, SOUND_FILES.welcome),
    ]);

    collisionBuffer = c;
    potBuffer = p;
    chalkBuffer = ch;
    welcomeBuffer = w;
  }

  return audioCtx;
};

// ---------- FALLBACK SYNTHS (only used if mp3 not loading) ----------

const playSynthCollision = (ctx: AudioContext, impact: number) => {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.frequency.setValueAtTime(2000 + Math.random() * 200, t);
  osc.frequency.exponentialRampToValueAtTime(500, t + 0.1);

  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(Math.min(Math.max(impact, 0.05), 1), t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);

  osc.start(t);
  osc.stop(t + 0.12);
};

const playSynthPot = (ctx: AudioContext) => {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "square";
  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.frequency.setValueAtTime(120, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.18);

  gain.gain.setValueAtTime(0.35, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);

  osc.start(t);
  osc.stop(t + 0.25);
};

const playSynthChalk = (ctx: AudioContext) => {
  const t = ctx.currentTime;
  const bufferSize = Math.floor(ctx.sampleRate * 0.25);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.25;

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1500;
  filter.Q.value = 1;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(0.22, t + 0.03);
  gain.gain.linearRampToValueAtTime(0.0001, t + 0.22);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  src.start(t);
};

const playBuffer = (ctx: AudioContext, buf: AudioBuffer, volume = 1, rate = 1) => {
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();

  src.buffer = buf;
  src.playbackRate.value = rate;

  gain.gain.value = volume;

  src.connect(gain);
  gain.connect(ctx.destination);

  src.start(0);
  return src;
};

// ---------- PUBLIC API ----------

export const playCollisionSound = (impact: number) => {
  if (!audioCtx) return;
  if (impact < 0.02) return;

  if (collisionBuffer) {
    const pitchRandom = 0.95 + Math.random() * 0.1;
    const rate = pitchRandom + impact * 0.05;

    // Filter to make soft hits dull, hard hits bright
    const src = audioCtx.createBufferSource();
    src.buffer = collisionBuffer;
    src.playbackRate.value = rate;

    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 800 + Math.pow(impact, 0.5) * 15000;

    const gain = audioCtx.createGain();
    gain.gain.value = Math.min(Math.pow(impact, 0.8), 1.2);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);

    src.start(0);
  } else {
    playSynthCollision(audioCtx, impact);
  }
};

export const playPotSound = () => {
  if (!audioCtx) return;

  if (potBuffer) {
    playBuffer(audioCtx, potBuffer, 0.8, 0.98 + Math.random() * 0.04);
  } else {
    playSynthPot(audioCtx);
  }
};

export const playChalkSound = () => {
  if (!audioCtx) return;

  if (chalkBuffer) {
    playBuffer(audioCtx, chalkBuffer, 0.6, 1);
  } else {
    playSynthChalk(audioCtx);
  }
};

export const playWelcomeAudio = async (): Promise<void> => {
  // Ensure context exists and is resumed (but do NOT force user click here)
  if (!audioCtx) return;

  if (welcomeBuffer) {
    await new Promise<void>((resolve) => {
      const src = playBuffer(audioCtx!, welcomeBuffer!, 1, 1);
      src.onended = () => resolve();
    });
    return;
  }

  // If mp3 failed, fall back to TTS
  if ("speechSynthesis" in window) {
    await new Promise<void>((resolve) => {
      const text = "Welcome to AZ Snooker Master. Thank you guys, ready for first frame? Let's play";
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      u.volume = 1.0;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }
};
