import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import {
  generateStrokeId,
  drawStroke,
  getCornerHandleUnderTouch,
  LIGHT_PALETTE
} from '../shared/drawing';
import {
  Surface,
  MediaSource,
  DrawingStroke,
  CornerPins,
  LinearGradientConfig
} from '../shared/protocol';
import '../style.css';

const params = new URLSearchParams(window.location.search);
const codeFromUrl = params.get('code') || '';

type RemoteTab = 'draw' | 'warp' | 'media';

function Remote() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const warpPadRef = useRef<HTMLCanvasElement>(null);

  const strokesRef = useRef<DrawingStroke[]>([]);
  const activeStrokeRef = useRef<DrawingStroke | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const [connected, setConnected] = useState(false);
  const [code, setCode] = useState(codeFromUrl);
  const [joined, setJoined] = useState(false);
  const [message, setMessage] = useState('Connecting to laptop…');

  // Authoritative state
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [sources, setSources] = useState<Record<string, MediaSource>>({});
  const [activeSurfaceId, setActiveSurfaceId] = useState<string>('surface-1');
  const [isBlackout, setIsBlackout] = useState(false);
  const [isCalibration, setIsCalibration] = useState(false);

  // Drawing controls
  const [tab, setTab] = useState<RemoteTab>('draw');
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState('#00f0ff');
  const [width, setWidth] = useState(0.01);
  const [laserDecay, setLaserDecay] = useState(0); // 0 = persistent

  // Corner pin / keystone touch state
  const [activeCorner, setActiveCorner] = useState<'tl' | 'tr' | 'br' | 'bl'>('tl');
  const [draggingCornerMobile, setDraggingCornerMobile] = useState<'tl' | 'tr' | 'br' | 'bl' | null>(null);
  const [warpStep, setWarpStep] = useState(0.01);

  const activeSurface = surfaces.find((s) => s.id === activeSurfaceId) || surfaces[0];
  const activeSource = activeSurface ? sources[activeSurface.sourceId] : undefined;

  // Render Mobile Surface Drawing Canvas
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

    // Render surface background preview
    if (activeSource && activeSource.data.type === 'gradient_linear') {
      const grad = ctx.createLinearGradient(0, 0, rect.width, rect.height);
      for (const stop of activeSource.data.config.stops) {
        grad.addColorStop(stop.offset, stop.color);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, rect.width, rect.height);
      // Subtle darkening overlay so drawing stands out clearly
      ctx.fillStyle = 'rgba(5, 7, 10, 0.4)';
      ctx.fillRect(0, 0, rect.width, rect.height);
    } else {
      ctx.fillStyle = '#05070a';
      ctx.fillRect(0, 0, rect.width, rect.height);
    }

    // Render strokes for active surface
    const now = Date.now();
    for (const stroke of strokesRef.current) {
      if (stroke.surfaceId && stroke.surfaceId !== activeSurfaceId) continue;

      let alpha = 1;
      if (stroke.decaySeconds && stroke.decaySeconds > 0) {
        const created = stroke.createdAt || now;
        const ageMs = now - created;
        const totalMs = stroke.decaySeconds * 1000;
        if (ageMs >= totalMs) continue;
        alpha = Math.max(0, 1 - ageMs / totalMs);
      }

      drawStroke(ctx, stroke as any, rect.width, rect.height, true, undefined, alpha);
    }

    // Active live stroke
    if (activeStrokeRef.current) {
      drawStroke(ctx, activeStrokeRef.current as any, rect.width, rect.height, true);
    }
  }, [activeSurfaceId, activeSource]);

  // Render Mobile Keystone Touch Pad
  const renderWarpTouchPad = useCallback(() => {
    const canvas = warpPadRef.current;
    if (!canvas || !activeSurface) return;
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

    const corners = activeSurface.geometry.corners;
    const tl = { x: corners.tl.x * rect.width, y: corners.tl.y * rect.height };
    const tr = { x: corners.tr.x * rect.width, y: corners.tr.y * rect.height };
    const br = { x: corners.br.x * rect.width, y: corners.br.y * rect.height };
    const bl = { x: corners.bl.x * rect.width, y: corners.bl.y * rect.height };

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
    const handleRadius = 24;
    const handles = [
      { key: 'tl', pos: tl, label: 'TL' },
      { key: 'tr', pos: tr, label: 'TR' },
      { key: 'br', pos: br, label: 'BR' },
      { key: 'bl', pos: bl, label: 'BL' }
    ] as const;

    for (const h of handles) {
      const isSelected = activeCorner === h.key;
      const isDragging = draggingCornerMobile === h.key;

      ctx.beginPath();
      ctx.arc(h.pos.x, h.pos.y, handleRadius, 0, Math.PI * 2);
      ctx.fillStyle = isDragging ? '#ffffff' : isSelected ? '#00f0ff' : '#141824';
      ctx.fill();

      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.strokeStyle = isSelected ? '#ffffff' : '#00f0ff';
      ctx.stroke();

      ctx.fillStyle = isDragging || isSelected ? '#000000' : '#00f0ff';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(h.label, h.pos.x, h.pos.y);
    }
  }, [activeSurface, activeCorner, draggingCornerMobile]);

  // Animation frame loop
  useEffect(() => {
    let animId: number;
    const loop = () => {
      animId = requestAnimationFrame(loop);
      if (tab === 'draw') renderCanvas();
      else if (tab === 'warp') renderWarpTouchPad();
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [tab, renderCanvas, renderWarpTouchPad]);

  // Connect to server
  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setMessage('Connected. Authenticating…');
      if (code) {
        socket.emit('join', { code: code.toUpperCase(), role: 'remote' });
      }
    });

    socket.on('disconnect', () => {
      setConnected(false);
      setJoined(false);
      setMessage('Disconnected from laptop.');
    });

    socket.on('join:error', (err: string) => {
      setJoined(false);
      setMessage(err || 'Failed to authenticate.');
    });

    socket.on('state:init', (st) => {
      setJoined(true);
      setMessage('Paired with Wallboard Studio');
      if (Array.isArray(st.surfaces)) setSurfaces(st.surfaces);
      if (st.sources) setSources(st.sources);
      if (st.activeSurfaceId) setActiveSurfaceId(st.activeSurfaceId);
      if (Array.isArray(st.strokes)) strokesRef.current = st.strokes;
      if (st.masterBlackout !== undefined) setIsBlackout(st.masterBlackout);
      if (st.calibrationActive !== undefined) setIsCalibration(st.calibrationActive);
    });

    socket.on('surfaces:sync', (data) => {
      if (Array.isArray(data.surfaces)) setSurfaces(data.surfaces);
      if (data.activeSurfaceId) setActiveSurfaceId(data.activeSurfaceId);
    });

    socket.on('surface:update', (updated: Surface) => {
      setSurfaces((prev) => {
        const idx = prev.findIndex((s) => s.id === updated.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = updated;
          return next;
        }
        return [...prev, updated];
      });
    });

    socket.on('surface:corners', ({ surfaceId, corners }: { surfaceId: string; corners: CornerPins }) => {
      setSurfaces((prev) =>
        prev.map((s) => (s.id === surfaceId ? { ...s, geometry: { ...s.geometry, corners } } : s))
      );
    });

    socket.on('source:update', (source: MediaSource) => {
      setSources((prev) => ({ ...prev, [source.id]: source }));
    });

    socket.on('source:sync', (allSources: Record<string, MediaSource>) => {
      setSources(allSources);
    });

    socket.on('stroke:add', (stroke: DrawingStroke) => {
      const idx = strokesRef.current.findIndex((s) => s.id === stroke.id);
      if (idx >= 0) strokesRef.current[idx] = stroke;
      else strokesRef.current.push(stroke);
    });

    socket.on('board:undo', (id: string) => {
      const idx = strokesRef.current.findIndex((s) => s.id === id);
      if (idx >= 0) strokesRef.current.splice(idx, 1);
    });

    socket.on('board:clear', () => {
      strokesRef.current.length = 0;
    });

    socket.on('blackout:update', (val: boolean) => setIsBlackout(val));
    socket.on('calibration:update', (val: boolean) => setIsCalibration(val));

    // Backward compatibility
    socket.on('board:init', (stk: DrawingStroke[]) => {
      if (Array.isArray(stk)) {
        strokesRef.current = stk;
        setJoined(true);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [code]);

  // Touch drawing handlers
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (tab !== 'draw' || !activeSurface) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const x = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (touch.clientY - rect.top) / rect.height));

    const stroke: DrawingStroke = {
      id: generateStrokeId(),
      color: tool === 'eraser' ? '#000000' : color,
      width: tool === 'eraser' ? width * 3 : width,
      points: [{ x, y, t: Date.now() }],
      createdAt: Date.now(),
      surfaceId: activeSurface.id,
      decaySeconds: laserDecay > 0 ? laserDecay : undefined
    };

    activeStrokeRef.current = stroke;
    strokesRef.current.push(stroke);
    socketRef.current?.emit('stroke:add', stroke);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!activeStrokeRef.current || tab !== 'draw') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const x = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (touch.clientY - rect.top) / rect.height));

    activeStrokeRef.current.points.push({ x, y, t: Date.now() });
    socketRef.current?.emit('stroke:add', activeStrokeRef.current);
  };

  const handleTouchEnd = () => {
    activeStrokeRef.current = null;
  };

  // Keystone / Warp touch handlers
  const handleWarpTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = warpPadRef.current;
    if (!canvas || !activeSurface) return;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const touchX = (touch.clientX - rect.left) / rect.width;
    const touchY = (touch.clientY - rect.top) / rect.height;

    const corner = getCornerHandleUnderTouch({ x: touchX, y: touchY }, activeSurface.geometry.corners, 0.12);
    if (corner) {
      setActiveCorner(corner);
      setDraggingCornerMobile(corner);
    }
  };

  const handleWarpTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!draggingCornerMobile || !activeSurface) return;
    const canvas = warpPadRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const x = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (touch.clientY - rect.top) / rect.height));

    const updatedCorners: CornerPins = {
      ...activeSurface.geometry.corners,
      [draggingCornerMobile]: { x, y }
    };

    setSurfaces((prev) =>
      prev.map((s) => (s.id === activeSurface.id ? { ...s, geometry: { ...s.geometry, corners: updatedCorners } } : s))
    );

    socketRef.current?.emit('surface:corners', {
      surfaceId: activeSurface.id,
      corners: updatedCorners
    });
  };

  const handleWarpTouchEnd = () => {
    setDraggingCornerMobile(null);
  };

  const handleCornerNudge = (dx: number, dy: number) => {
    if (!activeSurface) return;
    const current = activeSurface.geometry.corners[activeCorner];
    const nx = Math.max(0, Math.min(1, current.x + dx * warpStep));
    const ny = Math.max(0, Math.min(1, current.y + dy * warpStep));

    const updatedCorners: CornerPins = {
      ...activeSurface.geometry.corners,
      [activeCorner]: { x: nx, y: ny }
    };

    setSurfaces((prev) =>
      prev.map((s) => (s.id === activeSurface.id ? { ...s, geometry: { ...s.geometry, corners: updatedCorners } } : s))
    );

    socketRef.current?.emit('surface:corners', {
      surfaceId: activeSurface.id,
      corners: updatedCorners
    });
  };

  // Quick media actions from phone
  const handleToggleGradientAnim = () => {
    if (!activeSurface) return;
    const existing = activeSurface.animations?.find((a) => a.targetProperty === 'source.config.angle');
    let nextAnimations = activeSurface.animations || [];
    if (existing) {
      nextAnimations = nextAnimations.map((a) =>
        a.id === existing.id ? { ...a, enabled: !a.enabled } : a
      );
    } else {
      nextAnimations.push({
        id: `anim-rot-${Date.now().toString(36)}`,
        enabled: true,
        targetProperty: 'source.config.angle',
        duration: 8,
        loop: true,
        playbackSpeed: 1,
        keyframes: [
          { time: 0, value: 0 },
          { time: 8, value: 360 }
        ]
      });
    }
    const updated = { ...activeSurface, animations: nextAnimations };
    socketRef.current?.emit('surface:update', updated);
    setSurfaces((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleSetGradientColors = (color1: string, color2: string) => {
    if (!activeSource || activeSource.data.type !== 'gradient_linear') return;
    const currentConfig = activeSource.data.config;
    const updatedSource: MediaSource = {
      ...activeSource,
      data: {
        type: 'gradient_linear',
        config: {
          ...currentConfig,
          stops: [
            { offset: 0, color: color1 },
            { offset: 1, color: color2 }
          ]
        }
      }
    };
    socketRef.current?.emit('source:update', updatedSource);
    setSources((prev) => ({ ...prev, [updatedSource.id]: updatedSource }));
  };

  if (!joined) {
    return (
      <div className="remote-auth-wrap">
        <div className="remote-auth-card">
          <div className="remote-auth-header">
            <div className="brand-mark">W</div>
            <h1>WALLBOARD REMOTE</h1>
            <p className="auth-sub">CONNECT TO PROJECTION STUDIO</p>
          </div>

          <div className="code-input-group">
            <input
              type="text"
              className="code-input"
              value={code}
              placeholder="ENTER 6-DIGIT CODE"
              maxLength={6}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button
              className="btn-connect"
              onClick={() => {
                if (socketRef.current && code) {
                  socketRef.current.emit('join', { code: code.toUpperCase(), role: 'remote' });
                }
              }}
            >
              AUTHENTICATE
            </button>
          </div>

          <div className="auth-status-bar">{message}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="remote-app">
      {/* ── Mobile Header ── */}
      <header className="remote-header">
        <div className="remote-header-brand">
          <div className="brand-mark-sm">W</div>
          <div className="remote-surface-picker">
            <span className="surface-label">TARGET:</span>
            <select
              className="surface-select"
              value={activeSurfaceId}
              onChange={(e) => {
                setActiveSurfaceId(e.target.value);
                socketRef.current?.emit('surface:select', e.target.value);
              }}
            >
              {surfaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="remote-header-actions">
          <button
            className={`btn-header-pill ${isBlackout ? 'danger' : ''}`}
            onClick={() => socketRef.current?.emit('blackout:toggle')}
          >
            {isBlackout ? 'BLACKOUT' : 'SHUTTER'}
          </button>
        </div>
      </header>

      {/* ── Mode Navigation Tabs ── */}
      <nav className="remote-nav">
        <button className={`nav-btn ${tab === 'draw' ? 'active' : ''}`} onClick={() => setTab('draw')}>
          DRAW
        </button>
        <button className={`nav-btn ${tab === 'warp' ? 'active' : ''}`} onClick={() => setTab('warp')}>
          KEYSTONE
        </button>
        <button className={`nav-btn ${tab === 'media' ? 'active' : ''}`} onClick={() => setTab('media')}>
          MEDIA
        </button>
      </nav>

      {/* ── TAB 1: DRAW ── */}
      {tab === 'draw' && (
        <div className="remote-draw-view">
          <div className="canvas-wrapper">
            <canvas
              ref={canvasRef}
              className="remote-touch-canvas"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            />
          </div>

          {/* Palette & Tools Toolbar */}
          <div className="remote-palette-bar">
            <div className="color-swatches">
              {LIGHT_PALETTE.slice(0, 5).map((c) => (
                <button
                  key={c}
                  className={`color-btn ${color === c && tool === 'pen' ? 'active' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => {
                    setColor(c);
                    setTool('pen');
                  }}
                />
              ))}
              <button
                className={`tool-btn ${tool === 'eraser' ? 'active' : ''}`}
                onClick={() => setTool(tool === 'eraser' ? 'pen' : 'eraser')}
              >
                ⌫
              </button>
            </div>

            <div className="action-buttons-row">
              <button
                className={`laser-pill ${laserDecay > 0 ? 'active' : ''}`}
                onClick={() => setLaserDecay(laserDecay > 0 ? 0 : 2.5)}
              >
                {laserDecay > 0 ? 'LASER (2.5s)' : 'PERSISTENT'}
              </button>
              <button className="btn-undo-pill" onClick={() => socketRef.current?.emit('stroke:undo')}>
                UNDO
              </button>
              <button className="btn-clear-pill" onClick={() => socketRef.current?.emit('board:clear')}>
                CLEAR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: KEYSTONE / WARP ── */}
      {tab === 'warp' && (
        <div className="remote-warp-view">
          <div className="warp-pad-container">
            <canvas
              ref={warpPadRef}
              className="warp-touch-pad"
              onTouchStart={handleWarpTouchStart}
              onTouchMove={handleWarpTouchMove}
              onTouchEnd={handleWarpTouchEnd}
            />
          </div>

          {/* Precision D-Pad Nudge Controls */}
          <div className="warp-controls-panel">
            <div className="corner-selector-row">
              {(['tl', 'tr', 'br', 'bl'] as const).map((c) => (
                <button
                  key={c}
                  className={`corner-tab-btn ${activeCorner === c ? 'active' : ''}`}
                  onClick={() => setActiveCorner(c)}
                >
                  {c.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="dpad-grid">
              <button className="dpad-btn up" onClick={() => handleCornerNudge(0, -1)}>
                ▲
              </button>
              <div className="dpad-middle">
                <button className="dpad-btn left" onClick={() => handleCornerNudge(-1, 0)}>
                  ◀
                </button>
                <div className="dpad-center">{activeCorner.toUpperCase()}</div>
                <button className="dpad-btn right" onClick={() => handleCornerNudge(1, 0)}>
                  ▶
                </button>
              </div>
              <button className="dpad-btn down" onClick={() => handleCornerNudge(0, 1)}>
                ▼
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 3: MEDIA & ANIMATION ── */}
      {tab === 'media' && (
        <div className="remote-media-view">
          <div className="media-card">
            <h3>GRADIENT THEMES</h3>
            <div className="preset-grid">
              <button
                className="preset-theme-btn"
                style={{ background: 'linear-gradient(45deg, #00f0ff, #ff007f)' }}
                onClick={() => handleSetGradientColors('#00f0ff', '#ff007f')}
              >
                CYBERPUNK
              </button>
              <button
                className="preset-theme-btn"
                style={{ background: 'linear-gradient(45deg, #ffaa00, #ff0033)' }}
                onClick={() => handleSetGradientColors('#ffaa00', '#ff0033')}
              >
                SOLAR
              </button>
              <button
                className="preset-theme-btn"
                style={{ background: 'linear-gradient(45deg, #00ff66, #003311)' }}
                onClick={() => handleSetGradientColors('#00ff66', '#003311')}
              >
                MATRIX
              </button>
              <button
                className="preset-theme-btn"
                style={{ background: 'linear-gradient(45deg, #ffffff, #555555)', color: '#000' }}
                onClick={() => handleSetGradientColors('#ffffff', '#333333')}
              >
                MONO
              </button>
            </div>
          </div>

          <div className="media-card">
            <h3>ANIMATION CONTROLS</h3>
            <button
              className={`btn-media-toggle ${
                activeSurface?.animations?.some((a) => a.targetProperty === 'source.config.angle' && a.enabled)
                  ? 'active'
                  : ''
              }`}
              onClick={handleToggleGradientAnim}
            >
              {activeSurface?.animations?.some((a) => a.targetProperty === 'source.config.angle' && a.enabled)
                ? 'GRADIENT ROTATING (60 FPS)'
                : 'START ROTATION ANIMATION'}
            </button>
          </div>

          <div className="media-card">
            <h3>OPTICAL TEST PATTERN</h3>
            <button
              className={`btn-media-toggle ${isCalibration ? 'active-grid' : ''}`}
              onClick={() => socketRef.current?.emit('calibration:toggle')}
            >
              {isCalibration ? 'TEST GRID: ON' : 'SHOW CALIBRATION GRID'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const container = document.getElementById('root') || document.getElementById('remote-root');
if (container) {
  const root = createRoot(container);
  root.render(<Remote />);
}
