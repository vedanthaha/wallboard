import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  isValidStroke,
  isValidQuad,
  isValidSpotlight,
  isValidShape,
  MAX_STROKES
} from './protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true }, maxHttpBufferSize: 1e6 });
const PORT = Number(process.env.PORT || 3001);

const strokes = [];
const peers = new Map();
const shapes = [];

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

// Scenes persistence (Phase 6)
const scenesFile = path.resolve(__dirname, '../.scenes.json');
let scenes = [
  {
    id: 'preset-clean',
    name: 'Clean Light Canvas',
    quad: { ...currentQuad },
    strokes: [],
    shapes: [],
    createdAt: Date.now()
  },
  {
    id: 'preset-cube',
    name: '3D Cube Mapping Stage',
    quad: { ...currentQuad },
    strokes: [],
    shapes: [
      {
        id: 'cube-demo',
        type: 'cube',
        x: 0.5,
        y: 0.5,
        size: 0.22,
        rotX: 25,
        rotY: 35,
        rotZ: 0,
        color: '#00ffff',
        lineWidth: 3
      }
    ],
    createdAt: Date.now()
  }
];

try {
  if (fs.existsSync(scenesFile)) {
    const savedScenes = JSON.parse(fs.readFileSync(scenesFile, 'utf8'));
    if (Array.isArray(savedScenes) && savedScenes.length > 0) {
      scenes = savedScenes;
    }
  }
} catch {}

function saveScenesToDisk() {
  try {
    fs.writeFileSync(scenesFile, JSON.stringify(scenes, null, 2), 'utf8');
  } catch {}
}

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
      blackout: blackoutActive,
      shapes,
      scenes
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
    socket.emit('shapes:update', shapes);
    socket.emit('scenes:update', scenes);
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

  // 3D Cubes & Geometric Mapping Shapes
  socket.on('shape:add', (shape) => {
    if (!isValidShape(shape)) return;
    const idx = shapes.findIndex((s) => s.id === shape.id);
    if (idx >= 0) shapes[idx] = shape;
    else shapes.push(shape);
    io.emit('shapes:update', shapes);
  });

  socket.on('shape:remove', (shapeId) => {
    const idx = shapes.findIndex((s) => s.id === shapeId);
    if (idx >= 0) {
      shapes.splice(idx, 1);
      io.emit('shapes:update', shapes);
    }
  });

  socket.on('shapes:clear', () => {
    shapes.length = 0;
    io.emit('shapes:update', shapes);
  });

  // Scene presets & saving (Phase 6)
  socket.on('scene:save', (sceneData) => {
    if (!sceneData?.name) return;
    const newScene = {
      id: 'sc_' + Date.now().toString(36),
      name: sceneData.name,
      quad: { ...currentQuad },
      strokes: [...strokes],
      shapes: [...shapes],
      createdAt: Date.now()
    };
    scenes.push(newScene);
    saveScenesToDisk();
    io.emit('scenes:update', scenes);
  });

  socket.on('scene:load', (sceneId) => {
    const found = scenes.find((s) => s.id === sceneId);
    if (found) {
      if (found.quad) {
        currentQuad = { ...found.quad };
        io.emit('warp:update', currentQuad);
      }
      strokes.length = 0;
      if (Array.isArray(found.strokes)) strokes.push(...found.strokes);
      io.emit('board:init', strokes);

      shapes.length = 0;
      if (Array.isArray(found.shapes)) shapes.push(...found.shapes);
      io.emit('shapes:update', shapes);
    }
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
