import React, { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  drawStroke,
  drawCalibrationGrid,
  drawSpotlightBeam,
  drawMappingShapes,
  DEFAULT_QUAD,
  Quad,
  Stroke,
  Point,
  Spotlight,
  MappingShape,
  CubeShape,
  LIGHT_PALETTE
} from '../shared/drawing';
import { Scene } from '../shared/protocol';
import './studio.css';

interface DisplayInfo {
  id: number;
  label: string;
  width: number;
  height: number;
  x: number;
  y: number;
  scaleFactor: number;
  isPrimary: boolean;
  isInternal: boolean;
  rotation: number;
}

interface SessionData {
  code: string;
  remoteUrl: string;
  qr: string;
  connected: number;
  quad?: Quad;
  calibration?: boolean;
  blackout?: boolean;
  shapes?: MappingShape[];
  scenes?: Scene[];
}

declare global {
  interface Window {
    wallboard?: {
      listDisplays: () => Promise<DisplayInfo[]>;
      openOutput: (displayId: number) => void;
      closeOutput: () => void;
      isOutputOpen: () => Promise<boolean>;
      onDisplaysChanged: (cb: (displays: DisplayInfo[]) => void) => () => void;
      onOutputOpened: (cb: (info: { displayId: number; label?: string; width: number; height: number }) => void) => () => void;
      onOutputClosed: (cb: () => void) => () => void;
      onOutputError: (cb: (msg: string) => void) => () => void;
    };
    getScreenDetails?: () => Promise<{ screens: Array<{ isPrimary: boolean; availLeft: number; availTop: number; availWidth: number; availHeight: number }> }>;
  }
}

type StudioTab = 'preview' | 'displays' | 'shapes' | 'scenes' | 'light' | 'pairing';

