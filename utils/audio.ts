// utils/audio.ts
let audioCtx: AudioContext | null = null;

let collisionBuffer: AudioBuffer | null = null;
let potBuffer: AudioBuffer | null = null;
let chalkBuffer: AudioBuffer | null = null;
let welcomeBuffer: AudioBuffer | null = null;

let loadingPromise: Promise<void> | null = null;

// Works in dev + GitHub Pages + TWA/APK
const BASE = import.meta.env.BASE_URL;

const SOUND_FILES = {
  collision: `${BASE}audio/billiard-sound-01-288421.mp3`,
  pot: `${BASE}audio/potting-snooker-balls-102457.mp3`,
  chalk: `${BASE}audio/cue_chalk.mp3`,
  welcome: `${BASE}audio/welcome-sound.mp3`,
};

const loadBuffer = async (ctx: AudioContext, url: string): Promise<AudioBuffer | null> => {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.arrayBuffer();
    return await ctx.decodeAudioData(data);
  } catch (e) {
    console.warn('[audio] failed to load:', url, e);
    return null;
  }
};

// Call this from user gesture (click/tap). Safe to call multiple times.
export const initAudio = async () => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }

  if (audioCtx.state === 'suspended') {
    await audioCtx.resume().catch(() => {});
  }

  // Load only once (avoid repeated fetch/decode)
  if (!loadingPromise) {
    loadingPromise = (async () => {
      collisionBuffer = await loadBuffer(audioCtx!, SOUND_FILES.collision);
      potBuffer = await loadBuffer(audioCtx!, SOUND_FILES.pot);
      chalkBuffer = await loadBuffer(audioCtx!, SOUND_FILES.chalk);
      welcomeBuffer = await loadBuffer(audioCtx!, SOUND_FILES.welcome);
    })();
  }

  await loadingPromise;
  return audioCtx;
};

export const playCollisionSound = (impact: number) => {
  if (!audioCtx || !collisionBuffer || impact < 0.02) return;

  const src = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();

  src.buffer = collisionBuffer;
  src.playbackRate.value = 0.95 + Math.random() * 0.1;

  filter.type = 'lowpass';
  filter.frequency.value = 800 + impact * 14000;

  gain.gain.value = Math.min(Math.pow(impact, 0.8), 1.2);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);

  src.start();
};

export const playPotSound = () => {
  if (!audioCtx || !potBuffer) return;

  const src = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();

  src.buffer = potBuffer;
  src.playbackRate.value = 0.98 + Math.random() * 0.04;
  gain.gain.value = 0.8;

  src.connect(gain);
  gain.connect(audioCtx.destination);
  src.start();
};

export const playChalkSound = () => {
  if (!audioCtx || !chalkBuffer) return;

  const src = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();

  src.buffer = chalkBuffer;
  gain.gain.value = 0.6;

  src.connect(gain);
  gain.connect(audioCtx.destination);
  src.start();
};

// Promise-based to match your existing playWelcomeAudio().then(...)
export const playWelcomeAudio = (): Promise<void> => {
  return new Promise((resolve) => {
    if (!audioCtx || !welcomeBuffer) return resolve();

    const src = audioCtx.createBufferSource();
    src.buffer = welcomeBuffer;
    src.connect(audioCtx.destination);

    src.onended = () => resolve();
    try {
      src.start();
    } catch {
      resolve();
    }
  });
};
