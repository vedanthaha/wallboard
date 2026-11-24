import React, { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { WallboardWebGLCompositor } from '../shared/surfaceRenderer';
import {
  Surface,
  MediaSource,
  DrawingStroke,
  CornerPins,
  LinearGradientConfig,
  SolidConfig
} from '../shared/protocol';
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
  }
}

type StudioTab = 'surfaces' | 'media' | 'displays' | 'pairing';

export default function App() {
  const [activeTab, setActiveTab] = useState<StudioTab>('surfaces');
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [outputDisplay, setOutputDisplay] = useState<number | null>(null);
  const [outputOpen, setOutputOpen] = useState(false);
  const [session, setSession] = useState<SessionData | null>(null);
  const [remoteCount, setRemoteCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Decoupled authoritative state
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [sources, setSources] = useState<Record<string, MediaSource>>({});
  const [activeSurfaceId, setActiveSurfaceId] = useState<string>('surface-1');
  const [isBlackout, setIsBlackout] = useState(false);
  const [isCalibration, setIsCalibration] = useState(false);
  const [draggingCorner, setDraggingCorner] = useState<'tl' | 'tr' | 'br' | 'bl' | null>(null);

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const compositorRef = useRef<WallboardWebGLCompositor | null>(null);
  const strokesRef = useRef<DrawingStroke[]>([]);
  const socketRef = useRef<Socket | null>(null);

  const activeSurface = surfaces.find((s) => s.id === activeSurfaceId) || surfaces[0];
  const activeSource = activeSurface ? sources[activeSurface.sourceId] : undefined;

  // Render loop using WebGL Compositor
  useEffect(() => {
    let animId: number;

    const render = () => {
      animId = requestAnimationFrame(render);
      const canvas = previewCanvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        if (compositorRef.current) {
          compositorRef.current.resize(w, h);
        }
      }

      if (!compositorRef.current) {
        compositorRef.current = new WallboardWebGLCompositor(canvas);
        compositorRef.current.resize(w, h);
      }

      compositorRef.current.render(
        surfaces,
        sources,
        strokesRef.current,
        isBlackout,
        isCalibration
      );
    };

    animId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animId);
      if (compositorRef.current) {
        compositorRef.current.dispose();
        compositorRef.current = null;
      }
    };
  }, [surfaces, sources, isBlackout, isCalibration]);

  // Connect to Socket.IO and subscribe to state
  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    fetch('/api/session')
      .then((r) => r.json())
      .then((data) => {
        setSession(data);
        if (data.code) {
          socket.emit('join', { code: data.code, role: 'display' });
        }
        if (Array.isArray(data.surfaces)) setSurfaces(data.surfaces);
        if (data.sources) setSources(data.sources);
        if (data.activeSurfaceId) setActiveSurfaceId(data.activeSurfaceId);
        if (Array.isArray(data.strokes)) strokesRef.current = data.strokes;
        if (data.blackout !== undefined) setIsBlackout(data.blackout);
        if (data.calibration !== undefined) setIsCalibration(data.calibration);
      })
      .catch((err) => setError(`Failed to fetch session: ${err.message}`));

    socket.on('state:init', (st) => {
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
    socket.on('presence', ({ connected }: { connected: number }) => setRemoteCount(connected));

    return () => {
      socket.disconnect();
    };
  }, []);

  // Display enumeration
  const refreshDisplays = useCallback(async () => {
    if (!window.wallboard) return;
    try {
      const list = await window.wallboard.listDisplays();
      setDisplays(list);
      const isOutput = await window.wallboard.isOutputOpen();
      setOutputOpen(isOutput);
    } catch (err: any) {
      setError(err?.message || 'Failed to list displays.');
    }
  }, []);

  useEffect(() => {
    refreshDisplays();
    if (window.wallboard) {
      const unsubChanged = window.wallboard.onDisplaysChanged((list) => setDisplays(list));
      const unsubOpened = window.wallboard.onOutputOpened(({ displayId }) => {
        setOutputOpen(true);
        setOutputDisplay(displayId);
      });
      const unsubClosed = window.wallboard.onOutputClosed(() => {
        setOutputOpen(false);
        setOutputDisplay(null);
      });
      return () => {
        unsubChanged();
        unsubOpened();
        unsubClosed();
      };
    }
  }, [refreshDisplays]);

  // Corner pin dragging logic
  const handlePointerDownCorner = (corner: 'tl' | 'tr' | 'br' | 'bl', e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingCorner(corner);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingCorner || !activeSurface || !previewWrapRef.current) return;
    const rect = previewWrapRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    const updatedCorners: CornerPins = {
      ...activeSurface.geometry.corners,
      [draggingCorner]: { x, y }
    };

    setSurfaces((prev) =>
      prev.map((s) => (s.id === activeSurface.id ? { ...s, geometry: { ...s.geometry, corners: updatedCorners } } : s))
    );

    socketRef.current?.emit('surface:corners', {
      surfaceId: activeSurface.id,
      corners: updatedCorners
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingCorner) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      setDraggingCorner(null);
    }
  };

  // Surface management actions
  const handleAddSurface = () => {
    const id = `surface-${Date.now().toString(36)}`;
    const newSurface: Surface = {
      id,
      name: `Surface ${surfaces.length + 1}`,
      sourceId: Object.keys(sources)[0] || 'src-gradient-cyber',
      blendMode: 'screen',
      opacity: 1,
      geometry: {
        id: `geom-${id}`,
        name: `Quad ${surfaces.length + 1}`,
        type: 'quad',
        zIndex: surfaces.length,
        visible: true,
        locked: false,
        corners: {
          tl: { x: 0.25, y: 0.25 },
          tr: { x: 0.75, y: 0.25 },
          br: { x: 0.75, y: 0.75 },
          bl: { x: 0.25, y: 0.75 }
        }
      },
      effects: [{ id: `fx-${id}`, type: 'bloom', enabled: true, params: { intensity: 1.0, radius: 0.5, threshold: 0.2 } }],
      animations: [
        {
          id: `anim-${id}`,
          enabled: true,
          targetProperty: 'source.config.angle',
          duration: 8,
          loop: true,
          playbackSpeed: 1,
          keyframes: [
            { time: 0, value: 0 },
            { time: 8, value: 360 }
          ]
        }
      ]
    };

    socketRef.current?.emit('surface:create', newSurface);
    setSurfaces((prev) => [...prev, newSurface]);
    setActiveSurfaceId(newSurface.id);
  };

  const handleRemoveSurface = (id: string) => {
    if (surfaces.length <= 1) return;
    socketRef.current?.emit('surface:remove', id);
    setSurfaces((prev) => prev.filter((s) => s.id !== id));
    if (activeSurfaceId === id) {
      const remaining = surfaces.filter((s) => s.id !== id);
      setActiveSurfaceId(remaining[0]?.id || 'surface-1');
    }
  };

  const handleAssignSource = (sourceId: string) => {
    if (!activeSurface) return;
    const updated = { ...activeSurface, sourceId };
    socketRef.current?.emit('surface:update', updated);
    setSurfaces((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleOpacityChange = (opacity: number) => {
    if (!activeSurface) return;
    const updated = { ...activeSurface, opacity };
    socketRef.current?.emit('surface:update', updated);
    setSurfaces((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleResetCorners = () => {
    if (!activeSurface) return;
    const defaultCorners: CornerPins = {
      tl: { x: 0.15, y: 0.15 },
      tr: { x: 0.85, y: 0.15 },
      br: { x: 0.85, y: 0.85 },
      bl: { x: 0.15, y: 0.85 }
    };
    socketRef.current?.emit('surface:corners', {
      surfaceId: activeSurface.id,
      corners: defaultCorners
    });
    setSurfaces((prev) =>
      prev.map((s) => (s.id === activeSurface.id ? { ...s, geometry: { ...s.geometry, corners: defaultCorners } } : s))
    );
  };

  // Media inspection actions
  const handleUpdateLinearGradient = (partial: Partial<LinearGradientConfig>) => {
    if (!activeSource || activeSource.data.type !== 'gradient_linear') return;
    const currentConfig = activeSource.data.config;
    const updatedSource: MediaSource = {
      ...activeSource,
      data: {
        type: 'gradient_linear',
        config: { ...currentConfig, ...partial }
      }
    };
    socketRef.current?.emit('source:update', updatedSource);
    setSources((prev) => ({ ...prev, [updatedSource.id]: updatedSource }));
  };

  const handleUpdateSolidColor = (color: string) => {
    if (!activeSource || activeSource.data.type !== 'solid') return;
    const updatedSource: MediaSource = {
      ...activeSource,
      data: {
        type: 'solid',
        config: { color }
      }
    };
    socketRef.current?.emit('source:update', updatedSource);
    setSources((prev) => ({ ...prev, [updatedSource.id]: updatedSource }));
  };

  const handleToggleRotationAnim = () => {
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

  const handleAnimSpeedChange = (speed: number) => {
    if (!activeSurface) return;
    const nextAnimations = (activeSurface.animations || []).map((a) =>
      a.targetProperty === 'source.config.angle' ? { ...a, playbackSpeed: speed } : a
    );
    const updated = { ...activeSurface, animations: nextAnimations };
    socketRef.current?.emit('surface:update', updated);
    setSurfaces((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleSaveProject = () => {
    socketRef.current?.emit('project:save');
  };

  // Corner coordinates in percentage for overlay
  const corners = activeSurface?.geometry?.corners || {
    tl: { x: 0, y: 0 },
    tr: { x: 1, y: 0 },
    br: { x: 1, y: 1 },
    bl: { x: 0, y: 1 }
  };

  const tlPct = { x: `${corners.tl.x * 100}%`, y: `${corners.tl.y * 100}%` };
  const trPct = { x: `${corners.tr.x * 100}%`, y: `${corners.tr.y * 100}%` };
  const brPct = { x: `${corners.br.x * 100}%`, y: `${corners.br.y * 100}%` };
  const blPct = { x: `${corners.bl.x * 100}%`, y: `${corners.bl.y * 100}%` };

  return (
    <div className="studio">
      {/* ── Studio Header ── */}
      <header className="studio-header">
        <div className="studio-brand">
          <div className="studio-brand-mark">W</div>
          <span className="studio-brand-text">WALLBOARD STUDIO</span>
          <span className="studio-version">v0.4.0 · M1</span>
        </div>

        <div className="studio-status-row">
          <span className={`studio-indicator ${remoteCount > 0 ? 'active' : ''}`}>
            REMOTE: {remoteCount > 0 ? `${remoteCount} CONNECTED` : 'DISCONNECTED'}
          </span>
          <span className={`studio-indicator ${outputOpen ? 'active' : ''}`}>
            PROJECTOR: {outputOpen ? 'ACTIVE' : 'IDLE'}
          </span>
          {isBlackout && <span className="studio-indicator danger">SHUTTER: BLACKOUT</span>}
        </div>
      </header>

      {/* ── Studio Body ── */}
      <div className="studio-body">
        {/* ── Sidebar ── */}
        <aside className="studio-sidebar">
          {/* Navigation Tabs */}
          <div className="studio-nav-tabs">
            <button
              className={`studio-tab-btn ${activeTab === 'surfaces' ? 'active' : ''}`}
              onClick={() => setActiveTab('surfaces')}
            >
              SURFACES
            </button>
            <button
              className={`studio-tab-btn ${activeTab === 'media' ? 'active' : ''}`}
              onClick={() => setActiveTab('media')}
            >
              MEDIA
            </button>
            <button
              className={`studio-tab-btn ${activeTab === 'displays' ? 'active' : ''}`}
              onClick={() => setActiveTab('displays')}
            >
              DISPLAYS
            </button>
            <button
              className={`studio-tab-btn ${activeTab === 'pairing' ? 'active' : ''}`}
              onClick={() => setActiveTab('pairing')}
            >
              PAIRING
            </button>
          </div>

          {error && <div className="studio-error">{error}</div>}

          {/* TAB 1: SURFACES */}
          {activeTab === 'surfaces' && (
            <div className="sidebar-section">
              <div className="sidebar-title">SURFACE HIERARCHY</div>
              <div className="surface-list">
                {surfaces.map((s) => {
                  const src = sources[s.sourceId];
                  return (
                    <div
                      key={s.id}
                      className={`surface-item ${s.id === activeSurfaceId ? 'active' : ''}`}
                      onClick={() => setActiveSurfaceId(s.id)}
                    >
                      <div className="surface-item-name">
                        <span>{s.name}</span>
                        <span className="surface-item-badge">{src?.name || s.sourceId}</span>
                      </div>
                      {surfaces.length > 1 && (
                        <button
                          className="btn-preset btn-danger-subtle"
                          style={{ padding: '2px 8px', fontSize: '9px' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveSurface(s.id);
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}

                <button className="surface-btn-add" onClick={handleAddSurface}>
                  + ADD PROJECTION SURFACE
                </button>
              </div>

              {activeSurface && (
                <div className="inspector-card">
                  <div className="sidebar-title">SELECTED: {activeSurface.name}</div>

                  <div className="prop-group">
                    <label className="prop-label">ASSIGNED MEDIA SOURCE</label>
                    <select
                      className="prop-input-select"
                      value={activeSurface.sourceId}
                      onChange={(e) => handleAssignSource(e.target.value)}
                    >
                      {Object.values(sources).map((src) => (
                        <option key={src.id} value={src.id}>
                          {src.name} ({src.data.type})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="prop-group">
                    <div className="prop-label">
                      <span>SURFACE OPACITY</span>
                      <span className="prop-value">{Math.round((activeSurface.opacity ?? 1) * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      className="prop-slider"
                      value={activeSurface.opacity ?? 1}
                      onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
                    />
                  </div>

                  <div className="preset-buttons" style={{ marginTop: '4px' }}>
                    <button className="btn-preset" onClick={handleResetCorners}>
                      RESET RECTANGLE
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: MEDIA INSPECTOR */}
          {activeTab === 'media' && activeSource && (
            <div className="sidebar-section">
              <div className="sidebar-title">MEDIA SOURCE: {activeSource.name}</div>

              {activeSource.data.type === 'gradient_linear' && (() => {
                const linearConfig = activeSource.data.config;
                return (
                  <div className="inspector-card">
                    <div className="sidebar-title">LINEAR GRADIENT CONTROLS</div>

                    {linearConfig.stops.map((stop, i) => (
                      <div key={i} className="color-stop-row">
                        <input
                          type="color"
                          className="color-picker-input"
                          value={stop.color}
                          onChange={(e) => {
                            const newStops = [...linearConfig.stops];
                            newStops[i] = { ...stop, color: e.target.value };
                            handleUpdateLinearGradient({ stops: newStops });
                          }}
                        />
                        <span className="color-hex-label">
                          STOP {i + 1} ({Math.round(stop.offset * 100)}%): {stop.color}
                        </span>
                      </div>
                    ))}

                    <div className="prop-group" style={{ marginTop: '8px' }}>
                      <div className="prop-label">
                        <span>BASE ANGLE</span>
                        <span className="prop-value">{linearConfig.angle}°</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="360"
                        step="1"
                        className="prop-slider"
                        value={linearConfig.angle}
                        onChange={(e) => handleUpdateLinearGradient({ angle: parseInt(e.target.value, 10) })}
                      />
                    </div>

                    {/* Continuous Animation Controls */}
                    <div className="prop-group" style={{ marginTop: '12px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
                      <div className="prop-label">
                        <span>CONTINUOUS ROTATION ANIMATION</span>
                      </div>
                      <button
                        className={`btn-toggle ${
                          activeSurface?.animations?.some((a) => a.targetProperty === 'source.config.angle' && a.enabled)
                            ? 'active-cyan'
                            : ''
                        }`}
                        onClick={handleToggleRotationAnim}
                      >
                        {activeSurface?.animations?.some((a) => a.targetProperty === 'source.config.angle' && a.enabled)
                          ? 'ROTATION: ACTIVE (60 FPS)'
                          : 'START ROTATION ANIMATION'}
                      </button>
                    </div>

                    {activeSurface?.animations?.some((a) => a.targetProperty === 'source.config.angle') && (
                      <div className="prop-group">
                        <div className="prop-label">
                          <span>PLAYBACK SPEED</span>
                          <span className="prop-value">
                            {activeSurface.animations.find((a) => a.targetProperty === 'source.config.angle')?.playbackSpeed || 1}x
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.2"
                          max="3.0"
                          step="0.1"
                          className="prop-slider"
                          value={activeSurface.animations.find((a) => a.targetProperty === 'source.config.angle')?.playbackSpeed || 1}
                          onChange={(e) => handleAnimSpeedChange(parseFloat(e.target.value))}
                        />
                      </div>
                    )}
                  </div>
                );
              })()}

              {activeSource.data.type === 'solid' && (() => {
                const solidConfig = activeSource.data.config;
                return (
                  <div className="inspector-card">
                    <div className="sidebar-title">SOLID COLOR</div>
                    <div className="color-stop-row">
                      <input
                        type="color"
                        className="color-picker-input"
                        value={solidConfig.color}
                        onChange={(e) => handleUpdateSolidColor(e.target.value)}
                      />
                      <span className="color-hex-label">COLOR: {solidConfig.color}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* TAB 3: DISPLAYS */}
          {activeTab === 'displays' && (
            <div className="sidebar-section">
              <div className="sidebar-title">PROJECTOR OUTPUT DISPLAYS</div>
              <div className="display-list">
                {displays.map((d) => (
                  <div
                    key={d.id}
                    className={`display-card ${!d.isInternal ? 'external' : ''} ${
                      outputDisplay === d.id && outputOpen ? 'active' : ''
                    }`}
                  >
                    <div className="display-card-icon">{d.isInternal ? '💻' : '📽️'}</div>
                    <div className="display-card-info">
                      <div className="display-card-name">
                        {d.label || (d.isInternal ? 'Built-in Display' : `Display ${d.id}`)}
                      </div>
                      <div className="display-card-desc">
                        {d.width} × {d.height} · {d.isPrimary ? 'Primary' : 'External Projector'}
                      </div>
                    </div>
                    <div className="display-card-action">
                      {outputOpen && outputDisplay === d.id ? (
                        <button
                          className="btn-output active"
                          onClick={() => window.wallboard?.closeOutput()}
                        >
                          CLOSE
                        </button>
                      ) : (
                        <button
                          className="btn-output"
                          onClick={() => window.wallboard?.openOutput(d.id)}
                        >
                          LAUNCH
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: PAIRING */}
          {activeTab === 'pairing' && session && (
            <div className="sidebar-section">
              <div className="sidebar-title">ANDROID REMOTE PAIRING</div>
              <div className="qr-container">
                {session.qr && <img src={session.qr} alt="Pairing QR" className="studio-qr" />}
                <div className="session-code-display">{session.code}</div>
                <div className="session-url-display">{session.remoteUrl}</div>
              </div>
              <div className="optical-info-card">
                <span className="card-heading">AUTHENTICATED LAN</span>
                <p>Scan with Android camera to open remote controller over local Wi-Fi.</p>
              </div>
            </div>
          )}

          {/* Master Shutter & Calibration */}
          <div className="sidebar-section" style={{ marginTop: 'auto' }}>
            <div className="sidebar-title">MASTER CONTROLS</div>
            <div className="light-switches">
              <button
                className={`btn-shutter-large ${isBlackout ? 'active' : ''}`}
                onClick={() => socketRef.current?.emit('blackout:toggle')}
              >
                {isBlackout ? 'SHUTTER CLOSED (0 LIGHT)' : 'BLACKOUT SHUTTER'}
              </button>
              <button
                className={`btn-grid-large ${isCalibration ? 'active' : ''}`}
                onClick={() => socketRef.current?.emit('calibration:toggle')}
              >
                {isCalibration ? 'CALIBRATION GRID: ON' : 'CALIBRATION TEST PATTERN'}
              </button>
            </div>
          </div>
        </aside>

        {/* ── Main Stage Viewport ── */}
        <main className="studio-main">
          <div className="preview-header">
            <div className="preview-title-group">
              <span className="preview-title">STAGE VIEWPORT · HOMOGRAPHY GLSL</span>
              <span className="preview-meta">
                SURFACE: {activeSurface?.name} · CORNERS: TL({Math.round(corners.tl.x * 100)},{Math.round(corners.tl.y * 100)})
              </span>
            </div>

            <div className="preview-controls">
              <button className="btn-action" onClick={handleSaveProject}>
                SAVE PROJECT
              </button>
              <button
                className="btn-action"
                onClick={() => socketRef.current?.emit('board:clear')}
              >
                CLEAR STROKES
              </button>
              {outputOpen && (
                <button
                  className="btn-close-output"
                  onClick={() => window.wallboard?.closeOutput()}
                >
                  CLOSE PROJECTOR
                </button>
              )}
            </div>
          </div>

          {/* Stage Canvas Wrap with Interactive Corner Handles */}
          <div
            className="preview-wrap"
            ref={previewWrapRef}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <canvas ref={previewCanvasRef} className="preview-canvas" />

            {/* Interactive Corner Pin Overlay for Active Surface */}
            {activeSurface && (
              <div className="stage-overlay">
                <svg className="stage-overlay-svg">
                  <polygon
                    points={`${corners.tl.x * 100}%,${corners.tl.y * 100}% ${corners.tr.x * 100}%,${corners.tr.y * 100}% ${corners.br.x * 100}%,${corners.br.y * 100}% ${corners.bl.x * 100}%,${corners.bl.y * 100}%`}
                    fill="none"
                    stroke="#00ffff"
                    strokeWidth="1.5"
                    strokeDasharray="4 2"
                  />
                </svg>

                {/* 4 Corner Pin Drag Handles */}
                <div
                  className={`corner-pin-handle ${draggingCorner === 'tl' ? 'dragging' : ''}`}
                  style={{ left: tlPct.x, top: tlPct.y }}
                  onPointerDown={(e) => handlePointerDownCorner('tl', e)}
                >
                  TL
                </div>
                <div
                  className={`corner-pin-handle ${draggingCorner === 'tr' ? 'dragging' : ''}`}
                  style={{ left: trPct.x, top: trPct.y }}
                  onPointerDown={(e) => handlePointerDownCorner('tr', e)}
                >
                  TR
                </div>
                <div
                  className={`corner-pin-handle ${draggingCorner === 'br' ? 'dragging' : ''}`}
                  style={{ left: brPct.x, top: brPct.y }}
                  onPointerDown={(e) => handlePointerDownCorner('br', e)}
                >
                  BR
                </div>
                <div
                  className={`corner-pin-handle ${draggingCorner === 'bl' ? 'dragging' : ''}`}
                  style={{ left: blPct.x, top: blPct.y }}
                  onPointerDown={(e) => handlePointerDownCorner('bl', e)}
                >
                  BL
                </div>
              </div>
            )}
          </div>

          <div className="preview-footer">
            <span className="preview-hint">
              DRAG CORNERS TO WARP SURFACE · CREASE-FREE PROJECTIVE HOMOGRAPHY · PHONE DRAWINGS APPEAR INSIDE ACTIVE SURFACE
            </span>
          </div>
        </main>
      </div>
    </div>
  );
}
