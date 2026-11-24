# Wallboard Build Checklist

Status meanings: `DONE` = implemented and verified in this workspace; `IN PROGRESS` = partially implemented; `TODO` = not implemented; `BLOCKED` = requires external hardware/account/manual action.

## Phase 1: Electron Shell & Dedicated Projector Output
- [x] Electron application shell and lifecycle — implemented (`electron/main.cjs`, `electron/preload.cjs`)
- [x] Multi-display enumeration and detection — implemented (`screen.getAllDisplays()`, `screen.getPrimaryDisplay()`)
- [x] Dynamic display hotplug tracking — implemented (`display-added`, `display-removed`, `display-metrics-changed`)
- [x] Dedicated Projector Output window — implemented (`src/output/main.tsx`, `output.html`)
  - [x] Borderless fullscreen targeting selected display coordinates
  - [x] Zero browser chrome, zero window frame, zero taskbar
  - [x] Pitch black optical canvas (`#000000` = zero light emission from projector lamp)
  - [x] Real-time stroke synchronization via Socket.IO
  - [x] Interactive hotkeys: F11/F (fullscreen), B (blackout), C (calibration grid)

## Phase 2: Phone QR Pairing & Real-time Drawing
- [x] Local LAN pairing with persistent session code — implemented (`server/index.js`, `.session-code`)
- [x] Mobile pointer/touch event handling with touch-action isolation — implemented (`src/remote/main.tsx`)
- [x] Normalized 2D coordinate system across different aspect ratios — implemented
- [x] Smooth curve interpolation using quadratic Bezier midpoint smoothing — implemented (`src/shared/drawing.ts`)
- [x] Maximized immersive canvas viewport (`60dvh`) without distracting background dots — implemented (`src/style.css`)
- [x] Global remote access over mobile data via Ngrok tunnel — verified

## Phase 3: Brushes, Colors, Eraser, Undo/Redo & Light Modes
- [x] High-luminosity projection light palette (White Beam, Cyan, Neon Green, Amber, UV Magenta, Crimson, Violet) — implemented
- [x] Optical cutout eraser (`#000000` / `destination-out`) — implemented
- [x] Undo and clear canvas — implemented
- [x] Beam width slider with normalized thickness scaling — implemented

## Phase 4: Glow, Gradients, Brightness & Light Effects
- [x] Multi-pass optical light bloom (Pass 1: wide diffuse halo, Pass 2: saturated corona, Pass 3: white-hot laser core) — implemented (`src/shared/drawing.ts`)
- [x] Optical additive light blending (`screen` / `lighter`) — implemented
- [x] Dynamic laser trail decay with continuous rAF animation loop (1.0s, 2.5s, 5.0s presets) — implemented
- [x] Virtual moving spotlight / torch beam mode with radial feathering and color selection — implemented
- [x] Projector shutter / Blackout mode (instant 0 light cutoff) — implemented

## Phase 5: Projection Mapping, Corner Pinning, 3D Cubes & Masks
- [x] 4-corner perspective quad warping / keystone calibration math (`warpPoint`) — implemented
- [x] Direct touch-dragging of keystone corners (`TL`, `TR`, `BR`, `BL`) on mobile touchpad — implemented (`src/remote/main.tsx`)
- [x] Precision 4-way D-Pad micro-nudging on mobile remote — implemented
- [x] Interactive drag-handle Quad Warper directly on Desktop Studio canvas — implemented
- [x] Projection mapping calibration test pattern with crosshairs and numbered corner targets — implemented
- [x] 3D Cube wireframe engine with 3D rotation matrix and touch orbit pad for physical box tracing — implemented (`src/shared/drawing.ts`, `src/remote/main.tsx`)
- [x] Polygon cutout mask for blacking out physical objects (TV, picture frame, door) — implemented
- [x] Concentric glowing target rings — implemented

## Phase 6: Scenes, Presets & Persistence
- [x] Built-in scene presets (Clean Light Canvas, 3D Cube Mapping Stage, etc.) — implemented
- [x] Custom scene saving from mobile remote or desktop studio — implemented (`server/index.js`, `.scenes.json`)
- [x] Instant scene switching with full state restoration (quad, strokes, shapes, settings) — implemented
- [x] Persistent scene storage on disk (`.scenes.json`) — implemented

## Verification
- [x] `node --test server/protocol.test.js` — 6 passed, 0 failed
- [x] `npm install` — completed successfully
- [x] `npm run build` (`tsc && vite build`) — completed successfully, generated studio, output, index, remote bundles
