# Blitzball-X

**Blitzball-X** is a high-performance, fast-paced 3D mobile sports action game built with WebGL (Three.js), ES6/TypeScript, and Node.js. It brings the high-curve trajectory dynamics, strike zone targeting, and rapid arcade gameplay of physical Blitzball to mobile devices and web browsers.

The engine features a headless, deterministic physics core, real-time Web Haptics integration, automated CI/CD balance simulation pipelines, server-side anti-cheat replay validation, and cloud state synchronization.

---

## Key Features

* **3D Magnus-Effect Physics Core:** Realistic curveball, slider, and knuckleball trajectories influenced by drag, spin vector, and lightweight plastic ball bounce dynamics.
* **Touch & Gesture Dynamics:** Touch interface with swipe velocity vectors for pitching/passing and native device haptic feedback (`navigator.vibrate`).
* **Adaptive 60 FPS WebGL Rendering:** Built-in dynamic Device Pixel Ratio (DPR) adjustment that automatically throttles resolution during intense particle bursts to guarantee smooth frame rates on mobile hardware.
* **Headless Engine & Anti-Cheat Validation:** Fully decoupled game logic running seedable PRNG that allows server-side Node.js execution to validate client replays and prevent leaderboard tampering.
* **Progressive Career Meta-Game:** XP progression, leveling, coin rewards, leaderboard rankings, and unlocked cosmetic skins for balls, bats, and courts.
* **Unified Save Synchronization:** Dual-layer state persistence supporting local offline storage (`localStorage`) with REST cloud synchronization.
* **Automated CI/CD Simulation Pipeline:** GitHub Actions integration running headless multi-match statistical simulations (`scripts/simulate.mjs`) to catch balance regressions prior to release.

---

## Tech Stack

* **Frontend Rendering:** Three.js, WebGL, ES6/TypeScript
* **Build Tooling:** Vite, Terser
* **Backend Runtime:** Node.js, Express, SQLite (`better-sqlite3`)
* **Testing & Profiling:** Native Node Test Runner, Headless Simulation Engine, ESLint
* **CI/CD:** GitHub Actions (Automated Linting, Unit Testing, Balance Simulation, Build)
* **Mobile Packaging Target:** Capacitor / Cordova (iOS `WKWebView` & Android `WebView`)

---

## Directory Architecture

```text
Blitzball-X/
├── .github/
│   └── workflows/
│       ├── ci.yml               # Automated CI pipeline (lint, test, simulate, build)
│       ├── deploy-pages.yml     # GitHub Pages deployment workflow
│       └── release.yml          # Release asset bundler
├── public/                      # Static game assets, models, and audio
├── scripts/
│   ├── balance.mjs              # Tuning & balance verification
│   ├── simulate.mjs             # Headless parallel match simulation runner
│   └── snapshot.mjs            # Golden baseline state generator
├── server/
│   ├── db.js                    # SQLite database schema initialization
│   ├── index.js                 # Express server entry point
│   ├── match-validator.js       # Headless replay verification engine
│   └── routes/
│       ├── match.js              # Match submission & leaderboard routes
│       └── save.js               # Cloud save synchronization routes
├── src/
│   ├── core/
│   │   ├── events.js            # Event bus bus dispatcher
│   │   ├── rng.js               # Seedable pseudo-random number generator
│   │   └── vec3.js              # 3D Vector math utilities
│   ├── data/
│   │   ├── constants.js          # Field dimensions, physics limits & tuning values
│   │   ├── plays.js              # AI offensive/defensive play formations
│   │   └── teams.js              # Team rosters & stat profiles
│   ├── game/
│   │   ├── ball.js              # Ball trajectories, Magnus physics & strike zones
│   │   ├── career.js            # XP, levels, coin economy & cosmetic manager
│   │   ├── combat.js            # Tackle & collision resolution logic
│   │   └── match.js             # Deterministic match state machine
│   ├── render/
│   │   ├── fx.js                # Mobile-optimized particle pooling system
│   │   └── renderer.js          # WebGL manager with dynamic DPR scaling
│   ├── ui/
│   │   ├── hud.js               # Safe-area responsive overlay & controls
│   │   ├── save.js              # Local & remote REST save manager
│   │   └── touch.js             # Gesture recognition & native haptics bridge
│   └── main.js                  # Application entry point & game loop
├── tests/                       # Unit, golden snapshot, and balance test suites
├── package.json                 # NPM dependencies and script commands
└── vite.config.js               # WebGL chunk-splitting & mobile packaging config