export default function App() {
  const [activeTab, setActiveTab] = useState<StudioTab>('preview');
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [outputDisplay, setOutputDisplay] = useState<number | null>(null);
  const [outputOpen, setOutputOpen] = useState(false);
  const [session, setSession] = useState<SessionData | null>(null);
  const [remoteCount, setRemoteCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Optical & Projection Mapping state
  const [quad, setQuad] = useState<Quad>({ ...DEFAULT_QUAD });
  const [draggingCorner, setDraggingCorner] = useState<'tl' | 'tr' | 'br' | 'bl' | null>(null);
  const [isBlackout, setIsBlackout] = useState(false);
  const [isCalibration, setIsCalibration] = useState(false);
  const [activeSpotlight, setActiveSpotlight] = useState<Spotlight | null>(null);

  // Geometric 3D Shapes & Tracing (Phase 5)
  const [shapes, setShapes] = useState<MappingShape[]>([]);
  const [activeCube, setActiveCube] = useState<CubeShape | null>(null);

  // Scenes & Presets (Phase 6)
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [newSceneName, setNewSceneName] = useState('');

  const previewRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const socketRef = useRef<Socket | null>(null);

  // Render Studio Live Preview
  const renderPreview = useCallback(() => {
    const canvas = previewRef.current;
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

    // Optical Blackout
    if (isBlackout) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.fillStyle = '#ff0055';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SHUTTER CLOSED · BLACKOUT (0 LIGHT)', rect.width / 2, rect.height / 2);
      return;
    }

    // Pitch black background for optical projection preview
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Aspect ratio boundary
    ctx.strokeStyle = '#1a1f29';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, rect.width, rect.height);

    const now = Date.now();

    // 1. Render active 3D cubes and geometric shapes
    if (shapes.length > 0) {
      drawMappingShapes(ctx, shapes, rect.width, rect.height, quad, isCalibration);
    }

    // 2. Render strokes with multi-pass bloom
    for (let i = strokesRef.current.length - 1; i >= 0; i--) {
      const stroke = strokesRef.current[i];
      let alpha = 1;
      if (stroke.decaySeconds && stroke.decaySeconds > 0) {
        const created = stroke.createdAt || now;
        const ageMs = now - created;
        const totalMs = stroke.decaySeconds * 1000;
        if (ageMs >= totalMs) {
          strokesRef.current.splice(i, 1);
          continue;
        }
        alpha = Math.max(0, 1 - ageMs / totalMs);
      }
      drawStroke(ctx, stroke, rect.width, rect.height, true, quad, alpha);
    }

    // 3. Moving virtual spotlight beam
    if (activeSpotlight && activeSpotlight.active) {
      drawSpotlightBeam(
        ctx,
        { x: activeSpotlight.x, y: activeSpotlight.y },
        activeSpotlight.radius,
        activeSpotlight.color,
        rect.width,
        rect.height,
        quad
      );
    }

    // 4. Calibration Grid
    if (isCalibration) {
      drawCalibrationGrid(ctx, rect.width, rect.height, quad);
    }

    // Draw interactive corner handles in Studio preview
    const drawHandle = (p: Point, label: string, isHot: boolean) => {
      const px = p.x * rect.width;
      const py = p.y * rect.height;

      ctx.save();
      ctx.fillStyle = isHot ? '#ffffff' : '#00f0ff';
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = isHot ? 16 : 8;

      ctx.beginPath();
      ctx.arc(px, py, isHot ? 9 : 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, px, py);
      ctx.restore();
    };

    drawHandle(quad.tl, 'TL', draggingCorner === 'tl');
    drawHandle(quad.tr, 'TR', draggingCorner === 'tr');
    drawHandle(quad.br, 'BR', draggingCorner === 'br');
    drawHandle(quad.bl, 'BL', draggingCorner === 'bl');

    // Outline warped quad perimeter
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(quad.tl.x * rect.width, quad.tl.y * rect.height);
    ctx.lineTo(quad.tr.x * rect.width, quad.tr.y * rect.height);
    ctx.lineTo(quad.br.x * rect.width, quad.br.y * rect.height);
    ctx.lineTo(quad.bl.x * rect.width, quad.bl.y * rect.height);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }, [quad, draggingCorner, isBlackout, isCalibration, activeSpotlight, shapes]);

  // Query system displays
  const refreshDisplays = useCallback(async () => {
    if (window.wallboard) {
      try {
        const list = await window.wallboard.listDisplays();
        setDisplays(list);
      } catch {
        setError('Could not query system displays');
      }
    }
  }, []);

  // Fetch session data
  const fetchSession = useCallback(() => {
    fetch('/api/session')
      .then((r) => r.json())
      .then((data: SessionData) => {
        setSession(data);
        if (data.quad) setQuad(data.quad);
        if (data.shapes) {
          setShapes(data.shapes);
          const cube = data.shapes.find((s) => s.type === 'cube') as CubeShape;
          if (cube) setActiveCube(cube);
        }
        if (data.scenes) setScenes(data.scenes);
        if (data.calibration !== undefined) setIsCalibration(data.calibration);
        if (data.blackout !== undefined) setIsBlackout(data.blackout);
        if (socketRef.current && data.code) {
          socketRef.current.emit('join', { code: data.code, role: 'display' });
        }
      })
      .catch(() => {});
  }, []);

  // Electron IPC Listeners
  useEffect(() => {
    refreshDisplays();
    if (window.wallboard) {
      const unsub1 = window.wallboard.onDisplaysChanged((list) => setDisplays(list));
      const unsub2 = window.wallboard.onOutputOpened((info) => {
        setOutputDisplay(info.displayId);
        setOutputOpen(true);
        setError(null);
      });
      const unsub3 = window.wallboard.onOutputClosed(() => {
        setOutputOpen(false);
        setOutputDisplay(null);
      });
      const unsub4 = window.wallboard.onOutputError((msg) => setError(msg));
      return () => {
        unsub1();
        unsub2();
        unsub3();
        unsub4();
      };
    }
  }, [refreshDisplays]);

  // Connect to Socket.IO
  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      fetchSession();
    });

    socket.on('board:init', (initStrokes: Stroke[]) => {
      strokesRef.current = Array.isArray(initStrokes) ? [...initStrokes] : [];
    });

    socket.on('stroke:add', (stroke: Stroke) => {
      const index = strokesRef.current.findIndex((s) => s.id === stroke.id);
      if (index >= 0) strokesRef.current[index] = stroke;
      else strokesRef.current.push(stroke);
    });

    socket.on('board:undo', (id: string) => {
      strokesRef.current = strokesRef.current.filter((s) => s.id !== id);
    });

    socket.on('board:clear', () => {
      strokesRef.current = [];
    });

    socket.on('presence', ({ connected }: { connected: number }) => {
      setRemoteCount(connected);
    });

    socket.on('warp:update', (newQuad: Quad) => {
      if (newQuad) setQuad(newQuad);
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

    socket.on('spotlight:update', (spotlight: Spotlight | null) => {
      setActiveSpotlight(spotlight);
    });

    fetchSession();

    return () => {
      socket.disconnect();
    };
  }, [fetchSession]);

  // rAF continuous render loop for live preview
  useEffect(() => {
    let animId: number;
    const loop = () => {
      renderPreview();
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [renderPreview]);

  // Mouse drag handling for corner pinning on preview canvas
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const hitThreshold = 0.06;
    const dist = (p: Point) => Math.hypot(p.x - x, p.y - y);

    if (dist(quad.tl) <= hitThreshold) setDraggingCorner('tl');
    else if (dist(quad.tr) <= hitThreshold) setDraggingCorner('tr');
    else if (dist(quad.br) <= hitThreshold) setDraggingCorner('br');
    else if (dist(quad.bl) <= hitThreshold) setDraggingCorner('bl');
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!draggingCorner) return;
    const canvas = previewRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clampedX = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const clampedY = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));

    const nextQuad = { ...quad };
    nextQuad[draggingCorner] = {
      x: Math.round(clampedX * 1000) / 1000,
      y: Math.round(clampedY * 1000) / 1000
    };
    setQuad(nextQuad);
    socketRef.current?.emit('warp:update', nextQuad);
  };

  const handleCanvasMouseUp = () => {
    setDraggingCorner(null);
  };

  // Launch output handler
  const handleOpenOutput = async (displayId: number) => {
    if (window.wallboard) {
      window.wallboard.openOutput(displayId);
      return;
    }

    // Browser Fallback (outside Electron)
    try {
      if ('getScreenDetails' in window && window.getScreenDetails) {
        const details = await window.getScreenDetails();
        const screen = details.screens.find((s) => !s.isPrimary) || details.screens[0];
        window.open(
          '/output.html',
          'ProjectorOutput',
          `left=${screen.availLeft},top=${screen.availTop},width=${screen.availWidth},height=${screen.availHeight}`
        );
      } else {
        window.open('/output.html', 'ProjectorOutput', 'width=1280,height=720');
      }
      setOutputOpen(true);
      setOutputDisplay(displayId);
    } catch {
      window.open('/output.html', 'ProjectorOutput', 'width=1280,height=720');
      setOutputOpen(true);
    }
  };

  const handleCloseOutput = () => {
    if (window.wallboard) {
      window.wallboard.closeOutput();
    }
    setOutputOpen(false);
  };

  const applyQuadPreset = (preset: '16:9' | '16:10' | '4:3' | 'reset') => {
    let next: Quad;
    if (preset === '16:9') {
      next = { tl: { x: 0, y: 0.06 }, tr: { x: 1, y: 0.06 }, br: { x: 1, y: 0.94 }, bl: { x: 0, y: 0.94 } };
    } else if (preset === '16:10') {
      next = { tl: { x: 0.03, y: 0.04 }, tr: { x: 0.97, y: 0.04 }, br: { x: 0.97, y: 0.96 }, bl: { x: 0.03, y: 0.96 } };
    } else if (preset === '4:3') {
      next = { tl: { x: 0.12, y: 0.05 }, tr: { x: 0.88, y: 0.05 }, br: { x: 0.88, y: 0.95 }, bl: { x: 0.12, y: 0.95 } };
    } else {
      next = { ...DEFAULT_QUAD };
    }
    setQuad(next);
    socketRef.current?.emit('warp:update', next);
  };

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

  return (
    <div className="studio">
      {/* Studio Header */}
      <header className="studio-header">
        <div className="studio-brand">
          <span className="studio-brand-mark">W</span>
          <span className="studio-brand-text">WALLBOARD STUDIO</span>
          <span className="studio-version">PROJECTION ENGINE</span>
        </div>

        {/* Global Indicators */}
        <div className="studio-status-row">
          <span className={`studio-indicator ${session ? 'active' : ''}`}>
            {session ? 'LOCAL SERVER ONLINE' : 'SERVER STARTING…'}
          </span>
          <span className={`studio-indicator ${remoteCount > 0 ? 'active' : ''}`}>
            {remoteCount} PHONE{remoteCount === 1 ? '' : 'S'} PAIRED
          </span>
          <span className={`studio-indicator ${outputOpen ? 'active' : ''}`}>
            {outputOpen ? 'PROJECTOR OUTPUT LIVE' : 'OUTPUT OFFLINE'}
          </span>
          <span className={`studio-indicator ${isBlackout ? 'danger' : ''}`}>
            {isBlackout ? 'BLACKOUT SHUTTER (0 LIGHT)' : 'SHUTTER OPEN'}
          </span>
        </div>
      </header>

      {/* Main Studio Body */}
      <div className="studio-body">
        {/* Left Control Sidebar with Navigation Tabs */}
        <aside className="studio-sidebar">
          {/* Studio Navigation Tabs */}
          <div className="studio-nav-tabs">
            <button
              className={`studio-tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
              onClick={() => setActiveTab('preview')}
            >
              WARP
            </button>
            <button
              className={`studio-tab-btn ${activeTab === 'displays' ? 'active' : ''}`}
              onClick={() => setActiveTab('displays')}
            >
              DISPLAYS
            </button>
            <button
              className={`studio-tab-btn ${activeTab === 'shapes' ? 'active' : ''}`}
              onClick={() => setActiveTab('shapes')}
            >
              3D CUBES
            </button>
            <button
              className={`studio-tab-btn ${activeTab === 'scenes' ? 'active' : ''}`}
              onClick={() => setActiveTab('scenes')}
            >
              SCENES
            </button>
            <button
              className={`studio-tab-btn ${activeTab === 'light' ? 'active' : ''}`}
              onClick={() => setActiveTab('light')}
            >
              OPTICAL
            </button>
            <button
              className={`studio-tab-btn ${activeTab === 'pairing' ? 'active' : ''}`}
              onClick={() => setActiveTab('pairing')}
            >
              QR
            </button>
          </div>

          {/* TAB 1: WARP & PROJECTION MAPPING */}
          {activeTab === 'preview' && (
            <div className="sidebar-section">
              <h2 className="sidebar-title">4-CORNER KEYSTONE WARPER</h2>
              <p className="sidebar-hint">
                Drag corner pins (TL, TR, BR, BL) on the live preview to keystone the projection directly onto your wall.
              </p>

              <div className="warp-quad-coords">
                <div className="coord-box">
                  <span className="coord-label">TOP-LEFT</span>
                  <span className="coord-val">{quad.tl.x.toFixed(3)}, {quad.tl.y.toFixed(3)}</span>
                </div>
                <div className="coord-box">
                  <span className="coord-label">TOP-RIGHT</span>
                  <span className="coord-val">{quad.tr.x.toFixed(3)}, {quad.tr.y.toFixed(3)}</span>
                </div>
                <div className="coord-box">
                  <span className="coord-label">BOT-LEFT</span>
                  <span className="coord-val">{quad.bl.x.toFixed(3)}, {quad.bl.y.toFixed(3)}</span>
                </div>
                <div className="coord-box">
                  <span className="coord-label">BOT-RIGHT</span>
                  <span className="coord-val">{quad.br.x.toFixed(3)}, {quad.br.y.toFixed(3)}</span>
                </div>
              </div>

              <div className="preset-row">
                <span className="preset-label">ASPECT PRESETS:</span>
                <div className="preset-buttons">
                  <button className="btn-preset" onClick={() => applyQuadPreset('16:9')}>16:9</button>
                  <button className="btn-preset" onClick={() => applyQuadPreset('16:10')}>16:10</button>
                  <button className="btn-preset" onClick={() => applyQuadPreset('4:3')}>4:3</button>
                  <button className="btn-preset btn-danger-subtle" onClick={() => applyQuadPreset('reset')}>Reset</button>
                </div>
              </div>

              <div className="quick-toggle-box">
                <button
                  className={`btn-toggle ${isCalibration ? 'active-cyan' : ''}`}
                  onClick={() => socketRef.current?.emit('calibration:toggle')}
                >
                  {isCalibration ? '✓ CALIBRATION GRID ON' : '⛶ SHOW CALIBRATION GRID'}
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: DISPLAYS & PROJECTOR SELECTION */}
          {activeTab === 'displays' && (
            <div className="sidebar-section">
              <h2 className="sidebar-title">PROJECTOR & DISPLAYS</h2>
              <p className="sidebar-hint">
                Select your connected projector to launch clean borderless output with zero window frame.
              </p>

              <div className="display-list">
                {displays.map((d) => {
                  const isActive = outputOpen && outputDisplay === d.id;
                  const isProjector = !d.isPrimary;
                  return (
                    <div
                      key={d.id}
                      className={`display-card ${isActive ? 'active' : ''} ${isProjector ? 'external' : 'internal'}`}
                    >
                      <div className="display-card-icon">{isProjector ? '📽️' : '💻'}</div>
                      <div className="display-card-info">
                        <div className="display-card-name">
                          {d.label || (d.isPrimary ? 'Laptop Built-in Display' : `Projector / Screen ${d.id}`)}
                        </div>
                        <div className="display-card-desc">
                          {d.width}×{d.height} · {d.isPrimary ? 'Primary (Studio)' : 'External (Projector)'}
                        </div>
                      </div>
                      <div className="display-card-action">
                        {isActive ? (
                          <button className="btn-output active" onClick={handleCloseOutput}>
                            STOP
                          </button>
                        ) : (
                          <button className="btn-output" onClick={() => handleOpenOutput(d.id)}>
                            LAUNCH
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {displays.length === 0 && (
                <div className="display-empty">
                  <p>Running in browser or no external display detected.</p>
                  <button className="btn-output" style={{ marginTop: '8px' }} onClick={() => handleOpenOutput(1)}>
                    LAUNCH OUTPUT POPUP
                  </button>
                  <button className="btn-refresh" style={{ marginTop: '8px', marginLeft: '6px' }} onClick={refreshDisplays}>
                    Query Displays
                  </button>
                </div>
              )}

              {error && <div className="studio-error">{error}</div>}
            </div>
          )}

          {/* TAB 3: 3D CUBES & TRACING (Phase 5) */}
          {activeTab === 'shapes' && (
            <div className="sidebar-section">
              <h2 className="sidebar-title">3D CUBE & OBJECT TRACING</h2>
              <p className="sidebar-hint">
                Project 3D wireframe boxes to map physical cubes or structures in your space.
              </p>

              <div className="preset-buttons">
                <button className="btn-preset" onClick={() => addOrUpdateCube({})}>
                  + Add 3D Cube
                </button>
                <button
                  className="btn-preset btn-danger-subtle"
                  onClick={() => socketRef.current?.emit('shapes:clear')}
                >
                  Clear
                </button>
              </div>

              {activeCube && (
                <div className="cube-editor-box" style={{ marginTop: '10px' }}>
                  <div className="cube-controls-grid">
                    <div className="control-item">
                      <span>ROT X ({activeCube.rotX}°)</span>
                      <input
                        type="range"
                        min="-90"
                        max="90"
                        value={activeCube.rotX}
                        onChange={(e) => addOrUpdateCube({ rotX: Number(e.target.value) })}
                      />
                    </div>
                    <div className="control-item">
                      <span>ROT Y ({activeCube.rotY}°)</span>
                      <input
                        type="range"
                        min="0"
                        max="360"
                        value={activeCube.rotY}
                        onChange={(e) => addOrUpdateCube({ rotY: Number(e.target.value) })}
                      />
                    </div>
                    <div className="control-item">
                      <span>SIZE</span>
                      <input
                        type="range"
                        min="0.08"
                        max="0.45"
                        step="0.01"
                        value={activeCube.size}
                        onChange={(e) => addOrUpdateCube({ size: Number(e.target.value) })}
                      />
                    </div>
                  </div>

                  <div className="swatches" style={{ padding: '6px 0 0' }}>
                    {LIGHT_PALETTE.map((c) => (
                      <button
                        key={c}
                        className={`swatch-btn ${activeCube.color === c ? 'chosen' : ''}`}
                        style={{ background: c }}
                        onClick={() => addOrUpdateCube({ color: c })}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: SCENES & PRESETS (Phase 6) */}
          {activeTab === 'scenes' && (
            <div className="sidebar-section">
              <h2 className="sidebar-title">SAVED SCENES & PRESETS</h2>
              <p className="sidebar-hint">
                Save and switch between different wall mapping setups.
              </p>

              <div className="save-scene-box">
                <input
                  type="text"
                  placeholder="New scene name..."
                  value={newSceneName}
                  onChange={(e) => setNewSceneName(e.target.value)}
                  className="scene-input"
                />
                <button
                  className="btn-preset"
                  disabled={!newSceneName.trim()}
                  onClick={() => {
                    socketRef.current?.emit('scene:save', { name: newSceneName.trim() });
                    setNewSceneName('');
                  }}
                >
                  Save
                </button>
              </div>

              <div className="scenes-list" style={{ marginTop: '10px' }}>
                {scenes.map((sc) => (
                  <div key={sc.id} className="scene-card">
                    <div className="scene-info">
                      <span className="scene-name">{sc.name}</span>
                      <span className="scene-meta">
                        {sc.shapes?.length || 0} shapes · {sc.strokes?.length || 0} strokes
                      </span>
                    </div>
                    <button
                      className="btn-output"
                      onClick={() => socketRef.current?.emit('scene:load', sc.id)}
                    >
                      Load
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: OPTICAL EFFECTS & LIGHT CONTROLS */}
          {activeTab === 'light' && (
            <div className="sidebar-section">
              <h2 className="sidebar-title">OPTICAL & LIGHT ENGINE</h2>
              <p className="sidebar-hint">
                Control the light emitted by your projector. Pure black (#000000) emits zero light.
              </p>

              <div className="light-switches">
                <button
                  className={`btn-shutter-large ${isBlackout ? 'active' : ''}`}
                  onClick={() => socketRef.current?.emit('blackout:toggle')}
                >
                  {isBlackout ? '● BLACKOUT ACTIVE (0 LIGHT EMITTED)' : '○ CLOSE SHUTTER (BLACKOUT)'}
                </button>
                <button
                  className={`btn-grid-large ${isCalibration ? 'active' : ''}`}
                  onClick={() => socketRef.current?.emit('calibration:toggle')}
                >
                  {isCalibration ? '✓ CALIBRATION TEST PATTERN ON' : '⛶ SHOW CALIBRATION PATTERN'}
                </button>
              </div>

              <div className="optical-info-card">
                <span className="card-heading">VIRTUAL SPOTLIGHT / TORCH</span>
                <p>
                  {activeSpotlight && activeSpotlight.active
                    ? `Active at (${activeSpotlight.x.toFixed(2)}, ${activeSpotlight.y.toFixed(2)}) · Radius: ${Math.round(activeSpotlight.radius * 100)}%`
                    : 'Idle · Drag finger in Torch mode on phone to shine spotlight'}
                </p>
              </div>
            </div>
          )}

          {/* TAB 6: PHONE PAIRING */}
          {activeTab === 'pairing' && (
            <div className="sidebar-section qr-section">
              <h2 className="sidebar-title">PHONE PAIRING</h2>
              <p className="sidebar-hint">Scan from Android / phone to draw wirelessly.</p>
              {session ? (
                <div className="qr-container">
                  <img src={session.qr} alt="Pairing QR" className="studio-qr" />
                  <div className="session-code-display">{session.code}</div>
                  <div className="session-url-display">{session.remoteUrl}</div>
                </div>
              ) : (
                <div className="qr-placeholder">Loading pairing code…</div>
              )}
            </div>
          )}
        </aside>

        {/* Right: Live Projector Canvas Preview with Interactive Drag Warper */}
        <main className="studio-main">
          <div className="preview-header">
            <div className="preview-title-group">
              <h2 className="preview-title">PROJECTOR LIVE VIEW (GPU 2D CANVAS)</h2>
              <span className="preview-meta">
                {outputOpen
                  ? `Active on Display ${outputDisplay} · Fullscreen Borderless Output`
                  : 'Select an external display on the left to launch projector window'}
              </span>
            </div>
            <div className="preview-controls">
              <button
                className={`btn-action ${isBlackout ? 'btn-danger' : ''}`}
                onClick={() => socketRef.current?.emit('blackout:toggle')}
              >
                {isBlackout ? 'Shutter Closed' : 'Blackout'}
              </button>
              <button
                className={`btn-action ${isCalibration ? 'btn-active-cyan' : ''}`}
                onClick={() => socketRef.current?.emit('calibration:toggle')}
              >
                Calibration Grid
              </button>
              <button className="btn-action" onClick={() => socketRef.current?.emit('stroke:undo')}>
                Undo
              </button>
              <button className="btn-action" onClick={() => socketRef.current?.emit('board:clear')}>
                Clear
              </button>
              {outputOpen && (
                <button className="btn-close-output" onClick={handleCloseOutput}>
                  ✕ Stop Output
                </button>
              )}
            </div>
          </div>

          <div className="preview-wrap">
            <canvas
              ref={previewRef}
              className="preview-canvas"
              style={{ cursor: draggingCorner ? 'grabbing' : 'crosshair' }}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
            />
          </div>

          <div className="preview-footer">
            <span className="preview-hint">
              Tip: Click & drag any corner handle (TL, TR, BR, BL) on the preview canvas to keystone the projection to your wall.
            </span>
          </div>
        </main>
      </div>
    </div>
  );
}
