const { app, BrowserWindow, WebContentsView, Menu, Notification, dialog, screen, shell, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GITHUB_OWNER = 'pgkt04';
const GITHUB_REPO = 'excalidraw-desktop';
const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const RELEASES_PAGE_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const UPDATE_STATE_FILE = 'update-state.json';
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const WINDOW_STATE_FILE = 'window-state.json';
const WORKSPACE_STATE_FILE = 'workspace-state.json';
const DEFAULT_WINDOW_BOUNDS = { width: 1300, height: 900 };
const SIDEBAR_WIDTH = 260;
const SIDEBAR_COLLAPSED_WIDTH = 28;

// Track file paths requested before the app is ready (macOS open-file can fire early)
let pendingFilePath = null;
let updateCheckPromise = null;

// Per-window state: { win, contentView, sidebarView, sidebarVisible, workspaceDir, currentFilePath, lastSavedSnapshotHash, forceClosing }
const windowState = new Map();
// Per-directory watchers, refcounted across windows: dir -> { watcher, subscribers: Set<winId>, debounceTimer }
const workspaceWatchers = new Map();
// In-flight New File dialogs, keyed by the dialog window's webContents.id: -> { resolve, existingNames }
const pendingNewFileDialogs = new Map();

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

function getWorkspaceStatePath() {
  return path.join(app.getPath('userData'), WORKSPACE_STATE_FILE);
}

function loadWorkspaceState() {
  try {
    return JSON.parse(fs.readFileSync(getWorkspaceStatePath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveWorkspaceState(state) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(getWorkspaceStatePath(), JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('Failed to save workspace state:', err);
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
    title: `Excalidraw ${latestVersion} available`,
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
      title: `Excalidraw ${latestVersion} available`,
      message: `Excalidraw ${latestVersion} is available.`,
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
      message: 'Excalidraw is up to date.',
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

// Parse a file path from argv (skip electron/app executable entries)
function getFilePathFromArgv(argv) {
  // In packaged app: argv = [appPath, ...args]
  // In dev (npm start): argv = [electron, '.', ...args]
  // We look for an argument ending in .excalidraw
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg && !arg.startsWith('-') && arg.endsWith('.excalidraw')) {
      const resolved = path.resolve(arg);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }
  }
  return null;
}

function hashData(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

function contentWebContentsFor(win) {
  const state = windowState.get(win.id);
  return state ? state.contentView.webContents : win.webContents;
}

// executeJavaScript() can occasionally never settle (neither resolve nor reject) —
// e.g. when called in close proximity to another in-flight call on the same
// webContents, such as right after a reload triggered by loadFileIntoWindow.
// Race it against a timeout so callers never hang indefinitely.
function withTimeout(promise, ms, onTimeoutMessage) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.error(onTimeoutMessage);
      resolve(undefined);
    }, ms);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.error(onTimeoutMessage, err);
        resolve(undefined);
      },
    );
  });
}

// Read the current canvas state out of the loaded excalidraw.com page's own
// localStorage (the same keys it already persists itself as the user draws).
async function readCanvasStateFromWindow(win) {
  const result = await withTimeout(
    contentWebContentsFor(win).executeJavaScript(`
      (function() {
        try {
          return {
            elements: JSON.parse(localStorage.getItem('excalidraw') || '[]'),
            appState: JSON.parse(localStorage.getItem('excalidraw-state') || '{}'),
            files: JSON.parse(localStorage.getItem('excalidraw-files') || '{}'),
          };
        } catch (e) {
          return null;
        }
      })();
    `),
    8000,
    'Timed out or failed reading canvas state from content view:',
  );
  return result === undefined ? null : result;
}

// Dirty-comparison hash deliberately covers only elements + files (the actual
// drawing content), not appState — appState carries ephemeral UI/view state
// (scroll position, zoom, welcome-screen flags, etc.) that Excalidraw mutates
// on its own even with zero user edits, which caused false-positive "unsaved
// changes" prompts when it was included.
function hashContent(data) {
  return hashData({ elements: data.elements, files: data.files });
}

async function hashCanvasState(win) {
  const data = await readCanvasStateFromWindow(win);
  if (data === null) return null;
  return hashContent(data);
}

