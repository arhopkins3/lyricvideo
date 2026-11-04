import fs from 'node:fs'
import path from 'node:path'
import type { AlignmentResult, Line } from '../shared/types'
import { alignerPython, alignerReady, alignerScriptDir, alignerVenvDir, requireTool, run } from './tools'
import { workDirFor } from './project'
import { log, progress } from './events'

let current: AbortController | null = null

export async function setupAligner(): Promise<void> {
  const python = requireTool('python3')
  const venv = alignerVenvDir()
  const task = 'aligner-setup'
  progress({ task, fraction: -1, message: 'Creating Python environment…' })
  if (!fs.existsSync(alignerPython())) {
    const res = await run(python, ['-m', 'venv', venv], { onLine: (l) => log(task, l) })
    if (res.code !== 0) throw new Error(`Could not create a virtual environment: ${res.stderr.slice(-600)}`)
  }
  progress({ task, fraction: -1, message: 'Installing faster-whisper (first time can take a few minutes)…' })
  const pip = path.join(venv, 'bin', 'pip')
  const req = path.join(alignerScriptDir(), 'requirements.txt')
  const inst = await run(pip, ['install', '--upgrade', 'pip', '-r', req], { onLine: (l) => log(task, l) })
  if (inst.code !== 0) throw new Error(`pip install failed: ${inst.stderr.slice(-800)}`)
  fs.writeFileSync(path.join(venv, '.ready'), new Date().toISOString())
  progress({ task, fraction: 1, message: 'Aligner ready', done: true })
}

export async function runAlignment(
  projectId: string,
  lines: Line[],
  options: { model?: string; separate?: boolean } = {}
): Promise<AlignmentResult> {
  if (!alignerReady()) throw new Error('The aligner is not set up yet. Open Settings and click "Set up aligner".')
  const dir = workDirFor(projectId)
  const alignDir = path.join(dir, 'align')
  fs.mkdirSync(alignDir, { recursive: true })
  const lyricsPath = path.join(alignDir, 'lyrics.json')
  const outPath = path.join(alignDir, 'result.json')
  fs.writeFileSync(
    lyricsPath,
    JSON.stringify({ lines: lines.map((l) => ({ id: l.id, fa: l.fa, words: l.words.map((w) => ({ id: w.id, fa: w.fa })) })) })
  )
  const audio = path.join(dir, 'audio.mp3')
  const args = [
    path.join(alignerScriptDir(), 'align.py'),
    '--audio',
    audio,
    '--lyrics',
    lyricsPath,
    '--out',
    outPath,
    '--model',
    options.model ?? 'large-v3-turbo',
    '--tokens-cache',
    path.join(alignDir, `tokens-${options.model ?? 'large-v3-turbo'}${options.separate ? '-sep' : ''}.json`)
  ]
  if (options.separate) args.push('--separate')
  current?.abort()
  current = new AbortController()
  progress({ task: 'align', fraction: 0, message: 'Starting aligner…' })
  let lastError: string | undefined
  const res = await run(alignerPython(), ['-u', ...args], {
    signal: current.signal,
    env: { PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    onLine: (line) => {
      if (line.startsWith('{')) {
        try {
          const ev = JSON.parse(line) as { progress?: number; message?: string; error?: string }
          if (ev.error) lastError = ev.error
          else if (typeof ev.progress === 'number') progress({ task: 'align', fraction: ev.progress, message: ev.message ?? '' })
          return
        } catch {
          /* fall through to log */
        }
      }
      log('align', line)
    }
  })
  current = null
  if (res.code !== 0 || !fs.existsSync(outPath)) {
    throw new Error(`Alignment failed: ${lastError ?? res.stderr.slice(-1200)}`)
  }
  const result = JSON.parse(fs.readFileSync(outPath, 'utf8')) as AlignmentResult
  progress({ task: 'align', fraction: 1, message: result.notes ?? 'Alignment finished', done: true })
  return result
}

export function cancelAlignment(): void {
  current?.abort()
  current = null
}
