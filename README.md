# 🌊 Blitzball-X

**Blitzball-X** is a high-fidelity 3D WebGL and native mobile re-imagining of the iconic aquatic sport from *Final Fantasy X*. Built with Three.js, Web Audio API, Express, SQLite, and Capacitor, Blitzball-X delivers real-time 3D sphere pool navigation, turn-based encounter math, status ailments, dynamic tactical AI, and server-validated anti-cheat replay verification.

---

## 📑 Table of Contents

1. [Key Features](#-key-features)
2. [System Architecture](#-system-architecture)
3. [Project Directory Structure](#-project-directory-structure)
4. [FFX Encounter Mechanics & Math](#-ffx-encounter-mechanics--math)
5. [Tactical AI Engine & Formations](#-tactical-ai-engine--formations)
6. [Server Anti-Cheat & Replay Validation](#-server-anti-cheat--replay-validation)
7. [API Reference](#-api-reference)
8. [Testing Suite (Vitest)](#-testing-suite-vitest)
9. [Native Mobile Packaging (Capacitor)](#-native-mobile-packaging-capacitor)
10. [Local Development & Setup](#-local-development--setup)

---

## 🚀 Key Features

* **3D Sphere Pool Engine**: WebGL water caustics shaders, volumetric depth fog absorption, and touch/mouse spherical camera controls.
* **FFX Combat & Encounter System**: Full implementation of Endurance (EN), Passing (PAS), Shooting (SH), Tackling (TCK), Blocking (BLK), and Catching (CAT) math with distance decay.
* **Status Ailments & GLSL Shaders**: Poison (continuous HP drain), Sleep (movement immobilization), and Wither (stat-halving) with custom 3D particle effects.
* **Techcopy Reaction QTE**: Real-time reaction timing window for learning enemy abilities like *Sphere Shot*, *Venom Pass*, and *Invisible Shot*.
* **Dynamic AI Engine**: Opponent teams adjust formations (Normal, Mark, Offense, Defense, Counter) and choose encounter actions based on distance, stats, and match urgency.
* **Spira Career League**: Tournament brackets, team standings, free-agent scouting with Gil contracts, and automated background AI match simulation.
* **Procedural Sound Synthesizer**: Web Audio API audio synthesis for victory fanfares, stadium goal buzzers, referee whistles, and water impacts without raw MP3 assets.
* **Server Anti-Cheat & Deterministic Replay**: Seeded pseudo-random number generator (PRNG) logs every match action for headless server-side validation against score and Gil tampering.

---

## 🏗 System Architecture

```
                               ┌───────────────────────────────────────────┐
                               │           BlitzballApp (App Controller)   │
                               └─────────────────────┬─────────────────────┘
                                                     │
     ┌───────────────────────┬───────────────────────┼───────────────────────┬───────────────────────┐
     │                       │                       │                       │                       │
┌────▼─────────────┐   ┌─────▼─────────────┐   ┌─────▼─────────────┐   ┌─────▼─────────────┐   ┌─────▼─────────────┐
│ Three.js Renderer│   │ FFX Match Engine  │   │ Tactical AI Engine│   │ Sound Synthesizer │   │ Save & Sync API   │
├──────────────────┤   ├───────────────────┤   ├───────────────────┤   ├───────────────────┤   ├───────────────────┤
│ • Water Caustics │   │ • State Machine   │   │ • Formation Logic │   │ • Crowd Fanfares  │   │ • LocalStorage    │
│ • Volumetric Fog │   │ • Encounter Math  │   │ • Decision Trees  │   │ • Goal Buzzers    │   │ • SQLite Backend  │
│ • Status Shaders │   │ • Status Effects  │   │ • Mark Tracking   │   │ • Water Splashes  │   │ • Anti-Cheat Sync │
└──────────────────┘   └───────────────────┘   └───────────────────┘   └───────────────────┘   └───────────────────┘
```

---

## 📁 Project Directory Structure

```
blitzball-x/
├── assets/                  # Source icons and splash images for native builds
├── capacitor.config.json    # Capacitor mobile bundle configuration
├── capacitor.assets.json    # @capacitor/assets generation config
├── package.json             # Dependencies and build scripts
├── server/
│   ├── app.js               # Express server entry point
│   ├── db.js                # SQLite database connection & schema
│   ├── match-validator.js   # Deterministic replay anti-cheat verifier
│   └── routes/
│       └── save.js          # Cloud save/load and replay verification routes
├── src/
│   ├── main.js              # Application lifecycle & game loop driver
│   ├── core/
│   │   └── rng.js           # Seedable PRNG (LCG / Mulberry32)
│   ├── data/
│   │   ├── constants.js     # FFX match formulas & constants
│   │   ├── players.js       # Player database (Tidus, Wakka, Nimrook, etc.)
│   │   └── teams.js         # Team profiles & default rosters
│   ├── game/
│   │   ├── ai.js            # Tactical AI engine & formation logic
│   │   ├── combat.js        # Encounter math & stat calculation
│   │   ├── league.js        # League tournament manager & AI simulation
│   │   ├── match.js         # FFX Match state machine
│   │   └── scout.js         # Free-agent recruitment & contract decay
│   ├── render/
│   │   ├── court.js         # 3D Sphere Pool & Water Caustics Shaders
│   │   ├── qte.js           # Techcopy reaction QTE overlay
│   │   ├── renderer.js      # Three.js WebGL rendering pipeline
│   │   └── status.js        # 3D Status effect visuals & shaders
│   └── ui/
│       ├── audio.js         # Procedural Web Audio API synthesizer
│       ├── hud.js           # 2D HUD, radar mini-map & encounter menus
│       ├── league-view.js   # Standings UI overlay
│       ├── save.js          # SaveManager (Local + Remote sync)
│       ├── scout-view.js    # Free agent recruitment menu
│       ├── tech-view.js     # Technique assignment screen
│       └── touch.js         # Virtual joystick & haptic feedback
└── test/
    └── match.test.js        # Vitest integration & anti-cheat test suite
```

---

## ⚽ FFX Encounter Mechanics & Math

### 1. Stat Range Calculations
When a player initiates an encounter or action (Pass, Shoot, Tackle, Block), stats vary randomly between **50% and 150%** of their base value:

$$\text{Effective Stat} = \text{Base Stat} \times \text{RNG}(0.5, 1.5)$$

### 2. Hydrodynamic Shot & Pass Decay
As the ball travels through the sphere pool water, its **SH** or **PAS** stat decays exponentially over distance $d$ (in meters):

$$\text{Remaining Stat}(d) = \max\left(0, \text{Initial Stat} - (d \times \text{Decay Rate})\right)$$

### 3. Breakthrough Formula
When breaking through $N$ defenders, the carrier's **EN** must withstand the sum of all defenders' **TCK**:

$$\text{Remaining EN} = \text{Carrier EN} - \sum_{i=1}^{N} \left( \text{Defender TCK}_i \times \text{RNG}_i(0.5, 1.5) \right)$$

If $\text{Remaining EN} \le 0$, the ball is stolen.

---

## 🧠 Tactical AI Engine & Formations

The `TacticalAIEngine` continuously evaluates the state of the match and dynamically adjusts opponent strategies:

* **Normal**: Balanced position tracking based on default formation slots.
* **Mark**: Defenders stick tightly to assigned player targets.
* **Offense**: Forward players push aggressively toward the opponent goal sphere.
* **Defense**: Retracts all fielders into a protective box around the goalkeeper.
* **Counter**: Quick transition into forward swimming upon recovering possession.

### AI Decision Matrix
When an AI ball carrier triggers an encounter, it computes expected success probabilities:
1. **Pass**: Evaluates distance and intercepting defenders' BLK.
2. **Shot**: Evaluates distance to goal, keeper CAT, and current SH stat.
3. **Breakthrough**: Compares EN against total defender TCK.

---

## 🔒 Server Anti-Cheat & Replay Validation

To prevent client-side memory editing or falsified match submissions, every match run generates an action seed log:

```json
{
  "matchSeed": 555123,
  "homeTeamId": "besaid_aurochs",
  "awayTeamId": "luca_goers",
  "actionLog": [
    { "type": "SHOOT", "carrierId": "p_tidus", "defenderIds": [], "shotDistance": 8 }
  ],
  "reportedHomeScore": 1,
  "reportedAwayScore": 0,
  "reportedGilEarned": 1050
}
```

The server re-runs the match using `MatchReplayValidator` with the exact seed and action history. If reported scores or Gil rewards diverge from server calculations, the submission is flagged and rejected.

---

## 🌐 API Reference

### `POST /api/save`
Saves current game state payload.
* **Body**: `{ "userId": "user_123", "saveData": { ... } }`
* **Response**: `200 OK` with saved timestamp.

### `GET /api/save/:userId`
Loads state for a given user ID.
* **Response**: `{ "success": true, "saveData": { ... } }`

### `POST /api/match/verify`
Validates match replay seed and updates user Gil/XP upon verification.
* **Body**: Replay submission log object.
* **Response**: `{ "valid": true, "verifiedHomeScore": 1, "verifiedGil": 1050 }`

---

## 🧪 Testing Suite (Vitest)

Run the full integration test suite covering RNG seed determinism, encounter math, status ailments, and replay verification:

```bash
# Run tests once
npx vitest run test/match.test.js

# Run tests in watch mode
npx vitest test/match.test.js
```

---

## 📱 Native Mobile Packaging (Capacitor)

Blitzball-X is configured for native cross-platform deployment on iOS and Android via Capacitor.

### 1. Generate Native Assets
Place 1024x1024 icons and 2732x2732 splash images in `/assets` and run:

```bash
npx @capacitor/assets generate --ios --android
```

### 2. Build Web App & Sync
```bash
# Build web bundle
npm run build

# Copy web assets into native iOS and Android projects
npx cap sync
```

### 3. Open in Xcode / Android Studio
```bash
# Open iOS project in Xcode
npx cap open ios

# Open Android project in Android Studio
npx cap open android
```

---

## ⚡ Local Development & Setup

### Requirements
* **Node.js**: v18.x or higher
* **npm**: v9.x or higher

### Installation Steps

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/your-username/blitzball-x.git
   cd blitzball-x
   npm install
   ```

2. Start the development server and Express API:
   ```bash
   npm run dev
   ```

3. Open your browser and navigate to `http://localhost:5173`.
