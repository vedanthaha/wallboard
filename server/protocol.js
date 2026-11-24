export const MAX_POINTS_PER_STROKE = 12000;
export const MAX_STROKES = 5000;

export function isValidPoint(point) {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
}

export function isValidStroke(stroke) {
  return Boolean(stroke && typeof stroke.id === 'string' && stroke.id.length <= 80
    && typeof stroke.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(stroke.color)
    && Number.isFinite(stroke.width) && stroke.width >= 0.001 && stroke.width <= 0.08
    && Array.isArray(stroke.points) && stroke.points.length > 0
    && stroke.points.length <= MAX_POINTS_PER_STROKE && stroke.points.every(isValidPoint));
}
