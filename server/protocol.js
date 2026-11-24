export const MAX_POINTS_PER_STROKE = 12000;
export const MAX_STROKES = 5000;

export function isValidPoint(point) {
  return Boolean(
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= 1 &&
    point.y >= 0 &&
    point.y <= 1 &&
    (point.t === undefined || Number.isFinite(point.t))
  );
}

export function isValidStroke(stroke) {
  return Boolean(
    stroke &&
    typeof stroke.id === 'string' &&
    stroke.id.length <= 80 &&
    typeof stroke.color === 'string' &&
    /^#[0-9a-fA-F]{6}$/.test(stroke.color) &&
    Number.isFinite(stroke.width) &&
    stroke.width >= 0.001 &&
    stroke.width <= 0.08 &&
    Array.isArray(stroke.points) &&
    stroke.points.length > 0 &&
    stroke.points.length <= MAX_POINTS_PER_STROKE &&
    stroke.points.every(isValidPoint) &&
    (stroke.decaySeconds === undefined || (Number.isFinite(stroke.decaySeconds) && stroke.decaySeconds >= 0))
  );
}

export function isValidQuad(quad) {
  return Boolean(
    quad &&
    isValidPoint(quad.tl) &&
    isValidPoint(quad.tr) &&
    isValidPoint(quad.br) &&
    isValidPoint(quad.bl)
  );
}

export function isValidSpotlight(spotlight) {
  if (spotlight === null) return true;
  return Boolean(
    spotlight &&
    Number.isFinite(spotlight.x) &&
    Number.isFinite(spotlight.y) &&
    spotlight.x >= 0 &&
    spotlight.x <= 1 &&
    spotlight.y >= 0 &&
    spotlight.y <= 1 &&
    Number.isFinite(spotlight.radius) &&
    spotlight.radius > 0 &&
    spotlight.radius <= 1 &&
    typeof spotlight.color === 'string' &&
    typeof spotlight.active === 'boolean'
  );
}
