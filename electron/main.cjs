const { app, BrowserWindow, ipcMain, screen, Menu } = require('electron');
const path = require('node:path');
const { fork } = require('node:child_process');
const http = require('node:http');

let studioWindow = null;
let outputWindow = null;
let serverProcess = null;

function ensureServerRunning() {
  const req = http.get('http://localhost:3001/api/session', () => {});
  req.on('error', () => {
    console.log('Starting internal Wallboard server on port 3001...');
    serverProcess = fork(path.join(__dirname, '../server/index.js'), [], {
      stdio: 'inherit'
    });
  });
}

async function getStudioUrl() {
  try {
    const res = await fetch('http://localhost:5173/studio.html');
    if (res.ok) return 'http://localhost:5173/studio.html';
  } catch {}
  return `file://${path.join(__dirname, '../dist/studio.html')}`;
}

async function getOutputUrl() {
  try {
    const res = await fetch('http://localhost:5173/output.html');
    if (res.ok) return 'http://localhost:5173/output.html';
  } catch {}
  return `file://${path.join(__dirname, '../dist/output.html')}`;
}

function getDisplayList() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  return displays.map((d) => ({
    id: d.id,
    label: d.label || (d.id === primary.id ? 'Laptop / Primary Screen' : `Projector / Display ${d.id}`),
    width: d.size.width,
    height: d.size.height,
    x: d.bounds.x,
    y: d.bounds.y,
    bounds: d.bounds,
    scaleFactor: d.scaleFactor,
    isPrimary: d.id === primary.id,
    isInternal: d.internal ?? (d.id === primary.id),
    rotation: d.rotation
  }));
}

async function createStudioWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  studioWindow = new BrowserWindow({
    width: Math.min(1280, width - 40),
    height: Math.min(840, height - 40),
    minWidth: 880,
    minHeight: 580,
    title: 'Wallboard Studio',
    backgroundColor: '#0b0d10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  });

  const url = await getStudioUrl();
  studioWindow.loadURL(url);

  studioWindow.once('ready-to-show', () => {
    studioWindow.show();
  });

  studioWindow.on('closed', () => {
    studioWindow = null;
    if (outputWindow && !outputWindow.isDestroyed()) {
      outputWindow.close();
      outputWindow = null;
    }
    app.quit();
  });
}

async function createOutputWindow(displayId) {
  if (outputWindow && !outputWindow.isDestroyed()) {
    outputWindow.close();
    outputWindow = null;
  }

  const displays = screen.getAllDisplays();
  const target = displays.find((d) => d.id === displayId) || displays.find((d) => !d.isPrimary) || displays[0];
  if (!target) {
    studioWindow?.webContents.send('output:error', `Target display ${displayId} not found`);
    return;
  }

  outputWindow = new BrowserWindow({
    x: target.bounds.x,
    y: target.bounds.y,
    width: target.bounds.width,
    height: target.bounds.height,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#000000',
    title: 'Wallboard Projector Output',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  });

  outputWindow.setBounds(target.bounds);
  outputWindow.setBackgroundColor('#000000');
  const url = await getOutputUrl();
  outputWindow.loadURL(url);

  outputWindow.once('ready-to-show', () => {
    outputWindow.setBounds(target.bounds);
    outputWindow.show();
    outputWindow.setAlwaysOnTop(true, 'screen-saver');

    studioWindow?.webContents.send('output:opened', {
      displayId: target.id,
      label: target.label,
      width: target.size.width,
      height: target.size.height
    });
  });

  outputWindow.on('closed', () => {
    outputWindow = null;
    studioWindow?.webContents.send('output:closed');
  });
}

function closeOutputWindow() {
  if (outputWindow && !outputWindow.isDestroyed()) {
    outputWindow.close();
    outputWindow = null;
  }
}

// IPC Handlers
ipcMain.handle('displays:list', () => getDisplayList());

ipcMain.on('output:open', (_event, displayId) => {
  createOutputWindow(displayId);
});

ipcMain.on('output:close', () => {
  closeOutputWindow();
});

ipcMain.handle('output:is-open', () => {
  return outputWindow !== null && !outputWindow.isDestroyed();
});

// App Lifecycle
Menu.setApplicationMenu(null);

app.whenReady().then(async () => {
  ensureServerRunning();
  await createStudioWindow();

  screen.on('display-added', () => {
    studioWindow?.webContents.send('displays:changed', getDisplayList());
  });

  screen.on('display-removed', () => {
    studioWindow?.webContents.send('displays:changed', getDisplayList());
    if (outputWindow && !outputWindow.isDestroyed()) {
      const displays = screen.getAllDisplays();
      const outputBounds = outputWindow.getBounds();
      const stillExists = displays.some(
        (d) => d.bounds.x === outputBounds.x && d.bounds.y === outputBounds.y
      );
      if (!stillExists) {
        closeOutputWindow();
      }
    }
  });

  screen.on('display-metrics-changed', () => {
    studioWindow?.webContents.send('displays:changed', getDisplayList());
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    try { serverProcess.kill(); } catch {}
  }
  app.quit();
});
