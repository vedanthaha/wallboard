import { io } from 'socket.io-client';
import { WallboardWebGLCompositor } from '../shared/surfaceRenderer';
import {
  Surface,
  MediaSource,
  DrawingStroke,
  CornerPins
} from '../shared/protocol';

const canvas = document.getElementById('output-canvas') as HTMLCanvasElement;
let compositor: WallboardWebGLCompositor | null = null;

let surfaces: Surface[] = [];
let sources: Record<string, MediaSource> = {};
const strokes: DrawingStroke[] = [];
let isMasterBlackout = false;
let isCalibrationActive = false;

// Connect to server
const socket = io({ transports: ['websocket', 'polling'] });

function joinSession() {
  fetch('/api/session')
    .then((r) => r.json())
    .then((session) => {
      if (session?.code) {
        socket.emit('join', { code: session.code, role: 'display' });
      }
      if (Array.isArray(session?.surfaces)) surfaces = session.surfaces;
      if (session?.sources) sources = session.sources;
      if (Array.isArray(session?.strokes)) strokes.push(...session.strokes);
      if (session?.blackout !== undefined) isMasterBlackout = session.blackout;
      if (session?.calibration !== undefined) isCalibrationActive = session.calibration;
    })
    .catch(() => {});
}

socket.on('connect', joinSession);
joinSession();

// State synchronization
socket.on('state:init', (state) => {
  if (Array.isArray(state?.surfaces)) surfaces = state.surfaces;
  if (state?.sources) sources = state.sources;
  if (Array.isArray(state?.strokes)) {
    strokes.length = 0;
    strokes.push(...state.strokes);
  }
  if (state?.masterBlackout !== undefined) isMasterBlackout = state.masterBlackout;
  if (state?.calibrationActive !== undefined) isCalibrationActive = state.calibrationActive;
});

socket.on('surfaces:sync', (data) => {
  if (Array.isArray(data?.surfaces)) surfaces = data.surfaces;
});

socket.on('surface:update', (updated: Surface) => {
  const idx = surfaces.findIndex((s) => s.id === updated.id);
  if (idx >= 0) surfaces[idx] = updated;
  else surfaces.push(updated);
});

socket.on('surface:corners', ({ surfaceId, corners }: { surfaceId: string; corners: CornerPins }) => {
  const surf = surfaces.find((s) => s.id === surfaceId);
  if (surf) {
    surf.geometry.corners = corners;
  }
});

socket.on('source:update', (source: MediaSource) => {
  sources[source.id] = source;
});

socket.on('source:sync', (allSources: Record<string, MediaSource>) => {
  sources = allSources;
});

socket.on('stroke:add', (stroke: DrawingStroke) => {
  if (!stroke.createdAt) stroke.createdAt = Date.now();
  const index = strokes.findIndex((item) => item.id === stroke.id);
  if (index >= 0) strokes[index] = stroke;
  else strokes.push(stroke);
});

socket.on('board:undo', (id: string) => {
  const index = strokes.findIndex((item) => item.id === id);
  if (index >= 0) strokes.splice(index, 1);
});

socket.on('board:clear', () => {
  strokes.length = 0;
});

socket.on('blackout:update', (active: boolean) => {
  isMasterBlackout = Boolean(active);
});

socket.on('calibration:update', (active: boolean) => {
  isCalibrationActive = Boolean(active);
});

// Backward-compatibility events
socket.on('warp:update', (quad: CornerPins) => {
  if (surfaces[0]) {
    surfaces[0].geometry.corners = quad;
  }
});

socket.on('board:init', (initStrokes: DrawingStroke[]) => {
  strokes.length = 0;
  if (Array.isArray(initStrokes)) {
    const now = Date.now();
    for (const s of initStrokes) {
      if (!s.createdAt) s.createdAt = now;
      strokes.push(s);
    }
  }
});

// Render Loop
function renderLoop() {
  requestAnimationFrame(renderLoop);
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    if (compositor) {
      compositor.resize(w, h);
    }
  }

  if (!compositor) {
    compositor = new WallboardWebGLCompositor(canvas);
    compositor.resize(w, h);
  }

  compositor.render(surfaces, sources, strokes, isMasterBlackout, isCalibrationActive);
}

requestAnimationFrame(renderLoop);

// Projector operator shortcuts
window.addEventListener('keydown', (e) => {
  if (e.key === 'F11') {
    e.preventDefault();
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  } else if (e.key === 'b' || e.key === 'B') {
    socket.emit('blackout:toggle');
  } else if (e.key === 'c' || e.key === 'C') {
    socket.emit('calibration:toggle');
  } else if (e.key === 'Escape' && document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
});
