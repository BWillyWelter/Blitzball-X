# Menu architecture — Blitzball-X

## Engine and UI stack

This repository is a **browser/WebGL game built with Three.js and JavaScript ES modules**. Menus are accessible DOM controls styled in `src/styles.css`; the match is a Three.js canvas with DOM HUD/overlays. There is no Unity/Unreal editor or scene-attachment workflow in this project.

## Runtime architecture

```text
src/main.js — BlitzballApp (lifecycle, route/state owner)
├── src/ui/screens.js — TitleScreen / SettingsScreen / PauseOverlay factories
├── src/ui/input.js — keyboard, gamepad, and pause input
├── src/ui/audio.js — Web Audio master/music/SFX buses
├── src/render/renderer.js — Three.js renderer, quality and render resolution
└── localStorage — career, records, and validated settings
```

- `BlitzballApp.go(name)` owns full-screen route changes. Each screen factory returns an element and optional navigation handler; the app mounts it into `#app` and applies the existing fade transition.
- The title-screen **Play** action enters the game's existing team-select flow. Choosing a crew and starting the match creates `MatchSim` + `MatchScene`; no separate static gameplay scene is required.
- The same `SettingsScreen(app, params)` factory is mounted as a normal screen from the title menu and as a modal over the pause menu. Its Back callback either routes to the title screen or dismisses the overlay, leaving the match paused.
- Pause state lives on the active match (`app.match.paused`). The game loop skips simulation steps and advances no match/environment time while paused. `togglePause()` releases Pointer Lock if a browser/device has it, flushes one-shot inputs, and mounts `PauseOverlay`. Resume clears the pause state; Main Menu clears pause before safely disposing the match and routing to the title screen.
- Settings update `app.state.settings`, apply immediately where possible, and call `app.save()` (versioned key `blitzball_x_save_data_v1`). Back also saves before returning.

## Menu behaviors

### Main menu

- **Play** → team selection → `startMatch()`.
- **Settings** → full-screen settings view with the normal screen fade.
- **Quit** → calls Capacitor's native `App.exitApp()` on Android. iOS keeps its platform convention and tells the player to use the Home gesture/app switcher. On the web, it attempts `window.close()` and explains that the player must close the browser tab if browser policy prevents closing it. Vite development mode logs the browser limitation instead of pretending the tab closed.

### Settings

- **Video / Graphics:** `resolution` chooses Auto, 720p, 1080p, or 1440p internal WebGL render-buffer height; `quality` chooses Low/Medium/High and retains the existing adaptive-FPS fallback; `fullscreen` uses the browser Fullscreen API.
- **Resolution limitation:** browsers cannot generally change the operating system's monitor mode. These presets change the internal render buffer, preserve the viewport aspect ratio, and leave the CSS canvas fitted to the window. Fullscreen requires a fresh user gesture, may be unavailable on a browser/device, and is not automatically restored after a reload.
- **Audio:** Master, Music/Ambience, and SFX sliders feed independent Web Audio gain buses. This project currently synthesizes ambience and effects rather than shipping a separate music track, so the music channel controls the underwater ambience until a score is added.
- **Gameplay:** existing difficulty, motion, and touch-control preferences remain available.

### In-game pause

- **Trigger:** Escape (plus the existing gamepad Start and on-screen touch pause controls).
- **Resume:** removes the overlay and continues the same match.
- **Settings:** opens the exact same settings factory above without unpausing.
- **Main Menu:** unpauses, releases any pointer capture, disposes match-only resources, and returns to the title menu.

## Where to attach / wire it

There are no per-scene scripts to attach. `src/main.js` constructs `BlitzballApp` after `DOMContentLoaded`; it creates the renderer, input manager, audio engine, and screens. To change menu copy/layout, edit `TitleScreen`, `SettingsScreen`, or `PauseOverlay` in `src/ui/screens.js` and their styles in `src/styles.css`. To change menu routing or lifecycle behavior, edit `BlitzballApp` in `src/main.js`. Graphics scale belongs in `src/render/renderer.js`; audio mixing belongs in `src/ui/audio.js`.

The native quit action uses the `@capacitor/app` plugin. After adding the dependency, refresh native project plugin metadata with `npx cap sync` as part of the normal Capacitor build workflow.

## Verification

```bash
npm run lint
npm run build
npm test
npm run dev
```