// Right after a fresh load/reload, excalidraw.com's own app can still be
// restoring/normalizing elements and re-writing them to localStorage via its
// debounced autosave for a brief moment after 'did-finish-load' fires. Hashing
// immediately can capture a pre-normalization snapshot as the baseline, which
// will then never match the (already-normalized) live state read on the next
// dirty-check — a false-positive "unsaved changes" prompt on the very next
// file switch. Poll until two consecutive reads agree (or give up) so the
// baseline reflects the settled state.
async function waitForStableCanvasHash(win, { intervalMs = 150, maxWaitMs = 1500 } = {}) {
  let previous = await hashCanvasState(win);
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const current = await hashCanvasState(win);
    if (current === previous) return current;
    previous = current;
  }

  return previous;
}

async function hasUnsavedChanges(win) {
  const state = windowState.get(win.id);
  if (!state) return false;

  const data = await readCanvasStateFromWindow(win);
  if (data === null) return false;

  if (state.lastSavedSnapshotHash === null) {
    // Never saved yet: only consider it dirty if there's actually something drawn.
    return Array.isArray(data.elements) && data.elements.length > 0;
  }

  return hashContent(data) !== state.lastSavedSnapshotHash;
}

// Read a .excalidraw file and inject its contents into the content view via localStorage.
// Low-level: does not perform any dirty-check. Use openFileInWindow() for that.
function loadFileIntoWindow(win, filePath) {
  const contentWebContents = contentWebContentsFor(win);

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(safetyTimer);
      resolve(value);
    };
    // Defensive fallback in case 'did-finish-load' never fires after reload()
    // for some unforeseen reason — without this, the IPC call awaiting this
    // promise (Save/Open from the sidebar or menu) would hang forever.
    const safetyTimer = setTimeout(() => {
      console.error('Timed out waiting for content view to reload:', filePath);
      settle(false);
    }, 15000);

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);

      const elements = data.elements || [];
      const appState = data.appState || {};
      const files = data.files || {};

      // Note: we deliberately don't gate this on contentWebContents.isLoading() —
      // it can still report true from inside a 'did-finish-load' handler (the very
      // callers of this function), which would wait on a second did-finish-load
      // that never fires. executeJavaScript works fine as soon as the DOM/localStorage
      // exist, and the reload() below re-reads whatever we just set regardless.
      //
      // excalidraw.com flushes its own pending debounced autosave synchronously
      // on 'beforeunload'/'unload' (LocalData.flushSave() in its App.tsx), which
      // fires the instant reload() below starts navigating away — i.e. strictly
      // AFTER we've written here. If a save was still pending (which is common,
      // since its debounce resets on nearly any interaction, including moving
      // the mouse toward the button that got us here), that flush silently
      // overwrites what we just wrote with stale pre-navigation elements/appState.
      // No delay before writing can avoid this, since the flush is triggered by
      // navigating away, not by a fixed timer. So instead we neutralize further
      // localStorage writes right after our own, making that flush a no-op —
      // excalidraw.com calls localStorage.setItem() directly (not a cached
      // reference), so overriding it here reliably intercepts it.
      contentWebContents
        .executeJavaScript(`
          try {
            const setItem = Storage.prototype.setItem.bind(localStorage);
            localStorage.setItem = function () {};
            setItem("excalidraw", JSON.stringify(${JSON.stringify(elements)}));
            setItem("excalidraw-state", JSON.stringify(${JSON.stringify(appState)}));
            setItem("excalidraw-files", JSON.stringify(${JSON.stringify(files)}));
            true;
          } catch(e) {
            console.error("Failed to inject excalidraw data:", e);
            false;
          }
        `)
        .then(() => {
          contentWebContents.once('did-finish-load', async () => {
            const state = windowState.get(win.id);
            if (state) {
              state.currentFilePath = filePath;
              state.lastSavedSnapshotHash = await waitForStableCanvasHash(win);
              win.setTitle(`${path.basename(filePath)} — Excalidraw`);
              notifyCurrentFileChanged(win);
            }
            settle(true);
          });
          contentWebContents.reload();
        })
        .catch((err) => {
          console.error('Failed to inject .excalidraw file into content view:', err);
          settle(false);
        });
    } catch (err) {
      console.error('Failed to load .excalidraw file:', err);
      settle(false);
    }
  });
}

