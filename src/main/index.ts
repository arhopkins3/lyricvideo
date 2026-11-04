import { app, BrowserWindow, dialog, ipcMain, protocol, shell, net, Menu } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Line, Project } from '../shared/types'
import type { GenerateTextRequest, LyricSearchQuery } from '../shared/api'
import {
  getSettings,
  setApiKey,
  updateSettings,
  recentProjects
} from './settings'
import { setupAligner, runAlignment, cancelAlignment } from './aligner'
import { toolStatus } from './tools'
import { projectFromFile, projectFromPath, projectFromYoutube } from './media'
import {
  chooseBackgroundImage,
  openProjectDialog,
  openProjectPath,
  projectsRoot,
  saveProject,
  writeProjectJson
} from './project'
import * as claude from './claude'
import { beginExport, cancelExport, chooseOutput, finishExport, writeFrame } from './exporter'

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } }
])

let mainWindow: BrowserWindow | null = null
let projectDirty = false
let forceClose = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    title: 'LyricVideo',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  mainWindow.on('close', (e) => {
    if (!projectDirty || forceClose) return
    e.preventDefault()
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Your project has unsaved changes.',
      detail: 'Save them to a .lvproj package before closing?'
    })
    if (choice === 2) return
    if (choice === 1) {
      forceClose = true
      mainWindow?.close()
      return
    }
    mainWindow?.webContents.send('menu:saveAndClose')
  })
  mainWindow.on('closed', () => (mainWindow = null))
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

/** media://<projectId>/<file> serves files from the project's working folder, with HTTP range support for video seeking. */
function registerMediaProtocol(): void {
  protocol.handle('media', async (request) => {
    const url = new URL(request.url)
    const projectId = url.hostname
    const file = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    const root = path.join(projectsRoot(), projectId)
    const full = path.normalize(path.join(root, file))
    if (!full.startsWith(root + path.sep) || !fs.existsSync(full)) {
      return new Response('Not found', { status: 404 })
    }
    const stat = fs.statSync(full)
    const range = request.headers.get('range')
    const mime = mimeFor(full)
    if (range) {
      const m = range.match(/bytes=(\d*)-(\d*)/)
      const start = m && m[1] ? parseInt(m[1]) : 0
      const end = m && m[2] ? Math.min(parseInt(m[2]), stat.size - 1) : stat.size - 1
      const stream = fs.createReadStream(full, { start, end })
      return new Response(stream as unknown as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          // The renderer draws this media onto canvases it later reads back (export), so it must not taint them.
          'Access-Control-Allow-Origin': '*'
        }
      })
    }
    const res = await net.fetch(pathToFileURL(full).toString())
    const headers = new Headers(res.headers)
    headers.set('Content-Type', mime)
    headers.set('Accept-Ranges', 'bytes')
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(res.body, { status: 200, headers })
  })
}

function mimeFor(file: string): string {
  const ext = path.extname(file).toLowerCase()
  return (
    {
      '.mp3': 'audio/mpeg',
      '.mp4': 'video/mp4',
      '.m4a': 'audio/mp4',
      '.wav': 'audio/wav',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.json': 'application/json'
    }[ext] ?? 'application/octet-stream'
  )
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:setApiKey', (_e, key: string) => setApiKey(key))
  ipcMain.handle('settings:clearApiKey', () => setApiKey(''))
  ipcMain.handle('settings:update', (_e, patch) => updateSettings(patch))
  ipcMain.handle('settings:testApiKey', () => claude.testApiKey())

  ipcMain.handle('tools:status', () => toolStatus())
  ipcMain.handle('tools:setupAligner', () => setupAligner())

  ipcMain.handle('project:fromYoutube', (_e, url: string) => projectFromYoutube(url))
  ipcMain.handle('project:fromFile', () => projectFromFile(mainWindow))
  ipcMain.handle('project:importPath', (_e, p: string) => (p.toLowerCase().endsWith('.lvproj') ? openProjectPath(p) : projectFromPath(p)))
  ipcMain.handle('project:open', () => openProjectDialog(mainWindow))
  ipcMain.handle('project:openPath', (_e, p: string) => openProjectPath(p))
  ipcMain.handle('project:update', (_e, project: Project) => writeProjectJson(project))
  ipcMain.handle('project:save', (_e, project: Project, saveAs: boolean) => saveProject(project, saveAs, mainWindow))
  ipcMain.handle('project:chooseBackgroundImage', (_e, id: string) => chooseBackgroundImage(id, mainWindow))
  ipcMain.handle('project:recent', () => recentProjects())

  ipcMain.handle('claude:searchLyrics', (_e, _id: string, q: LyricSearchQuery) => claude.searchLyrics(q))
  ipcMain.handle('claude:generateText', (_e, req: GenerateTextRequest) => claude.generateText(req))
  ipcMain.handle('claude:searchTranslations', (_e, _id: string, lines: Line[], q: LyricSearchQuery) =>
    claude.searchTranslations(lines, q)
  )
  ipcMain.handle('claude:explainLine', (_e, req) => claude.explainLine(req))
  ipcMain.handle('claude:explainSong', (_e, req) => claude.explainSong(req))

  ipcMain.handle('align:run', (_e, id: string, lines: Line[], options) => runAlignment(id, lines, options))
  ipcMain.handle('align:cancel', () => cancelAlignment())

  ipcMain.handle('export:begin', (_e, id: string) => beginExport(id))
  ipcMain.handle('export:writeFrame', (_e, dir: string, file: string, png: ArrayBuffer) => writeFrame(dir, file, png))
  ipcMain.handle('export:finish', (_e, id, dir, req, frames) => finishExport(id, dir, req, frames))
  ipcMain.handle('export:chooseOutput', (_e, name: string) => chooseOutput(name, mainWindow))
  ipcMain.handle('export:cancel', () => cancelExport())

  ipcMain.handle('app:setDirty', (_e, dirty: boolean) => {
    projectDirty = dirty
  })
  ipcMain.handle('app:closeNow', () => {
    forceClose = true
    mainWindow?.close()
  })
  ipcMain.handle('shell:showInFolder', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('shell:openExternal', (_e, u: string) => shell.openExternal(u))
}

function buildMenu(): void {
  const send = (channel: string) => mainWindow?.webContents.send(channel)
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New from YouTube…', accelerator: 'CmdOrCtrl+N', click: () => send('menu:new') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => send('menu:open') },
        { type: 'separator' },
        { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => send('menu:save') },
        { label: 'Save Project As…', accelerator: 'Shift+CmdOrCtrl+S', click: () => send('menu:saveAs') },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('menu:settings') },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  registerMediaProtocol()
  registerIpc()
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Open .lvproj files double-clicked in Finder.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  const deliver = () => mainWindow?.webContents.send('menu:openPath', filePath)
  if (mainWindow) deliver()
  else app.whenReady().then(() => setTimeout(deliver, 1500))
})
