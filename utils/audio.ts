
let audioCtx: AudioContext | null = null;
let collisionBuffer: AudioBuffer | null = null;
let potBuffer: AudioBuffer | null = null;
let chalkBuffer: AudioBuffer | null = null;
let welcomeBuffer: AudioBuffer | null = null;

// File references as requested
const SOUND_FILES = {
    collision: '/billiard-sound-01-288421.mp3', 
    pot: '/potting-snooker-balls-102457.mp3',
    chalk: '/cue_chalk.mp3',
    welcome: '/welcome-sound.mp3'
};

const loadBuffer = async (ctx: AudioContext, url: string): Promise<AudioBuffer | null> => {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        return await ctx.decodeAudioData(arrayBuffer);
    } catch (e) {
        // Silent fail for optional sounds, will use fallback
        return null;
    }
};

export const initAudio = () => {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
            audioCtx = new AudioContextClass();
            
            // Preload sounds immediately
            loadBuffer(audioCtx, SOUND_FILES.collision).then(b => collisionBuffer = b);
            loadBuffer(audioCtx, SOUND_FILES.pot).then(b => potBuffer = b);
            loadBuffer(audioCtx, SOUND_FILES.chalk).then(b => chalkBuffer = b);
            loadBuffer(audioCtx, SOUND_FILES.welcome).then(b => welcomeBuffer = b);
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
};

// Fallback Synth for Collisions (if file missing)
const playSynthCollision = (ctx: AudioContext, impact: number) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    // Simple "tink" sound
    osc.frequency.setValueAtTime(2000 + Math.random() * 200, t);
    osc.frequency.exponentialRampToValueAtTime(500, t + 0.1);
    
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(Math.min(impact, 1), t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    
    osc.start(t);
    osc.stop(t + 0.15);
};

// Fallback Synth for Potting (if file missing)
const playSynthPot = (ctx: AudioContext) => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'square';
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.frequency.setValueAtTime(100, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    
    osc.start(t);
    osc.stop(t + 0.25);
};

// Fallback Synth for Chalking (White Noise)
const playSynthChalk = (ctx: AudioContext) => {
    const t = ctx.currentTime;
    const bufferSize = ctx.sampleRate * 0.4; // 400ms
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.5;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1500;
    filter.Q.value = 1;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.1);
    gain.gain.linearRampToValueAtTime(0, t + 0.4);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    
    noise.start(t);
};

export const playCollisionSound = (impact: number) => {
    if (!audioCtx) return;
    
    // Threshold to prevent noise on tiny sliding movements
    if (impact < 0.02) return;

    // Use loaded buffer if available
    if (collisionBuffer) {
        const source = audioCtx.createBufferSource();
        source.buffer = collisionBuffer;
        
        // --- REALISM TWEAKS ---
        // 1. Pitch Variance: Real balls never sound exactly identical. 
        // Vary pitch by +/- 5% based on randomness and impact.
        // Harder hits tend to pitch up slightly due to material compression.
        const pitchRandom = 0.95 + Math.random() * 0.1;
        source.playbackRate.value = pitchRandom + (impact * 0.05);

        // 2. Dynamic Filtering: Soft hits shouldn't just be quieter, they should be "duller".
        // Hard hits are "brighter". We use a Low Pass Filter to simulate this.
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        // Map impact (0-1) to Frequency (800Hz - 22000Hz)
        // Soft hit = ~800Hz cutoff (muffled). Hard hit = Open filter (crisp).
        filter.frequency.value = 800 + (Math.pow(impact, 0.5) * 15000);
        
        const gain = audioCtx.createGain();
        // Volume curve: Impact is 0-1+, gain needs to be logarithmic-ish
        gain.gain.value = Math.min(Math.pow(impact, 0.8), 1.5);

        source.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);
        
        source.start(0);
    } else {
        playSynthCollision(audioCtx, impact);
    }
};

export const playPotSound = () => {
    if (!audioCtx) return;
    
    if (potBuffer) {
        const source = audioCtx.createBufferSource();
        source.buffer = potBuffer;
        
        // Slight variance for potting too
        source.playbackRate.value = 0.98 + Math.random() * 0.04;
        
        const gain = audioCtx.createGain();
        gain.gain.value = 0.8;
        
        source.connect(gain);
        gain.connect(audioCtx.destination);
        
        source.start(0);
    } else {
        playSynthPot(audioCtx);
    }
};

export const playChalkSound = () => {
    if (!audioCtx) return;

    if (chalkBuffer) {
        const source = audioCtx.createBufferSource();
        source.buffer = chalkBuffer;
        
        const gain = audioCtx.createGain();
        gain.gain.value = 0.6; 
        
        source.connect(gain);
        gain.connect(audioCtx.destination);
        
        source.start(0);
    } else {
        playSynthChalk(audioCtx);
    }
};

export const playWelcomeAudio = (): Promise<void> => {
    return new Promise((resolve) => {
        // Try Buffer First
        if (audioCtx && welcomeBuffer) {
            const source = audioCtx.createBufferSource();
            source.buffer = welcomeBuffer;
            source.connect(audioCtx.destination);
            source.onended = () => resolve();
            source.start(0);
            return;
        }

        // Fallback to TTS
        if ('speechSynthesis' in window) {
             const text = "Welcome to AZ Snooker Master. Thank you guys, ready for first frame? Let's play";
             const utterance = new SpeechSynthesisUtterance(text);
             utterance.rate = 0.95;
             utterance.volume = 1.0;
             
             // Prefer English Male voice
             const voices = window.speechSynthesis.getVoices();
             const preferred = voices.find(v => v.name.includes('English') && (v.name.includes('Male') || v.name.includes('Google US')));
             if (preferred) utterance.voice = preferred;

             utterance.onend = () => resolve();
             utterance.onerror = () => resolve(); // Fail safe
             
             window.speechSynthesis.speak(utterance);
        } else {
            // No Audio capability fallback
            setTimeout(resolve, 3000);
        }
    });
};
