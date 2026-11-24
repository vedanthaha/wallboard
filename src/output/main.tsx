import { io } from 'socket.io-client';
import {
  drawStroke,
  drawCalibrationGrid,
  drawSpotlightBeam,
  DEFAULT_QUAD,
  Quad,
  Stroke,
  Spotlight
} from '../shared/drawing';

const canvas = document.getElementById('output-canvas') as HTMLCanvasElement;
const strokes: Stroke[] = [];
let currentQuad: Quad = { ...DEFAULT_QUAD };
let isCalibrationActive = false;
let isBlackoutActive = false;
let activeSpotlight: Spotlight | null = null;

// Connect to local server for real-time stroke and projection synchronization
const socket = io({ transports: ['websocket', 'polling'] });

function joinSession() {
  fetch('/api/session')
    .then((r) => r.json())
    .then((session) => {
      if (session?.code) {
        socket.emit('join', { code: session.code, role: 'display' });
      }
      if (session?.quad) currentQuad = session.quad;
      if (session?.calibration !== undefined) isCalibrationActive = session.calibration;
      if (session?.blackout !== undefined) isBlackoutActive = session.blackout;
    })
    .catch(() => {});
}

socket.on('connect', joinSession);
joinSession();

socket.on('board:init', (initStrokes: Stroke[]) => {
  strokes.length = 0;
  if (Array.isArray(initStrokes)) {
    const now = Date.now();
    for (const s of initStrokes) {
      if (!s.createdAt) s.createdAt = now;
      strokes.push(s);
    }
  }
});

socket.on('stroke:add', (stroke: Stroke) => {
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

socket.on('warp:update', (quad: Quad) => {
  if (quad) currentQuad = quad;
});

socket.on('calibration:update', (active: boolean) => {
  isCalibrationActive = Boolean(active);
});

socket.on('blackout:update', (active: boolean) => {
  isBlackoutActive = Boolean(active);
});

socket.on('spotlight:update', (spotlight: Spotlight | null) => {
  activeSpotlight = spotlight;
});

// Continuous high-FPS render loop for optical decay, spotlights, and warping
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
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Blackout Shutter: 0 light emitted from projector lamp
  if (isBlackoutActive) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, rect.width, rect.height);
    return;
  }

  // Pitch black background (pure optical black)
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, rect.width, rect.height);

  const now = Date.now();

  // Render strokes with laser decay handling
  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i];
    let alpha = 1;

    if (stroke.decaySeconds && stroke.decaySeconds > 0) {
      const created = stroke.createdAt || now;
      const ageMs = now - created;
      const totalMs = stroke.decaySeconds * 1000;
      if (ageMs >= totalMs) {
        // Expired decay stroke — prune
        strokes.splice(i, 1);
        continue;
      }
      alpha = Math.max(0, 1 - ageMs / totalMs);
    }

    drawStroke(ctx, stroke, rect.width, rect.height, true, currentQuad, alpha);
  }

  // Render moving virtual spotlight beam
  if (activeSpotlight && activeSpotlight.active) {
    drawSpotlightBeam(
      ctx,
      { x: activeSpotlight.x, y: activeSpotlight.y },
      activeSpotlight.radius,
      activeSpotlight.color,
      rect.width,
      rect.height,
      currentQuad
    );
  }

  // Render projection calibration test pattern (4-corner keystone alignment)
  if (isCalibrationActive) {
    drawCalibrationGrid(ctx, rect.width, rect.height, currentQuad);
  }
}

requestAnimationFrame(renderLoop);

// Interactive hotkeys & gestures for projector calibration
window.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F' || e.key === 'F11') {
    e.preventDefault();
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  } else if (e.key === 'c' || e.key === 'C') {
    socket.emit('calibration:toggle');
  } else if (e.key === 'b' || e.key === 'B') {
    socket.emit('blackout:toggle');
  } else if (e.key === 'Escape' && document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
});

window.addEventListener('dblclick', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
});
