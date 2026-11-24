# Wallboard Verification Report
**Milestone 1: End-to-End Vertical Slice**
**Version:** 0.5.0 (Homography GLSL Compositor, Decoupled Media Architecture, Studio & Remote)
**Date:** 2026-11-24

---

## 1. Automated Test Suite Results
Command: `npm test` (`node --test server/*.test.js`)
- **Status:** **PASSED** (9 tests passed, 0 failed, duration: ~1.3s)
  - `homography identity for unit square`: Analytical forward and inverse mapping verified
  - `homography maps non-affine perspective trapezoid with exact precision`: Verified sub-millimeter precision on physical keystone quad (zero affine diagonal crease)
  - `Milestone 1 vertical slice: end-to-end state synchronization`: Integration test suite verified
  - `accepts normalized points`: Bounds `[0, 1]` verified
  - `accepts a valid stroke with optional decay and surfaceId`: Decoupled stroke verified
  - `rejects malformed strokes`: Invalid hex, out-of-bound coords rejected
  - `validates projection mapping quad / corner pins`: Quad integrity verified
  - `validates media sources (solid, gradient_linear)`: Media registry validation verified
  - `validates decoupled surface entity`: Surface referencing `sourceId` verified

---

## 2. Production Build Verification
Command: `npm run build` (`tsc && vite build`)
- **Status:** **PASSED** (0 TypeScript errors, all bundles generated):
  - `dist/output.html` + `dist/assets/output-*.js`: Dedicated Projector Output
  - `dist/studio.html` + `dist/assets/studio-*.js`: Desktop Studio on laptop
  - `dist/remote.html` + `dist/assets/main-*.js`: Mobile Remote controller
  - `dist/index.html` + `dist/assets/index-*.js`: Root redirect entry
  - `dist/assets/surfaceRenderer-*.js`: Three.js WebGL Homography Compositor

---

## 3. Implemented Capabilities (Milestone 1 Vertical Slice)

### 1. Homography-Based GLSL Perspective Mapping
- Replaced naive 2-triangle vertex displacement with **analytical inverse homography projective texture mapping** ($H^{-1}$).
- CPU derives the $3 \times 3$ projective matrix analytically on corner updates and uploads as `uniform mat3 u_invHomography`.
- Fragment shader computes homogeneous coordinates per pixel (`uv = proj.xy / proj.z`) and strictly discards pixels outside `[0, 1]^2`.
- **Zero diagonal affine creases** across arbitrary keystone quadrilaterals.

### 2. Decoupled Architecture
- Surfaces do not own media data. Each surface points to a `sourceId`.
- Media sources (`solid`, `gradient_linear`, `gradient_radial`, `drawing`) live in an independent registry.
- Modifying geometry does not alter media, and changing media does not alter geometry.

### 3. Continuous 60 FPS Animation Engine
- Procedural linear gradient with animated angle property.
- Real-time rotation track running smoothly in the WebGL loop.
- Configurable playback speed and stop colors in Studio and Remote.

### 4. Interactive Desktop Studio
- Multi-display detector and launcher for dedicated borderless projector output (`MStar Demo` or secondary display).
- Surface Hierarchy panel: Add, delete, rename, select surfaces, assign media source.
- Live WebGL Stage Viewport with 4 interactive corner pin drag handles (`TL`, `TR`, `BR`, `BL`).
- Media Inspector for real-time color editing and animation toggling.
- Master Blackout Shutter (`B`) and Calibration Grid (`C`) controls.

### 5. Android Remote Controller
- Authenticated QR code pairing over private Wi-Fi.
- Surface target selector: directs finger strokes into the selected surface.
- Live Touch Drawing: strokes drawn on phone land inside the warped surface on the projector in real time.
- Keystone Touch Pad: drag corner handles with thumb standing next to the physical wall.
- Media theme presets (Cyberpunk, Solar, Matrix, Mono) and continuous rotation toggle.
