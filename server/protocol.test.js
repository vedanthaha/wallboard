import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidPoint, isValidStroke } from './protocol.js';

test('accepts normalized points', () => {
  assert.equal(isValidPoint({ x: 0, y: 1 }), true);
  assert.equal(isValidPoint({ x: -0.1, y: 0.5 }), false);
  assert.equal(isValidPoint({ x: 0.5, y: Infinity }), false);
});

test('accepts a valid stroke', () => {
  assert.equal(isValidStroke({ id: 'stroke-1', color: '#20242b', width: 0.006, points: [{ x: 0.1, y: 0.2 }] }), true);
});

test('rejects malformed strokes', () => {
  assert.equal(isValidStroke({ id: 'x', color: 'red', width: 1, points: [{ x: 0, y: 0 }] }), false);
  assert.equal(isValidStroke({ id: 'x', color: '#ffffff', width: 0.01, points: [{ x: 4, y: 4 }] }), false);
});
