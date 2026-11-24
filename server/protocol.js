// Shared protocol — validation for decoupled surfaces, media sources, strokes, and scenes

export const MAX_POINTS_PER_STROKE = 12000;
export const MAX_STROKES = 5000;

export function isValidPoint(point) {
  return Boolean(
    point &&
    typeof point === 'object' &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= 1 &&
    point.y >= 0 &&
    point.y <= 1 &&
    (point.t === undefined || Number.isFinite(point.t))
  );
}

export function isValidCornerPins(corners) {
  return Boolean(
    corners &&
    typeof corners === 'object' &&
    isValidPoint(corners.tl) &&
    isValidPoint(corners.tr) &&
    isValidPoint(corners.br) &&
    isValidPoint(corners.bl)
  );
}

export function isValidStroke(stroke) {
  return Boolean(
    stroke &&
    typeof stroke === 'object' &&
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
    (stroke.surfaceId === undefined || typeof stroke.surfaceId === 'string') &&
    (stroke.decaySeconds === undefined || (Number.isFinite(stroke.decaySeconds) && stroke.decaySeconds >= 0))
  );
}

export function isValidMediaSource(source) {
  if (!source || typeof source !== 'object') return false;
  if (typeof source.id !== 'string' || typeof source.name !== 'string') return false;
  if (!source.data || typeof source.data !== 'object') return false;

  const { type, config } = source.data;
  if (!type || !config || typeof config !== 'object') return false;

  switch (type) {
    case 'solid':
      return typeof config.color === 'string';
    case 'gradient_linear':
      return (
        Number.isFinite(config.angle) &&
        Array.isArray(config.stops) &&
        config.stops.length >= 2 &&
        config.stops.every((s) => Number.isFinite(s.offset) && typeof s.color === 'string')
      );
    case 'gradient_radial':
      return (
        Number.isFinite(config.centerX) &&
        Number.isFinite(config.centerY) &&
        Number.isFinite(config.radius) &&
        Array.isArray(config.stops) &&
        config.stops.length >= 2
      );
    case 'drawing':
      return Array.isArray(config.strokes);
    case 'image':
      return typeof config.url === 'string';
    case 'video':
      return typeof config.url === 'string';
    case 'text':
      return typeof config.content === 'string';
    case 'generative':
      return typeof config.preset === 'string';
    default:
      return false;
  }
}

export function isValidSurface(surface) {
  if (!surface || typeof surface !== 'object') return false;
  if (typeof surface.id !== 'string' || typeof surface.name !== 'string') return false;
  if (typeof surface.sourceId !== 'string') return false;
  if (!surface.geometry || !isValidCornerPins(surface.geometry.corners)) return false;
  if (Number.isFinite(surface.opacity) && (surface.opacity < 0 || surface.opacity > 1)) return false;
  return true;
}

// Backward-compatibility validators
export function isValidQuad(quad) {
  return isValidCornerPins(quad);
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

export function isValidCube(cube) {
  return Boolean(
    cube &&
    cube.type === 'cube' &&
    typeof cube.id === 'string' &&
    Number.isFinite(cube.x) &&
    Number.isFinite(cube.y) &&
    Number.isFinite(cube.size) &&
    cube.size > 0 &&
    typeof cube.color === 'string'
  );
}

export function isValidShape(shape) {
  if (!shape || typeof shape !== 'object') return false;
  if (shape.type === 'cube') return isValidCube(shape);
  if (shape.type === 'mask') {
    return Boolean(
      typeof shape.id === 'string' &&
      Array.isArray(shape.points) &&
      shape.points.length >= 3 &&
      shape.points.every(isValidPoint)
    );
  }
  if (shape.type === 'circle') {
    return Boolean(
      typeof shape.id === 'string' &&
      Number.isFinite(shape.x) &&
      Number.isFinite(shape.y) &&
      Number.isFinite(shape.radius)
    );
  }
  return false;
}
