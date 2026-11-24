// Shared drawing, projection mapping math, 3D cube wireframe, and optical light rendering

export const LIGHT_PALETTE = [
  '#ffffff', // Pure White Beam
  '#00f0ff', // Electric Cyan
  '#39ff14', // Neon Green
  '#ffaa00', // Amber Gold
  '#ff007f', // Magenta UV
  '#ff3333', // Crimson Laser
  '#a855f7'  // Violet Pulse
];

export const WHITEBOARD_PALETTE = [
  '#20242b',
  '#e45454',
  '#3976d2',
  '#269b72',
  '#d49a2a',
  '#8c62bd',
  '#f7f7f4'
];

export interface Point {
  x: number;
  y: number;
  t?: number;
}

export interface Stroke {
  id: string;
  color: string;
  width: number;
  points: Point[];
  createdAt?: number;
  decaySeconds?: number;
}

export interface Quad {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
}

export interface Spotlight {
  x: number;
  y: number;
  radius: number;
  color: string;
  active: boolean;
}

export interface CubeShape {
  id: string;
  type: 'cube';
  x: number;
  y: number;
  size: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  color: string;
  lineWidth: number;
}

export interface MaskShape {
  id: string;
  type: 'mask';
  points: Point[];
}

export interface CircleShape {
  id: string;
  type: 'circle';
  x: number;
  y: number;
  radius: number;
  rings: number;
  color: string;
}

export type MappingShape = CubeShape | MaskShape | CircleShape;

export const DEFAULT_QUAD: Quad = {
  tl: { x: 0, y: 0 },
  tr: { x: 1, y: 0 },
  br: { x: 1, y: 1 },
  bl: { x: 0, y: 1 }
};

export function generateStrokeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

// Bilinear quad mapping for 4-corner keystone projection calibration
export function warpPoint(p: Point, quad: Quad = DEFAULT_QUAD): Point {
  const u = Math.min(1, Math.max(0, p.x));
  const v = Math.min(1, Math.max(0, p.y));
  const invU = 1 - u;
  const invV = 1 - v;
  return {
    x: invU * invV * quad.tl.x + u * invV * quad.tr.x + u * v * quad.br.x + invU * v * quad.bl.x,
    y: invU * invV * quad.tl.y + u * invV * quad.tr.y + u * v * quad.br.y + invU * v * quad.bl.y
  };
}

