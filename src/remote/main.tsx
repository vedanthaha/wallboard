import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import {
  drawStroke,
  generateStrokeId,
  Stroke,
  Quad,
  DEFAULT_QUAD,
  LIGHT_PALETTE
} from '../shared/drawing';
import '../style.css';

const params = new URLSearchParams(window.location.search);
const codeFromUrl = params.get('code') || '';

type RemoteTab = 'draw' | 'laser' | 'torch' | 'warp';

function Remote() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const torchPadRef = useRef<HTMLDivElement>(null);
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
  const [warpStep, setWarpStep] = useState(0.01);

  // Optical toggles
  const [isBlackout, setIsBlackout] = useState(false);
  const [isCalibration, setIsCalibration] = useState(false);

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
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, rect.width, rect.height);

    for (const stroke of strokesRef.current) {
      drawStroke(ctx, stroke, rect.width, rect.height, true);
    }
  }, []);

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

  // 4-Corner Nudge for keystone calibration
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

  const toggleTab = (nextTab: RemoteTab) => {
    setTab(nextTab);
    if (nextTab === 'warp') {
      // Auto-enable calibration pattern when entering warp tab
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
          {/* Main Mode Tabs */}
          <nav className="mode-tabs">
            <button
              className={`mode-tab ${tab === 'draw' ? 'active' : ''}`}
              onClick={() => toggleTab('draw')}
            >
              <span className="tab-icon">🎨</span>
              <span className="tab-label">BEAM PEN</span>
            </button>
            <button
              className={`mode-tab ${tab === 'laser' ? 'active' : ''}`}
              onClick={() => toggleTab('laser')}
            >
              <span className="tab-icon">⚡</span>
              <span className="tab-label">LASER TRAIL</span>
            </button>
            <button
              className={`mode-tab ${tab === 'torch' ? 'active' : ''}`}
              onClick={() => toggleTab('torch')}
            >
              <span className="tab-icon">🔦</span>
              <span className="tab-label">TORCH BEAM</span>
            </button>
            <button
              className={`mode-tab ${tab === 'warp' ? 'active' : ''}`}
              onClick={() => toggleTab('warp')}
            >
              <span className="tab-icon">📐</span>
              <span className="tab-label">CALIBRATE</span>
            </button>
          </nav>

          {/* TAB 1: DRAW (Persistent Neon Light) & TAB 2: LASER (Decay) */}
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
                      Light Beam
                    </button>
                    <button
                      className={`btn-pill ${tool === 'eraser' ? 'selected' : ''}`}
                      onClick={() => setTool('eraser')}
                    >
                      Optical Cutout (Eraser)
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

              {/* Responsive Phone Touch Canvas */}
              <div className="phone-canvas-wrap">
                <canvas
                  ref={canvasRef}
                  className="phone-canvas"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                />
              </div>

              {/* Beam Width Slider */}
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
                Drag your thumb below to cast a moving light beam on the wall.
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
                <div className="torch-pad-grid" />
                {torchPos.active && (
                  <div
                    className="torch-reticle"
                    style={{
                      left: `${torchPos.x * 100}%`,
                      top: `${torchPos.y * 100}%`,
                      borderColor: torchColor,
                      boxShadow: `0 0 24px ${torchColor}`
                    }}
                  />
                )}
                {!torchPos.active && <div className="torch-pad-idle">Touch and drag here</div>}
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

          {/* TAB 4: CALIBRATE / 4-CORNER KEYSTONE WARPER */}
          {tab === 'warp' && (
            <div className="warp-container">
              <div className="warp-banner">
                Select a corner and tap arrows to align projection to your wall.
              </div>

              {/* Visual Corner Selector */}
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

              {/* Tactile D-Pad Nudge Controls */}
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
                  <span className="step-label">STEP:</span>
                  <button
                    className={`btn-pill ${warpStep === 0.005 ? 'selected' : ''}`}
                    onClick={() => setWarpStep(0.005)}
                  >
                    Fine (0.005)
                  </button>
                  <button
                    className={`btn-pill ${warpStep === 0.02 ? 'selected' : ''}`}
                    onClick={() => setWarpStep(0.02)}
                  >
                    Coarse (0.02)
                  </button>
                </div>
                <button className="btn-pill btn-danger" onClick={resetQuad}>
                  Reset Quad
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Remote />);
