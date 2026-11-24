import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidPoint, isValidStroke, isValidQuad, isValidSpotlight } from './protocol.js';

test('accepts normalized points', () => {
  assert.equal(isValidPoint({ x: 0, y: 1 }), true);
  assert.equal(isValidPoint({ x: 0.5, y: 0.5, t: 12345 }), true);
  assert.equal(isValidPoint({ x: -0.1, y: 0.5 }), false);
  assert.equal(isValidPoint({ x: 0.5, y: Infinity }), false);
});

test('accepts a valid stroke with optional decay', () => {
  assert.equal(
    isValidStroke({ id: 'stroke-1', color: '#20242b', width: 0.006, points: [{ x: 0.1, y: 0.2 }] }),
    true
  );
  assert.equal(
    isValidStroke({
      id: 'laser-1',
      color: '#00ffff',
      width: 0.01,
      points: [{ x: 0.1, y: 0.2, t: 100 }],
      decaySeconds: 2.5
    }),
    true
  );
});

test('rejects malformed strokes', () => {
  assert.equal(isValidStroke({ id: 'x', color: 'red', width: 1, points: [{ x: 0, y: 0 }] }), false);
  assert.equal(isValidStroke({ id: 'x', color: '#ffffff', width: 0.01, points: [{ x: 4, y: 4 }] }), false);
});

test('validates projection mapping quad', () => {
  const validQuad = {
    tl: { x: 0, y: 0 },
    tr: { x: 1, y: 0 },
    br: { x: 1, y: 1 },
    bl: { x: 0, y: 1 }
  };
  assert.equal(isValidQuad(validQuad), true);
  assert.equal(isValidQuad({ ...validQuad, tl: { x: -0.2, y: 0 } }), false);
});

test('validates spotlight beam descriptor', () => {
  assert.equal(isValidSpotlight({ x: 0.5, y: 0.5, radius: 0.1, color: '#ffffff', active: true }), true);
  assert.equal(isValidSpotlight(null), true);
  assert.equal(isValidSpotlight({ x: 2, y: 0.5, radius: 0.1, color: '#ffffff', active: true }), false);
});
