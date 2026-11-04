import type {
  AlignmentResult,
  AppSettings,
  ExportFrame,
  ExportRequest,
  Line,
  LogEvent,
  LyricCandidate,
  ProgressEvent,
  Project,
  ProjectHandle,
  ToolStatus,
  TranslationCandidate
} from './types'

export interface LyricSearchQuery {
  title?: string
  artist?: string
  hints?: string
}

export interface GenerateTextRequest {
  projectId: string
  lines: Line[]
  what: 'finglish' | 'english' | 'both'
  conventions: string
  title?: string
  artist?: string
}

export interface GenerateTextResult {
  lines: Array<{
    id: string
    finglish?: string
    en?: string
    words?: Array<{ id: string; finglish: string }>
  }>
}

/** The API surface exposed to the renderer as `window.api`. */
export interface RendererApi {
  settings: {
    get(): Promise<AppSettings>
    setApiKey(key: string): Promise<void>
    clearApiKey(): Promise<void>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
    testApiKey(): Promise<{ ok: boolean; message: string }>
  }
  tools: {
    status(): Promise<ToolStatus>
    setupAligner(): Promise<void>
  }
  project: {
    fromYoutube(url: string): Promise<ProjectHandle>
    fromFile(): Promise<ProjectHandle | null>
    /** Import an audio/video file (or open a .lvproj) given its path, e.g. from drag-and-drop. */
    importPath(path: string): Promise<ProjectHandle>
    open(): Promise<ProjectHandle | null>
    openPath(path: string): Promise<ProjectHandle>
    /** Persist the project.json in the working folder (cheap, call often). */
    update(project: Project): Promise<void>
    /** Zip the working folder to a .lvproj. Prompts for a path when the project has none or saveAs is set. */
    save(project: Project, saveAs?: boolean): Promise<string | null>
    chooseBackgroundImage(projectId: string): Promise<string | null>
    recent(): Promise<Array<{ path: string; title: string; openedAt: string }>>
  }
  claude: {
    searchLyrics(projectId: string, query: LyricSearchQuery): Promise<LyricCandidate[]>
    generateText(req: GenerateTextRequest): Promise<GenerateTextResult>
    searchTranslations(
      projectId: string,
      lines: Line[],
      query: LyricSearchQuery
    ): Promise<TranslationCandidate[]>
    explainLine(req: {
      lines: Line[]
      lineId: string
      title?: string
      artist?: string
    }): Promise<string>
    explainSong(req: { lines: Line[]; title?: string; artist?: string }): Promise<string>
  }
  align: {
    run(projectId: string, lines: Line[], options?: { model?: string; separate?: boolean }): Promise<AlignmentResult>
    cancel(): Promise<void>
  }
  exporter: {
    begin(projectId: string): Promise<{ exportDir: string }>
    writeFrame(exportDir: string, file: string, png: ArrayBuffer): Promise<void>
    finish(
      projectId: string,
      exportDir: string,
      request: ExportRequest,
      frames: ExportFrame[]
    ): Promise<string>
    chooseOutput(defaultName: string): Promise<string | null>
    cancel(): Promise<void>
  }
  files: {
    /** Absolute path of a File dropped onto the window. */
    pathFor(file: File): string
  }
  app: {
    /** Tell the main process whether the open project has unsaved changes (drives the close prompt). */
    setDirty(dirty: boolean): Promise<void>
    /** Close the window without the unsaved-changes prompt. */
    closeNow(): Promise<void>
  }
  shell: {
    showInFolder(path: string): Promise<void>
    openExternal(url: string): Promise<void>
  }
  events: {
    onProgress(cb: (e: ProgressEvent) => void): () => void
    onLog(cb: (e: LogEvent) => void): () => void
    /** Menu / Finder actions from the main process: new, open, save, saveAs, saveAndClose, settings, openPath (with a file path). */
    onMenu(cb: (action: string, arg?: string) => void): () => void
  }
}
