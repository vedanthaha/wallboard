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
  isValidSurface,
  isValidMediaSource,
  isValidCornerPins,
  isValidSpotlight,
  isValidShape,
  MAX_STROKES
} from './protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true }, maxHttpBufferSize: 2e6 });
const PORT = Number(process.env.PORT || 3001);

const projectFile = path.resolve(__dirname, '../default.wallboard');

// ---------------------------------------------------------------------------
// Authoritative Decoupled Application State
// ---------------------------------------------------------------------------

let sources = {
  'src-gradient-cyber': {
    id: 'src-gradient-cyber',
    name: 'Cyberpunk Neon',
    data: {
      type: 'gradient_linear',
      config: {
        angle: 45,
        stops: [
          { offset: 0, color: '#00f0ff' },
          { offset: 0.5, color: '#7000ff' },
          { offset: 1, color: '#ff007f' }
        ]
      }
    }
  },
  'src-gradient-warm': {
    id: 'src-gradient-warm',
    name: 'Solar Flare',
    data: {
      type: 'gradient_linear',
      config: {
        angle: 90,
        stops: [
          { offset: 0, color: '#ffaa00' },
          { offset: 1, color: '#ff0033' }
        ]
      }
    }
  },
  'src-solid-cyan': {
    id: 'src-solid-cyan',
    name: 'Solid Cyan',
    data: {
      type: 'solid',
      config: {
        color: '#00f0ff'
      }
    }
  }
};

let surfaces = [
  {
    id: 'surface-1',
    name: 'Surface 1',
    sourceId: 'src-gradient-cyber',
    blendMode: 'screen',
    opacity: 1,
    geometry: {
      id: 'geom-1',
      name: 'Quad 1',
      type: 'quad',
      zIndex: 0,
      visible: true,
      locked: false,
      corners: {
        tl: { x: 0.15, y: 0.15 },
        tr: { x: 0.85, y: 0.15 },
        br: { x: 0.85, y: 0.85 },
        bl: { x: 0.15, y: 0.85 }
      }
    },
    effects: [
      {
        id: 'fx-bloom-1',
        type: 'bloom',
        enabled: true,
        params: { intensity: 1.2, radius: 0.5, threshold: 0.2 }
      }
    ],
    animations: [
      {
        id: 'anim-rot-1',
        enabled: true,
        targetProperty: 'source.config.angle',
        duration: 8,
        loop: true,
        playbackSpeed: 1,
        keyframes: [
          { time: 0, value: 0 },
          { time: 8, value: 360 }
        ]
      }
    ]
  }
];

let activeSurfaceId = 'surface-1';
const strokes = [];
let masterBlackout = false;
let masterIntensity = 1.0;
let calibrationActive = false;
let activeSpotlight = null;
const peers = new Map();

// Load persistent project from disk
function loadProjectFromDisk() {
  try {
    if (fs.existsSync(projectFile)) {
      const content = fs.readFileSync(projectFile, 'utf8');
      const project = JSON.parse(content);
      if (project && project.scenes && project.scenes[0]) {
        const sc = project.scenes[0];
        if (Array.isArray(sc.surfaces) && sc.surfaces.length > 0) {
          surfaces = sc.surfaces;
        }
        if (sc.sources && Object.keys(sc.sources).length > 0) {
          sources = sc.sources;
        }
        if (Array.isArray(sc.strokes)) {
          strokes.length = 0;
          strokes.push(...sc.strokes);
        }
        if (sc.masterBlackout !== undefined) masterBlackout = sc.masterBlackout;
        if (sc.masterIntensity !== undefined) masterIntensity = sc.masterIntensity;
        activeSurfaceId = surfaces[0]?.id || 'surface-1';
        console.log(`Loaded project from disk: ${project.name || 'default'} (schemaVersion: ${project.schemaVersion || 1})`);
      }
    }
  } catch (err) {
    console.warn('Could not load project file from disk:', err.message);
  }
}

function saveProjectToDisk() {
  try {
    const project = {
      schemaVersion: 1,
      name: 'Default Project',
      activeSceneId: 'scene-1',
      savedAt: Date.now(),
      scenes: [
        {
          id: 'scene-1',
          name: 'Main Stage',
          surfaces,
          sources,
          strokes,
          masterBlackout,
          masterIntensity
        }
      ]
    };
    fs.writeFileSync(projectFile, JSON.stringify(project, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Failed to save project:', err);
    return false;
  }
}

loadProjectFromDisk();

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
    const qr = await QRCode.toDataURL(remoteUrl, {
      margin: 1,
      width: 220,
      color: { dark: '#101318', light: '#ffffff' }
    });
    res.json({
      code: sessionCode,
      remoteUrl,
      qr,
      connected: peers.size,
      surfaces,
      sources,
      activeSurfaceId,
      strokes,
      blackout: masterBlackout,
      calibration: calibrationActive,
      // Backward compatibility quad:
      quad: surfaces[0]?.geometry?.corners || {
        tl: { x: 0, y: 0 },
        tr: { x: 1, y: 0 },
        br: { x: 1, y: 1 },
        bl: { x: 0, y: 1 }
      }
    });
  } catch {
    res.status(500).json({ error: 'Could not generate pairing QR code.' });
  }
});

app.post('/api/project/save', (_req, res) => {
  const ok = saveProjectToDisk();
  res.json({ success: ok });
});

