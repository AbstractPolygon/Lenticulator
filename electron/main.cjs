// Electron entry point: serves the built web app from a privileged app:// scheme
// (so module workers, fetch and blob URLs behave exactly as on the web).
const { app, BrowserWindow, Menu, ipcMain, net, protocol, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
// sample images are not packaged; they're downloaded on request from the web app's copy
const SAMPLES_URL = 'https://abstractpolygon.github.io/Lenticulator/app/samples/';
const samplesDir = () => path.join(app.getPath('userData'), 'samples');

// resolve rel inside root, or null if it would escape (a bare prefix check would also accept siblings)
function inside(root, rel) {
  const file = path.normalize(path.join(root, rel));
  const r = path.relative(root, file);
  return !r || r.startsWith('..') || path.isAbsolute(r) ? null : file;
}

async function downloadSamples(sender) {
  const get = async (rel) => {
    const res = await net.fetch(SAMPLES_URL + rel);
    if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
  const manifest = await get('index.json');
  const { samples } = JSON.parse(manifest.toString('utf8'));
  const files = samples.flatMap((s) => s.files.map((f) => `${s.id}/${f}`));
  const dest = samplesDir();
  const tmp = `${dest}.part`;
  await fs.promises.rm(tmp, { recursive: true, force: true });
  let done = 0;
  const queue = [...files];
  const worker = async () => {
    for (let rel; (rel = queue.shift()); ) {
      const file = inside(tmp, rel);
      if (!file) throw new Error(`Bad sample path: ${rel}`);
      const data = await get(rel);
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, data);
      if (!sender.isDestroyed()) sender.send('samples:progress', ++done, files.length);
    }
  };
  try {
    await Promise.all(Array.from({ length: 6 }, worker));
    await fs.promises.writeFile(path.join(tmp, 'index.json'), manifest); // written last: marks a complete set
    await fs.promises.rm(dest, { recursive: true, force: true });
    await fs.promises.rename(tmp, dest);
  } catch (e) {
    await fs.promises.rm(tmp, { recursive: true, force: true });
    throw e;
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Lenticulator',
    backgroundColor: '#15161a',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // open external links in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://') && !(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault();
  });
  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadURL('app://lenticulator/index.html');
  return win;
}

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    const file = rel.startsWith('samples/') ? inside(samplesDir(), rel.slice(8)) : inside(DIST, rel);
    if (!file) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  ipcMain.handle('samples:installed', () => fs.existsSync(path.join(samplesDir(), 'index.json')));
  ipcMain.handle('samples:download', (e) => downloadSamples(e.sender));
  ipcMain.handle('samples:remove', () => fs.promises.rm(samplesDir(), { recursive: true, force: true }));

  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu' }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [
          { label: 'Project on GitHub', click: () => shell.openExternal('https://github.com/AbstractPolygon/Lenticulator') },
        ],
      },
    ]),
  );

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
