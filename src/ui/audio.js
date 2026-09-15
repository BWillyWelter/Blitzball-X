/**
 * Procedural audio: every sound is synthesized with the Web Audio API so the game
 * ships with zero audio assets. Includes a looping beat generator for menus and matches,
 * crowd bed, and one-shot SFX (bounce, swish, rim, slam, whoosh, crowd swells, stingers).
 */
export class AudioSystem {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.crowdBus = null;
    this.beat = null;
    this.crowd = null;
    this.unlocked = false;
    this.pendingResume = false;
  }

  unlock() {
    if (this.unlocked) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.musicBus = this.ctx.createGain();
    this.crowdBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.crowdBus.connect(this.master);
    this.applyVolumes();
    this.unlocked = true;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.noiseBuffer = this.makeNoise(2);
  }

  applyVolumes() {
    if (!this.unlocked) return;
    const s = this.settings;
    this.master.gain.value = s.masterVolume;
    this.sfxBus.gain.value = s.sfxVolume;
    this.musicBus.gain.value = s.musicVolume;
    this.crowdBus.gain.value = s.sfxVolume * 0.8;
  }

  makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ---------------------------------------------------------------------------
  // One-shots
  // ---------------------------------------------------------------------------

  tone({ freq = 440, type = 'sine', dur = 0.2, vol = 0.3, attack = 0.005, decay = null, slide = null, bus = null, filter = null }) {
    if (!this.unlocked) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (decay || dur));
    let node = osc;
    if (filter) {
      const f = this.ctx.createBiquadFilter();
      f.type = filter.type || 'lowpass';
      f.frequency.value = filter.freq || 1200;
      f.Q.value = filter.q || 1;
      osc.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(bus || this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.2, vol = 0.3, filter = 800, q = 1, type = 'bandpass', bus = null, attack = 0.005, slide = null }) {
    if (!this.unlocked) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filter, t0);
    if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t0 + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(bus || this.sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  bounce(strength = 1) {
    this.tone({ freq: 160, type: 'sine', dur: 0.12, vol: 0.25 * strength, slide: 70 });
    this.noise({ dur: 0.05, vol: 0.12 * strength, filter: 1800, q: 0.8 });
  }

  dribble() {
    this.tone({ freq: 140, type: 'sine', dur: 0.09, vol: 0.14, slide: 60 });
  }

  /** Underwater swim stroke: a soft low-passed swoosh. */
  stroke(strength = 0.6) {
    this.noise({ dur: 0.22, vol: 0.09 * strength, filter: 380, slide: 900, q: 0.5, type: 'lowpass', attack: 0.04 });
  }

  swish() {
    this.noise({ dur: 0.35, vol: 0.4, filter: 3200, q: 0.6, type: 'highpass' });
    this.noise({ dur: 0.25, vol: 0.2, filter: 1200, q: 0.4, type: 'bandpass' });
  }

  rim(hard) {
    this.tone({ freq: hard ? 620 : 520, type: 'triangle', dur: 0.4, vol: hard ? 0.35 : 0.2, slide: hard ? 500 : 480 });
    this.tone({ freq: 1240, type: 'sine', dur: 0.25, vol: 0.12 });
    this.noise({ dur: 0.08, vol: 0.2, filter: 2400 });
  }

  board() {
    this.tone({ freq: 240, type: 'square', dur: 0.12, vol: 0.18, slide: 120, filter: { freq: 900 } });
    this.noise({ dur: 0.1, vol: 0.2, filter: 700 });
  }

  slam() {
    this.tone({ freq: 90, type: 'sine', dur: 0.45, vol: 0.7, slide: 30 });
    this.noise({ dur: 0.3, vol: 0.5, filter: 400, q: 0.5, type: 'lowpass' });
    this.tone({ freq: 700, type: 'triangle', dur: 0.5, vol: 0.3, slide: 560 });
    this.tone({ freq: 1400, type: 'sine', dur: 0.4, vol: 0.12, slide: 1100 });
  }

  whoosh(pitch = 1) {
    this.noise({ dur: 0.3, vol: 0.28, filter: 600 * pitch, slide: 2600 * pitch, q: 0.7, attack: 0.03 });
  }

  shotCharge() {
    this.tone({ freq: 180, type: 'sine', dur: 0.22, vol: 0.16, slide: 520, filter: { freq: 1400 } });
    this.noise({ dur: 0.18, vol: 0.1, filter: 900, slide: 2200, q: 1.2, attack: 0.04 });
  }

  perfectShot() {
    this.tone({ freq: 740, type: 'square', dur: 0.16, vol: 0.22, slide: 1480, filter: { freq: 3200 } });
    this.tone({ freq: 1480, type: 'triangle', dur: 0.32, vol: 0.16, slide: 900, filter: { freq: 2600 } });
    this.noise({ dur: 0.24, vol: 0.24, filter: 4200, slide: 1800, q: 0.6, type: 'highpass', attack: 0.01 });
  }

  fence() {
    this.noise({ dur: 0.35, vol: 0.3, filter: 2200, q: 2 });
    this.tone({ freq: 1800, type: 'triangle', dur: 0.3, vol: 0.08 });
  }

  thud() {
    this.tone({ freq: 110, type: 'sine', dur: 0.25, vol: 0.55, slide: 40 });
    this.noise({ dur: 0.15, vol: 0.3, filter: 300, type: 'lowpass' });
  }

  sneakerSqueak() {
    this.tone({ freq: 2200, type: 'sawtooth', dur: 0.12, vol: 0.05, slide: 2900, filter: { freq: 3500, type: 'bandpass', q: 6 } });
  }

  stealHit() {
    this.noise({ dur: 0.12, vol: 0.35, filter: 1500 });
    this.tone({ freq: 880, type: 'square', dur: 0.1, vol: 0.12, slide: 440 });
  }

  blockHit() {
    this.noise({ dur: 0.18, vol: 0.5, filter: 900, q: 0.8 });
    this.tone({ freq: 200, type: 'sine', dur: 0.3, vol: 0.4, slide: 60 });
  }

  buzzer() {
    this.tone({ freq: 220, type: 'sawtooth', dur: 1.0, vol: 0.35, filter: { freq: 900 } });
    this.tone({ freq: 227, type: 'square', dur: 1.0, vol: 0.2, filter: { freq: 700 } });
  }

  stinger(kind = 'style') {
    if (!this.unlocked) return;
    const notes = kind === 'big' ? [523, 659, 784, 1046] : kind === 'gb' ? [392, 523, 659, 784, 1046, 1318] : [659, 880];
    notes.forEach((f, i) => setTimeout(() => this.tone({ freq: f, type: 'square', dur: 0.18, vol: 0.14, filter: { freq: 2400 } }), i * 55));
  }

  gbCharge() {
    this.tone({ freq: 80, type: 'sawtooth', dur: 1.2, vol: 0.4, slide: 640, filter: { freq: 1800, type: 'lowpass', q: 4 } });
    this.noise({ dur: 1.2, vol: 0.25, filter: 200, slide: 4000, q: 1.5, attack: 0.3 });
  }

  whistle() {
    this.tone({ freq: 2800, type: 'square', dur: 0.4, vol: 0.12, filter: { freq: 3200, type: 'bandpass', q: 8 } });
    this.tone({ freq: 2850, type: 'sine', dur: 0.4, vol: 0.1 });
  }

  crowdSwell(intensity = 1) {
    if (!this.unlocked) return;
    this.noise({ dur: 1.4 * intensity, vol: 0.28 * intensity, filter: 900, q: 0.5, type: 'bandpass', bus: this.crowdBus, attack: 0.15 });
    this.noise({ dur: 1.0 * intensity, vol: 0.18 * intensity, filter: 2400, q: 0.8, type: 'bandpass', bus: this.crowdBus, attack: 0.1 });
  }

  crowdGroan() {
    if (!this.unlocked) return;
    this.tone({ freq: 220, type: 'sawtooth', dur: 0.8, vol: 0.08, slide: 150, bus: this.crowdBus, filter: { freq: 600 } });
    this.noise({ dur: 0.7, vol: 0.14, filter: 500, q: 0.6, bus: this.crowdBus, attack: 0.1 });
  }

  uiMove() {
    this.tone({ freq: 720, type: 'square', dur: 0.06, vol: 0.08, filter: { freq: 2200 } });
  }

  uiConfirm() {
    this.tone({ freq: 520, type: 'square', dur: 0.09, vol: 0.12, filter: { freq: 2600 } });
    setTimeout(() => this.tone({ freq: 780, type: 'square', dur: 0.14, vol: 0.12, filter: { freq: 2600 } }), 70);
  }

  uiBack() {
    this.tone({ freq: 440, type: 'square', dur: 0.1, vol: 0.1, slide: 300, filter: { freq: 2000 } });
  }

  // ---------------------------------------------------------------------------
  // Crowd bed (continuous)
  // ---------------------------------------------------------------------------

  startCrowd() {
    if (!this.unlocked || this.crowd) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 0.4;
    const g = this.ctx.createGain();
    g.gain.value = 0.06;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.02;
    lfo.connect(lfoG);
    lfoG.connect(g.gain);
    src.connect(f);
    f.connect(g);
    g.connect(this.crowdBus);
    src.start();
    lfo.start();
    this.crowd = { src, g, lfo };
  }

  setCrowdLevel(level) {
    if (!this.crowd) return;
    const target = 0.04 + level * 0.12;
    this.crowd.g.gain.setTargetAtTime(target, this.ctx.currentTime, 0.4);
  }

  stopCrowd() {
    if (!this.crowd) return;
    try {
      this.crowd.src.stop();
      this.crowd.lfo.stop();
    } catch (e) {
      /* already stopped */
    }
    this.crowd = null;
  }

  // ---------------------------------------------------------------------------
  // Beat generator — boom-bap at 92 BPM
  // ---------------------------------------------------------------------------

  startBeat(style = 'menu') {
    if (!this.unlocked) return;
    this.stopBeat();
    const bpm = style === 'match' ? 96 : 90;
    const beat = { style, bpm, step: 0, nextTime: this.ctx.currentTime + 0.05, timer: null, bar: 0 };
    this.beat = beat;
    const stepDur = 60 / bpm / 4;
    const schedule = () => {
      if (this.beat !== beat) return;
      while (beat.nextTime < this.ctx.currentTime + 0.25) {
        this.playStep(beat, beat.nextTime);
        beat.nextTime += stepDur;
        beat.step = (beat.step + 1) % 16;
        if (beat.step === 0) beat.bar++;
      }
      beat.timer = setTimeout(schedule, 60);
    };
    schedule();
  }

  stopBeat() {
    if (this.beat && this.beat.timer) clearTimeout(this.beat.timer);
    this.beat = null;
  }

  playStep(beat, t) {
    const s = beat.step;
    const bar = beat.bar % 4;
    const ctx = this.ctx;
    const bus = this.musicBus;
    const kick = () => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      g.gain.setValueAtTime(0.6, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      o.connect(g);
      g.connect(bus);
      o.start(t);
      o.stop(t + 0.3);
    };
    const snare = () => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 1500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.32, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      src.connect(f);
      f.connect(g);
      g.connect(bus);
      src.start(t);
      src.stop(t + 0.2);
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(210, t);
      og.gain.setValueAtTime(0.25, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(og);
      og.connect(bus);
      o.start(t);
      o.stop(t + 0.12);
    };
    const hat = (open = false) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(open ? 0.12 : 0.08, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.18 : 0.04));
      src.connect(f);
      f.connect(g);
      g.connect(bus);
      src.start(t);
      src.stop(t + 0.2);
    };
    const bass = (freq, dur = 0.22) => {
      const o = ctx.createOscillator();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(freq, t);
      f.type = 'lowpass';
      f.frequency.setValueAtTime(600, t);
      f.frequency.exponentialRampToValueAtTime(180, t + dur);
      f.Q.value = 6;
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(f);
      f.connect(g);
      g.connect(bus);
      o.start(t);
      o.stop(t + dur + 0.02);
    };
    const stab = (freqs, dur = 0.16) => {
      for (const fr of freqs) {
        const o = ctx.createOscillator();
        const f = ctx.createBiquadFilter();
        const g = ctx.createGain();
        o.type = 'square';
        o.frequency.setValueAtTime(fr, t);
        f.type = 'lowpass';
        f.frequency.value = 1800;
        g.gain.setValueAtTime(0.045, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.connect(f);
        f.connect(g);
        g.connect(bus);
        o.start(t);
        o.stop(t + dur + 0.02);
      }
    };

    // Drum pattern (boom-bap)
    if (s === 0 || s === 7 || s === 10) kick();
    if (s === 4 || s === 12) snare();
    if (s % 2 === 0) hat(false);
    if (s === 14) hat(true);
    if (beat.style === 'match' && s === 6 && bar === 3) kick();

    // Bassline: E minor pentatonic groove
    const root = beat.style === 'match' ? 41.2 : 36.7; // E1 / D1
    const seq = [0, null, null, 0, null, null, 7, null, 10, null, null, 12, null, 7, null, null];
    const semis = seq[s];
    if (semis !== null && semis !== undefined) bass(root * Math.pow(2, semis / 12));

    // Chord stabs every other bar
    if ((bar === 1 || bar === 3) && (s === 2 || s === 11)) {
      const r = root * 4;
      stab(bar === 1 ? [r, r * 1.189, r * 1.498] : [r * 0.89, r * 1.06, r * 1.335]);
    }
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
}
