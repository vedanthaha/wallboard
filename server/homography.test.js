import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeHomography,
  computeInverseHomography,
  forwardMap,
  inverseMap,
  matrix3ToColumnMajor
} from './homography.js';

test('homography identity for unit square', () => {
  const unitQuad = {
    tl: { x: 0, y: 0 },
    tr: { x: 1, y: 0 },
    br: { x: 1, y: 1 },
    bl: { x: 0, y: 1 }
  };

  const H = computeHomography(unitQuad);
  const invH = computeInverseHomography(unitQuad);

  // TL (0,0) -> (0,0)
  const tlMapped = forwardMap(H, 0, 0);
  assert.ok(Math.abs(tlMapped.x - 0) < 1e-6);
  assert.ok(Math.abs(tlMapped.y - 0) < 1e-6);

  // BR (1,1) -> (1,1)
  const brMapped = forwardMap(H, 1, 1);
  assert.ok(Math.abs(brMapped.x - 1) < 1e-6);
  assert.ok(Math.abs(brMapped.y - 1) < 1e-6);

  // Inverse: (1,1) -> (1,1)
  const brInv = inverseMap(invH, 1, 1);
  assert.ok(Math.abs(brInv.x - 1) < 1e-6);
  assert.ok(Math.abs(brInv.y - 1) < 1e-6);
});

test('homography maps non-affine perspective trapezoid with exact precision', () => {
  // Keystone projection on wall (trapezoid where top is narrower than bottom)
  const keystoneQuad = {
    tl: { x: 0.25, y: 0.1 },
    tr: { x: 0.75, y: 0.15 },
    br: { x: 0.85, y: 0.85 },
    bl: { x: 0.15, y: 0.8 }
  };

  const H = computeHomography(keystoneQuad);
  const invH = computeInverseHomography(keystoneQuad);

  // Verify all 4 corners forward map to exact quad coordinates
  const tl = forwardMap(H, 0, 0);
  assert.ok(Math.abs(tl.x - keystoneQuad.tl.x) < 1e-5);
  assert.ok(Math.abs(tl.y - keystoneQuad.tl.y) < 1e-5);

  const tr = forwardMap(H, 1, 0);
  assert.ok(Math.abs(tr.x - keystoneQuad.tr.x) < 1e-5);
  assert.ok(Math.abs(tr.y - keystoneQuad.tr.y) < 1e-5);

  const br = forwardMap(H, 1, 1);
  assert.ok(Math.abs(br.x - keystoneQuad.br.x) < 1e-5);
  assert.ok(Math.abs(br.y - keystoneQuad.br.y) < 1e-5);

  const bl = forwardMap(H, 0, 1);
  assert.ok(Math.abs(bl.x - keystoneQuad.bl.x) < 1e-5);
  assert.ok(Math.abs(bl.y - keystoneQuad.bl.y) < 1e-5);

  // Verify all 4 corners inverse map to exact UV coordinates
  const uvTL = inverseMap(invH, keystoneQuad.tl.x, keystoneQuad.tl.y);
  assert.ok(Math.abs(uvTL.x - 0) < 1e-5);
  assert.ok(Math.abs(uvTL.y - 0) < 1e-5);

  const uvTR = inverseMap(invH, keystoneQuad.tr.x, keystoneQuad.tr.y);
  assert.ok(Math.abs(uvTR.x - 1) < 1e-5);
  assert.ok(Math.abs(uvTR.y - 0) < 1e-5);

  const uvBR = inverseMap(invH, keystoneQuad.br.x, keystoneQuad.br.y);
  assert.ok(Math.abs(uvBR.x - 1) < 1e-5);
  assert.ok(Math.abs(uvBR.y - 1) < 1e-5);

  const uvBL = inverseMap(invH, keystoneQuad.bl.x, keystoneQuad.bl.y);
  assert.ok(Math.abs(uvBL.x - 0) < 1e-5);
  assert.ok(Math.abs(uvBL.y - 1) < 1e-5);

  // Verify column-major conversion length
  const colMajor = matrix3ToColumnMajor(invH);
  assert.equal(colMajor.length, 9);
});
