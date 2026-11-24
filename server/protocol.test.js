import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidPoint,
  isValidStroke,
  isValidQuad,
  isValidSpotlight,
  isValidShape,
  isValidSurface,
  isValidMediaSource,
  isValidCornerPins
} from './protocol.js';

test('accepts normalized points', () => {
  assert.equal(isValidPoint({ x: 0, y: 1 }), true);
  assert.equal(isValidPoint({ x: 0.5, y: 0.5, t: 12345 }), true);
  assert.equal(isValidPoint({ x: -0.1, y: 0.5 }), false);
  assert.equal(isValidPoint({ x: 0.5, y: Infinity }), false);
});

test('accepts a valid stroke with optional decay and surfaceId', () => {
  assert.equal(
    isValidStroke({ id: 'stroke-1', color: '#20242b', width: 0.006, points: [{ x: 0.1, y: 0.2 }] }),
    true
  );
  assert.equal(
    isValidStroke({
      id: 'laser-1',
      color: '#00ffff',
      width: 0.01,
      surfaceId: 'surface-1',
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

test('validates projection mapping quad / corner pins', () => {
  const validQuad = {
    tl: { x: 0, y: 0 },
    tr: { x: 1, y: 0 },
    br: { x: 1, y: 1 },
    bl: { x: 0, y: 1 }
  };
  assert.equal(isValidQuad(validQuad), true);
  assert.equal(isValidCornerPins(validQuad), true);
  assert.equal(isValidQuad({ ...validQuad, tl: { x: -0.2, y: 0 } }), false);
});

test('validates media sources (solid, gradient_linear)', () => {
  assert.equal(
    isValidMediaSource({
      id: 'src-solid',
      name: 'Solid Cyan',
      data: { type: 'solid', config: { color: '#00f0ff' } }
    }),
    true
  );
  assert.equal(
    isValidMediaSource({
      id: 'src-grad',
      name: 'Cyber Gradient',
      data: {
        type: 'gradient_linear',
        config: {
          angle: 45,
          stops: [
            { offset: 0, color: '#00f0ff' },
            { offset: 1, color: '#ff007f' }
          ]
        }
      }
    }),
    true
  );
  assert.equal(
    isValidMediaSource({
      id: 'src-bad',
      name: 'Bad',
      data: { type: 'unknown', config: {} }
    }),
    false
  );
});

test('validates decoupled surface entity', () => {
  const validSurface = {
    id: 'surf-1',
    name: 'Main Wall',
    sourceId: 'src-grad',
    geometry: {
      id: 'geom-1',
      name: 'Quad 1',
      type: 'quad',
      zIndex: 0,
      visible: true,
      locked: false,
      corners: {
        tl: { x: 0.1, y: 0.1 },
        tr: { x: 0.9, y: 0.1 },
        br: { x: 0.9, y: 0.9 },
        bl: { x: 0.1, y: 0.9 }
      }
    },
    blendMode: 'screen',
    opacity: 1,
    effects: [],
    animations: []
  };

  assert.equal(isValidSurface(validSurface), true);
  assert.equal(isValidSurface({ ...validSurface, sourceId: undefined }), false);
});