// Render a stroke with multi-pass optical bloom, white-hot laser core, and quad warping
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  canvasWidth: number,
  canvasHeight: number,
  glow: boolean = false,
  quad: Quad = DEFAULT_QUAD,
  alpha: number = 1
): void {
  if (!stroke.points || stroke.points.length === 0 || alpha <= 0.001) return;

  const isEraser = stroke.color === '#000000' || stroke.color === '#05070a';
  const pts = stroke.points;
  const strokeWidth = Math.max(1, stroke.width * canvasWidth);

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Helper to build smoothed path
  const buildPath = () => {
    ctx.beginPath();
    if (pts.length === 1) {
      const p0 = warpPoint(pts[0], quad);
      ctx.arc(p0.x * canvasWidth, p0.y * canvasHeight, strokeWidth * 0.5, 0, Math.PI * 2);
      return;
    }
    if (pts.length === 2) {
      const p0 = warpPoint(pts[0], quad);
      const p1 = warpPoint(pts[1], quad);
      ctx.moveTo(p0.x * canvasWidth, p0.y * canvasHeight);
      ctx.lineTo(p1.x * canvasWidth, p1.y * canvasHeight);
      return;
    }
    const startPt = warpPoint(pts[0], quad);
    ctx.moveTo(startPt.x * canvasWidth, startPt.y * canvasHeight);
    for (let i = 1; i < pts.length - 1; i++) {
      const current = warpPoint(pts[i], quad);
      const next = warpPoint(pts[i + 1], quad);
      const midX = (current.x + next.x) * 0.5;
      const midY = (current.y + next.y) * 0.5;
      ctx.quadraticCurveTo(
        current.x * canvasWidth,
        current.y * canvasHeight,
        midX * canvasWidth,
        midY * canvasHeight
      );
    }
    const lastPt = warpPoint(pts[pts.length - 1], quad);
    ctx.lineTo(lastPt.x * canvasWidth, lastPt.y * canvasHeight);
  };

  if (isEraser) {
    ctx.globalCompositeOperation = 'destination-out';
    buildPath();
    if (pts.length === 1) {
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fill();
    } else {
      ctx.lineWidth = strokeWidth * 1.8;
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  // Multi-pass Optical Light Bloom (MadMapper-style vibrant emission)
  if (glow) {
    ctx.globalCompositeOperation = 'lighter';

    // Pass 1: Wide diffuse atmospheric bloom
    ctx.shadowColor = stroke.color;
    ctx.shadowBlur = Math.max(20, strokeWidth * 4.2);
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = strokeWidth * 1.6;
    buildPath();
    pts.length === 1 ? ctx.fill() : ctx.stroke();

    // Pass 2: Saturated inner corona
    ctx.shadowBlur = Math.max(10, strokeWidth * 2);
    ctx.lineWidth = strokeWidth * 1.1;
    buildPath();
    pts.length === 1 ? ctx.fill() : ctx.stroke();

    // Pass 3: White-hot laser center core
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1.5, strokeWidth * 0.42);
    ctx.strokeStyle = '#ffffff';
    buildPath();
    if (pts.length === 1) {
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    } else {
      ctx.stroke();
    }
  } else {
    // Non-glow standard render
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = strokeWidth;
    buildPath();
    pts.length === 1 ? ctx.fill() : ctx.stroke();
  }

  ctx.restore();
}

// 3D Cube Wireframe for physical box and object projection mapping
export function draw3DCube(
  ctx: CanvasRenderingContext2D,
  cube: CubeShape,
  canvasWidth: number,
  canvasHeight: number,
  quad: Quad = DEFAULT_QUAD
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const radX = (cube.rotX * Math.PI) / 180;
  const radY = (cube.rotY * Math.PI) / 180;
  const radZ = (cube.rotZ * Math.PI) / 180;

  // 8 unit cube vertices (-0.5 to 0.5)
  const half = cube.size * 0.5;
  const rawVertices = [
    { x: -half, y: -half, z: -half }, // 0: Front top left
    { x: half, y: -half, z: -half },  // 1: Front top right
    { x: half, y: half, z: -half },   // 2: Front bot right
    { x: -half, y: half, z: -half },  // 3: Front bot left
    { x: -half, y: -half, z: half },  // 4: Back top left
    { x: half, y: -half, z: half },   // 5: Back top right
    { x: half, y: half, z: half },    // 6: Back bot right
    { x: -half, y: half, z: half }    // 7: Back bot left
  ];

  // Rotate and project to 2D normalized coordinates
  const projected = rawVertices.map((v) => {
    // Rotate around X
    let y1 = v.y * Math.cos(radX) - v.z * Math.sin(radX);
    let z1 = v.y * Math.sin(radX) + v.z * Math.cos(radX);

    // Rotate around Y
    let x2 = v.x * Math.cos(radY) + z1 * Math.sin(radY);
    let z2 = -v.x * Math.sin(radY) + z1 * Math.cos(radY);

    // Rotate around Z
    let x3 = x2 * Math.cos(radZ) - y1 * Math.sin(radZ);
    let y3 = x2 * Math.sin(radZ) + y1 * Math.cos(radZ);

    // Perspective projection factor
    const dist = 1.8;
    const fov = dist / (dist + z2);

    const normPt: Point = {
      x: cube.x + x3 * fov,
      y: cube.y + y3 * fov
    };

    // Apply projection quad keystone warping
    const warped = warpPoint(normPt, quad);
    return {
      x: warped.x * canvasWidth,
      y: warped.y * canvasHeight
    };
  });

  // 12 edges connecting the cube faces
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0], // Front face
    [4, 5], [5, 6], [6, 7], [7, 4], // Back face
    [0, 4], [1, 5], [2, 6], [3, 7]  // Connecting pillars
  ];

  // Pass 1: Outer glowing neon halo
  ctx.strokeStyle = cube.color;
  ctx.shadowColor = cube.color;
  ctx.shadowBlur = 18;
  ctx.lineWidth = cube.lineWidth * 1.5;

  ctx.beginPath();
  for (const [a, b] of edges) {
    ctx.moveTo(projected[a].x, projected[a].y);
    ctx.lineTo(projected[b].x, projected[b].y);
  }
  ctx.stroke();

  // Pass 2: Sharp core beam
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, cube.lineWidth * 0.4);
  ctx.stroke();

  // Render corner vertices for visual tracing handles
  for (let i = 0; i < projected.length; i++) {
    const pt = projected[i];
    ctx.fillStyle = cube.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// Polygon Mask / Cutout: cuts off 100% of projector light over physical objects (TV, picture frame)
export function drawPolygonMask(
  ctx: CanvasRenderingContext2D,
  mask: MaskShape,
  canvasWidth: number,
  canvasHeight: number,
  quad: Quad = DEFAULT_QUAD,
  showGuides: boolean = false
): void {
  if (!mask.points || mask.points.length < 3) return;

  ctx.save();
  const warpedPts = mask.points.map((p) => {
    const w = warpPoint(p, quad);
    return { x: w.x * canvasWidth, y: w.y * canvasHeight };
  });

  // 1. Cutout light: pitch black fill (0 photons from projector)
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.moveTo(warpedPts[0].x, warpedPts[0].y);
  for (let i = 1; i < warpedPts.length; i++) {
    ctx.lineTo(warpedPts[i].x, warpedPts[i].y);
  }
  ctx.closePath();
  ctx.fill();

  // 2. Alignment dashed border if guides are enabled
  if (showGuides) {
    ctx.strokeStyle = 'rgba(255, 0, 85, 0.7)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

// Concentric Glowing Target Circles
export function drawTargetCircle(
  ctx: CanvasRenderingContext2D,
  circle: CircleShape,
  canvasWidth: number,
  canvasHeight: number,
  quad: Quad = DEFAULT_QUAD
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const center = warpPoint({ x: circle.x, y: circle.y }, quad);
  const cx = center.x * canvasWidth;
  const cy = center.y * canvasHeight;
  const baseR = circle.radius * canvasWidth;

  ctx.strokeStyle = circle.color;
  ctx.shadowColor = circle.color;
  ctx.shadowBlur = 14;
  ctx.lineWidth = 2;

  const count = Math.max(1, circle.rings || 3);
  for (let i = 1; i <= count; i++) {
    const r = (baseR / count) * i;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Crosshairs
  ctx.beginPath();
  ctx.moveTo(cx - baseR * 1.2, cy);
  ctx.lineTo(cx + baseR * 1.2, cy);
  ctx.moveTo(cx, cy - baseR * 1.2);
  ctx.lineTo(cx, cy + baseR * 1.2);
  ctx.stroke();

  ctx.restore();
}

// Render all active geometric shapes
export function drawMappingShapes(
  ctx: CanvasRenderingContext2D,
  shapes: MappingShape[],
  canvasWidth: number,
  canvasHeight: number,
  quad: Quad = DEFAULT_QUAD,
  showGuides: boolean = false
): void {
  for (const s of shapes) {
    if (s.type === 'cube') {
      draw3DCube(ctx, s, canvasWidth, canvasHeight, quad);
    } else if (s.type === 'mask') {
      drawPolygonMask(ctx, s, canvasWidth, canvasHeight, quad, showGuides);
    } else if (s.type === 'circle') {
      drawTargetCircle(ctx, s, canvasWidth, canvasHeight, quad);
    }
  }
}

// Draw projection mapping calibration grid (test pattern)
export function drawCalibrationGrid(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  quad: Quad
): void {
  ctx.save();
  ctx.setLineDash([]);

  const tl = { x: quad.tl.x * canvasWidth, y: quad.tl.y * canvasHeight };
  const tr = { x: quad.tr.x * canvasWidth, y: quad.tr.y * canvasHeight };
  const br = { x: quad.br.x * canvasWidth, y: quad.br.y * canvasHeight };
  const bl = { x: quad.bl.x * canvasWidth, y: quad.bl.y * canvasHeight };

  // 1. Perimeter glow border
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#00f0ff';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(tl.x, tl.y);
  ctx.lineTo(tr.x, tr.y);
  ctx.lineTo(br.x, br.y);
  ctx.lineTo(bl.x, bl.y);
  ctx.closePath();
  ctx.stroke();

  // 2. Corner to corner diagonal guides
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
  ctx.beginPath();
  ctx.moveTo(tl.x, tl.y);
  ctx.lineTo(br.x, br.y);
  ctx.moveTo(tr.x, tr.y);
  ctx.lineTo(bl.x, bl.y);
  ctx.stroke();

  // 3. Subdivided internal perspective grid (4x4)
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    const topPt = warpPoint({ x: t, y: 0 }, quad);
    const botPt = warpPoint({ x: t, y: 1 }, quad);
    ctx.beginPath();
    ctx.moveTo(topPt.x * canvasWidth, topPt.y * canvasHeight);
    ctx.lineTo(botPt.x * canvasWidth, botPt.y * canvasHeight);
    ctx.stroke();

    const leftPt = warpPoint({ x: 0, y: t }, quad);
    const rightPt = warpPoint({ x: 1, y: t }, quad);
    ctx.beginPath();
    ctx.moveTo(leftPt.x * canvasWidth, leftPt.y * canvasHeight);
    ctx.lineTo(rightPt.x * canvasWidth, rightPt.y * canvasHeight);
    ctx.stroke();
  }

  // 4. Center crosshairs and target ring
  const center = warpPoint({ x: 0.5, y: 0.5 }, quad);
  const cx = center.x * canvasWidth;
  const cy = center.y * canvasHeight;

  ctx.strokeStyle = '#39ff14';
  ctx.shadowColor = '#39ff14';
  ctx.shadowBlur = 8;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.arc(cx, cy, 24, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - 36, cy);
  ctx.lineTo(cx + 36, cy);
  ctx.moveTo(cx, cy - 36);
  ctx.lineTo(cx, cy + 36);
  ctx.stroke();

  // 5. Numbered corner pins for physical keystone calibration
  const drawCornerPin = (
    pos: { x: number; y: number },
    label: string,
    coordLabel: string
  ) => {
    ctx.save();
    ctx.fillStyle = '#00f0ff';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 12;

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, pos.x, pos.y);

    // Coordinate tag
    ctx.fillStyle = '#00f0ff';
    ctx.font = '10px monospace';
    ctx.fillText(coordLabel, pos.x, pos.y + (pos.y > canvasHeight * 0.5 ? -22 : 24));
    ctx.restore();
  };

  drawCornerPin(tl, 'TL', `(${quad.tl.x.toFixed(2)}, ${quad.tl.y.toFixed(2)})`);
  drawCornerPin(tr, 'TR', `(${quad.tr.x.toFixed(2)}, ${quad.tr.y.toFixed(2)})`);
  drawCornerPin(br, 'BR', `(${quad.br.x.toFixed(2)}, ${quad.br.y.toFixed(2)})`);
  drawCornerPin(bl, 'BL', `(${quad.bl.x.toFixed(2)}, ${quad.bl.y.toFixed(2)})`);

  // 6. Header label
  ctx.fillStyle = '#00f0ff';
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('PROJECTOR CALIBRATION GRID — 4-CORNER KEYSTONE WARPING', cx, Math.max(30, tl.y + 24));

  ctx.restore();
}

// Draw moving virtual spotlight / torch beam
export function drawSpotlightBeam(
  ctx: CanvasRenderingContext2D,
  center: Point,
  radius: number,
  color: string,
  canvasWidth: number,
  canvasHeight: number,
  quad: Quad = DEFAULT_QUAD
): void {
  const warped = warpPoint(center, quad);
  const cx = warped.x * canvasWidth;
  const cy = warped.y * canvasHeight;
  const r = Math.max(15, radius * canvasWidth);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  grad.addColorStop(0, '#ffffff'); // bright center
  grad.addColorStop(0.3, color);
  grad.addColorStop(0.7, color);
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)'); // falloff to pitch black (0 light)

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Subtle outer ring
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

// Mobile & Desktop touch detection for corner pins
export function getCornerHandleUnderTouch(
  touchPos: Point,
  quad: Quad,
  hitThreshold: number = 0.12 // generous touch target for fingers
): 'tl' | 'tr' | 'br' | 'bl' | null {
  const dist = (p1: Point, p2: Point) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
  if (dist(touchPos, quad.tl) <= hitThreshold) return 'tl';
  if (dist(touchPos, quad.tr) <= hitThreshold) return 'tr';
  if (dist(touchPos, quad.br) <= hitThreshold) return 'br';
  if (dist(touchPos, quad.bl) <= hitThreshold) return 'bl';
  return null;
}
