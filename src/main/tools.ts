import { execFile, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { ToolStatus } from '../shared/types'
import { getSettings } from './settings'

/** Directories searched in addition to PATH (Homebrew, MacPorts, pipx, user bins). */
const EXTRA_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/opt/local/bin',
  path.join(process.env.HOME ?? '', '.local', 'bin'),
  path.join(process.env.HOME ?? '', 'bin'),
  '/usr/bin'
]

export function findExecutable(name: string, override?: string): string | undefined {
  if (override && fs.existsSync(override)) return override
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter)
  for (const dir of [...pathDirs, ...EXTRA_DIRS]) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      /* keep looking */
    }
  }
  return undefined
}

export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; onLine?: (line: string) => void; signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...withExtraPath(), ...(opts.env ?? {}) }
    })
    let stdout = ''
    let stderr = ''
    const feed = (chunk: Buffer, isErr: boolean) => {
      const text = chunk.toString('utf8')
      if (isErr) stderr += text
      else stdout += text
      if (opts.onLine) {
        for (const line of text.split(/\r?\n|\r/)) {
          if (line.trim()) opts.onLine(line)
        }
      }
    }
    child.stdout?.on('data', (c) => feed(c, false))
    child.stderr?.on('data', (c) => feed(c, true))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
    if (opts.signal) {
      const kill = () => {
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 3000).unref()
      }
      if (opts.signal.aborted) kill()
      else opts.signal.addEventListener('abort', kill, { once: true })
    }
  })
}

function withExtraPath(): { PATH: string } {
  const current = process.env.PATH ?? ''
  const extra = EXTRA_DIRS.filter((d) => !current.split(path.delimiter).includes(d))
  return { PATH: [current, ...extra].filter(Boolean).join(path.delimiter) }
}

function version(cmd: string | undefined, args: string[]): Promise<string | undefined> {
  if (!cmd) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) return resolve(undefined)
      const text = (stdout || stderr || '').toString().split('\n')[0].trim()
      resolve(text || undefined)
    })
  })
}

export function alignerVenvDir(): string {
  return path.join(app.getPath('userData'), 'aligner-venv')
}

export function alignerPython(): string {
  return path.join(alignerVenvDir(), 'bin', 'python')
}

export function alignerScriptDir(): string {
  // In development the resources folder sits at the repo root; when packaged it is copied next to the app.
  const packaged = path.join(process.resourcesPath ?? '', 'aligner')
  if (app.isPackaged && fs.existsSync(packaged)) return packaged
  return path.join(app.getAppPath(), 'resources', 'aligner')
}

export function alignerReady(): boolean {
  return fs.existsSync(alignerPython()) && fs.existsSync(path.join(alignerVenvDir(), '.ready'))
}

export async function toolStatus(): Promise<ToolStatus> {
  const s = getSettings()
  const ytdlp = findExecutable('yt-dlp', s.ytdlpPath)
  const ffmpeg = findExecutable('ffmpeg', s.ffmpegPath)
  const ffprobe = ffmpeg ? findExecutable('ffprobe', path.join(path.dirname(ffmpeg), 'ffprobe')) : findExecutable('ffprobe')
  const python =
    findExecutable('python3', s.pythonPath) ??
    findExecutable('python3.12') ??
    findExecutable('python3.11') ??
    findExecutable('python')
  const [ytv, ffv, pyv] = await Promise.all([
    version(ytdlp, ['--version']),
    version(ffmpeg, ['-version']),
    version(python, ['--version'])
  ])
  return {
    ytdlp: { found: Boolean(ytdlp), path: ytdlp, version: ytv },
    ffmpeg: { found: Boolean(ffmpeg), path: ffmpeg, version: ffv?.replace(/^ffmpeg version\s*/, '').split(' ')[0] },
    ffprobe: { found: Boolean(ffprobe), path: ffprobe },
    python: { found: Boolean(python), path: python, version: pyv },
    alignerReady: alignerReady(),
    alignerVenv: alignerVenvDir()
  }
}

export function requireTool(name: 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'python3'): string {
  const s = getSettings()
  const override =
    name === 'yt-dlp' ? s.ytdlpPath : name === 'ffmpeg' ? s.ffmpegPath : name === 'python3' ? s.pythonPath : undefined
  const found = findExecutable(name, override)
  if (!found) {
    const hint =
      name === 'python3'
        ? 'Install Python 3 (brew install python)'
        : `Install it with Homebrew: brew install ${name === 'ffprobe' ? 'ffmpeg' : name}`
    throw new Error(`${name} was not found. ${hint}, or set its path in Settings.`)
  }
  return found
}