// High-level open: checks for unsaved changes first, then reuses loadFileIntoWindow.
async function openFileInWindow(win, filePath) {
  if (!win || !filePath) return false;

  if (await hasUnsavedChanges(win)) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Do you want to save the changes you made?',
      detail: "Your changes will be lost if you don't save them.",
    });

    if (response === 2) return false; // Cancel
    if (response === 0) {
      const saved = await saveCurrentWindow(win);
      if (!saved) return false;
    }
  }

  return loadFileIntoWindow(win, filePath);
}

async function writeCanvasToFile(targetPath, data) {
  const payload = {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: data.elements,
    appState: data.appState,
    files: data.files,
  };
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2));
}

async function saveCurrentWindow(win) {
  const state = windowState.get(win.id);
  if (!state) return false;

  if (!state.currentFilePath) {
    return saveAsCurrentWindow(win);
  }

  const data = await readCanvasStateFromWindow(win);
  if (!data) {
    dialog.showErrorBox('Save Failed', 'Could not read the current drawing state.');
    return false;
  }

  try {
    await writeCanvasToFile(state.currentFilePath, data);
    state.lastSavedSnapshotHash = hashContent(data);
    refreshFileList(win);
    return true;
  } catch (err) {
    dialog.showErrorBox('Save Failed', err.message || String(err));
    return false;
  }
}

async function saveAsCurrentWindow(win) {
  const state = windowState.get(win.id);
  if (!state) return false;

  const defaultDir = state.workspaceDir || app.getPath('documents');
  const { canceled, filePath: chosenPath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(defaultDir, 'Untitled.excalidraw'),
    filters: [{ name: 'Excalidraw Files', extensions: ['excalidraw'] }],
  });

  if (canceled || !chosenPath) return false;

  const data = await readCanvasStateFromWindow(win);
  if (!data) {
    dialog.showErrorBox('Save Failed', 'Could not read the current drawing state.');
    return false;
  }

  try {
    await writeCanvasToFile(chosenPath, data);
    state.currentFilePath = chosenPath;
    state.lastSavedSnapshotHash = hashContent(data);
    win.setTitle(`${path.basename(chosenPath)} — Excalidraw`);
    notifyCurrentFileChanged(win);

    const chosenDir = path.dirname(chosenPath);
    if (chosenDir !== state.workspaceDir) {
      setWorkspace(win, chosenDir);
      saveWorkspaceState({ ...loadWorkspaceState(), lastWorkspaceDir: chosenDir });
    } else {
      refreshFileList(win);
    }
    return true;
  } catch (err) {
    dialog.showErrorBox('Save Failed', err.message || String(err));
    return false;
  }
}

function scanWorkspaceFiles(dir) {
  if (!dir) return [];
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.excalidraw'))
      .map((entry) => {
        const filePath = path.join(dir, entry.name);
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(filePath).mtimeMs;
        } catch {
          // Ignore races with concurrent deletion.
        }
        return { path: filePath, mtimeMs };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
  } catch (err) {
    console.error('Failed to scan workspace folder:', err);
    return [];
  }
}

function notifyFilesChanged(win) {
  const state = windowState.get(win.id);
  if (!state) return;
  state.sidebarView.webContents.send('workspace:filesChanged', scanWorkspaceFiles(state.workspaceDir));
}

function notifyWorkspaceChanged(win) {
  const state = windowState.get(win.id);
  if (!state) return;
  state.sidebarView.webContents.send('workspace:changed', state.workspaceDir);
}

function notifyCurrentFileChanged(win) {
  const state = windowState.get(win.id);
  if (!state) return;
  state.sidebarView.webContents.send('workspace:currentFileChanged', state.currentFilePath);
}

function refreshFileList(win) {
  notifyFilesChanged(win);
}

function debounceRefresh(dir, entry) {
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = null;
    for (const winId of entry.subscribers) {
      const state = windowState.get(winId);
      if (state) notifyFilesChanged(state.win);
    }
  }, 200);
}

function watchWorkspace(dir, winId) {
  if (!dir) return;

  const existing = workspaceWatchers.get(dir);
  if (existing) {
    existing.subscribers.add(winId);
    return;
  }

  const entry = { subscribers: new Set([winId]), debounceTimer: null, watcher: null };
  try {
    entry.watcher = fs.watch(dir, { persistent: true }, () => debounceRefresh(dir, entry));
  } catch (err) {
    console.error('Failed to watch workspace folder:', err);
  }
  workspaceWatchers.set(dir, entry);
}

