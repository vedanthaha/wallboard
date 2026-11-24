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

const DEFAULT_SOURCE: MediaSource = {
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
};

const DEFAULT_SURFACE: Surface = {
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
  effects: [{ id: 'fx-bloom-1', type: 'bloom', enabled: true, params: { intensity: 1.2, radius: 0.5, threshold: 0.2 } }],
  animations: [{ id: 'anim-rot-1', enabled: true, targetProperty: 'source.config.angle', duration: 8, loop: true, playbackSpeed: 1, keyframes: [{ time: 0, value: 0 }, { time: 8, value: 360 }] }]
};

// Immediate default surface so projector displays content instantly on open
let surfaces: Surface[] = [DEFAULT_SURFACE];
let sources: Record<string, MediaSource> = { 'src-gradient-cyber': DEFAULT_SOURCE };
const strokes: DrawingStroke[] = [];
let isMasterBlackout = false;
let isCalibrationActive = false;

// Resolve server endpoint correctly across both http:// (Vite proxy) and file:// (Electron production)
const SERVER_URL = window.location.protocol === 'file:' ? 'http://localhost:3001' : '';
const socket = io(SERVER_URL || undefined, { transports: ['websocket', 'polling'] });

function joinSession() {
  fetch(`${SERVER_URL}/api/session`)
    .then((r) => r.json())
    .then((session) => {
      if (session?.code) {
        socket.emit('join', { code: session.code, role: 'display' });
      }
      if (Array.isArray(session?.surfaces) && session.surfaces.length > 0) {
        surfaces = session.surfaces;
      }
      if (session?.sources && Object.keys(session.sources).length > 0) {
        sources = session.sources;
      }
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
  if (Array.isArray(state?.surfaces) && state.surfaces.length > 0) {
    surfaces = state.surfaces;
  }
  if (state?.sources && Object.keys(state.sources).length > 0) {
    sources = state.sources;
  }
  if (Array.isArray(state?.strokes)) {
    strokes.length = 0;
    strokes.push(...state.strokes);
  }
  if (state?.masterBlackout !== undefined) isMasterBlackout = state.masterBlackout;
  if (state?.calibrationActive !== undefined) isCalibrationActive = state.calibrationActive;
});

socket.on('surfaces:sync', (data) => {
  if (Array.isArray(data?.surfaces) && data.surfaces.length > 0) {
    surfaces = data.surfaces;
  }
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
