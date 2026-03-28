const { app, BrowserWindow, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

// Track file paths requested before the app is ready (macOS open-file can fire early)
let pendingFilePath = null;

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

// Read a .excalidraw file and inject its contents into the window via localStorage
async function loadFileIntoWindow(win, filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);

    const elements = data.elements || [];
    const appState = data.appState || {};
    const files = data.files || {};

    // Wait for the page to finish loading before injecting
    const inject = () => {
      win.webContents.executeJavaScript(`
        try {
          localStorage.setItem("excalidraw", JSON.stringify(${JSON.stringify(elements)}));
          localStorage.setItem("excalidraw-state", JSON.stringify(${JSON.stringify(appState)}));
          localStorage.setItem("excalidraw-files", JSON.stringify(${JSON.stringify(files)}));
          true;
        } catch(e) {
          console.error("Failed to inject excalidraw data:", e);
          false;
        }
      `).then(() => {
        win.webContents.reload();
      });
    };

    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', inject);
    } else {
      inject();
    }
  } catch (err) {
    console.error('Failed to load .excalidraw file:', err);
  }
}

function createWindow(filePath) {
  const win = new BrowserWindow({
    width: 1300,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
    },
  });

  win.loadURL('https://excalidraw.com/');

  // Hide menu bar visually for Windows and Linux, but keep keyboard shortcuts working
  if (process.platform === 'win32' || process.platform === 'linux') {
    win.setMenuBarVisibility(false);
    win.setAutoHideMenuBar(true);
  }

  // If a file was requested, load it once the page is ready
  if (filePath) {
    win.webContents.once('did-finish-load', () => {
      loadFileIntoWindow(win, filePath);
    });
  }

  return win;
}

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
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);
