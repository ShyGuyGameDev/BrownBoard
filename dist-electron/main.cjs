"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
// __dirname is available in CommonJS output.
const PROTOCOL = 'brownboard';
const LEGACY_PROTOCOL = 'devboard';
const isMac = process.platform === 'darwin';
let mainWindow = null;
let pendingRoom = null;
/** BrownBoard desktop links (including the legacy scheme) -> room id, validated before injection. */
const parseDeepLink = (url) => {
    const m = url.match(/^(?:brownboard|devboard):\/\/(?:r|join)\/([A-Za-z0-9_-]{3,64})\/?$/);
    return m ? m[1] : null;
};
const isDeepLink = (url) => url.startsWith(`${PROTOCOL}://`) || url.startsWith(`${LEGACY_PROTOCOL}://`);
/** Run a tiny snippet in the renderer. Keeps us from needing any preload changes. */
const sendToRenderer = (event, detail) => {
    mainWindow?.webContents
        .executeJavaScript(`window.dispatchEvent(new CustomEvent(${JSON.stringify(event)}, { detail: ${JSON.stringify(detail ?? null)} }))`)
        .catch(() => undefined);
};
const joinRoom = (id) => {
    if (!mainWindow) {
        pendingRoom = id;
        return;
    }
    mainWindow.webContents.executeJavaScript(`location.hash = '/r/${id}'`).catch(() => undefined);
    if (mainWindow.isMinimized())
        mainWindow.restore();
    mainWindow.focus();
};
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 900,
        minHeight: 600,
        show: false,
        backgroundColor: electron_1.nativeTheme.shouldUseDarkColors ? '#0f1013' : '#f4f5f7',
        titleBarStyle: isMac ? 'hiddenInset' : 'default',
        webPreferences: {
            // preload is compiled to JS in dist-electron
            preload: path_1.default.join(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    mainWindow.once('ready-to-show', () => mainWindow?.show());
    mainWindow.webContents.on('did-finish-load', () => {
        if (pendingRoom) {
            joinRoom(pendingRoom);
            pendingRoom = null;
        }
    });
    // The page blocks closing while a guest's room is untitled (beforeunload). Electron would just
    // ignore the close, so ask here instead, like a browser's "leave site?" prompt.
    mainWindow.webContents.on('will-prevent-unload', (event) => {
        const choice = electron_1.dialog.showMessageBoxSync(mainWindow, {
            type: 'warning',
            buttons: ['Leave', 'Stay'],
            defaultId: 1,
            cancelId: 1,
            message: "This room has no name, so it won't be saved.",
            detail: 'Sign in to keep it.',
        });
        if (choice === 0)
            event.preventDefault();
    });
    // Links inside the app (e.g. in task descriptions) open in the real browser.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url))
            electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl) {
        mainWindow.loadURL(devUrl);
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, '../dist/index.html'));
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
function buildMenu() {
    const template = [
        ...(isMac ? [{ role: 'appMenu' }] : []),
        {
            label: 'File',
            submenu: [
                {
                    label: 'Copy Share Link',
                    accelerator: 'CmdOrCtrl+Shift+L',
                    click: () => sendToRenderer('devboard:share'),
                },
                { type: 'separator' },
                isMac ? { role: 'close' } : { label: 'Exit', accelerator: 'CmdOrCtrl+Q', click: () => electron_1.app.quit() },
            ],
        },
        {
            label: 'Edit',
            submenu: [
                // No accelerators on undo/redo on purpose: the keyboard shortcut goes straight to the page,
                // which routes it to a focused text field or to the canvas history.
                { label: 'Undo', click: () => sendToRenderer('devboard:history', 'undo') },
                { label: 'Redo', click: () => sendToRenderer('devboard:history', 'redo') },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' },
            ],
        },
        {
            label: 'Go',
            submenu: [
                { label: 'Board', accelerator: 'CmdOrCtrl+1', click: () => sendToRenderer('devboard:navigate', 'board') },
                { label: 'Canvas', accelerator: 'CmdOrCtrl+2', click: () => sendToRenderer('devboard:navigate', 'canvas') },
            ],
        },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
    ];
    electron_1.Menu.setApplicationMenu(electron_1.Menu.buildFromTemplate(template));
}
// Register both schemes so existing shared devboard:// links continue to open.
if (process.defaultApp) {
    if (process.argv.length >= 2) {
        const appPath = process.execPath;
        const appArgs = [path_1.default.resolve(process.argv[1])];
        electron_1.app.setAsDefaultProtocolClient(PROTOCOL, appPath, appArgs);
        electron_1.app.setAsDefaultProtocolClient(LEGACY_PROTOCOL, appPath, appArgs);
    }
}
else {
    electron_1.app.setAsDefaultProtocolClient(PROTOCOL);
    electron_1.app.setAsDefaultProtocolClient(LEGACY_PROTOCOL);
}
// macOS delivers deep links here (possibly before the window exists).
electron_1.app.on('open-url', (event, url) => {
    event.preventDefault();
    const id = parseDeepLink(url);
    if (id)
        joinRoom(id);
});
if (!electron_1.app.requestSingleInstanceLock()) {
    electron_1.app.quit();
}
else {
    // Windows / Linux deliver deep links as argv of a second instance.
    electron_1.app.on('second-instance', (_event, argv) => {
        const link = argv.find(isDeepLink);
        const id = link ? parseDeepLink(link) : null;
        if (id)
            joinRoom(id);
        else if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.focus();
        }
    });
    electron_1.app.whenReady().then(() => {
        buildMenu();
        createWindow();
        const launchLink = process.argv.find(isDeepLink);
        const id = launchLink ? parseDeepLink(launchLink) : null;
        if (id)
            pendingRoom = id;
    });
}
electron_1.app.on('window-all-closed', () => {
    if (!isMac)
        electron_1.app.quit();
});
electron_1.app.on('activate', () => {
    if (mainWindow === null)
        createWindow();
});
//# sourceMappingURL=main.js.map