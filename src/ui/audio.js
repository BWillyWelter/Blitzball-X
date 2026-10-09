/**
 * FFX Sphere Pool Procedural Web Audio Engine & Synthesizer
 */

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.underwaterGain = null;
    this.ambientOsc = null;
    this.bubbleTimer = null;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    this.ctx = new AudioContext();

    // Master Output Node
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.7;
    this.masterGain.connect(this.ctx.destination);

    // Dedicated Underwater Low-Pass Bus
    this.underwaterBus = this.ctx.createBiquadFilter();
    this.underwaterBus.type = 'lowpass';
    this.underwaterBus.frequency.value = 450; // Muffles high frequencies for underwater immersion
    this.underwaterBus.connect(this.masterGain);

    this.initialized = true;
  }

  ensureContext() {
    if (!this.initialized) this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Starts continuous underwater sphere pool sub-bass ambient hum and random bubble pops
   */
  startSpherePoolAmbience() {
    this.ensureContext();
    if (!this.ctx || this.ambientOsc) return;

    const now = this.ctx.currentTime;

    // Sub-bass ambient pool drone (55Hz rumble)
    this.ambientOsc = this.ctx.createOscillator();
    const ambientGain = this.ctx.createGain();

    this.ambientOsc.type = 'sine';
    this.ambientOsc.frequency.setValueAtTime(55, now);

    // LFO to gently oscillate the pool hum depth
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.setValueAtTime(0.2, now); // 0.2Hz slow pulse
    lfoGain.gain.setValueAtTime(8, now);

    lfo.connect(this.ambientOsc.frequency);
    lfo.start(now);

    ambientGain.gain.setValueAtTime(0.3, now);

    this.ambientOsc.connect(ambientGain);
    ambientGain.connect(this.underwaterBus);
    this.ambientOsc.start(now);

    // Schedule periodic underwater bubble pop accents
    this.bubbleTimer = setInterval(() => {
      if (Math.random() > 0.4) this.playBubblePop();
    }, 1200);
  }

  /**
   * Generates a single underwater bubble pop sound
   */
  playBubblePop() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    const startFreq = 250 + Math.random() * 200;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(startFreq * 2.2, now + 0.08); // Rising pitch pitch sweep

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(this.underwaterBus);

    osc.start(now);
    osc.stop(now + 0.09);
  }

  /**
   * Sharp 裁判 (Ref) Whistle Snap for match kickoff, half-time, and goals
   */
  playRefWhistle() {
    this.ensureContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // Dual modulated sine waves for realistic whistle beat frequency
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'sine';

    osc1.frequency.setValueAtTime(2400, now);
    osc2.frequency.setValueAtTime(2450, now); // 50Hz beat interference

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.6, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.masterGain); // Bypass underwater bus for crisp surface whistle sound

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.36);
    osc2.stop(now + 0.36);
  }

  /**
   * Dynamic crowd cheer roar for goal execution and Jecht Shots
   * @param {number} intensity Level of cheer hype (0.5 to 2.0)
   */
  playCrowdCheer(intensity = 1.0) {
    this.ensureContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const duration = 1.8 * intensity;

    // Filtered pink noise buffer for crowd roar
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      data[i] = (b0 + b1 + b2) * 0.1;
    }

    const crowdSource = this.ctx.createBufferSource();
    crowdSource.buffer = buffer;

    // Bandpass filter centered around stadium resonance
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800, now);
    filter.Q.setValueAtTime(1.2, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.5 * intensity, now + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    crowdSource.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    crowdSource.start(now);
  }

  stopAmbience() {
    if (this.ambientOsc) {
      this.ambientOsc.stop();
      this.ambientOsc = null;
    }
    if (this.bubbleTimer) {
      clearInterval(this.bubbleTimer);
      this.bubbleTimer = null;
    }
  }
}