io.on('connection', (socket) => {
  socket.on('join', ({ code, role } = {}) => {
    if (code !== sessionCode || !['display', 'remote'].includes(role)) {
      socket.emit('join:error', 'Invalid pairing code.');
      return;
    }
    peers.set(socket.id, role);
    socket.data.role = role;

    // Send complete authoritative state
    socket.emit('state:init', {
      surfaces,
      sources,
      activeSurfaceId,
      strokes,
      masterBlackout,
      masterIntensity,
      calibrationActive
    });

    // Backward-compatibility events
    socket.emit('board:init', strokes);
    socket.emit('warp:update', surfaces[0]?.geometry?.corners);
    socket.emit('calibration:update', calibrationActive);
    socket.emit('blackout:update', masterBlackout);

    io.emit('presence', { connected: [...peers.values()].filter((v) => v === 'remote').length });
  });

  // Clock offset telemetry for latency calculation
  socket.on('telemetry:ping', (data) => {
    socket.emit('telemetry:pong', {
      clientTime: data?.clientTime,
      serverTime: Date.now()
    });
  });

  // Surface management
  socket.on('surface:create', (newSurface) => {
    if (!isValidSurface(newSurface)) return;
    const exists = surfaces.find((s) => s.id === newSurface.id);
    if (!exists) {
      surfaces.push(newSurface);
      activeSurfaceId = newSurface.id;
      io.emit('surfaces:sync', { surfaces, activeSurfaceId });
    }
  });

  socket.on('surface:select', (surfaceId) => {
    if (surfaces.some((s) => s.id === surfaceId)) {
      activeSurfaceId = surfaceId;
      io.emit('surface:selected', activeSurfaceId);
    }
  });

  socket.on('surface:update', (updatedSurface) => {
    if (!isValidSurface(updatedSurface)) return;
    const idx = surfaces.findIndex((s) => s.id === updatedSurface.id);
    if (idx >= 0) {
      surfaces[idx] = updatedSurface;
      io.emit('surface:update', updatedSurface);
    }
  });

  // Corner pin update for a specific surface
  socket.on('surface:corners', ({ surfaceId, corners }) => {
    if (!isValidCornerPins(corners)) return;
    const targetId = surfaceId || activeSurfaceId;
    const surface = surfaces.find((s) => s.id === targetId);
    if (surface) {
      surface.geometry.corners = corners;
      io.emit('surface:corners', { surfaceId: targetId, corners });
      // Backward compatibility event for default surface
      if (surface.id === surfaces[0]?.id) {
        io.emit('warp:update', corners);
      }
    }
  });

  socket.on('surface:remove', (surfaceId) => {
    if (surfaces.length <= 1) return; // Keep at least one surface
    const idx = surfaces.findIndex((s) => s.id === surfaceId);
    if (idx >= 0) {
      surfaces.splice(idx, 1);
      if (activeSurfaceId === surfaceId) {
        activeSurfaceId = surfaces[0].id;
      }
      io.emit('surfaces:sync', { surfaces, activeSurfaceId });
    }
  });

  // Media source management
  socket.on('source:update', (source) => {
    if (!isValidMediaSource(source)) return;
    sources[source.id] = source;
    io.emit('source:update', source);
  });

  socket.on('source:create', (source) => {
    if (!isValidMediaSource(source)) return;
    sources[source.id] = source;
    io.emit('source:sync', sources);
  });

  // Drawing strokes
  socket.on('stroke:add', (stroke) => {
    if (socket.data.role !== 'remote') return;
    if (!isValidStroke(stroke)) {
      console.warn('Rejected invalid stroke:', JSON.stringify(stroke));
      return;
    }
    // Tag stroke with active surface if not explicitly provided
    if (!stroke.surfaceId) {
      stroke.surfaceId = activeSurfaceId;
    }
    const existingIndex = strokes.findIndex((item) => item.id === stroke.id);
    if (existingIndex >= 0) strokes[existingIndex] = stroke;
    else strokes.push(stroke);
    if (strokes.length > MAX_STROKES) strokes.shift();

    socket.broadcast.emit('stroke:add', { ...stroke, t_network: Date.now() });
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

  // Master Blackout Shutter (0 light output)
  socket.on('blackout:set', (val) => {
    masterBlackout = Boolean(val);
    io.emit('blackout:update', masterBlackout);
  });

  socket.on('blackout:toggle', () => {
    masterBlackout = !masterBlackout;
    io.emit('blackout:update', masterBlackout);
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

  // Backward compatibility warp:update
  socket.on('warp:update', (quad) => {
    if (!isValidCornerPins(quad)) return;
    const defaultSurface = surfaces[0];
    if (defaultSurface) {
      defaultSurface.geometry.corners = quad;
      io.emit('surface:corners', { surfaceId: defaultSurface.id, corners: quad });
      io.emit('warp:update', quad);
    }
  });

  // Project persistence triggers
  socket.on('project:save', () => {
    const success = saveProjectToDisk();
    socket.emit('project:save:result', { success });
  });

  socket.on('disconnect', () => {
    peers.delete(socket.id);
    io.emit('presence', { connected: [...peers.values()].filter((v) => v === 'remote').length });
  });
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(__dirname, '../dist');
  app.use(express.static(dist));
  app.get('/remote', (_req, res) => res.sendFile(path.join(dist, 'remote.html')));
  app.get('/output', (_req, res) => res.sendFile(path.join(dist, 'output.html')));
  app.get('/studio', (_req, res) => res.sendFile(path.join(dist, 'studio.html')));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Wallboard server listening on http://localhost:${PORT}`);
  console.log(`Session code: ${sessionCode}`);
});
