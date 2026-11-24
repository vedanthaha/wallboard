// Shared protocol — stroke, quad and light validation

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
