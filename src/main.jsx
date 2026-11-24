import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './style.css';

const params = new URLSearchParams(window.location.search);
const isRemote = window.location.pathname === '/remote';
const codeFromUrl = params.get('code') || '';

function generateStrokeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function useSocket() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    return () => socket.disconnect();
  }, []);
  return { socket: socketRef, connected };
}

function drawStroke(ctx, stroke, width, height, glow = false) {
  if (!stroke.points?.length) return;
  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = Math.max(1, stroke.width * width);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (glow && stroke.color !== '#000000' && stroke.color !== '#f7f7f4') {
    ctx.shadowColor = stroke.color;
    ctx.shadowBlur = Math.max(3, stroke.width * width * 1.4);
  }
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
  for (const point of stroke.points.slice(1)) ctx.lineTo(point.x * width, point.y * height);
  if (stroke.points.length === 1) ctx.lineTo(stroke.points[0].x * width + 0.1, stroke.points[0].y * height + 0.1);
  ctx.stroke();
  ctx.restore();
}

function Display() {
  const { socket, connected } = useSocket();
  const canvasRef = useRef(null);
  const strokesRef = useRef([]);
  const [session, setSession] = useState(null);
  const [remoteCount, setRemoteCount] = useState(0);
  const [showPair, setShowPair] = useState(true);
  const [isProjectionMode, setIsProjectionMode] = useState(true); // Black canvas for projector light manipulation
  const [cleanView, setCleanView] = useState(false);

  const render = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = isProjectionMode ? '#000000' : '#f7f7f4';
    ctx.fillRect(0, 0, rect.width, rect.height);
    for (const stroke of strokesRef.current) drawStroke(ctx, stroke, rect.width, rect.height, isProjectionMode);
  };

  useEffect(() => {
    const fetchSession = () => {
      fetch('/api/session')
        .then((r) => r.json())
        .then(setSession)
        .catch(() => setSession({ error: 'Start the local server to create a session.' }));
    };
    fetchSession();
  }, [connected]);

  useEffect(() => {
    const s = socket.current;
    if (!s || !connected || !session?.code) return;
    s.emit('join', { code: session.code, role: 'display' });
    const init = (strokes) => { strokesRef.current = Array.isArray(strokes) ? [...strokes] : []; render(); };
    const add = (stroke) => {
      const index = strokesRef.current.findIndex((item) => item.id === stroke.id);
      if (index >= 0) strokesRef.current[index] = stroke;
      else strokesRef.current.push(stroke);
      render();
    };
    const undo = (id) => { strokesRef.current = strokesRef.current.filter((stroke) => stroke.id !== id); render(); };
    const clear = () => { strokesRef.current = []; render(); };
    s.on('board:init', init);
    s.on('stroke:add', add);
    s.on('board:undo', undo);
    s.on('board:clear', clear);
    s.on('presence', ({ connected: count }) => {
      setRemoteCount(count);
      if (count > 0) setShowPair(false); // auto-hide pairing card once phone connects!
    });
    return () => {
      s.off('board:init', init);
      s.off('stroke:add', add);
      s.off('board:undo', undo);
      s.off('board:clear', clear);
      s.off('presence');
    };
  }, [connected, session?.code]);

  useEffect(() => {
    render();
    const observer = new ResizeObserver(() => render());
    if (canvasRef.current) observer.observe(canvasRef.current);
    window.addEventListener('resize', render);
    return () => { observer.disconnect(); window.removeEventListener('resize', render); };
  }, [isProjectionMode]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      if (e.key === 'h' || e.key === 'H') setCleanView((v) => !v);
      if (e.key === 'p' || e.key === 'P') setShowPair((v) => !v);
      if (e.key === 'm' || e.key === 'M') setIsProjectionMode((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return <main className={`display-shell ${isProjectionMode ? 'dark' : ''} ${cleanView ? 'clean' : ''}`} onDoubleClick={toggleFullscreen}>
    <canvas ref={canvasRef} className="display-canvas" />
    <div className="display-top">
      <div className="brand"><span className="brand-mark">W</span><span>WALLBOARD</span></div>
      <div className="status"><i className={connected ? 'online' : ''} />{connected ? (isProjectionMode ? 'LIGHT PROJECTION ACTIVE' : 'LOCAL SESSION') : 'CONNECTING'}</div>
    </div>
    <div className="display-bottom">
      <span>{isProjectionMode ? 'PROJECTOR LIGHT MODE (BLACK = ZERO LIGHT)' : 'WHITEBOARD MODE'}</span>
      <span>{remoteCount} PHONE{remoteCount === 1 ? '' : 'S'} CONNECTED</span>
      <div className="display-bottom-actions">
        <button onClick={() => setIsProjectionMode((v) => !v)}>{isProjectionMode ? 'MODE: LIGHT (BLACK)' : 'MODE: WHITE'}</button>
        <button onClick={() => setCleanView((v) => !v)}>{cleanView ? 'SHOW UI' : 'HIDE ALL UI (H)'}</button>
        <button onClick={() => setShowPair((v) => !v)}>{showPair ? 'HIDE QR' : 'PAIR PHONE (P)'}</button>
        <button onClick={toggleFullscreen}>FULLSCREEN (F)</button>
      </div>
    </div>
    {showPair && !cleanView && <section className="pair-card">
      <div className="pair-copy">
        <span className="eyebrow">{isProjectionMode ? 'LIGHT PROJECTION' : 'JOIN THIS CANVAS'}</span>
        <h1>Paint with light<br/>from your phone.</h1>
        <p>Scan to draw. In Light Mode, black is 100% dark and lines shine as pure light beams.</p>
        <div className="session-code">{session?.code || '------'}</div>
        <small>Keep both devices on the same Wi-Fi network.</small>
      </div>
      {session?.qr ? <img className="qr" src={session.qr} alt="QR code to pair a phone" /> : <div className="qr-placeholder">{session?.error || 'Preparing QR…'}</div>}
    </section>}
  </main>;
}

const LIGHT_PALETTE = ['#ffffff', '#00ffff', '#39ff14', '#ffe600', '#ff007f', '#ff3b30', '#a855f7'];
const WHITEBOARD_PALETTE = ['#20242b', '#e45454', '#3976d2', '#269b72', '#d49a2a', '#8c62bd', '#f7f7f4'];

function Remote() {
  const { socket, connected } = useSocket();
  const canvasRef = useRef(null);
  const strokesRef = useRef([]);
  const activeRef = useRef(null);
  const [code, setCode] = useState(codeFromUrl);
  const [joined, setJoined] = useState(false);
  const [isProjectionMode, setIsProjectionMode] = useState(true);
  const [color, setColor] = useState('#00ffff');
  const [width, setWidth] = useState(0.008);
  const [tool, setTool] = useState('pen');
  const [message, setMessage] = useState('Connecting to your laptop…');

  const palette = isProjectionMode ? LIGHT_PALETTE : WHITEBOARD_PALETTE;

  const render = () => {
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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = isProjectionMode ? '#05070a' : '#f7f7f4';
    ctx.fillRect(0, 0, rect.width, rect.height);
    for (const stroke of strokesRef.current) {
      drawStroke(ctx, stroke, rect.width, rect.height, isProjectionMode);
    }
  };

  useEffect(() => {
    const s = socket.current;
    if (!s || !connected) return;

    const onError = (text) => {
      setJoined(false);
      setMessage(text);
    };
    const onInit = (strokes) => {
      strokesRef.current = Array.isArray(strokes) ? [...strokes] : [];
      setJoined(true);
      setMessage('Connected » Draw anywhere below');
      render();
    };
    const onStrokeAdd = (stroke) => {
      const index = strokesRef.current.findIndex((item) => item.id === stroke.id);
      if (index >= 0) strokesRef.current[index] = stroke;
      else strokesRef.current.push(stroke);
      render();
    };
    const onUndo = (id) => {
      strokesRef.current = strokesRef.current.filter((stroke) => stroke.id !== id);
      render();
    };
    const onClear = () => {
      strokesRef.current = [];
      render();
    };

    s.on('join:error', onError);
    s.on('board:init', onInit);
    s.on('stroke:add', onStrokeAdd);
    s.on('board:undo', onUndo);
    s.on('board:clear', onClear);

    if (code.length === 6) {
      s.emit('join', { code: code.toUpperCase(), role: 'remote' });
    }

    return () => {
      s.off('join:error', onError);
      s.off('board:init', onInit);
      s.off('stroke:add', onStrokeAdd);
      s.off('board:undo', onUndo);
      s.off('board:clear', onClear);
    };
  }, [connected, code]);

  useEffect(() => {
    if (!joined) return;
    render();
    const observer = new ResizeObserver(() => render());
    if (canvasRef.current) observer.observe(canvasRef.current);
    window.addEventListener('resize', render);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', render);
    };
  }, [joined, isProjectionMode]);

  const pointFrom = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    const clampedX = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const clampedY = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    return {
      x: Number.isFinite(clampedX) ? Math.round(clampedX * 10000) / 10000 : 0,
      y: Number.isFinite(clampedY) ? Math.round(clampedY * 10000) / 10000 : 0
    };
  };

  const getEraserColor = () => (isProjectionMode ? '#000000' : '#f7f7f4');

  const start = (event) => {
    if (!joined) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
    const point = pointFrom(event);
    const stroke = {
      id: generateStrokeId(),
      color: tool === 'eraser' ? getEraserColor() : color,
      width: tool === 'eraser' ? 0.04 : width,
      points: [point]
    };
    activeRef.current = stroke;
    strokesRef.current.push(stroke);
    render();
    socket.current?.emit('stroke:add', stroke);
  };

  const move = (event) => {
    if (!activeRef.current) return;
    event.preventDefault();
    const point = pointFrom(event);
    activeRef.current.points.push(point);
    render();
    if (activeRef.current.points.length % 2 === 0) {
      socket.current?.emit('stroke:add', activeRef.current);
    }
  };

  const end = (event) => {
    if (!activeRef.current) return;
    try {
      if (event?.currentTarget && event?.pointerId) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {}
    socket.current?.emit('stroke:add', activeRef.current);
    activeRef.current = null;
    render();
  };

  return <main className={`remote-shell ${isProjectionMode ? 'dark' : ''}`}>
    <header className="remote-header">
      <div className="brand"><span className="brand-mark">W</span><span>WALLBOARD</span></div>
      <span className="remote-status"><i className={joined ? 'online' : ''}/>{joined ? (isProjectionMode ? 'LIGHT MODE' : 'WHITEBOARD') : 'NOT CONNECTED'}</span>
    </header>
    {!joined && <section className="join-panel">
      <span className="eyebrow">PAIR WITH YOUR PROJECTOR</span>
      <h1>Paint with<br/>pure light.</h1>
      <p>{message}</p>
      <label>SESSION CODE<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))} placeholder="6-DIGIT CODE" maxLength={6}/></label>
      <button className="primary" disabled={code.length !== 6 || !connected} onClick={() => socket.current?.emit('join', { code: code.toUpperCase(), role: 'remote' })}>CONNECT</button>
    </section>}
    <section className={`drawing-panel ${joined ? 'active' : ''}`}>
      <div className="tool-row">
        <button className={tool === 'pen' ? 'selected' : ''} onClick={() => setTool('pen')}>Light Pen</button>
        <button className={tool === 'eraser' ? 'selected' : ''} onClick={() => setTool('eraser')}>Eraser (Off)</button>
        <button onClick={() => {
          setIsProjectionMode((v) => {
            const next = !v;
            setColor(next ? '#00ffff' : '#20242b');
            return next;
          });
        }}>{isProjectionMode ? 'Beam Mode' : 'Whiteboard'}</button>
        <span className="tool-spacer"/>
        <button onClick={() => socket.current?.emit('stroke:undo')}>Undo</button>
        <button onClick={() => socket.current?.emit('board:clear')}>Clear</button>
      </div>
      <div className="swatches">
        {palette.map((c) => (
          <button key={c} aria-label={`Choose ${c}`} className={color === c && tool === 'pen' ? 'chosen' : ''} style={{ background: c }} onClick={() => { setColor(c); setTool('pen'); }}/>
        ))}
      </div>
      <div className="phone-canvas-wrap">
        <canvas ref={canvasRef} className="phone-canvas" style={{ touchAction: 'none' }} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
      </div>
      <div className="brush-row">
        <span>BEAM SIZE</span>
        <input type="range" min="0.003" max="0.03" step="0.001" value={width} onChange={(e) => setWidth(Number(e.target.value))}/>
      </div>
      <p className="draw-hint">Draw above · Only your light lines are projected onto the wall</p>
    </section>
  </main>;
}

function App() { return isRemote ? <Remote/> : <Display/>; }

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
