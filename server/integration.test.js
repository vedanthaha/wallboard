import test from 'node:test';
import assert from 'node:assert/strict';
import { io as Client } from 'socket.io-client';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('Milestone 1 vertical slice: end-to-end state synchronization', async (t) => {
  const sessionFile = path.resolve(__dirname, '../.session-code');
  const sessionCode = fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile, 'utf8').trim() : '9V28Z2';

  const serverRunning = await new Promise((resolve) => {
    const req = http.get('http://localhost:3001/api/session', (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(500, () => {
      req.destroy();
      resolve(false);
    });
  });

  if (!serverRunning) {
    t.diagnostic('Dev server not running on port 3001, skipping live socket network test.');
    return;
  }

  // 1. Connect Projector Display Client
  const displaySocket = Client('http://localhost:3001', { transports: ['websocket'] });
  let remoteSocket = null;

  t.after(() => {
    displaySocket.disconnect();
    remoteSocket?.disconnect();
  });

  // Authenticate display
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Display connect timeout')), 4000);
    const doJoin = () => displaySocket.emit('join', { code: sessionCode, role: 'display' });
    if (displaySocket.connected) doJoin();
    else displaySocket.once('connect', doJoin);

    displaySocket.on('state:init', (state) => {
      clearTimeout(timer);
      assert.ok(Array.isArray(state.surfaces));
      assert.ok(state.sources);
      assert.ok(state.activeSurfaceId);
      resolve();
    });
    displaySocket.on('join:error', (err) => {
      clearTimeout(timer);
      reject(new Error(err));
    });
  });

  // Authenticate remote
  remoteSocket = Client('http://localhost:3001', { transports: ['websocket'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Remote connect timeout')), 4000);
    const doJoin = () => remoteSocket.emit('join', { code: sessionCode, role: 'remote' });
    if (remoteSocket.connected) doJoin();
    else remoteSocket.once('connect', doJoin);

    remoteSocket.on('state:init', (state) => {
      clearTimeout(timer);
      assert.ok(Array.isArray(state.surfaces));
      resolve();
    });
    remoteSocket.on('join:error', (err) => {
      clearTimeout(timer);
      reject(new Error(err));
    });
  });

  // 2. Corner Pinning: Remote drags corner of Surface 1
  const updatedCorners = {
    tl: { x: 0.2, y: 0.1 },
    tr: { x: 0.8, y: 0.15 },
    br: { x: 0.85, y: 0.85 },
    bl: { x: 0.15, y: 0.8 }
  };

  const cornerPromise = new Promise((resolve) => {
    displaySocket.on('surface:corners', (data) => {
      if (data.corners.tl.x === 0.2) {
        resolve(data);
      }
    });
  });

  remoteSocket.emit('surface:corners', {
    surfaceId: 'surface-1',
    corners: updatedCorners
  });

  const cornerResult = await cornerPromise;
  assert.equal(cornerResult.surfaceId, 'surface-1');
  assert.equal(cornerResult.corners.tl.x, 0.2);

  // 3. Drawing: Remote draws a stroke inside the warped surface
  const testStroke = {
    id: 'test-stroke-' + Date.now(),
    color: '#00f0ff',
    width: 0.01,
    surfaceId: 'surface-1',
    points: [
      { x: 0.5, y: 0.5, t: Date.now() },
      { x: 0.6, y: 0.6, t: Date.now() }
    ],
    createdAt: Date.now()
  };

  const strokePromise = new Promise((resolve) => {
    displaySocket.on('stroke:add', (stroke) => {
      if (stroke.id === testStroke.id) {
        resolve(stroke);
      }
    });
  });

  remoteSocket.emit('stroke:add', testStroke);
  const strokeResult = await strokePromise;
  assert.equal(strokeResult.id, testStroke.id);
  assert.equal(strokeResult.surfaceId, 'surface-1');
  assert.ok(strokeResult.t_network);

  // 4. Blackout Shutter: Remote toggles blackout
  const blackoutPromise = new Promise((resolve) => {
    displaySocket.on('blackout:update', (val) => {
      resolve(val);
    });
  });

  remoteSocket.emit('blackout:toggle');
  const blackoutVal = await blackoutPromise;
  assert.equal(typeof blackoutVal, 'boolean');
});
