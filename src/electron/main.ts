import { app, BrowserWindow, dialog, Menu, nativeTheme, shell } from 'electron'
import path from 'path'

// __dirname is available in CommonJS output.
const PROTOCOL = 'devboard'
const isMac = process.platform === 'darwin'

let mainWindow: BrowserWindow | null = null
let pendingRoom: string | null = null

/** devboard://r/<room> or devboard://join/<room>  ->  room id (validated so it is safe to inject). */
const parseDeepLink = (url: string): string | null => {
  const m = url.match(/^devboard:\/\/(?:r|join)\/([A-Za-z0-9_-]{3,64})\/?$/)
  return m ? m[1] : null
}

/** Run a tiny snippet in the renderer. Keeps us from needing any preload changes. */
const sendToRenderer = (event: string, detail?: unknown) => {
  mainWindow?.webContents
    .executeJavaScript(
      `window.dispatchEvent(new CustomEvent(${JSON.stringify(event)}, { detail: ${JSON.stringify(detail ?? null)} }))`,
    )
    .catch(() => undefined)
}

const joinRoom = (id: string) => {
  if (!mainWindow) {
    pendingRoom = id
    return
  }
  mainWindow.webContents.executeJavaScript(`location.hash = '/r/${id}'`).catch(() => undefined)
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1013' : '#f4f5f7',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    webPreferences: {
      // preload is compiled to JS in dist-electron
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingRoom) {
      joinRoom(pendingRoom)
      pendingRoom = null
    }
  })

  // The page blocks closing while a guest's room is untitled (beforeunload). Electron would just
  // ignore the close, so ask here instead, like a browser's "leave site?" prompt.
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'warning',
      buttons: ['Leave', 'Stay'],
      defaultId: 1,
      cancelId: 1,
      message: "This room has no name, so it won't be saved.",
      detail: 'Sign in to keep it.',
    })
    if (choice === 0) event.preventDefault()
  })

  // Links inside the app (e.g. in task descriptions) open in the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    mainWindow.loadURL(devUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Copy Share Link',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => sendToRenderer('devboard:share'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { label: 'Exit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
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
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---- deep links: devboard://r/<room> ----
if (process.defaultApp) {
  if (process.argv.length >= 2) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
} else {
  app.setAsDefaultProtocolClient(PROTOCOL)
}

// macOS delivers deep links here (possibly before the window exists).
app.on('open-url', (event, url) => {
  event.preventDefault()
  const id = parseDeepLink(url)
  if (id) joinRoom(id)
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Windows / Linux deliver deep links as argv of a second instance.
  app.on('second-instance', (_event, argv) => {
    const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`))
    const id = link ? parseDeepLink(link) : null
    if (id) joinRoom(id)
    else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    buildMenu()
    createWindow()
    const launchLink = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`))
    const id = launchLink ? parseDeepLink(launchLink) : null
    if (id) pendingRoom = id
  })
}

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})

app.on('activate', () => {
  if (mainWindow === null) createWindow()
})