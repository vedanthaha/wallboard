# Wallboard Milestone 1 Build Checklist

- [x] Three.js and type definitions installed (`three`, `@types/three`)
- [x] Mathematical analytical Homography matrix engine (`server/homography.js`, `src/shared/homography.ts`)
- [x] Unit test suite for homography mapping and inverse projection (`server/homography.test.js`)
- [x] Decoupled state protocol (`src/shared/protocol.ts`, `server/protocol.js`, `server/protocol.test.js`)
- [x] Three.js WebGL homography compositor with fragment shader projective division (`src/shared/surfaceRenderer.ts`)
- [x] Projector output window upgraded to Three.js compositor with borderless display (`src/output/main.tsx`)
- [x] Desktop Studio upgraded with surface list, media inspector, and interactive corner handles (`src/studio/App.tsx`, `src/studio/studio.css`)
- [x] Android Remote upgraded with surface targeting, touch drawing, and mobile keystone pad (`src/remote/main.tsx`, `src/style.css`)
- [x] Server authoritative state synchronization and project persistence (`server/index.js`)
- [x] End-to-end integration test (`server/integration.test.js`)
- [x] `npm test` passes (9/9 tests)
- [x] `npm run build` compiles with 0 errors across all 4 entry points
