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
- [x] Reconnection and session state synchronization — implemented

## Phase 3: Brushes, Colors, Eraser, Undo/Redo & Light Modes
- [x] High-luminosity projection light palette (White Beam, Cyan, Neon Green, Amber, UV Magenta, Crimson, Violet) — implemented
- [x] Optical cutout eraser (`#000000` / `destination-out`) — implemented
- [x] Undo and clear canvas — implemented
- [x] Beam width slider with normalized thickness scaling — implemented

## Phase 4: Glow, Gradients, Brightness & Light Effects
- [x] Real-time multi-layer beam glow bloom (`shadowBlur` + white-hot core) — implemented
- [x] Optical additive light blending (`screen` / `lighter`) — implemented
- [x] Dynamic laser trail decay with continuous rAF animation loop (1.0s, 2.5s, 5.0s presets) — implemented
- [x] Virtual moving spotlight / torch beam mode with radial feathering and color selection — implemented
- [x] Projector shutter / Blackout mode (instant 0 light cutoff) — implemented

## Phase 5: Projection Mapping, Corner Pinning & Calibration
- [x] 4-corner perspective quad warping / keystone calibration math (`warpPoint`) — implemented
- [x] Real-time keystone synchronization over Socket.IO (`warp:update`) — implemented
- [x] Projection mapping calibration test pattern with crosshairs and numbered corner targets — implemented
- [x] Interactive drag-handle Quad Warper directly on Desktop Studio canvas — implemented
- [x] Tactile 4-way D-Pad keystone calibration console on Android Phone Remote — implemented
- [x] Aspect ratio presets (16:9, 16:10, 4:3, Full bounds) — implemented

## Verification
- [x] `node --test server/protocol.test.js` — 5 passed, 0 failed
- [x] `npm install` — completed successfully
- [x] `npm run build` (`tsc && vite build`) — completed successfully, generated studio, output, index, remote bundles
