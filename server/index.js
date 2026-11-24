import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isValidStroke, isValidQuad, isValidSpotlight, MAX_STROKES } from './protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true }, maxHttpBufferSize: 1e6 });
const PORT = Number(process.env.PORT || 3001);

const strokes = [];
const peers = new Map();

// Projection mapping and light state
let currentQuad = {
  tl: { x: 0, y: 0 },
  tr: { x: 1, y: 0 },
  br: { x: 1, y: 1 },
  bl: { x: 0, y: 1 }
};
let calibrationActive = false;
let blackoutActive = false;
let activeSpotlight = null;

function getOrCreateSessionCode() {
  if (process.env.SESSION_CODE) return process.env.SESSION_CODE.toUpperCase();
  const sessionFile = path.resolve(__dirname, '../.session-code');
  try {
    if (fs.existsSync(sessionFile)) {
      const saved = fs.readFileSync(sessionFile, 'utf8').trim();
      if (/^[A-Z0-9]{6}$/.test(saved)) return saved;
    }
  } catch {}
  const generated = '9V28Z2';
  try {
    fs.writeFileSync(sessionFile, generated, 'utf8');
  } catch {}
  return generated;
}

const sessionCode = getOrCreateSessionCode();

function getLanAddress(req) {
  if (process.env.HOST && process.env.HOST !== '0.0.0.0') return process.env.HOST;
  const reqHost = req?.hostname;
  if (reqHost && reqHost !== 'localhost' && reqHost !== '127.0.0.1') {
    return reqHost;
  }
  const nets = os.networkInterfaces();
  for (const [name, interfaces] of Object.entries(nets)) {
    if (/wi-fi|wlan|wireless/i.test(name)) {
      for (const info of interfaces || []) {
        if (info.family === 'IPv4' && !info.internal) return info.address;
      }
    }
  }
  for (const interfaces of Object.values(nets)) {
    for (const info of interfaces || []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return 'localhost';
}

app.get('/api/session', async (req, res) => {
  const host = getLanAddress(req);
  const clientPort = process.env.NODE_ENV === 'production' ? PORT : 5173;
  const remoteUrl = `http://${host}:${clientPort}/remote?code=${sessionCode}`;
  try {
    const qr = await QRCode.toDataURL(remoteUrl, { margin: 1, width: 220, color: { dark: '#101318', light: '#ffffff' } });
    res.json({
      code: sessionCode,
      remoteUrl,
      qr,
      connected: peers.size,
      quad: currentQuad,
      calibration: calibrationActive,
      blackout: blackoutActive
    });
  } catch {
    res.status(500).json({ error: 'Could not generate pairing QR code.' });
  }
});

io.on('connection', (socket) => {
  socket.on('join', ({ code, role } = {}) => {
    if (code !== sessionCode || !['display', 'remote'].includes(role)) {
      socket.emit('join:error', 'Invalid pairing code.');
      return;
    }
    peers.set(socket.id, role);
    socket.data.role = role;

    // Send complete current board and optical state
    socket.emit('board:init', strokes);
    socket.emit('warp:update', currentQuad);
    socket.emit('calibration:update', calibrationActive);
    socket.emit('blackout:update', blackoutActive);
    if (activeSpotlight) {
      socket.emit('spotlight:update', activeSpotlight);
    }

    io.emit('presence', { connected: [...peers.values()].filter((v) => v === 'remote').length });
  });

  socket.on('stroke:add', (stroke) => {
    if (socket.data.role !== 'remote') return;
    if (!isValidStroke(stroke)) {
      console.warn('Rejected invalid stroke from client:', JSON.stringify(stroke));
      return;
    }
    const existingIndex = strokes.findIndex((item) => item.id === stroke.id);
    if (existingIndex >= 0) strokes[existingIndex] = stroke;
    else strokes.push(stroke);
    if (strokes.length > MAX_STROKES) strokes.shift();
    socket.broadcast.emit('stroke:add', stroke);
  });

  socket.on('stroke:undo', () => {
    if (socket.data.role !== 'remote') return;
    const removed = strokes.pop();
    if (removed) io.emit('board:undo', removed.id);
  });

  socket.on('board:clear', () => {
    if (socket.data.role !== 'remote') return;
    strokes.length = 0;
    io.emit('board:clear');
  });

  // Projection mapping / quad warping
  socket.on('warp:update', (quad) => {
    if (!isValidQuad(quad)) return;
    currentQuad = quad;
    io.emit('warp:update', currentQuad);
  });

  // Calibration test grid
  socket.on('calibration:set', (val) => {
    calibrationActive = Boolean(val);
    io.emit('calibration:update', calibrationActive);
  });

  socket.on('calibration:toggle', () => {
    calibrationActive = !calibrationActive;
    io.emit('calibration:update', calibrationActive);
  });

  // Optical blackout / shutter
  socket.on('blackout:set', (val) => {
    blackoutActive = Boolean(val);
    io.emit('blackout:update', blackoutActive);
  });

  socket.on('blackout:toggle', () => {
    blackoutActive = !blackoutActive;
    io.emit('blackout:update', blackoutActive);
  });

  // Moving virtual spotlight / torch beam
  socket.on('spotlight:move', (spotlight) => {
    if (!isValidSpotlight(spotlight)) return;
    activeSpotlight = spotlight;
    socket.broadcast.emit('spotlight:update', activeSpotlight);
  });

  socket.on('spotlight:end', () => {
    activeSpotlight = null;
    socket.broadcast.emit('spotlight:update', null);
  });

  socket.on('disconnect', () => {
    peers.delete(socket.id);
    io.emit('presence', { connected: [...peers.values()].filter((v) => v === 'remote').length });
  });
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(__dirname, '../dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Wallboard server listening on http://localhost:${PORT}`);
  console.log(`Session code: ${sessionCode}`);
});
