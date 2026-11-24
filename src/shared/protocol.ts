// Shared protocol — stroke, quad, shape and scene validation

export const MAX_POINTS_PER_STROKE = 12000;
export const MAX_STROKES = 5000;

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

export interface Scene {
  id: string;
  name: string;
  quad: Quad;
  strokes: Stroke[];
  shapes: MappingShape[];
  createdAt: number;
}

export function isValidPoint(point: unknown): point is Point {
  if (!point || typeof point !== 'object') return false;
  const p = point as Record<string, unknown>;
  return (
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    (p.x as number) >= 0 &&
    (p.x as number) <= 1 &&
    (p.y as number) >= 0 &&
    (p.y as number) <= 1 &&
    (p.t === undefined || Number.isFinite(p.t))
  );
}

export function isValidStroke(stroke: unknown): stroke is Stroke {
  if (!stroke || typeof stroke !== 'object') return false;
  const s = stroke as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    s.id.length <= 80 &&
    typeof s.color === 'string' &&
    /^#[0-9a-fA-F]{6}$/.test(s.color as string) &&
    Number.isFinite(s.width) &&
    (s.width as number) >= 0.001 &&
    (s.width as number) <= 0.08 &&
    Array.isArray(s.points) &&
    s.points.length > 0 &&
    s.points.length <= MAX_POINTS_PER_STROKE &&
    s.points.every(isValidPoint) &&
    (s.decaySeconds === undefined || (Number.isFinite(s.decaySeconds) && (s.decaySeconds as number) >= 0))
  );
}

export function isValidQuad(quad: unknown): quad is Quad {
  if (!quad || typeof quad !== 'object') return false;
  const q = quad as Record<string, unknown>;
  return (
    isValidPoint(q.tl) &&
    isValidPoint(q.tr) &&
    isValidPoint(q.br) &&
    isValidPoint(q.bl)
  );
}

export function isValidSpotlight(spotlight: unknown): spotlight is Spotlight | null {
  if (spotlight === null) return true;
  if (!spotlight || typeof spotlight !== 'object') return false;
  const s = spotlight as Record<string, unknown>;
  return (
    Number.isFinite(s.x) &&
    Number.isFinite(s.y) &&
    (s.x as number) >= 0 &&
    (s.x as number) <= 1 &&
    (s.y as number) >= 0 &&
    (s.y as number) <= 1 &&
    Number.isFinite(s.radius) &&
    (s.radius as number) > 0 &&
    (s.radius as number) <= 1 &&
    typeof s.color === 'string' &&
    typeof s.active === 'boolean'
  );
}

export function isValidShape(shape: unknown): shape is MappingShape {
  if (!shape || typeof shape !== 'object') return false;
  const s = shape as Record<string, unknown>;
  if (s.type === 'cube') {
    return Boolean(
      typeof s.id === 'string' &&
      Number.isFinite(s.x) &&
      Number.isFinite(s.y) &&
      Number.isFinite(s.size) &&
      (s.size as number) > 0 &&
      typeof s.color === 'string'
    );
  }
  if (s.type === 'mask') {
    return Boolean(
      typeof s.id === 'string' &&
      Array.isArray(s.points) &&
      s.points.length >= 3 &&
      s.points.every(isValidPoint)
    );
  }
  if (s.type === 'circle') {
    return Boolean(
      typeof s.id === 'string' &&
      Number.isFinite(s.x) &&
      Number.isFinite(s.y) &&
      Number.isFinite(s.radius)
    );
  }
  return false;
}
