// Shared drawing, projection mapping math, and optical light rendering

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

// Render a stroke with curve smoothing, multi-layer glow, and quad warping
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

  if (isEraser) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = strokeWidth * 1.5;
  } else {
    ctx.globalCompositeOperation = glow ? 'screen' : 'source-over';
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = strokeWidth;

    if (glow) {
      ctx.shadowColor = stroke.color;
      ctx.shadowBlur = Math.max(6, strokeWidth * 2.2);
    }
  }

  // Single dot
  if (pts.length === 1) {
    const p0 = warpPoint(pts[0], quad);
    ctx.beginPath();
    ctx.arc(p0.x * canvasWidth, p0.y * canvasHeight, strokeWidth * 0.5, 0, Math.PI * 2);
    if (isEraser) {
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fill();
    } else {
      ctx.fillStyle = stroke.color;
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  // 2 points: simple line
  if (pts.length === 2) {
    const p0 = warpPoint(pts[0], quad);
    const p1 = warpPoint(pts[1], quad);
    ctx.beginPath();
    ctx.moveTo(p0.x * canvasWidth, p0.y * canvasHeight);
    ctx.lineTo(p1.x * canvasWidth, p1.y * canvasHeight);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // 3+ points: quadratic Bezier midpoint smoothing
  ctx.beginPath();
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
  ctx.stroke();

  // Draw intense white-hot core for neon beams when glowing
  if (glow && !isEraser && strokeWidth >= 3 && stroke.color !== '#ffffff') {
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1, strokeWidth * 0.35);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.stroke();
  }

  ctx.restore();
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
  ctx.shadowBlur = 10;
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
  ctx.globalCompositeOperation = 'screen';

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

// Interactive corner detection helper for drag handles
export function getQuadCornerAt(
  clickPos: Point,
  quad: Quad,
  threshold: number = 0.05
): 'tl' | 'tr' | 'br' | 'bl' | null {
  const dist = (p1: Point, p2: Point) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
  if (dist(clickPos, quad.tl) <= threshold) return 'tl';
  if (dist(clickPos, quad.tr) <= threshold) return 'tr';
  if (dist(clickPos, quad.br) <= threshold) return 'br';
  if (dist(clickPos, quad.bl) <= threshold) return 'bl';
  return null;
}