function unwatchWorkspace(dir, winId) {
  if (!dir) return;
  const entry = workspaceWatchers.get(dir);
  if (!entry) return;

  entry.subscribers.delete(winId);
  if (entry.subscribers.size === 0) {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    if (entry.watcher) entry.watcher.close();
    workspaceWatchers.delete(dir);
  }
}

function setWorkspace(win, dir) {
  const state = windowState.get(win.id);
  if (!state) return;

  if (state.workspaceDir && state.workspaceDir !== dir) {
    unwatchWorkspace(state.workspaceDir, win.id);
  }

  state.workspaceDir = dir || null;

  if (state.workspaceDir) {
    watchWorkspace(state.workspaceDir, win.id);
  }

  notifyWorkspaceChanged(win);
  notifyFilesChanged(win);
}

async function chooseWorkspaceFolder(win) {
  if (!win) return;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
  });
  if (canceled || !filePaths || !filePaths[0]) return;

  const dir = filePaths[0];
  setWorkspace(win, dir);
  saveWorkspaceState({ ...loadWorkspaceState(), lastWorkspaceDir: dir });
}

async function openFileDialogInWindow(win) {
  if (!win) return;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Excalidraw Files', extensions: ['excalidraw'] }],
  });
  if (canceled || !filePaths[0]) return;
  await openFileInWindow(win, filePaths[0]);
}

const ILLEGAL_FILENAME_CHARS_REGEX = /[\\/:*?"<>|\x00-\x1F]/g;
const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);
const MAX_BASENAME_LENGTH = 150;

