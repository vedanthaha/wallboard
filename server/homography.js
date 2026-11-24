// Homography matrix computation and coordinate mapping
// Maps unit square [0,1]^2 to/from arbitrary planar quadrilateral

/**
 * Computes forward homography matrix H mapping unit square:
 * (0,0) -> TL, (1,0) -> TR, (1,1) -> BR, (0,1) -> BL
 * Matrix in row-major:
 * [ m00, m01, m02,
 *   m10, m11, m12,
 *   m20, m21, m22 ]
 */
export function computeHomography(corners) {
  const x0 = corners.tl.x;
  const y0 = corners.tl.y;
  const x1 = corners.tr.x;
  const y1 = corners.tr.y;
  const x2 = corners.br.x;
  const y2 = corners.br.y;
  const x3 = corners.bl.x;
  const y3 = corners.bl.y;

  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const sx = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const sy = y0 - y1 + y2 - y3;

  // Affine case (parallelogram)
  if (Math.abs(sx) < 1e-10 && Math.abs(sy) < 1e-10) {
    return [
      x1 - x0, x3 - x0, x0,
      y1 - y0, y3 - y0, y0,
      0, 0, 1
    ];
  }

  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-12) {
    // Degenerate quad, fallback to affine
    return [
      x1 - x0, x3 - x0, x0,
      y1 - y0, y3 - y0, y0,
      0, 0, 1
    ];
  }

  const g = (sx * dy2 - sy * dx2) / den;
  const h = (dx1 * sy - dy1 * sx) / den;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const c = x0;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  const f = y0;

  return [
    a, b, c,
    d, e, f,
    g, h, 1
  ];
}

/**
 * Inverts a 3x3 matrix in row-major order.
 * Returns null if matrix is singular.
 */
export function invertMatrix3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;

  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;

  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);

  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;

  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-14) {
    return null;
  }

  const invDet = 1 / det;
  return [
    A * invDet, D * invDet, G * invDet,
    B * invDet, E * invDet, H * invDet,
    C * invDet, F * invDet, I * invDet
  ];
}

/**
 * Computes inverse homography H^-1 mapping screen coordinates (x, y)
 * into surface UV space (u, v) in [0, 1]^2.
 */
export function computeInverseHomography(corners) {
  const H = computeHomography(corners);
  const inv = invertMatrix3(H);
  if (!inv) {
    return [
      1, 0, 0,
      0, 1, 0,
      0, 0, 1
    ];
  }
  return inv;
}

/**
 * Convert row-major Matrix3 into column-major array format
 * expected by WebGL / Three.js uniform mat3.
 */
export function matrix3ToColumnMajor(m) {
  return [
    m[0], m[3], m[6],
    m[1], m[4], m[7],
    m[2], m[5], m[8]
  ];
}

/**
 * Maps UV point (u, v) -> Screen point (x, y) using forward homography
 */
export function forwardMap(H, u, v) {
  const x = H[0] * u + H[1] * v + H[2];
  const y = H[3] * u + H[4] * v + H[5];
  const w = H[6] * u + H[7] * v + H[8];
  if (Math.abs(w) < 1e-12) return { x: 0, y: 0 };
  return { x: x / w, y: y / w };
}

/**
 * Maps Screen point (x, y) -> UV point (u, v) using inverse homography
 */
export function inverseMap(invH, x, y) {
  const u = invH[0] * x + invH[1] * y + invH[2];
  const v = invH[3] * x + invH[4] * y + invH[5];
  const w = invH[6] * x + invH[7] * y + invH[8];
  if (Math.abs(w) < 1e-12) return { x: 0, y: 0 };
  return { x: u / w, y: v / w };
}
