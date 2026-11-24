import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import {
  drawStroke,
  generateStrokeId,
  Stroke,
  Quad,
  DEFAULT_QUAD,
  LIGHT_PALETTE,
  MappingShape,
  CubeShape,
  getCornerHandleUnderTouch,
  Point
} from '../shared/drawing';
import { Scene } from '../shared/protocol';
import '../style.css';

const params = new URLSearchParams(window.location.search);
const codeFromUrl = params.get('code') || '';

type RemoteTab = 'draw' | 'laser' | 'torch' | 'warp' | 'shapes' | 'scenes';

function Remote() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const torchPadRef = useRef<HTMLDivElement>(null);
  const warpPadRef = useRef<HTMLCanvasElement>(null);
  const orbitPadRef = useRef<HTMLDivElement>(null);

  const strokesRef = useRef<Stroke[]>([]);
  const activeRef = useRef<Stroke | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const [connected, setConnected] = useState(false);
  const [code, setCode] = useState(codeFromUrl);
  const [joined, setJoined] = useState(false);
  const [message, setMessage] = useState('Connecting to laptop…');

  // Mode and light controls
  const [tab, setTab] = useState<RemoteTab>('draw');
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState('#00f0ff');
  const [width, setWidth] = useState(0.008);
  const [laserDecay, setLaserDecay] = useState(2.5); // seconds

  // Torch / Spotlight state
  const [torchPos, setTorchPos] = useState({ x: 0.5, y: 0.5, active: false });
  const [torchRadius, setTorchRadius] = useState(0.12);
  const [torchColor, setTorchColor] = useState('#ffffff');

  // Projection Mapping / Keystone state
  const [quad, setQuad] = useState<Quad>({ ...DEFAULT_QUAD });
  const [activeCorner, setActiveCorner] = useState<'tl' | 'tr' | 'br' | 'bl'>('tl');
  const [draggingCornerMobile, setDraggingCornerMobile] = useState<'tl' | 'tr' | 'br' | 'bl' | null>(null);
  const [warpStep, setWarpStep] = useState(0.01);

  // Geometric 3D Shapes & Tracing (Phase 5)
  const [shapes, setShapes] = useState<MappingShape[]>([]);
  const [activeCube, setActiveCube] = useState<CubeShape | null>(null);

  // Scenes & Presets (Phase 6)
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [newSceneName, setNewSceneName] = useState('');

  // Optical toggles
  const [isBlackout, setIsBlackout] = useState(false);
  const [isCalibration, setIsCalibration] = useState(false);

  // Render Mobile Drawing Canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Pure clean optical canvas — NO distracting dots
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, rect.width, rect.height);

    for (const stroke of strokesRef.current) {
      drawStroke(ctx, stroke, rect.width, rect.height, true);
    }
  }, []);

  // Render Touch-Draggable Keystone Canvas on Mobile
  const renderWarpTouchPad = useCallback(() => {
    const canvas = warpPadRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#080a0f';
    ctx.fillRect(0, 0, rect.width, rect.height);

    const tl = { x: quad.tl.x * rect.width, y: quad.tl.y * rect.height };
    const tr = { x: quad.tr.x * rect.width, y: quad.tr.y * rect.height };
    const br = { x: quad.br.x * rect.width, y: quad.br.y * rect.height };
    const bl = { x: quad.bl.x * rect.width, y: quad.bl.y * rect.height };

    // Warped quad outline
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y);
    ctx.lineTo(tr.x, tr.y);
    ctx.lineTo(br.x, br.y);
    ctx.lineTo(bl.x, bl.y);
    ctx.closePath();
    ctx.stroke();

    // Cross diagonals
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y);
    ctx.lineTo(br.x, br.y);
    ctx.moveTo(tr.x, tr.y);
    ctx.lineTo(bl.x, bl.y);
    ctx.stroke();

    // Large finger-touch handles for each corner
    const drawTouchHandle = (pos: { x: number; y: number }, label: string, isCurrent: boolean) => {
      ctx.save();
      ctx.fillStyle = isCurrent ? '#ffffff' : '#00f0ff';
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = isCurrent ? 20 : 8;

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, isCurrent ? 18 : 14, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pos.x, pos.y);
      ctx.restore();
    };

    drawTouchHandle(tl, 'TL', activeCorner === 'tl' || draggingCornerMobile === 'tl');
    drawTouchHandle(tr, 'TR', activeCorner === 'tr' || draggingCornerMobile === 'tr');
    drawTouchHandle(br, 'BR', activeCorner === 'br' || draggingCornerMobile === 'br');
    drawTouchHandle(bl, 'BL', activeCorner === 'bl' || draggingCornerMobile === 'bl');
  }, [quad, activeCorner, draggingCornerMobile]);

  // Connect to server
  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      if (code.length === 6) {
        socket.emit('join', { code: code.toUpperCase(), role: 'remote' });
      }
    });

    socket.on('disconnect', () => {
      setConnected(false);
      setJoined(false);
    });

    socket.on('join:error', (text: string) => {
      setJoined(false);
      setMessage(text);
    });

    socket.on('board:init', (strokes: Stroke[]) => {
      strokesRef.current = Array.isArray(strokes) ? [...strokes] : [];
      setJoined(true);
      setMessage('Connected · Ready to project');
      renderCanvas();
    });

    socket.on('warp:update', (serverQuad: Quad) => {
      if (serverQuad) setQuad(serverQuad);
    });

    socket.on('shapes:update', (updatedShapes: MappingShape[]) => {
      if (Array.isArray(updatedShapes)) {
        setShapes(updatedShapes);
        const cube = updatedShapes.find((s) => s.type === 'cube') as CubeShape;
        if (cube) setActiveCube(cube);
      }
    });

    socket.on('scenes:update', (updatedScenes: Scene[]) => {
      if (Array.isArray(updatedScenes)) setScenes(updatedScenes);
    });

    socket.on('calibration:update', (active: boolean) => {
      setIsCalibration(Boolean(active));
    });

    socket.on('blackout:update', (active: boolean) => {
      setIsBlackout(Boolean(active));
    });

    socket.on('stroke:add', (stroke: Stroke) => {
      const index = strokesRef.current.findIndex((item) => item.id === stroke.id);
      if (index >= 0) strokesRef.current[index] = stroke;
      else strokesRef.current.push(stroke);
      renderCanvas();
    });

    socket.on('board:undo', (id: string) => {
      strokesRef.current = strokesRef.current.filter((s) => s.id !== id);
      renderCanvas();
    });

    socket.on('board:clear', () => {
      strokesRef.current = [];
      renderCanvas();
    });

    return () => {
      socket.disconnect();
    };
  }, [code, renderCanvas]);

  useEffect(() => {
    if (!joined) return;
    renderCanvas();
    const observer = new ResizeObserver(() => renderCanvas());
    if (canvasRef.current) observer.observe(canvasRef.current);
    window.addEventListener('resize', renderCanvas);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', renderCanvas);
    };
  }, [joined, renderCanvas]);

  useEffect(() => {
    if (tab === 'warp') {
      renderWarpTouchPad();
    }
  }, [tab, quad, activeCorner, draggingCornerMobile, renderWarpTouchPad]);

  const pointFrom = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    const clampedX = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const clampedY = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    return {
      x: Number.isFinite(clampedX) ? Math.round(clampedX * 10000) / 10000 : 0,
      y: Number.isFinite(clampedY) ? Math.round(clampedY * 10000) / 10000 : 0,
      t: Date.now()
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!joined) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}

    const point = pointFrom(event);
    const isEraser = tool === 'eraser' && tab === 'draw';
    const isLaser = tab === 'laser';

    const stroke: Stroke = {
      id: generateStrokeId(),
      color: isEraser ? '#000000' : color,
      width: isEraser ? 0.04 : width,
      points: [point],
      createdAt: Date.now(),
      decaySeconds: isLaser ? laserDecay : undefined
    };

    activeRef.current = stroke;
    strokesRef.current.push(stroke);
    renderCanvas();
    socketRef.current?.emit('stroke:add', stroke);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeRef.current) return;
    event.preventDefault();
    const point = pointFrom(event);
    activeRef.current.points.push(point);
    renderCanvas();

    if (activeRef.current.points.length % 2 === 0) {
      socketRef.current?.emit('stroke:add', activeRef.current);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeRef.current) return;
    try {
      if (event?.currentTarget && event?.pointerId) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {}
    socketRef.current?.emit('stroke:add', activeRef.current);
    activeRef.current = null;
    renderCanvas();
  };

  // Direct Touch-Dragging for Keystone Quad on Mobile
  const handleWarpTouchDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = warpPadRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const hit = getCornerHandleUnderTouch({ x, y }, quad, 0.14);
    if (hit) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
      setActiveCorner(hit);
      setDraggingCornerMobile(hit);
    }
  };

  const handleWarpTouchMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingCornerMobile) return;
    const canvas = warpPadRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));

    const nextQuad = { ...quad };
    nextQuad[draggingCornerMobile] = {
      x: Math.round(x * 1000) / 1000,
      y: Math.round(y * 1000) / 1000
    };
    setQuad(nextQuad);
    socketRef.current?.emit('warp:update', nextQuad);
  };

  const handleWarpTouchUp = () => {
    setDraggingCornerMobile(null);
  };

  // 4-Corner Nudge for micro keystone calibration
  const nudgeCorner = (dx: number, dy: number) => {
    const nextQuad = { ...quad };
    const pt = { ...nextQuad[activeCorner] };
    pt.x = Math.min(1, Math.max(0, Math.round((pt.x + dx) * 1000) / 1000));
    pt.y = Math.min(1, Math.max(0, Math.round((pt.y + dy) * 1000) / 1000));
    nextQuad[activeCorner] = pt;
    setQuad(nextQuad);
    socketRef.current?.emit('warp:update', nextQuad);
  };

  const resetQuad = () => {
    const fresh = { ...DEFAULT_QUAD };
    setQuad(fresh);
    socketRef.current?.emit('warp:update', fresh);
  };

  // 3D Cube Tracing Controls (Phase 5)
  const addOrUpdateCube = (updates: Partial<CubeShape>) => {
    const existing = activeCube || {
      id: 'cube_' + Date.now().toString(36),
      type: 'cube' as const,
      x: 0.5,
      y: 0.5,
      size: 0.22,
      rotX: 25,
      rotY: 35,
      rotZ: 0,
      color: '#00ffff',
      lineWidth: 3
    };
    const updated = { ...existing, ...updates };
    setActiveCube(updated);
    socketRef.current?.emit('shape:add', updated);
  };

  // 3D Orbit Trackpad: drag finger to rotate 3D cube
  const lastTouchRef = useRef<{ x: number; y: number } | null>(null);
  const handleOrbitPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    lastTouchRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleOrbitPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!lastTouchRef.current || !activeCube) return;
    const dx = e.clientX - lastTouchRef.current.x;
    const dy = e.clientY - lastTouchRef.current.y;
    lastTouchRef.current = { x: e.clientX, y: e.clientY };

    const nextRotY = (activeCube.rotY + dx * 0.8) % 360;
    const nextRotX = Math.max(-85, Math.min(85, activeCube.rotX - dy * 0.8));

    addOrUpdateCube({ rotX: Math.round(nextRotX), rotY: Math.round(nextRotY) });
  };

  const handleOrbitPointerUp = () => {
    lastTouchRef.current = null;
  };

  // Torch / Spotlight touch handling
  const handleTorchPointer = (event: React.PointerEvent<HTMLDivElement>, isEnd: boolean = false) => {
    event.preventDefault();
    const pad = torchPadRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    if (isEnd) {
      setTorchPos((prev) => ({ ...prev, active: false }));
      socketRef.current?.emit('spotlight:end');
      return;
    }

    try {
      if (event.type === 'pointerdown') event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}

    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));

    setTorchPos({ x, y, active: true });
    socketRef.current?.emit('spotlight:move', {
      x: Math.round(x * 1000) / 1000,
      y: Math.round(y * 1000) / 1000,
      radius: torchRadius,
      color: torchColor,
      active: true
    });
  };

  const toggleTab = (nextTab: RemoteTab) => {
    setTab(nextTab);
    if (nextTab === 'warp') {
      socketRef.current?.emit('calibration:set', true);
    }
  };

  return (
    <main className="remote-shell dark">
      {/* Top Console Bar */}
      <header className="remote-header">
        <div className="brand">
          <span className="brand-mark">W</span>
          <span className="brand-title">WALLBOARD</span>
        </div>
        <div className="remote-quick-actions">
          <button
            className={`btn-shutter ${isBlackout ? 'active' : ''}`}
            onClick={() => socketRef.current?.emit('blackout:toggle')}
            title="Projector Blackout Shutter"
          >
            {isBlackout ? '● BLACKOUT ON' : '○ SHUTTER'}
          </button>
          <button
            className={`btn-grid ${isCalibration ? 'active' : ''}`}
            onClick={() => socketRef.current?.emit('calibration:toggle')}
            title="Toggle Calibration Grid"
          >
            ⛶ GRID
          </button>
          <span className="remote-status">
            <i className={joined ? 'online' : ''} />
            {joined ? code : 'OFFLINE'}
          </span>
        </div>
      </header>

      {/* Pairing View if not joined */}
      {!joined && (
        <section className="join-panel">
          <span className="eyebrow">PROJECTOR REMOTE CONTROLLER</span>
          <h1>Manipulate light on your wall.</h1>
          <p>{message}</p>
          <label>
            ENTER 6-DIGIT SESSION CODE
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="9V28Z2"
              maxLength={6}
            />
          </label>
          <button
            className="primary"
            disabled={code.length !== 6 || !connected}
            onClick={() => socketRef.current?.emit('join', { code: code.toUpperCase(), role: 'remote' })}
          >
            CONNECT TO PROJECTOR
          </button>
        </section>
      )}

      {/* Main Lighting Console */}
      {joined && (
        <section className="console-panel">
          {/* Navigation Tabs (Drawing, Laser, Torch, Keystone, 3D Cubes, Scenes) */}
          <nav className="mode-tabs">
            <button
              className={`mode-tab ${tab === 'draw' ? 'active' : ''}`}
              onClick={() => toggleTab('draw')}
            >
              <span className="tab-icon">🎨</span>
              <span className="tab-label">DRAW</span>
            </button>
            <button
              className={`mode-tab ${tab === 'laser' ? 'active' : ''}`}
              onClick={() => toggleTab('laser')}
            >
              <span className="tab-icon">⚡</span>
              <span className="tab-label">LASER</span>
            </button>
            <button
              className={`mode-tab ${tab === 'torch' ? 'active' : ''}`}
              onClick={() => toggleTab('torch')}
            >
              <span className="tab-icon">🔦</span>
              <span className="tab-label">TORCH</span>
            </button>
            <button
              className={`mode-tab ${tab === 'warp' ? 'active' : ''}`}
              onClick={() => toggleTab('warp')}
            >
              <span className="tab-icon">📐</span>
              <span className="tab-label">WARP</span>
            </button>
            <button
              className={`mode-tab ${tab === 'shapes' ? 'active' : ''}`}
              onClick={() => toggleTab('shapes')}
            >
              <span className="tab-icon">📦</span>
              <span className="tab-label">3D CUBE</span>
            </button>
            <button
              className={`mode-tab ${tab === 'scenes' ? 'active' : ''}`}
              onClick={() => toggleTab('scenes')}
            >
              <span className="tab-icon">💾</span>
              <span className="tab-label">SCENES</span>
            </button>
          </nav>

          {/* TAB 1: DRAW & TAB 2: LASER (Maximized Immersive Canvas) */}
          {(tab === 'draw' || tab === 'laser') && (
            <div className="drawing-mode-container">
              {/* Secondary Tools Header */}
              <div className="tool-row">
                {tab === 'draw' && (
                  <>
                    <button
                      className={`btn-pill ${tool === 'pen' ? 'selected' : ''}`}
                      onClick={() => setTool('pen')}
                    >
                      Light Pen
                    </button>
                    <button
                      className={`btn-pill ${tool === 'eraser' ? 'selected' : ''}`}
                      onClick={() => setTool('eraser')}
                    >
                      Cutout (Eraser)
                    </button>
                  </>
                )}

                {tab === 'laser' && (
                  <div className="decay-selector">
                    <span className="decay-label">DECAY:</span>
                    {[1.0, 2.5, 5.0].map((sec) => (
                      <button
                        key={sec}
                        className={`btn-pill ${laserDecay === sec ? 'selected' : ''}`}
                        onClick={() => setLaserDecay(sec)}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>
                )}

                <span className="tool-spacer" />
                <button
                  className="btn-pill"
                  onClick={() => socketRef.current?.emit('stroke:undo')}
                >
                  Undo
                </button>
                <button
                  className="btn-pill btn-danger"
                  onClick={() => socketRef.current?.emit('board:clear')}
                >
                  Clear
                </button>
              </div>

              {/* Light Color Swatches */}
              <div className="swatches">
                {LIGHT_PALETTE.map((c) => (
                  <button
                    key={c}
                    aria-label={`Light color ${c}`}
                    className={`swatch-btn ${color === c && tool === 'pen' ? 'chosen' : ''}`}
                    style={{ background: c, boxShadow: color === c ? `0 0 14px ${c}` : undefined }}
                    onClick={() => {
                      setColor(c);
                      setTool('pen');
                    }}
                  />
                ))}
              </div>

              {/* Maximized Full-Height Mobile Canvas (Clean Optical Black) */}
              <div className="phone-canvas-wrap immersive">
                <canvas
                  ref={canvasRef}
                  className="phone-canvas"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                />
              </div>

              {/* Compact Beam Width Slider */}
              <div className="brush-row">
                <span>BEAM WIDTH</span>
                <input
                  type="range"
                  min="0.003"
                  max="0.035"
                  step="0.001"
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                />
                <span className="value-label">{Math.round(width * 1000)}</span>
              </div>
            </div>
          )}

          {/* TAB 3: TORCH / SPOTLIGHT BEAM */}
          {tab === 'torch' && (
            <div className="torch-container">
              <div className="torch-instructions">
                Touch & drag below to cast a moving light beam on the wall.
              </div>

              {/* Virtual Spotlight Trackpad */}
              <div
                ref={torchPadRef}
                className="torch-pad"
                onPointerDown={(e) => handleTorchPointer(e)}
                onPointerMove={(e) => handleTorchPointer(e)}
                onPointerUp={(e) => handleTorchPointer(e, true)}
                onPointerCancel={(e) => handleTorchPointer(e, true)}
              >
                {torchPos.active && (
                  <div
                    className="torch-reticle"
                    style={{
                      left: `${torchPos.x * 100}%`,
                      top: `${torchPos.y * 100}%`,
                      borderColor: torchColor,
                      boxShadow: `0 0 26px ${torchColor}`
                    }}
                  />
                )}
                {!torchPos.active && <div className="torch-pad-idle">Drag your finger here</div>}
              </div>

              {/* Torch Settings */}
              <div className="torch-controls">
                <div className="torch-slider-row">
                  <span>BEAM RADIUS</span>
                  <input
                    type="range"
                    min="0.04"
                    max="0.35"
                    step="0.01"
                    value={torchRadius}
                    onChange={(e) => setTorchRadius(Number(e.target.value))}
                  />
                </div>

                <div className="swatches torch-swatches">
                  {['#ffffff', '#ffaa00', '#00f0ff', '#ff007f', '#39ff14'].map((c) => (
                    <button
                      key={c}
                      className={`swatch-btn ${torchColor === c ? 'chosen' : ''}`}
                      style={{ background: c, boxShadow: torchColor === c ? `0 0 12px ${c}` : undefined }}
                      onClick={() => setTorchColor(c)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: WARP — DIRECT TOUCH-DRAGGABLE KEYSTONE */}
          {tab === 'warp' && (
            <div className="warp-container">
              <div className="warp-banner">
                Touch and drag any corner directly on the screen to align to your wall.
              </div>

              {/* Interactive Mobile Touchpad: Touch & Drag Corners Directly */}
              <div className="warp-touchpad-container">
                <canvas
                  ref={warpPadRef}
                  className="warp-touchpad"
                  onPointerDown={handleWarpTouchDown}
                  onPointerMove={handleWarpTouchMove}
                  onPointerUp={handleWarpTouchUp}
                  onPointerCancel={handleWarpTouchUp}
                />
              </div>

              {/* Corner Selector Buttons */}
              <div className="corner-selector-grid">
                <button
                  className={`corner-btn ${activeCorner === 'tl' ? 'active' : ''}`}
                  onClick={() => setActiveCorner('tl')}
                >
                  <span className="corner-tag">1 · TOP-LEFT</span>
                  <span className="corner-coords">
                    {quad.tl.x.toFixed(2)}, {quad.tl.y.toFixed(2)}
                  </span>
                </button>
                <button
                  className={`corner-btn ${activeCorner === 'tr' ? 'active' : ''}`}
                  onClick={() => setActiveCorner('tr')}
                >
                  <span className="corner-tag">2 · TOP-RIGHT</span>
                  <span className="corner-coords">
                    {quad.tr.x.toFixed(2)}, {quad.tr.y.toFixed(2)}
                  </span>
                </button>
                <button
                  className={`corner-btn ${activeCorner === 'bl' ? 'active' : ''}`}
                  onClick={() => setActiveCorner('bl')}
                >
                  <span className="corner-tag">4 · BOT-LEFT</span>
                  <span className="corner-coords">
                    {quad.bl.x.toFixed(2)}, {quad.bl.y.toFixed(2)}
                  </span>
                </button>
                <button
                  className={`corner-btn ${activeCorner === 'br' ? 'active' : ''}`}
                  onClick={() => setActiveCorner('br')}
                >
                  <span className="corner-tag">3 · BOT-RIGHT</span>
                  <span className="corner-coords">
                    {quad.br.x.toFixed(2)}, {quad.br.y.toFixed(2)}
                  </span>
                </button>
              </div>

              {/* Tactile D-Pad for Micro-Nudges */}
              <div className="dpad-box">
                <button className="dpad-btn up" onClick={() => nudgeCorner(0, -warpStep)}>
                  ▲
                </button>
                <div className="dpad-mid-row">
                  <button className="dpad-btn left" onClick={() => nudgeCorner(-warpStep, 0)}>
                    ◀
                  </button>
                  <div className="dpad-center-label">
                    <span className="active-corner-label">{activeCorner.toUpperCase()}</span>
                  </div>
                  <button className="dpad-btn right" onClick={() => nudgeCorner(warpStep, 0)}>
                    ▶
                  </button>
                </div>
                <button className="dpad-btn down" onClick={() => nudgeCorner(0, warpStep)}>
                  ▼
                </button>
              </div>

              {/* Step Size & Reset */}
              <div className="warp-options-row">
                <div className="step-toggle">
                  <span className="step-label">NUDGE:</span>
                  <button
                    className={`btn-pill ${warpStep === 0.005 ? 'selected' : ''}`}
                    onClick={() => setWarpStep(0.005)}
                  >
                    Fine
                  </button>
                  <button
                    className={`btn-pill ${warpStep === 0.02 ? 'selected' : ''}`}
                    onClick={() => setWarpStep(0.02)}
                  >
                    Coarse
                  </button>
                </div>
                <button className="btn-pill btn-danger" onClick={resetQuad}>
                  Reset Quad
                </button>
              </div>
            </div>
          )}

          {/* TAB 5: 3D CUBES & TRACING SHAPES (Phase 5) */}
          {tab === 'shapes' && (
            <div className="shapes-container">
              <div className="warp-banner">
                Project 3D wireframe cubes and shapes to map physical boxes and objects.
              </div>

              <div className="shape-actions-row">
                <button
                  className="btn-pill selected"
                  onClick={() => addOrUpdateCube({})}
                >
                  + Add 3D Cube
                </button>
                <button
                  className="btn-pill"
                  onClick={() => {
                    const mask: MappingShape = {
                      id: 'mask_' + Date.now().toString(36),
                      type: 'mask',
                      points: [
                        { x: 0.35, y: 0.35 },
                        { x: 0.65, y: 0.35 },
                        { x: 0.65, y: 0.65 },
                        { x: 0.35, y: 0.65 }
                      ]
                    };
                    socketRef.current?.emit('shape:add', mask);
                  }}
                >
                  + Blackout Cutout Mask
                </button>
                <button
                  className="btn-pill btn-danger"
                  onClick={() => socketRef.current?.emit('shapes:clear')}
                >
                  Clear Shapes
                </button>
              </div>

              {/* 3D Orbit Trackpad: Drag finger to rotate cube in 3D space */}
              {activeCube && (
                <div className="cube-editor-box">
                  <span className="editor-title">3D CUBE ORBIT & ROTATION</span>
                  <div
                    ref={orbitPadRef}
                    className="orbit-trackpad"
                    onPointerDown={handleOrbitPointerDown}
                    onPointerMove={handleOrbitPointerMove}
                    onPointerUp={handleOrbitPointerUp}
                    onPointerCancel={handleOrbitPointerUp}
                  >
                    <div className="orbit-hint">
                      Touch & drag here to rotate 3D cube onto your physical box
                    </div>
                    <div className="orbit-readout">
                      RotX: {activeCube.rotX}° · RotY: {activeCube.rotY}°
                    </div>
                  </div>

                  <div className="cube-controls-grid">
                    <div className="control-item">
                      <span>CUBE SIZE</span>
                      <input
                        type="range"
                        min="0.08"
                        max="0.45"
                        step="0.01"
                        value={activeCube.size}
                        onChange={(e) => addOrUpdateCube({ size: Number(e.target.value) })}
                      />
                    </div>
                    <div className="control-item">
                      <span>POS X</span>
                      <input
                        type="range"
                        min="0.1"
                        max="0.9"
                        step="0.01"
                        value={activeCube.x}
                        onChange={(e) => addOrUpdateCube({ x: Number(e.target.value) })}
                      />
                    </div>
                    <div className="control-item">
                      <span>POS Y</span>
                      <input
                        type="range"
                        min="0.1"
                        max="0.9"
                        step="0.01"
                        value={activeCube.y}
                        onChange={(e) => addOrUpdateCube({ y: Number(e.target.value) })}
                      />
                    </div>
                  </div>

                  <div className="swatches">
                    {LIGHT_PALETTE.map((c) => (
                      <button
                        key={c}
                        className={`swatch-btn ${activeCube.color === c ? 'chosen' : ''}`}
                        style={{ background: c, boxShadow: activeCube.color === c ? `0 0 12px ${c}` : undefined }}
                        onClick={() => addOrUpdateCube({ color: c })}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 6: SCENE PRESETS & PERSISTENCE (Phase 6) */}
          {tab === 'scenes' && (
            <div className="scenes-container">
              <div className="warp-banner">
                Save and recall your projection setups, wall mappings, and light shows.
              </div>

              {/* Save Current Scene */}
              <div className="save-scene-box">
                <input
                  type="text"
                  placeholder="Scene name (e.g. Living Room Box Setup)"
                  value={newSceneName}
                  onChange={(e) => setNewSceneName(e.target.value)}
                  className="scene-input"
                />
                <button
                  className="btn-pill selected"
                  disabled={!newSceneName.trim()}
                  onClick={() => {
                    socketRef.current?.emit('scene:save', { name: newSceneName.trim() });
                    setNewSceneName('');
                  }}
                >
                  Save Scene
                </button>
              </div>

              {/* Scenes List */}
              <div className="scenes-list">
                {scenes.map((sc) => (
                  <div key={sc.id} className="scene-card">
                    <div className="scene-info">
                      <span className="scene-name">{sc.name}</span>
                      <span className="scene-meta">
                        {sc.shapes?.length || 0} shapes · {sc.strokes?.length || 0} strokes
                      </span>
                    </div>
                    <button
                      className="btn-pill selected"
                      onClick={() => socketRef.current?.emit('scene:load', sc.id)}
                    >
                      Load
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Remote />);
