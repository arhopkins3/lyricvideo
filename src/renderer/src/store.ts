import { create } from 'zustand'
import type {
  AppSettings,
  LogEvent,
  ProgressEvent,
  Project,
  ProjectHandle,
  ToolStatus
} from '../../shared/types'
import { player } from './lib/player'

export type Step = 'source' | 'lyrics' | 'text' | 'align' | 'style' | 'export'
export const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'source', label: '1 · Source' },
  { id: 'lyrics', label: '2 · Lyrics' },
  { id: 'text', label: '3 · Translate' },
  { id: 'align', label: '4 · Align' },
  { id: 'style', label: '5 · Style' },
  { id: 'export', label: '6 · Export' }
]

interface AppState {
  handle: ProjectHandle | null
  settings: AppSettings | null
  tools: ToolStatus | null
  step: Step
  progress: Record<string, ProgressEvent>
  logs: LogEvent[]
  error: string | null
  notice: string | null
  showSettings: boolean
  selectedLineId: string | null
  dirty: boolean

  setStep(step: Step): void
  setHandle(h: ProjectHandle | null): void
  updateProject(fn: (p: Project) => Project): void
  setError(msg: string | null): void
  setNotice(msg: string | null): void
  setShowSettings(v: boolean): void
  selectLine(id: string | null): void
  refreshSettings(): Promise<void>
  refreshTools(): Promise<void>
  save(saveAs?: boolean): Promise<void>
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

export function mediaUrl(projectId: string, file: string | undefined): string | null {
  return file ? `media://${projectId}/${encodeURIComponent(file)}` : null
}

export const useStore = create<AppState>((set, get) => ({
  handle: null,
  settings: null,
  tools: null,
  step: 'source',
  progress: {},
  logs: [],
  error: null,
  notice: null,
  showSettings: false,
  selectedLineId: null,
  dirty: false,

  setStep: (step) => set({ step }),
  setHandle: (handle) => {
    set({ handle, step: 'source', selectedLineId: null, dirty: false, progress: {} })
    const project = handle?.project
    player.load(project ? mediaUrl(project.id, project.source.audioFile) : null)
  },
  updateProject: (fn) => {
    const h = get().handle
    if (!h) return
    const project = fn(h.project)
    set({ handle: { ...h, project }, dirty: true })
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      const latest = get().handle?.project
      if (latest) window.api.project.update(latest).catch((e) => set({ error: String(e) }))
    }, 600)
  },
  setError: (error) => set({ error }),
  setNotice: (notice) => {
    set({ notice })
    if (notice) setTimeout(() => get().notice === notice && set({ notice: null }), 4000)
  },
  setShowSettings: (showSettings) => set({ showSettings }),
  selectLine: (selectedLineId) => set({ selectedLineId }),
  refreshSettings: async () => set({ settings: await window.api.settings.get() }),
  refreshTools: async () => set({ tools: await window.api.tools.status() }),
  save: async (saveAs = false) => {
    const h = get().handle
    if (!h) return
    try {
      const path = await window.api.project.save(h.project, saveAs)
      if (path) {
        set({ handle: { ...h, project: { ...h.project, savedPath: path } }, dirty: false })
        get().setNotice(`Saved to ${path}`)
      }
    } catch (e) {
      set({ error: errorMessage(e) })
    }
  }
}))

export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  // Electron prefixes IPC errors with the handler name; strip it.
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Wire main-process progress/log events into the store once. */
export function connectEvents(): void {
  window.api.events.onProgress((e) => {
    useStore.setState((s) => ({ progress: { ...s.progress, [e.task]: e } }))
  })
  window.api.events.onLog((e) => {
    useStore.setState((s) => ({ logs: [...s.logs.slice(-400), e] }))
  })
}

/** Run an async task, surfacing errors in the global banner. Returns undefined on failure. */
export async function guarded<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    useStore.getState().setError(null)
    return await fn()
  } catch (e) {
    useStore.getState().setError(errorMessage(e))
    return undefined
  }
}
