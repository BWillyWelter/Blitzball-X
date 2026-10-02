/**
 * REPLAY PRESENTATION — the broadcast layer over the replay.
 *
 * A goal replay only reads as a replay if it is dressed like one: letterbox bars so the frame is
 * obviously cinema, a REPLAY flag, a caption naming the scorer and what the finish was, and a
 * progress hairline so you can see the clip moving rather than waiting. A tap or any key skips
 * straight back to live, because a replay you are stuck watching is worse than no replay.
 *
 * The bars and the flag animate on CSS only, so reduced-motion users get a still, readable frame
 * with no swooshes — and the director shortens the clip for them anyway.
 */
const REPLAY_CSS = `
.replay-bars {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 45;
  overflow: hidden;
}
.replay-bars::before,
.replay-bars::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 11vh;
  background: linear-gradient(180deg, #05080f, rgba(5, 8, 15, 0.92));
  transform: scaleY(0);
  transition: transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}
.replay-bars::before { top: 0; transform-origin: top; }
.replay-bars::after { bottom: 0; transform-origin: bottom; }
.replay-bars.on::before,
.replay-bars.on::after {
  transform: scaleY(1);
}
.replay-flag {
  position: absolute;
  top: calc(11vh + 14px);
  left: 22px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 4px 10px;
  border-radius: 4px;
  background: rgba(255, 45, 85, 0.92);
  color: #fff;
  font-family: var(--font-cond, sans-serif);
  font-weight: 900;
  font-size: 15px;
  letter-spacing: 2.4px;
  opacity: 0;
  transform: translateX(-12px);
  transition: opacity 0.25s, transform 0.25s;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.5);
}
.replay-bars.on .replay-flag {
  opacity: 1;
  transform: translateX(0);
}
.replay-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
  animation: replayBlink 1.1s infinite;
}
@keyframes replayBlink {
  0%, 45% { opacity: 1; }
  55%, 100% { opacity: 0.2; }
}
.replay-caption {
  position: absolute;
  left: 22px;
  bottom: calc(11vh + 16px);
  max-width: 62vw;
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 0.3s 0.08s, transform 0.3s 0.08s;
}
.replay-bars.on .replay-caption {
  opacity: 1;
  transform: translateY(0);
}
.replay-cap-name {
  font-family: var(--font-display, sans-serif);
  font-size: clamp(20px, 4.2vw, 34px);
  line-height: 1;
  color: #fff;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8);
}
.replay-cap-what {
  margin-top: 3px;
  font-family: var(--font-cond, sans-serif);
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 1.6px;
  color: rgba(255, 255, 255, 0.82);
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.9);
}
.replay-cap-what .ring {
  color: var(--yellow, #ffd23f);
}
.replay-skip {
  position: absolute;
  right: 22px;
  bottom: calc(11vh + 16px);
  font-family: var(--font-cond, sans-serif);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 1.4px;
  color: rgba(255, 255, 255, 0.55);
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.9);
  opacity: 0;
  transition: opacity 0.3s;
}
.replay-bars.on .replay-skip { opacity: 1; }
.replay-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 11vh;
  height: 2px;
  background: rgba(255, 255, 255, 0.12);
  opacity: 0;
  transition: opacity 0.25s;
}
.replay-bars.on .replay-progress { opacity: 1; }
.replay-progress i {
  display: block;
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #ff2d55, #ffd23f);
}
@media (prefers-reduced-motion: reduce) {
  .replay-bars::before,
  .replay-bars::after,
  .replay-flag,
  .replay-caption {
    transition: none;
  }
  .replay-dot { animation: none; }
}
`;

const FINISH_WORDS = {
  topring: 'THROUGH THE ORANGE',
  volley: 'LOB & VOLLEY',
  long: 'FROM DOWNTOWN',
  gamebreaker: 'GAMEBREAKER',
  own: 'OWN GOAL',
  shot: 'GOAL',
};

export class ReplayOverlay {
  constructor(wrap) {
    if (!document.getElementById('replay-styles')) {
      const style = document.createElement('style');
      style.id = 'replay-styles';
      style.textContent = REPLAY_CSS;
      document.head.appendChild(style);
    }
    const el = document.createElement('div');
    el.className = 'replay-bars';
    el.innerHTML = `
      <div class="replay-flag"><span class="replay-dot"></span>REPLAY</div>
      <div class="replay-caption">
        <div class="replay-cap-name"></div>
        <div class="replay-cap-what"></div>
      </div>
      <div class="replay-skip">TAP / ANY KEY TO SKIP</div>
      <div class="replay-progress"><i></i></div>`;
    wrap.appendChild(el);
    this.el = el;
    this.name = el.querySelector('.replay-cap-name');
    this.what = el.querySelector('.replay-cap-what');
    this.fill = el.querySelector('.replay-progress i');
    this.shown = false;
  }

  show(clip) {
    if (!clip) return;
    const scorer = clip.scorer;
    this.name.textContent = scorer ? scorer.data.nick : 'GOAL';
    // Ring 0 IS the top ring (the scorer's `ring` is 0 for a strike through the orange), so the
    // premium window is ring === 0, not ring > 0.
    const topRing = clip.ring === 0 && clip.type !== 'own';
    const what = topRing
      ? `+${clip.points} · TOP RING`
      : `+${clip.points} · ${FINISH_WORDS[clip.type] || 'GOAL'}`;
    this.what.innerHTML = what.replace('TOP RING', '<span class="ring">TOP RING</span>');
    this.fill.style.width = '0%';
    this.el.classList.add('on');
    this.shown = true;
  }

  progress(p) {
    this.fill.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
  }

  hide() {
    this.el.classList.remove('on');
    this.shown = false;
  }

  dispose() {
    this.hide();
    this.el.remove();
  }
}
