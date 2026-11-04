import { dialog, BrowserWindow, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { ExportFrame, ExportRequest } from '../shared/types'
import { workDirFor } from './project'
import { requireTool, run } from './tools'
import { log, progress } from './events'
import { getSettings, updateSettings } from './settings'

let current: AbortController | null = null

export function beginExport(projectId: string): { exportDir: string } {
  const dir = path.join(workDirFor(projectId), 'export', String(Date.now()))
  fs.mkdirSync(dir, { recursive: true })
  return { exportDir: dir }
}

export function writeFrame(exportDir: string, file: string, png: ArrayBuffer): void {
  // Guard against path escapes from the renderer.
  const safe = path.basename(file)
  fs.writeFileSync(path.join(exportDir, safe), Buffer.from(png))
}

export async function chooseOutput(defaultName: string, win: BrowserWindow | null): Promise<string | null> {
  const res = await dialog.showSaveDialog(win ?? undefined!, {
    title: 'Export video',
    defaultPath: path.join(getSettings().lastProjectDir ?? app.getPath('videos'), defaultName),
    filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
  })
  if (res.canceled || !res.filePath) return null
  updateSettings({ lastProjectDir: path.dirname(res.filePath) })
  return res.filePath.endsWith('.mp4') ? res.filePath : `${res.filePath}.mp4`
}

function parseTime(line: string): number | null {
  const m = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) return null
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3])
}

export async function finishExport(
  projectId: string,
  exportDir: string,
  req: ExportRequest,
  frames: ExportFrame[]
): Promise<string> {
  const ffmpeg = requireTool('ffmpeg')
  const workDir = workDirFor(projectId)
  if (frames.length === 0) throw new Error('No frames to export')

  // Concat demuxer list. The last file is repeated without a duration so its full duration is honoured.
  const list = ['ffconcat version 1.0']
  for (const f of frames) {
    list.push(`file '${path.basename(f.file)}'`)
    list.push(`duration ${Math.max(0.001, f.duration).toFixed(4)}`)
  }
  list.push(`file '${path.basename(frames[frames.length - 1].file)}'`)
  const listPath = path.join(exportDir, 'frames.ffconcat')
  fs.writeFileSync(listPath, list.join('\n') + '\n')

  const { width: W, height: H, fps } = req
  const audio = path.join(workDir, 'audio.mp3')
  const video = path.join(workDir, 'video.mp4')
  const useVideo = req.background.kind === 'video' && fs.existsSync(video)

  const args: string[] = ['-y', '-hide_banner', '-loglevel', 'info', '-stats']
  let filter: string
  if (useVideo) {
    const bgChain = [
      `scale=${W}:${H}:force_original_aspect_ratio=increase`,
      `crop=${W}:${H}`,
      `fps=${fps}`,
      req.background.blur > 0 ? `gblur=sigma=${Math.max(0.5, req.background.blur / 2)}` : '',
      req.background.dim > 0 ? `drawbox=c=black@${req.background.dim.toFixed(3)}:t=fill` : ''
    ]
      .filter(Boolean)
      .join(',')
    args.push('-i', video)
    args.push('-f', 'concat', '-safe', '0', '-i', listPath)
    args.push('-i', audio)
    filter = `[0:v]${bgChain}[bg];[1:v]format=rgba,fps=${fps}[ov];[bg][ov]overlay=0:0:eof_action=pass,format=yuv420p[v]`
    args.push('-filter_complex', filter, '-map', '[v]', '-map', '2:a')
  } else {
    args.push('-f', 'concat', '-safe', '0', '-i', listPath)
    args.push('-i', audio)
    filter = `[0:v]fps=${fps},scale=${W}:${H},format=yuv420p[v]`
    args.push('-filter_complex', filter, '-map', '[v]', '-map', '1:a')
  }
  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-t',
    req.duration.toFixed(3),
    '-movflags',
    '+faststart',
    '-shortest',
    req.outputPath
  )

  current?.abort()
  current = new AbortController()
  progress({ task: 'export', fraction: 0, message: 'Encoding video…' })
  const res = await run(ffmpeg, args, {
    signal: current.signal,
    onLine: (line) => {
      const t = parseTime(line)
      if (t !== null) {
        progress({
          task: 'export',
          fraction: Math.min(0.99, t / req.duration),
          message: `Encoding… ${Math.floor(t)}s / ${Math.floor(req.duration)}s`
        })
      } else {
        log('export', line)
      }
    }
  })
  current = null
  if (res.code !== 0) {
    throw new Error(`ffmpeg failed: ${res.stderr.split('\n').slice(-12).join('\n')}`)
  }
  // Clean up the PNG frames once the video exists.
  try {
    fs.rmSync(exportDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  progress({ task: 'export', fraction: 1, message: 'Export finished', done: true })
  return req.outputPath
}

export function cancelExport(): void {
  current?.abort()
  current = null
}
