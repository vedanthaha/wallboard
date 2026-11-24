# Wallboard build checklist

Status meanings: `DONE` = implemented and verified in this workspace; `IN PROGRESS` = partially implemented; `TODO` = not implemented; `BLOCKED` = requires external hardware/account/manual action.

## Project setup
- [x] Project structure and npm scripts — created
- [x] React + Vite frontend scaffold — created
- [x] Express + Socket.IO server scaffold — created
- [x] Local network binding — configured to listen on `0.0.0.0`
- [ ] Dependency installation — BLOCKED: npm registry install timed out in this environment

## Display experience
- [x] Full-screen display canvas — implemented
- [x] Pairing QR code and session code — implemented
- [x] Connection / phone presence indicators — implemented
- [ ] Browser kiosk / auto-fullscreen launch — TODO

## Phone remote
- [x] Phone route and session-code entry — implemented
- [x] Pointer/touch drawing input — implemented
- [x] Pen color and brush-size controls — implemented
- [x] Eraser, undo and clear controls — implemented
- [ ] Pan and zoom gestures — TODO
- [ ] Text, shapes, sticky notes and image import — TODO

## Realtime and reliability
- [x] Socket.IO realtime transport — implemented
- [x] Server-side stroke payload validation — implemented
- [x] Initial board sync on join — implemented
- [ ] Persistent board storage — TODO
- [ ] Reconnect replay / offline queue — TODO
- [ ] Robust multi-user undo and conflict handling — TODO
- [ ] Configurable production origin for QR links — TODO

## Verification
- [x] `node --test` — 3 passed, 0 failed
- [ ] `npm install` — BLOCKED: registry timeout in build environment
- [ ] `npm run build` — not verified because dependencies were unavailable
- [ ] Laptop + phone same-Wi-Fi test — requires user hardware
- [ ] Projector HDMI test — requires user hardware
- [ ] Drawing latency test — requires user hardware

## Release / publishing
- [x] ZIP archive — packaged; runtime build still requires dependency installation
- [x] GitHub repository — created by user
- [x] Source published to GitHub — verified on `main`
