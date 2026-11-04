import { dialog, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { ProjectHandle } from '../shared/types'
import { blankProject, workDirFor, writeProjectJson } from './project'
import { requireTool, run } from './tools'
import { log, progress } from './events'

export async function probeDuration(file: string): Promise<number> {
  const ffprobe = requireTool('ffprobe')
  const res = await run(ffprobe, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file
  ])
  const n = parseFloat(res.stdout.trim())
  if (!Number.isFinite(n)) throw new Error(`Could not read duration of ${path.basename(file)}: ${res.stderr}`)
  return n
}

async function extractAudio(video: string, mp3: string): Promise<void> {
  const ffmpeg = requireTool('ffmpeg')
  progress({ task: 'download', fraction: -1, message: 'Extracting MP3 audio…' })
  const res = await run(ffmpeg, ['-y', '-i', video, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', mp3], {
    onLine: (l) => log('download', l)
  })
  if (res.code !== 0) throw new Error(`ffmpeg failed to extract audio: ${res.stderr.slice(-800)}`)
}

/**
 * Download a YouTube video (<=1080p mp4), extract its audio to mp3 and create a project.
 */
export async function projectFromYoutube(url: string): Promise<ProjectHandle> {
  const ytdlp = requireTool('yt-dlp')
  const ffmpeg = requireTool('ffmpeg')
  const project = blankProject('Untitled')
  const dir = workDirFor(project.id)
  const videoPath = path.join(dir, 'video.mp4')
  const audioPath = path.join(dir, 'audio.mp3')

  progress({ task: 'download', fraction: -1, message: 'Fetching video info…' })
  const info = await run(ytdlp, ['--no-playlist', '--dump-single-json', '--no-warnings', url])
  if (info.code !== 0) throw new Error(`yt-dlp could not read the video: ${info.stderr.slice(-800)}`)
  let meta: { title?: string; uploader?: string; artist?: string; track?: string; duration?: number } = {}
  try {
    meta = JSON.parse(info.stdout)
  } catch {
    /* metadata is optional */
  }
  project.title = meta.track || meta.title || 'Untitled'
  project.artist = meta.artist || meta.uploader || undefined
  project.source = { type: 'youtube', url, audioFile: 'audio.mp3', videoFile: 'video.mp4', durationSec: meta.duration ?? 0 }

  progress({ task: 'download', fraction: 0, message: 'Downloading video…' })
  const dl = await run(
    ytdlp,
    [
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '--ffmpeg-location',
      path.dirname(ffmpeg),
      '-f',
      'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
      '--merge-output-format',
      'mp4',
      '-o',
      videoPath,
      '--write-thumbnail',
      '--convert-thumbnails',
      'jpg',
      url
    ],
    {
      onLine: (line) => {
        log('download', line)
        const m = line.match(/\[download\]\s+([\d.]+)%/)
        if (m) progress({ task: 'download', fraction: parseFloat(m[1]) / 100, message: `Downloading video… ${m[1]}%` })
      }
    }
  )
  if (dl.code !== 0 || !fs.existsSync(videoPath)) {
    throw new Error(`yt-dlp download failed: ${dl.stderr.slice(-800) || dl.stdout.slice(-800)}`)
  }
  const thumb = fs.readdirSync(dir).find((f) => /^video\.(jpg|jpeg|webp|png)$/i.test(f))
  if (thumb) project.source.thumbnailFile = thumb

  await extractAudio(videoPath, audioPath)
  project.source.durationSec = await probeDuration(audioPath)
  writeProjectJson(project)
  progress({ task: 'download', fraction: 1, message: 'Ready', done: true })
  return { project, workDir: dir }
}

/** Import a local audio (or video) file chosen by the user. */
export async function projectFromFile(win: BrowserWindow | null): Promise<ProjectHandle | null> {
  const res = await dialog.showOpenDialog(win ?? undefined!, {
    title: 'Import audio or video',
    filters: [
      { name: 'Audio / video', extensions: ['mp3', 'm4a', 'wav', 'flac', 'aac', 'ogg', 'mp4', 'mov', 'mkv', 'webm'] }
    ],
    properties: ['openFile']
  })
  if (res.canceled || res.filePaths.length === 0) return null
  return projectFromPath(res.filePaths[0])
}

/** Import a local audio or video file by path (also used for drag-and-drop). */
export async function projectFromPath(src: string): Promise<ProjectHandle> {
  if (!fs.existsSync(src)) throw new Error(`File not found: ${src}`)
  const project = blankProject(path.basename(src, path.extname(src)))
  const dir = workDirFor(project.id)
  const audioPath = path.join(dir, 'audio.mp3')
  const isVideo = /\.(mp4|mov|mkv|webm)$/i.test(src)
  project.source = { type: 'file', originalFileName: path.basename(src), audioFile: 'audio.mp3', durationSec: 0 }

  if (isVideo) {
    progress({ task: 'download', fraction: -1, message: 'Copying video…' })
    const ffmpeg = requireTool('ffmpeg')
    const videoPath = path.join(dir, 'video.mp4')
    if (/\.mp4$/i.test(src)) {
      fs.copyFileSync(src, videoPath)
    } else {
      const conv = await run(ffmpeg, ['-y', '-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', videoPath], {
        onLine: (l) => log('download', l)
      })
      if (conv.code !== 0) throw new Error(`ffmpeg could not convert the video: ${conv.stderr.slice(-800)}`)
    }
    project.source.videoFile = 'video.mp4'
    await extractAudio(videoPath, audioPath)
  } else if (/\.mp3$/i.test(src)) {
    fs.copyFileSync(src, audioPath)
  } else {
    await extractAudio(src, audioPath)
  }
  project.source.durationSec = await probeDuration(audioPath)
  writeProjectJson(project)
  progress({ task: 'download', fraction: 1, message: 'Ready', done: true })
  return { project, workDir: dir }
}