// Includes time down to the second so repeated "New File" calls in the same
// minute (e.g. blank-name submits) don't collide and fall through to the
// " (2)", " (3)", ... suffix.
function formatDateForFilename(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

// Sanitizes a user-supplied base name (no extension) for use as a filename.
// Returns '' if nothing usable remains; callers decide the fallback.
function sanitizeBaseName(name) {
  let result = String(name || '').replace(ILLEGAL_FILENAME_CHARS_REGEX, '');
  result = result.replace(/\.excalidraw$/i, '');
  // Windows silently drops trailing dots/spaces from the actual filename on disk,
  // which would otherwise desync what's shown from what's created.
  result = result.trim().replace(/[. ]+$/, '');
  if (!result) return '';
  if (WINDOWS_RESERVED_NAMES.has(result.toUpperCase())) return '';
  return result.slice(0, MAX_BASENAME_LENGTH);
}

function ensureExcalidrawExtension(name) {
  return name.endsWith('.excalidraw') ? name : `${name}.excalidraw`;
}

function computeNewFilePath(dir, baseName) {
  const sanitized = sanitizeBaseName(baseName) || 'Untitled';
  let candidate = path.join(dir, ensureExcalidrawExtension(sanitized));
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${sanitized} (${counter}).excalidraw`);
    counter += 1;
  }
  return candidate;
}

// Shows a small modal BrowserWindow prompting for a new file's base name.
// Resolves the entered name, or null if the dialog was cancelled/closed.
function promptForNewFileName(parentWin, defaultName, existingNames) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const dialogWin = new BrowserWindow({
      width: 420,
      height: 220,
      resizable: false,
      minimizable: false,
      maximizable: false,
      modal: true,
      parent: parentWin,
      show: false,
      title: 'New File',
      webPreferences: {
        preload: path.join(__dirname, 'dialogs', 'new-file-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // Windows/Linux would otherwise inherit the app's full menu bar on this tiny window.
    dialogWin.setMenu(null);

    // Captured up front: by the time 'closed' fires, dialogWin.webContents has
    // already been destroyed, so re-reading .webContents.id there throws.
    const webContentsId = dialogWin.webContents.id;
    pendingNewFileDialogs.set(webContentsId, { resolve: settle, existingNames });

    dialogWin.on('closed', () => {
      pendingNewFileDialogs.delete(webContentsId);
      settle(null);
    });

    dialogWin.once('ready-to-show', () => dialogWin.show());

    dialogWin.loadFile(path.join(__dirname, 'dialogs', 'new-file-dialog.html'), {
      query: { default: defaultName },
    });
  });
}

async function createNewFileInWindow(win) {
  const state = windowState.get(win.id);
  if (!state || !state.workspaceDir) return false;

  const defaultName = `drawing_${formatDateForFilename()}`;
  const existingNames = fs
    .readdirSync(state.workspaceDir)
    .filter((f) => f.endsWith('.excalidraw'))
    .map((f) => f.slice(0, -'.excalidraw'.length).toLowerCase());
  const inputName = await promptForNewFileName(win, defaultName, existingNames);
  if (inputName === null) return false; // user cancelled

  const baseName = inputName.trim() || defaultName;
  const newPath = computeNewFilePath(state.workspaceDir, baseName);
  const skeleton = {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [],
    appState: {},
    files: {},
  };

  try {
    fs.writeFileSync(newPath, JSON.stringify(skeleton, null, 2));
  } catch (err) {
    dialog.showErrorBox('New File Failed', err.message || String(err));
    return false;
  }

  refreshFileList(win);
  return openFileInWindow(win, newPath);
}

function sanitizeFileName(name) {
  const sanitized = sanitizeBaseName(name);
  if (!sanitized) return '';
  return ensureExcalidrawExtension(sanitized);
}

async function renameFileInWindow(win, oldPath, newName) {
  const state = windowState.get(win.id);
  if (!state || !state.workspaceDir) return false;

  const sanitized = sanitizeFileName(newName);
  if (!sanitized || sanitized === '.excalidraw') return false;

  const newPath = path.join(state.workspaceDir, sanitized);
  if (newPath === oldPath) return true;

  // On case-insensitive filesystems (macOS/Windows) a case-only rename makes
  // existsSync(newPath) match the file being renamed itself — allow that case
  // through so users can fix capitalization.
  const isCaseOnlyRename = newPath.toLowerCase() === oldPath.toLowerCase();
  if (!isCaseOnlyRename && fs.existsSync(newPath)) {
    dialog.showErrorBox('Rename Failed', `A file named "${sanitized}" already exists.`);
    return false;
  }

  try {
    fs.renameSync(oldPath, newPath);
  } catch (err) {
    dialog.showErrorBox('Rename Failed', err.message || String(err));
    return false;
  }

  if (state.currentFilePath === oldPath) {
    state.currentFilePath = newPath;
    win.setTitle(`${path.basename(newPath)} — Excalidraw`);
    notifyCurrentFileChanged(win);
  }

  refreshFileList(win);
  return true;
}

async function deleteFileInWindow(win, filePath) {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Move to Trash', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: `Delete "${path.basename(filePath)}"?`,
    detail: 'The file will be moved to the trash.',
  });
  if (response !== 0) return false;

  try {
    await shell.trashItem(filePath);
  } catch (err) {
    dialog.showErrorBox('Delete Failed', err.message || String(err));
    return false;
  }

  const state = windowState.get(win.id);
  if (state) {
    if (state.currentFilePath === filePath) {
      state.currentFilePath = null;
      win.setTitle('Excalidraw');
      notifyCurrentFileChanged(win);
    }
    refreshFileList(win);
  }
  return true;
}

function layoutViews(win) {
  const state = windowState.get(win.id);
  if (!state) return;

  const { width, height } = win.getContentBounds();
  const sidebarWidth = state.sidebarVisible ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH;

  state.sidebarView.setBounds({ x: 0, y: 0, width: sidebarWidth, height });
  state.contentView.setBounds({ x: sidebarWidth, y: 0, width: Math.max(0, width - sidebarWidth), height });
}

function toggleSidebar(win) {
  if (!win) return;
  const state = windowState.get(win.id);
  if (!state) return;

  state.sidebarVisible = !state.sidebarVisible;

  layoutViews(win);
  state.sidebarView.webContents.send('sidebar:collapsedChanged', !state.sidebarVisible);
  saveWorkspaceState({ ...loadWorkspaceState(), sidebarVisible: state.sidebarVisible });
}

function createWindow(filePath) {
  const savedWindowState = loadWindowState();
  const workspacePrefs = loadWorkspaceState();

  const win = new BrowserWindow({
    ...DEFAULT_WINDOW_BOUNDS,
    ...savedWindowState.bounds,
  });

  if (savedWindowState.isMaximized) {
    win.maximize();
  }

  const contentView = new WebContentsView({
    webPreferences: {
      nodeIntegration: true,
    },
  });

  const sidebarView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'sidebar', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const sidebarVisible = workspacePrefs.sidebarVisible !== false;

  windowState.set(win.id, {
    win,
    contentView,
    sidebarView,
    sidebarVisible,
    workspaceDir: null,
    currentFilePath: null,
    lastSavedSnapshotHash: null,
    forceClosing: false,
  });

  // Intercept Ctrl+S at the webContents level: on Linux/Windows the menu bar is
  // hidden, which breaks Electron's menu-accelerator dispatch, so CmdOrCtrl+S
  // would otherwise fall through to excalidraw.com's own Ctrl+S handler.
  const handleSaveShortcut = (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    if (!(input.control || input.meta) || input.alt) return;
    if (input.key.toLowerCase() !== 's') return;

    event.preventDefault();
    if (input.shift) {
      void saveAsCurrentWindow(win);
    } else {
      void saveCurrentWindow(win);
    }
  };

  contentView.webContents.on('before-input-event', handleSaveShortcut);
  sidebarView.webContents.on('before-input-event', handleSaveShortcut);

  win.contentView.addChildView(sidebarView);
  win.contentView.addChildView(contentView);

  sidebarView.webContents.loadFile(path.join(__dirname, 'sidebar', 'index.html'));
  contentView.webContents.loadURL('https://excalidraw.com/');

  layoutViews(win);
  win.on('resize', () => layoutViews(win));

  // Hide menu bar visually for Windows and Linux, but still keeps keyboard shortcuts working
  if (process.platform === 'win32' || process.platform === 'linux') {
    win.setMenuBarVisibility(false);
    win.setAutoHideMenuBar(false);
  }

  const initialWorkspaceDir = filePath
    ? path.dirname(filePath)
    : workspacePrefs.lastWorkspaceDir && fs.existsSync(workspacePrefs.lastWorkspaceDir)
      ? workspacePrefs.lastWorkspaceDir
      : null;

  setWorkspace(win, initialWorkspaceDir);

  // If a file was requested, load it once the page is ready
  if (filePath) {
    contentView.webContents.once('did-finish-load', () => {
      loadFileIntoWindow(win, filePath);
    });
  } else {
    // A brand-new window with no file yet still loads excalidraw.com's last
    // persisted localStorage content — it's the same session/profile shared
    // across windows and app restarts, so leftover elements from a previous
    // drawing can still be sitting there. Since no file is loaded yet,
    // hasUnsavedChanges() falls into its "never saved" check (elements.length
    // > 0), which would then see that leftover content and show a
    // false-positive save prompt the first time this window opens/creates a
    // file, even though nothing was drawn here. Clear it so a fresh window
    // actually starts blank.
    contentView.webContents.once('did-finish-load', () => {
      contentView.webContents.executeJavaScript(`
        try {
          localStorage.setItem("excalidraw", "[]");
          localStorage.setItem("excalidraw-state", "{}");
          localStorage.setItem("excalidraw-files", "{}");
        } catch (e) {}
      `);
    });
  }

  contentView.webContents.once('did-finish-load', () => {
    contentView.webContents.focus();
  });

  win.on('close', (event) => {
    const state = windowState.get(win.id);
    if (!state || state.forceClosing) {
      return;
    }

    event.preventDefault();

    (async () => {
      if (await hasUnsavedChanges(win)) {
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning',
          buttons: ['Save', "Don't Save", 'Cancel'],
          defaultId: 0,
          cancelId: 2,
          message: 'Do you want to save the changes you made?',
          detail: "Your changes will be lost if you don't save them.",
        });

        if (response === 2) return; // Cancel
        if (response === 0) {
          const saved = await saveCurrentWindow(win);
          if (!saved) return;
        }
      }

      saveWindowState(win);
      state.forceClosing = true;
      win.close();
    })();
  });

  win.on('closed', () => {
    const state = windowState.get(win.id);
    if (state && state.workspaceDir) {
      unwatchWorkspace(state.workspaceDir, win.id);
    }
    windowState.delete(win.id);
  });

  return win;
}

ipcMain.handle('workspace:selectFolder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) await chooseWorkspaceFolder(win);
});

ipcMain.handle('workspace:getState', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const state = win && windowState.get(win.id);
  if (!state) return { workspaceDir: null, files: [], currentFilePath: null, collapsed: false };
  return {
    workspaceDir: state.workspaceDir,
    files: scanWorkspaceFiles(state.workspaceDir),
    currentFilePath: state.currentFilePath,
    collapsed: !state.sidebarVisible,
  };
});

ipcMain.handle('sidebar:toggle', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) toggleSidebar(win);
});

ipcMain.handle('file:open', async (event, filePath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  return openFileInWindow(win, filePath);
});

ipcMain.handle('file:new', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  return createNewFileInWindow(win);
});

ipcMain.handle('file:rename', async (event, { oldPath, newName }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  return renameFileInWindow(win, oldPath, newName);
});

ipcMain.handle('file:delete', async (event, filePath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  return deleteFileInWindow(win, filePath);
});

ipcMain.handle('file:save', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  return saveCurrentWindow(win);
});

ipcMain.handle('file:saveAs', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  return saveAsCurrentWindow(win);
});

ipcMain.handle('dialog:new-file-submit', (event, name) => {
  const entry = pendingNewFileDialogs.get(event.sender.id);
  if (!entry) return;
  pendingNewFileDialogs.delete(event.sender.id);
  entry.resolve(name);
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle('dialog:new-file-cancel', (event) => {
  const entry = pendingNewFileDialogs.get(event.sender.id);
  if (!entry) return;
  pendingNewFileDialogs.delete(event.sender.id);
  entry.resolve(null);
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle('dialog:new-file-getExistingNames', (event) => {
  return pendingNewFileDialogs.get(event.sender.id)?.existingNames ?? [];
});

// macOS: open-file fires when a file is double-clicked or dragged onto the dock icon
// This can fire BEFORE app 'ready', so we store the path for later
app.on('open-file', (event, filePath) => {
  event.preventDefault();

  if (!filePath.endsWith('.excalidraw')) return;

  if (app.isReady()) {
    createWindow(filePath);
  } else {
    pendingFilePath = filePath;
  }
});

// Windows/Linux: when a second instance is launched with a file argument,
// this event fires on the first instance. Open a new window with that file.
app.on('second-instance', (event, argv) => {
  const filePath = getFilePathFromArgv(argv);
  if (filePath) {
    createWindow(filePath);
  } else {
    // No file — just open a new blank window
    createWindow();
  }
});

// Request single instance lock so second-instance events work
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running; it will handle the second-instance event.
  // We quit this instance.
  app.quit();
} else {
  app.whenReady().then(() => {
    // Check if launched with a file path via command line (Windows/Linux)
    const argFilePath = getFilePathFromArgv(process.argv);
    const fileToOpen = pendingFilePath || argFilePath || null;

    createWindow(fileToOpen);
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
          label: 'Excalidraw',
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
    label: 'File',
    submenu: [
      {
        label: 'New File',
        accelerator: 'CmdOrCtrl+N',
        click: () => {
          const win = BrowserWindow.getFocusedWindow();
          if (win) void createNewFileInWindow(win);
        },
      },
      { type: 'separator' },
      {
        label: 'Open File...',
        accelerator: 'CmdOrCtrl+O',
        click: () => {
          const win = BrowserWindow.getFocusedWindow();
          if (win) void openFileDialogInWindow(win);
        },
      },
      {
        label: 'Open Folder...',
        accelerator: 'CmdOrCtrl+Shift+O',
        click: () => {
          const win = BrowserWindow.getFocusedWindow();
          if (win) void chooseWorkspaceFolder(win);
        },
      },
      { type: 'separator' },
      {
        label: 'Save',
        accelerator: 'CmdOrCtrl+S',
        click: () => {
          const win = BrowserWindow.getFocusedWindow();
          if (win) void saveCurrentWindow(win);
        },
      },
      {
        label: 'Save As...',
        accelerator: 'CmdOrCtrl+Shift+S',
        click: () => {
          const win = BrowserWindow.getFocusedWindow();
          if (win) void saveAsCurrentWindow(win);
        },
      },
      { type: 'separator' },
      {
        label: 'Toggle Sidebar',
        accelerator: 'CmdOrCtrl+B',
        click: () => {
          const win = BrowserWindow.getFocusedWindow();
          if (win) toggleSidebar(win);
        },
      },
    ],
  },
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
