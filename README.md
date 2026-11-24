# Wallboard

A local-first phone-controlled drawing surface for a laptop + projector. The laptop runs the app and renders the board; phones send drawing events over the same Wi-Fi network. The projector only needs HDMI.

> MVP status: pairing, live pen strokes, color/size controls, eraser, undo and clear are implemented. This is a starter MVP, not yet a production infinite-canvas engine: pan/zoom, durable board saving, multi-user conflict handling and full end-to-end device testing remain planned.

## Requirements

- Node.js 20+
- Laptop connected to the projector by HDMI
- Phone and laptop on the same Wi-Fi network
- Network firewall allows local connections to ports 5173 and 3001

## Run in development

```bash
npm install
npm run dev
```

Open `http://localhost:5173` on the laptop. The display shows a QR code and six-character session code. Scan the QR code on your phone. If scanning does not open the page, open the local URL encoded in the QR code or enter the session code at `/remote`.

If the phone cannot connect, allow Node.js through the laptop firewall on the private network and confirm both devices are on the same Wi-Fi. Guest Wi-Fi / client isolation can block device-to-device traffic.

## Production build

```bash
npm run build
NODE_ENV=production npm start
```

The production server serves the built app on port 3001 by default.

## Routes

- `/` — projector / display view
- `/remote` — phone drawing pad
- `/api/session` — pairing metadata and QR code

## Controls

- Phone: pen, eraser, color, brush size, undo, clear
- Display: show/hide pairing card

## Architecture

- Vite + React frontend
- Express + Socket.IO local server
- Socket.IO relays validated normalized stroke events
- In-memory board state (resets when server restarts)
- QR pairing with a short session code

## Security / limitations

This is designed for a trusted home LAN. The session code is a lightweight pairing gate, not strong authentication. Do not expose the server to the public internet. Add TLS, stronger pairing tokens, rate limits and persistent storage before using it on untrusted networks.

The current eraser paints the background color and is intended for the default light canvas. The MVP sends stroke updates while drawing and sends the final stroke on pointer release; robust per-user undo and collaborative conflict resolution are not implemented.

## Tests

```bash
npm test
npm run build
```

See [`BUILD_CHECKLIST.md`](./BUILD_CHECKLIST.md) and [`STATUS.md`](./STATUS.md) for verified status and remaining work.
