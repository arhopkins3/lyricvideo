import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { RendererApi } from '../shared/api'
import type { LogEvent, ProgressEvent } from '../shared/types'

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api: RendererApi = {
  settings: {
    get: () => invoke('settings:get'),
    setApiKey: (key) => invoke('settings:setApiKey', key),
    clearApiKey: () => invoke('settings:clearApiKey'),
    update: (patch) => invoke('settings:update', patch),
    testApiKey: () => invoke('settings:testApiKey')
  },
  tools: {
    status: () => invoke('tools:status'),
    setupAligner: () => invoke('tools:setupAligner')
  },
  project: {
    fromYoutube: (url) => invoke('project:fromYoutube', url),
    fromFile: () => invoke('project:fromFile'),
    importPath: (p) => invoke('project:importPath', p),
    open: () => invoke('project:open'),
    openPath: (p) => invoke('project:openPath', p),
    update: (project) => invoke('project:update', project),
    save: (project, saveAs) => invoke('project:save', project, saveAs ?? false),
    chooseBackgroundImage: (id) => invoke('project:chooseBackgroundImage', id),
    recent: () => invoke('project:recent')
  },
  claude: {
    searchLyrics: (id, q) => invoke('claude:searchLyrics', id, q),
    fetchLyricsPage: (url) => invoke('claude:fetchLyricsPage', url),
    generateText: (req) => invoke('claude:generateText', req),
    searchTranslations: (id, lines, q) => invoke('claude:searchTranslations', id, lines, q),
    explainLine: (req) => invoke('claude:explainLine', req),
    explainSong: (req) => invoke('claude:explainSong', req)
  },
  align: {
    run: (id, lines, options) => invoke('align:run', id, lines, options ?? {}),
    cancel: () => invoke('align:cancel')
  },
  exporter: {
    begin: (id) => invoke('export:begin', id),
    writeFrame: (dir, file, png) => invoke('export:writeFrame', dir, file, png),
    finish: (id, dir, req, frames) => invoke('export:finish', id, dir, req, frames),
    chooseOutput: (name) => invoke('export:chooseOutput', name),
    cancel: () => invoke('export:cancel')
  },
  files: {
    pathFor: (file) => webUtils.getPathForFile(file)
  },
  app: {
    setDirty: (dirty) => invoke('app:setDirty', dirty),
    closeNow: () => invoke('app:closeNow')
  },
  shell: {
    showInFolder: (p) => invoke('shell:showInFolder', p),
    openExternal: (u) => invoke('shell:openExternal', u)
  },
  events: {
    onProgress: (cb) => {
      const listener = (_: unknown, e: ProgressEvent) => cb(e)
      ipcRenderer.on('progress', listener)
      return () => ipcRenderer.removeListener('progress', listener)
    },
    onLog: (cb) => {
      const listener = (_: unknown, e: LogEvent) => cb(e)
      ipcRenderer.on('log', listener)
      return () => ipcRenderer.removeListener('log', listener)
    },
    onMenu: (cb) => {
      const channels = ['new', 'open', 'save', 'saveAs', 'saveAndClose', 'settings', 'openPath']
      const listeners = channels.map((c) => {
        const listener = (_: unknown, arg?: string) => cb(c, arg)
        ipcRenderer.on(`menu:${c}`, listener)
        return () => ipcRenderer.removeListener(`menu:${c}`, listener)
      })
      return () => listeners.forEach((off) => off())
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
