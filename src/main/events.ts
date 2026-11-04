import { BrowserWindow } from 'electron'
import type { LogEvent, ProgressEvent } from '../shared/types'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function progress(e: ProgressEvent): void {
  broadcast('progress', e)
}

export function log(task: string, line: string): void {
  const e: LogEvent = { task, line }
  broadcast('log', e)
}
