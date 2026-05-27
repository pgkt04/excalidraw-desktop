const { app, BrowserWindow, Menu, Notification, dialog, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const GITHUB_OWNER = 'pprol';
const GITHUB_REPO = 'spotify-desktop';
const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const RELEASES_PAGE_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const UPDATE_STATE_FILE = 'update-state.json';
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const WINDOW_STATE_FILE = 'window-state.json';
const DEFAULT_WINDOW_BOUNDS = { width: 1300, height: 900 };

let updateCheckPromise = null;

function normalizeVersion(version) {
  return String(version || '')
    .replace(/^v\.?/i, '')
    .split('-')[0];
}

function compareVersions(a, b) {
  const left = normalizeVersion(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = normalizeVersion(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i++) {
    if ((left[i] || 0) > (right[i] || 0)) return 1;
    if ((left[i] || 0) < (right[i] || 0)) return -1;
  }

  return 0;
}

function getUpdateStatePath() {
  return path.join(app.getPath('userData'), UPDATE_STATE_FILE);
}

function loadUpdateState() {
  try {
    return JSON.parse(fs.readFileSync(getUpdateStatePath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveUpdateState(state) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(getUpdateStatePath(), JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('Failed to save update state:', err);
  }
}

function getWindowStatePath() {
  return path.join(app.getPath('userData'), WINDOW_STATE_FILE);
}

function boundsIntersect(bounds, workArea) {
  return (
    bounds.x < workArea.x + workArea.width &&
    bounds.x + bounds.width > workArea.x &&
    bounds.y < workArea.y + workArea.height &&
    bounds.y + bounds.height > workArea.y
  );
}

function isValidWindowBounds(bounds) {
  if (!bounds) return false;

  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Number.isFinite(bounds[key])) return false;
  }

  if (bounds.width <= 0 || bounds.height <= 0) return false;

  return screen.getAllDisplays().some((display) => boundsIntersect(bounds, display.workArea));
}

function loadWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(getWindowStatePath(), 'utf8'));
    if (isValidWindowBounds(state.bounds)) return state;
  } catch {
    // Missing or invalid state should fall back to Electron's centered default.
  }
  return {};
}

function saveWindowState(win) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(
      getWindowStatePath(),
      JSON.stringify(
        {
          bounds: win.getNormalBounds(),
          isMaximized: win.isMaximized(),
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error('Failed to save window state:', err);
  }
}

async function fetchLatestRelease() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(RELEASES_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`GitHub release check failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function showUpdateNotification(release) {
  if (!Notification.isSupported()) return false;

  const latestVersion = normalizeVersion(release.tag_name);
  const notification = new Notification({
    title: `Electronfy ${latestVersion} available`,
    body: `Current version ${app.getVersion()}. Click to open release page.`,
  });

  notification.once('click', () => {
    void shell.openExternal(release.html_url || RELEASES_PAGE_URL).catch((err) => {
      console.error('Failed to open release page:', err);
    });
  });

  notification.show();
  return true;
}

function showUpdateDialog(release) {
  const latestVersion = normalizeVersion(release.tag_name);
  dialog
    .showMessageBox({
      type: 'info',
      title: `Electronfy ${latestVersion} available`,
      message: `Electronfy ${latestVersion} is available.`,
      detail: `Current version ${app.getVersion()}.`,
      buttons: ['Open Release', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    })
    .then(({ response }) => {
      if (response === 0) {
        return shell.openExternal(release.html_url || RELEASES_PAGE_URL);
      }
      return undefined;
    })
    .catch((err) => {
      console.error('Failed to show update dialog:', err);
    });
}

function showNoUpdateDialog() {
  void dialog
    .showMessageBox({
      type: 'info',
      title: 'No Updates Available',
      message: 'Electronfy is up to date.',
      detail: `Current version ${app.getVersion()}.`,
      buttons: ['OK'],
    })
    .catch((err) => {
      console.error('Failed to show update dialog:', err);
    });
}

async function checkForUpdates({ force = false } = {}) {
  if (updateCheckPromise && !force) return updateCheckPromise;
  if (!force && !app.isPackaged) return;

  updateCheckPromise = (async () => {
    const state = loadUpdateState();
    const now = Date.now();

    if (!force && state.lastCheckAt && now - state.lastCheckAt < UPDATE_CHECK_INTERVAL_MS) {
      return;
    }

    try {
      const release = await fetchLatestRelease();
      const latestVersion = normalizeVersion(release.tag_name);
      const currentVersion = normalizeVersion(app.getVersion());

      if (!latestVersion || compareVersions(latestVersion, currentVersion) <= 0) {
        if (force) {
          showNoUpdateDialog();
        }
        saveUpdateState({
          ...state,
          lastCheckAt: now,
        });
        return;
      }

      if (!force && state.lastNotifiedVersion === latestVersion) {
        saveUpdateState({
          ...state,
          lastCheckAt: now,
        });
        return;
      }

      const notified = force ? true : showUpdateNotification(release);
      if (force) {
        showUpdateDialog(release);
      }
      saveUpdateState({
        ...state,
        lastCheckAt: now,
        lastNotifiedVersion: notified ? latestVersion : state.lastNotifiedVersion,
        lastNotifiedAt: notified ? now : state.lastNotifiedAt,
      });
    } catch (err) {
      console.error('Update check failed:', err);
      if (force) {
        dialog.showErrorBox('Update Check Failed', err.message || String(err));
      }
      saveUpdateState({
        ...state,
        lastCheckAt: now,
      });
    }
  })().finally(() => {
    updateCheckPromise = null;
  });

  return updateCheckPromise;
}

function createWindow() {
  const windowState = loadWindowState();
  const win = new BrowserWindow({
    ...DEFAULT_WINDOW_BOUNDS,
    ...windowState.bounds,
    webPreferences: {
      nodeIntegration: true,
    },
  });

  if (windowState.isMaximized) {
    win.maximize();
  }

  win.on('close', () => {
    saveWindowState(win);
  });

  win.loadURL('https://open.spotify.com/');

  // Hide menu bar visually for Windows and Linux, but keep keyboard shortcuts working
  if (process.platform === 'win32' || process.platform === 'linux') {
    win.setMenuBarVisibility(false);
    win.setAutoHideMenuBar(true);
  }

  return win;
}

// Request single instance lock so second-instance events work
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running; it will handle the second-instance event.
  // We quit this instance.
  app.quit();
} else {
  app.whenReady().then(() => {
    createWindow();
    // Silent startup check for packaged app only.
    void checkForUpdates();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const template = [
  ...(process.platform === 'darwin'
    ? [
        {
          label: 'Electronfy',
          submenu: [
            { role: 'about' },
            {
              label: 'Check for Updates...',
              accelerator: 'CmdOrCtrl+Shift+U',
              click: () => {
                void checkForUpdates({ force: true });
              },
            },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
      ]
    : []),
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  },
  {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  },
  {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'separator' },
      { role: 'close' },
    ],
  },
  ...(process.platform === 'darwin'
    ? []
    : [
        {
          label: 'Help',
          submenu: [
            {
              label: 'Check for Updates...',
              accelerator: 'CmdOrCtrl+Shift+U',
              click: () => {
                void checkForUpdates({ force: true });
              },
            },
          ],
        },
      ]),
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);
