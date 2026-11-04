/**
 * Types shared between the Electron main process, the preload bridge and the renderer.
 */

export interface Word {
  id: string
  /** Farsi text of the word (as written in the lyrics). */
  fa: string
  /** Finglish transliteration of this word. */
  finglish?: string
  /** Start time in seconds (undefined until aligned). */
  start?: number
  /** End time in seconds. */
  end?: number
}

export interface Line {
  id: string
  fa: string
  finglish?: string
  en?: string
  /** Cultural / idiomatic explanation generated on demand. */
  explanation?: string
  start?: number
  end?: number
  words: Word[]
}

export interface LyricCandidate {
  id: string
  source: string
  url?: string
  title?: string
  artist?: string
  /** Full lyric text, lines separated by newlines. */
  text: string
  notes?: string
  confidence?: 'high' | 'medium' | 'low'
}

export interface TranslationCandidate {
  id: string
  source: string
  url?: string
  /** One entry per original line, aligned by index where possible. */
  lines: string[]
  notes?: string
}

export type BackgroundKind = 'solid' | 'gradient' | 'image' | 'video'

export interface ScriptStyle {
  visible: boolean
  fontFamily: string
  fontSize: number
  color: string
  highlightColor: string
  bold: boolean
}

export interface StyleSettings {
  width: number
  height: number
  fps: number
  background: {
    kind: BackgroundKind
    color: string
    gradientFrom: string
    gradientTo: string
    /** Filename inside the project folder (e.g. background.jpg). */
    imageFile?: string
    /** 0..1 darkening applied over image/video. */
    dim: number
    /** Blur radius in px applied over image/video (preview + export). */
    blur: number
  }
  farsi: ScriptStyle
  finglish: ScriptStyle
  english: ScriptStyle
  /** Vertical anchor of the text block as a fraction of the height (0 top .. 1 bottom). */
  verticalPosition: number
  /** Gap between script rows in px. */
  lineGap: number
  /** Show the next line in a smaller/dimmer style. */
  showUpcomingLine: boolean
  /** Per-word highlight style. */
  highlightMode: 'color' | 'glow' | 'underline'
  /** Seconds a line stays on screen after its end before clearing. */
  lingerSeconds: number
  textShadow: boolean
}

export interface ProjectSource {
  type: 'youtube' | 'file'
  url?: string
  originalFileName?: string
  audioFile: string
  videoFile?: string
  durationSec: number
  thumbnailFile?: string
}

export interface Project {
  version: 1
  id: string
  title: string
  artist?: string
  source: ProjectSource
  lines: Line[]
  lyricCandidates: LyricCandidate[]
  translationCandidates: TranslationCandidate[]
  chosenLyricCandidateId?: string
  style: StyleSettings
  songExplanation?: string
  finglishConventions: string
  createdAt: string
  updatedAt: string
  /** Where the project was last saved, if ever. */
  savedPath?: string
}

export interface ProjectHandle {
  project: Project
  /** Absolute path of the working directory that holds the project media. */
  workDir: string
}

export interface ToolStatus {
  ytdlp: { found: boolean; path?: string; version?: string }
  ffmpeg: { found: boolean; path?: string; version?: string }
  ffprobe: { found: boolean; path?: string }
  python: { found: boolean; path?: string; version?: string }
  alignerReady: boolean
  alignerVenv: string
}

export interface AppSettings {
  hasApiKey: boolean
  model: string
  finglishConventions: string
  ytdlpPath?: string
  ffmpegPath?: string
  pythonPath?: string
  lastProjectDir?: string
}

export interface ProgressEvent {
  /** Identifies the task (e.g. "download", "align", "export"). */
  task: string
  /** 0..1, or -1 when indeterminate. */
  fraction: number
  message: string
  done?: boolean
  error?: string
}

export interface LogEvent {
  task: string
  line: string
}

export interface AlignmentResult {
  lines: Array<{
    id: string
    start?: number
    end?: number
    words: Array<{ id: string; start?: number; end?: number }>
  }>
  engine: string
  notes?: string
}

export interface ExportFrame {
  /** Time this frame becomes visible (seconds). */
  start: number
  /** Duration this frame stays visible (seconds). */
  duration: number
  /** PNG file name inside the export working folder. */
  file: string
}

export interface ExportRequest {
  outputPath: string
  width: number
  height: number
  fps: number
  /** Total length in seconds. */
  duration: number
  /** Background configuration mirrors StyleSettings.background. */
  background: StyleSettings['background']
}

export const DEFAULT_FINGLISH_CONVENTIONS =
  'Use "kh" for خ (never "x"), "oo" for the long u sound (never "u"), "aa" for long alef آ/ا (never "a"), "gh" for ق/غ, "ch" for چ, "sh" for ش, "zh" for ژ, "\'" for ع/ء when it is pronounced. Follow colloquial sung pronunciation (e.g. "mikhaam" for می‌خواهم when sung as میخوام). Keep one Finglish token per Farsi word, hyphenate clitics like "-o" / "-e" to the host word.'

export function defaultStyle(): StyleSettings {
  return {
    width: 1920,
    height: 1080,
    fps: 30,
    background: {
      kind: 'gradient',
      color: '#101418',
      gradientFrom: '#1b2735',
      gradientTo: '#090a0f',
      dim: 0.35,
      blur: 0
    },
    farsi: {
      visible: true,
      fontFamily: 'Vazirmatn, "Noto Naskh Arabic", "Geeza Pro", sans-serif',
      fontSize: 84,
      color: '#ffffff',
      highlightColor: '#ffd166',
      bold: true
    },
    finglish: {
      visible: true,
      fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif',
      fontSize: 52,
      color: '#d9e2ec',
      highlightColor: '#ffd166',
      bold: false
    },
    english: {
      visible: true,
      fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif',
      fontSize: 44,
      color: '#9fb3c8',
      highlightColor: '#ffffff',
      bold: false
    },
    verticalPosition: 0.72,
    lineGap: 18,
    showUpcomingLine: false,
    highlightMode: 'color',
    lingerSeconds: 1.0,
    textShadow: true
  }
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

/** Split lyric text into lines and words. */
export function linesFromText(text: string): Line[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((fa) => ({
      id: newId(),
      fa,
      words: fa
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => ({ id: newId(), fa: w }))
    }))
}
