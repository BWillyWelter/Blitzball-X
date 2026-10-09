/**
 * Procedural Web Audio API Sound Engine for Blitzball-X
 * Synthesizes arcade audio in real time without external audio assets:
 * - Victory Crowd Fanfares (synthesized brass/chords)
 * - Stadium Goal Buzzers (dual sawtooth + filter distortion growl)
 * - Water Splash Impacts (bandpass filtered white noise sweep + sine sub-pop)
 * - Sphere Pool Ambience (low-frequency underwater acoustics)
 * - Ref Whistles, Bubble Pops, and Dynamic Crowd Cheers
 */

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.ambienceGain = null;
    this.isAmbiencePlaying = false;

    this.initContext();
  }

  /**
   * Initializes or unlocks the WebAudio context on user gesture
   */
  initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(0.8, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
      }
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      const unlock = () => {
        this.ctx.resume();
        window.removeEventListener('click', unlock);
        window.removeEventListener('touchstart', unlock);
      };
      window.addEventListener('click', unlock);
      window.addEventListener('touchstart', unlock);
    }
  }

  ensureContextReady() {
    if (!this.ctx) this.initContext();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Generates a procedural white noise buffer for splash and crowd acoustics
   * @param {number} durationSec 
   * @returns {AudioBuffer}
   */
  createNoiseBuffer(durationSec = 2.0) {
    if (!this.ctx) return null;
    const bufferSize = this.ctx.sampleRate * durationSec;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /**
   * 1. Procedural Victory Crowd Fanfare (Triad Brass Chords)
   * Plays a triumphant 3-note FFX fanfare sequence (C -> F -> G -> High C)
   */
  playCrowdFanfare() {
    this.ensureContextReady();
    if (!this.ctx) return;

    const notes = [
      { freq: 261.63, start: 0.00, duration: 0.15 }, // C4
      { freq: 349.23, start: 0.15, duration: 0.15 }, // F4
      { freq: 392.00, start: 0.30, duration: 0.15 }, // G4
      { freq: 523.25, start: 0.45, duration: 0.70 }  // C5 (Hold)
    ];

    notes.forEach(n => {
      const now = this.ctx.currentTime + n.start;
      
      // Dual Sawtooth/Square blend for brass timbre
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc1.type = 'sawtooth';
      osc2.type = 'square';
      osc1.frequency.setValueAtTime(n.freq, now);
      osc2.frequency.setValueAtTime(n.freq * 1.002, now); // Slight detune

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, now);
      filter.frequency.exponentialRampToValueAtTime(3200, now + 0.05);
      filter.frequency.exponentialRampToValueAtTime(1000, now + n.duration);

      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.3, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.duration);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + n.duration);
      osc2.stop(now + n.duration);
    });

    // Layer fan crowd cheer underneath fanfare
    this.playCrowdCheer(1.5);
  }

  /**
   * 2. Stadium Goal Buzzer (Deep growling goal horn)
   */
  playGoalBuzzer(duration = 1.2) {
    this.ensureContextReady();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc1.type = 'sawtooth';
    osc2.type = 'sawtooth';
    osc1.frequency.setValueAtTime(110, now); // A2
    osc2.frequency.setValueAtTime(116.54, now); // A#2 (Dissonant growl)

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, now);
    filter.frequency.linearRampToValueAtTime(600, now + duration);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.5, now + 0.05);
    gain.gain.setValueAtTime(0.5, now + duration - 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + duration);
    osc2.stop(now + duration);
  }

  /**
   * 3. Hydrodynamic Water Splash Impact
   * Synthesizes a high-velocity entry splash using noise sweeps + sub pop
   * @param {number} [scale=1.0] Impact magnitude scale (0.5 to 2.0)
   */
  playWaterSplash(scale = 1.0) {
    this.ensureContextReady();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const duration = 0.6 * scale;

    // A. High-Frequency Water Spray (Bandpass Filter Sweep)
    const noiseBuffer = this.createNoiseBuffer(duration);
    if (noiseBuffer) {
      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.setValueAtTime(3.0, now);
      filter.frequency.setValueAtTime(3500 * scale, now);
      filter.frequency.exponentialRampToValueAtTime(400, now + duration);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.4 * scale, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noiseSource.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      noiseSource.start(now);
    }

    // B. Low-Frequency Underwater Impact "Thump" (Sine Pitch Drop)
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();

    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(180 * scale, now);
    subOsc.frequency.exponentialRampToValueAtTime(35, now + 0.25);

    subGain.gain.setValueAtTime(0.6 * scale, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    subOsc.connect(subGain);
    subGain.connect(this.masterGain);

    subOsc.start(now);
    subOsc.stop(now + 0.25);
  }

  /**
   * 4. Referee Whistle Effect (Dual Sine with Vibrato LFO)
   */
  playRefWhistle() {
    this.ensureContextReady();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const duration = 0.4;

    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    const gain = this.ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'sine';
    osc1.frequency.setValueAtTime(2800, now);
    osc2.frequency.setValueAtTime(3000, now);

    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(35, now); // Fast trill
    lfoGain.gain.setValueAtTime(120, now);

    lfo.connect(osc1.frequency);
    lfo.connect(osc2.frequency);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.masterGain);

    lfo.start(now);
    osc1.start(now);
    osc2.start(now);
    lfo.stop(now + duration);
    osc1.stop(now + duration);
    osc2.stop(now + duration);
  }

  /**
   * 5. Bubble Pop Sound (Encounter & UI Navigation)
   */
  playBubblePop() {
    this.ensureContextReady();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.08);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.08);
  }

  /**
   * 6. Crowd Cheer Swell
   */
  playCrowdCheer(intensity = 1.0) {
    this.ensureContextReady();
    if (!this.ctx) return;

    const duration = 2.0 * intensity;
    const now = this.ctx.currentTime;
    const noiseBuffer = this.createNoiseBuffer(duration);

    if (noiseBuffer) {
      const source = this.ctx.createBufferSource();
      source.buffer = noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.setValueAtTime(1.5, now);
      filter.frequency.setValueAtTime(800, now);
      filter.frequency.linearRampToValueAtTime(1800, now + 0.5);
      filter.frequency.linearRampToValueAtTime(600, now + duration);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.35 * intensity, now + 0.4);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      source.start(now);
    }
  }

  /**
   * 7. Continuous Sphere Pool Underwater Ambience
   */
  startSpherePoolAmbience() {
    this.ensureContextReady();
    if (!this.ctx || this.isAmbiencePlaying) return;

    this.ambienceGain = this.ctx.createGain();
    this.ambienceGain.gain.setValueAtTime(0.2, this.ctx.currentTime);

    // Deep lowpass rumbling underwater noise
    const noiseBuffer = this.createNoiseBuffer(5.0);
    if (noiseBuffer) {
      const source = this.ctx.createBufferSource();
      source.buffer = noiseBuffer;
      source.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(220, this.ctx.currentTime);

      source.connect(filter);
      filter.connect(this.ambienceGain);
      this.ambienceGain.connect(this.masterGain);

      source.start();
      this.isAmbiencePlaying = true;
    }
  }
  }
