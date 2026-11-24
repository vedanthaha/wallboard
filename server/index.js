import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidStroke, MAX_STROKES } from './protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true }, maxHttpBufferSize: 1e6 });
const PORT = Number(process.env.PORT || 3001);
const strokes = [];
const peers = new Map();
const sessionCode = Math.random().toString(36).slice(2, 8).toUpperCase();

function getLanAddress() {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const info of interfaces || []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return 'localhost';
}

app.get('/api/session', async (_req, res) => {
  const host = getLanAddress();
  const clientPort = process.env.NODE_ENV === 'production' ? PORT : 5173;
  const remoteUrl = `http://${host}:${clientPort}/remote?code=${sessionCode}`;
  try {
    const qr = await QRCode.toDataURL(remoteUrl, { margin: 1, width: 220, color: { dark: '#101318', light: '#ffffff' } });
    res.json({ code: sessionCode, remoteUrl, qr, connected: peers.size });
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
    socket.emit('board:init', strokes);
    io.emit('presence', { connected: [...peers.values()].filter((v) => v === 'remote').length });
  });

  socket.on('stroke:add', (stroke) => {
    if (socket.data.role !== 'remote' || !isValidStroke(stroke)) return;
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