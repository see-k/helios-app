const { app, BrowserWindow, ipcMain, nativeTheme, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const database = require('./database');

// Load .env from project root
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    transparent: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 18 },
    backgroundColor: '#0a0a0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../../assets/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Open DevTools in dev mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC handlers
ipcMain.handle('get-theme', () => {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
});

ipcMain.handle('toggle-theme', (event, theme) => {
  nativeTheme.themeSource = theme;
  return theme;
});

ipcMain.handle('get-env', (event, key) => {
  // Only expose whitelisted keys
  const allowed = ['GOOGLE_MAPS_API_KEY', 'GEMINI_API_KEY'];
  if (allowed.includes(key)) {
    return process.env[key] || '';
  }
  return '';
});

ipcMain.on('window-minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('window-close', () => {
  mainWindow?.close();
});

ipcMain.handle('export-pdf', async () => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Flight Report',
      defaultPath: `Helios-Flight-Report-${new Date().toISOString().slice(0, 10)}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return { success: false, reason: 'cancelled' };
    const pdfData = await mainWindow.webContents.printToPDF({
      printBackground: true,
      landscape: true,
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
    });
    fs.writeFileSync(filePath, pdfData);
    return { success: true, path: filePath };
  } catch (err) {
    return { success: false, reason: err.message };
  }
});

ipcMain.handle('open-file', async (event, { title, filters }) => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Open File',
      filters: filters || [{ name: 'All Files', extensions: ['*'] }],
      properties: ['openFile']
    });
    if (canceled || !filePaths.length) return { success: false, reason: 'cancelled' };
    const content = fs.readFileSync(filePaths[0], 'utf-8');
    return { success: true, path: filePaths[0], content };
  } catch (err) {
    return { success: false, reason: err.message };
  }
});

ipcMain.handle('save-file', async (event, { content, defaultName, filters }) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save File',
      defaultPath: defaultName || 'file.txt',
      filters: filters || [{ name: 'All Files', extensions: ['*'] }]
    });
    if (canceled || !filePath) return { success: false, reason: 'cancelled' };
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true, path: filePath };
  } catch (err) {
    return { success: false, reason: err.message };
  }
});

// ── Fleet / Drone connection test ──
ipcMain.handle('fleet-test-connection', async (event, hostname) => {
  const http = require('http');
  const url = `http://${hostname}:5000/api/status`;
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        resolve({ success: res.statusCode === 200, statusCode: res.statusCode, body });
      });
    });
    req.on('error', (err) => resolve({ success: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Connection timed out' }); });
  });
});

// ── Fleet / Drone CRUD IPC ──
ipcMain.handle('fleet-get-all', () => database.getAllDrones());
ipcMain.handle('fleet-get', (event, id) => database.getDroneById(id));
ipcMain.handle('fleet-add', (event, data) => database.addDrone(data));
ipcMain.handle('fleet-update', (event, id, data) => database.updateDrone(id, data));
ipcMain.handle('fleet-delete', (event, id) => database.deleteDrone(id));
ipcMain.handle('fleet-ping', (event, id) => database.pingDrone(id));

app.whenReady().then(() => {
  database.initDatabase();
  createWindow();
});

app.on('window-all-closed', () => {
  database.closeDatabase();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
