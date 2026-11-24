import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './style.css';

const params = new URLSearchParams(window.location.search);
const isRemote = window.location.pathname === '/remote';
const codeFromUrl = params.get('code') || '';

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

function drawStroke(ctx, stroke, width, height) {
  if (!stroke.points?.length) return;
  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = Math.max(1, stroke.width * width);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
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

  const render = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    for (const stroke of strokesRef.current) drawStroke(ctx, stroke, rect.width, rect.height);
  };

  useEffect(() => {
    fetch('/api/session').then((r) => r.json()).then(setSession).catch(() => setSession({ error: 'Start the local server to create a session.' }));
  }, []);
  useEffect(() => {
    const s = socket.current;
    if (!s || !connected) return;
    s.emit('join', { code: session?.code, role: 'display' });
    const init = (strokes) => { strokesRef.current = strokes; render(); };
    const add = (stroke) => {
      const index = strokesRef.current.findIndex((item) => item.id === stroke.id);
      if (index >= 0) strokesRef.current[index] = stroke;
      else strokesRef.current.push(stroke);
      render();
    };
    const undo = (id) => { strokesRef.current = strokesRef.current.filter((stroke) => stroke.id !== id); render(); };
    const clear = () => { strokesRef.current = []; render(); };
    s.on('board:init', init); s.on('stroke:add', add); s.on('board:undo', undo); s.on('board:clear', clear);
    s.on('presence', ({ connected: count }) => setRemoteCount(count));
    return () => { s.off('board:init', init); s.off('stroke:add', add); s.off('board:undo', undo); s.off('board:clear', clear); s.off('presence'); };
  }, [connected, session?.code]);
  useEffect(() => {
    render();
    const observer = new ResizeObserver(render);
    if (canvasRef.current) observer.observe(canvasRef.current);
    window.addEventListener('resize', render);
    return () => { observer.disconnect(); window.removeEventListener('resize', render); };
  }, []);

  return <main className="display-shell">
    <canvas ref={canvasRef} className="display-canvas" />
    <div className="display-top"><div className="brand"><span className="brand-mark">W</span><span>WALLBOARD</span></div><div className="status"><i className={connected ? 'online' : ''} />{connected ? 'LOCAL SESSION' : 'CONNECTING'}</div></div>
    <div className="display-bottom"><span>INFINITE CANVAS</span><span>{remoteCount} PHONE{remoteCount === 1 ? '' : 'S'} CONNECTED</span><button onClick={() => setShowPair((v) => !v)}>{showPair ? 'HIDE PAIRING' : 'PAIR PHONE'}</button></div>
    {showPair && <section className="pair-card"><div className="pair-copy"><span className="eyebrow">JOIN THIS CANVAS</span><h1>Draw from<br/>your phone.</h1><p>Scan the code with your phone camera. Keep both devices on the same Wi-Fi network.</p><div className="session-code">{session?.code || '------'}</div><small>Or open the local address shown in the setup guide.</small></div>{session?.qr ? <img className="qr" src={session.qr} alt="QR code to pair a phone" /> : <div className="qr-placeholder">{session?.error || 'Preparing QR…'}</div>}</section>}
  </main>;
}

function Remote() {
  const { socket, connected } = useSocket();
  const canvasRef = useRef(null);
  const activeRef = useRef(null);
  const [code, setCode] = useState(codeFromUrl);
  const [joined, setJoined] = useState(false);
  const [color, setColor] = useState('#20242b');
  const [width, setWidth] = useState(0.006);
  const [tool, setTool] = useState('pen');
  const [message, setMessage] = useState('Connecting to your laptop…');

  useEffect(() => {
    const s = socket.current;
    if (!s) return;
    const onError = (text) => { setJoined(false); setMessage(text); };
    const onInit = () => { setJoined(true); setMessage('Connected » Draw anywhere below'); };
    s.on('join:error', onError); s.on('board:init', onInit);
    return () => { s.off('join:error', onError); s.off('board:init', onInit); };
  }, []);
  useEffect(() => {
    if (connected && code.length === 6) socket.current?.emit('join', { code: code.toUpperCase(), role: 'remote' });
  }, [connected, code]);

  const pointFrom = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) };
  };
  const start = (event) => {
    if (!joined) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    const stroke = { id: crypto.randomUUID(), color: tool === 'eraser' ? '#f7f7f4' : color, width: tool === 'eraser' ? 0.035 : width, points: [pointFrom(event)] };
    activeRef.current = stroke;
  };
  const move = (event) => {
    if (!activeRef.current) return;
    event.preventDefault();
    activeRef.current.points.push(pointFrom(event));
    if (activeRef.current.points.length % 2 === 0) socket.current?.emit('stroke:add', activeRef.current);
  };
  const end = () => {
    if (!activeRef.current) return;
    socket.current?.emit('stroke:add', activeRef.current);
    activeRef.current = null;
  };

  return <main className="remote-shell">
    <header className="remote-header"><div className="brand"><span className="brand-mark">W</span><span>WALLBOARD</span></div><span className="remote-status"><i className={joined ? 'online' : ''}/>{joined ? 'CONNECTED' : 'NOT CONNECTED'}</span></header>
    {!joined && <section className="join-panel"><span className="eyebrow">PAIR WITH YOUR DISPLAY</span><h1>Connect to<br/>your canvas.</h1><p>{message}</p><label>SESSION CODE<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))} placeholder="6-DIGIT CODE" maxLength={6}/></label><button className="primary" disabled={code.length !== 6 || !connected} onClick={() => socket.current?.emit('join', { code, role: 'remote' })}>CONNECT</button></section>}
    <section className={`drawing-panel ${joined ? 'active' : ''}`}>
      <div className="tool-row"><button className={tool === 'pen' ? 'selected' : ''} onClick={() => setTool('pen')}>Pen</button><button className={tool === 'eraser' ? 'selected' : ''} onClick={() => setTool('eraser')}>Eraser</button><span className="tool-spacer"/><button onClick={() => socket.current?.emit('stroke:undo')}>Undo</button><button onClick={() => socket.current?.emit('board:clear')}>Clear</button></div>
      <div className="swatches">{['#20242b','#e45454','#3976d2','#269b72','#d49a2a','#8c62bd','#f7f7f4'].map((c) => <button key={c} aria-label={`Choose ${c}`} className={color === c ? 'chosen' : ''} style={{ background: c }} onClick={() => { setColor(c); setTool('pen'); }}/>)}</div>
      <div className="phone-canvas-wrap"><canvas ref={canvasRef} className="phone-canvas" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} /></div>
      <div className="brush-row"><span>BRUSH SIZE</span><input type="range" min="0.002" max="0.02" step="0.001" value={width} onChange={(e) => setWidth(Number(e.target.value))}/></div>
      <p className="draw-hint">Draw here · Your strokes appear on the projected canvas</p>
    </section>
  </main>;
}

function App() { return isRemote ? <Remote/> : <Display/>; }

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
