import fs from 'node:fs'
import path from 'node:path'
import type { AlignmentResult, Line } from '../shared/types'
import { alignerPython, alignerReady, alignerScriptDir, alignerVenvDir, requireTool, run } from './tools'
import { workDirFor } from './project'
import { log, progress } from './events'

let current: AbortController | null = null

/** Library chatter that is not an error and only alarms the user. */
const NOISE = /HF_TOKEN|unauthenticated requests|resource_tracker|warnings\.warn|UserWarning|FutureWarning|leaked semaphore|^\s*$/

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
  const ffmpeg = requireTool('ffmpeg')
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
    path.join(alignDir, `tokens-${options.model ?? 'large-v3-turbo'}${options.separate ? '-sep' : ''}.json`),
    '--ffmpeg',
    ffmpeg
  ]
  if (options.separate) args.push('--separate')
  current?.abort()
  current = new AbortController()
  progress({ task: 'align', fraction: 0, message: 'Starting aligner…' })
  let lastError: string | undefined
  let lastStage = 'starting'
  const logLines: string[] = []
  const res = await run(alignerPython(), ['-u', '-X', 'faulthandler', ...args], {
    signal: current.signal,
    env: { PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', KMP_DUPLICATE_LIB_OK: 'TRUE' },
    onLine: (line) => {
      if (line.startsWith('{')) {
        try {
          const ev = JSON.parse(line) as { progress?: number; message?: string; error?: string }
          if (ev.error) lastError = ev.error
          else if (typeof ev.progress === 'number') {
            lastStage = ev.message ?? lastStage
            progress({ task: 'align', fraction: ev.progress, message: ev.message ?? '' })
          }
          return
        } catch {
          /* fall through to log */
        }
      }
      if (NOISE.test(line)) return
      // Hugging Face download bars look like "model.bin:  45%|████ | 700M/1.5G [00:20<00:25, 32MB/s]"
      const dl = line.match(/^([\w.\-]+):\s+(\d+)%\|.*?\|\s*([\d.]+[kMG]?B?\/[\d.]+[kMG]?B?)/)
      if (dl) {
        progress({ task: 'align', fraction: 0.25 + (parseInt(dl[2]) / 100) * 0.1, message: `Downloading model (first time only): ${dl[1]} ${dl[2]}% (${dl[3]})` })
        return
      }
      logLines.push(line)
      log('align', line)
    }
  })
  const cancelled = current?.signal.aborted ?? false
  current = null
  if (cancelled) {
    progress({ task: 'align', fraction: 1, message: 'Alignment cancelled', done: true })
    throw new Error('Alignment cancelled.')
  }
  const logPath = path.join(alignDir, 'align.log')
  fs.writeFileSync(logPath, `exit code: ${res.code}\nlast stage: ${lastStage}\n\n${res.stdout}\n--- stderr ---\n${res.stderr}`)
  if (res.code !== 0 || !fs.existsSync(outPath)) {
    // Warnings (HF token, resource_tracker) are noise; keep the lines that explain the failure.
    const interesting = logLines.slice(-12)
    const why =
      lastError ??
      (res.code === null || res.code < 0 || res.code > 128
        ? `the Python process was killed (signal / crash, exit ${res.code})`
        : interesting.length
          ? interesting.join('\n')
          : `exit code ${res.code} with no error output`)
    throw new Error(
      `Alignment failed while "${lastStage}".\n${why}\n\nFull log: ${logPath}\nTips: try a smaller model (medium or small) from the dropdown; if the process keeps dying, reinstall the aligner from Settings.`
    )
  }
  const result = JSON.parse(fs.readFileSync(outPath, 'utf8')) as AlignmentResult
  progress({ task: 'align', fraction: 1, message: result.notes ?? 'Alignment finished', done: true })
  return result
}

export function cancelAlignment(): void {
  current?.abort()
  current = null
}
