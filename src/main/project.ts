import { app, dialog, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { ZipArchive } from 'archiver'
import yauzl from 'yauzl'
import { defaultStyle, newId, type Project, type ProjectHandle } from '../shared/types'
import { getSettings, addRecentProject, updateSettings } from './settings'
import { progress } from './events'

export const PROJECT_EXT = 'lvproj'

export function projectsRoot(): string {
  const dir = path.join(app.getPath('userData'), 'projects')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function workDirFor(projectId: string): string {
  const dir = path.join(projectsRoot(), projectId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function blankProject(title: string): Project {
  const now = new Date().toISOString()
  return {
    version: 1,
    id: newId(),
    title,
    source: { type: 'file', audioFile: 'audio.mp3', durationSec: 0 },
    lines: [],
    lyricCandidates: [],
    translationCandidates: [],
    style: defaultStyle(),
    finglishConventions: getSettings().finglishConventions,
    createdAt: now,
    updatedAt: now
  }
}

export function writeProjectJson(project: Project): void {
  const dir = workDirFor(project.id)
  project.updatedAt = new Date().toISOString()
  const tmp = path.join(dir, 'project.json.tmp')
  fs.writeFileSync(tmp, JSON.stringify(project, null, 2))
  fs.renameSync(tmp, path.join(dir, 'project.json'))
}

export function readProjectJson(dir: string): Project {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')) as Project
  // Fill in any fields added after the project was created.
  raw.style = { ...defaultStyle(), ...raw.style }
  raw.lyricCandidates ??= []
  raw.translationCandidates ??= []
  raw.lines ??= []
  return raw
}

export async function saveProject(
  project: Project,
  saveAs: boolean,
  win: BrowserWindow | null
): Promise<string | null> {
  let target = project.savedPath
  if (!target || saveAs) {
    const defaultDir = getSettings().lastProjectDir ?? app.getPath('documents')
    const safeTitle = (project.title || 'untitled').replace(/[\\/:*?"<>|]+/g, '_')
    const res = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Save project',
      defaultPath: path.join(defaultDir, `${safeTitle}.${PROJECT_EXT}`),
      filters: [{ name: 'LyricVideo project', extensions: [PROJECT_EXT] }]
    })
    if (res.canceled || !res.filePath) return null
    target = res.filePath.endsWith(`.${PROJECT_EXT}`) ? res.filePath : `${res.filePath}.${PROJECT_EXT}`
    updateSettings({ lastProjectDir: path.dirname(target) })
  }
  project.savedPath = target
  writeProjectJson(project)
  const dir = workDirFor(project.id)
  progress({ task: 'save', fraction: -1, message: 'Packaging project…' })
  await zipDirectory(dir, target)
  progress({ task: 'save', fraction: 1, message: 'Saved', done: true })
  addRecentProject(target, project.title)
  return target
}

function zipDirectory(dir: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmp = target + '.part'
    const output = fs.createWriteStream(tmp)
    // Media is already compressed; store it rather than deflating 100MB of mp4 for no gain.
    const archive = new ZipArchive({ zlib: { level: 6 } })
    output.on('close', () => {
      fs.renameSync(tmp, target)
      resolve()
    })
    archive.on('error', reject)
    archive.pipe(output)
    for (const entry of fs.readdirSync(dir)) {
      if (entry === 'export' || entry.endsWith('.tmp')) continue
      const full = path.join(dir, entry)
      const stat = fs.statSync(full)
      const store = /\.(mp3|mp4|m4a|webm|jpg|jpeg|png|mkv)$/i.test(entry)
      if (stat.isDirectory()) archive.directory(full, entry)
      else archive.file(full, { name: entry, store })
    }
    archive.finalize().catch(reject)
  })
}

export async function openProjectPath(filePath: string): Promise<ProjectHandle> {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`)
  progress({ task: 'open', fraction: -1, message: 'Unpacking project…' })
  const tmpDir = path.join(projectsRoot(), `incoming-${newId()}`)
  fs.mkdirSync(tmpDir, { recursive: true })
  await extractZipSafely(filePath, tmpDir)
  const project = readProjectJson(tmpDir)
  const dir = path.join(projectsRoot(), project.id)
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  fs.renameSync(tmpDir, dir)
  project.savedPath = filePath
  writeProjectJson(project)
  addRecentProject(filePath, project.title)
  updateSettings({ lastProjectDir: path.dirname(filePath) })
  progress({ task: 'open', fraction: 1, message: 'Opened', done: true })
  return { project, workDir: dir }
}

export async function openProjectDialog(win: BrowserWindow | null): Promise<ProjectHandle | null> {
  const res = await dialog.showOpenDialog(win ?? undefined!, {
    title: 'Open project',
    defaultPath: getSettings().lastProjectDir,
    filters: [{ name: 'LyricVideo project', extensions: [PROJECT_EXT] }],
    properties: ['openFile']
  })
  if (res.canceled || res.filePaths.length === 0) return null
  return openProjectPath(res.filePaths[0])
}

export async function chooseBackgroundImage(
  projectId: string,
  win: BrowserWindow | null
): Promise<string | null> {
  const res = await dialog.showOpenDialog(win ?? undefined!, {
    title: 'Choose background image',
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    properties: ['openFile']
  })
  if (res.canceled || res.filePaths.length === 0) return null
  const src = res.filePaths[0]
  const ext = path.extname(src).toLowerCase()
  const name = `background${ext}`
  fs.copyFileSync(src, path.join(workDirFor(projectId), name))
  return name
}

/**
 * Extract a zip into `dir`, refusing entries that would escape it and skipping symlinks.
 * The package is user data, so it is treated as untrusted.
 */
export function extractZipSafely(zipPath: string, dir: string): Promise<void> {
  const root = path.resolve(dir)
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Could not open package'))
      zip.on('error', reject)
      zip.on('end', resolve)
      zip.on('entry', (entry: yauzl.Entry) => {
        const target = path.resolve(root, entry.fileName)
        const isDir = entry.fileName.endsWith('/')
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000
        const isSymlink = mode === 0o120000
        if (!target.startsWith(root + path.sep) || isSymlink) {
          zip.readEntry()
          return
        }
        if (isDir) {
          fs.mkdirSync(target, { recursive: true })
          zip.readEntry()
          return
        }
        fs.mkdirSync(path.dirname(target), { recursive: true })
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e ?? new Error(`Could not read ${entry.fileName}`))
          const out = fs.createWriteStream(target)
          stream.on('error', reject)
          out.on('error', reject)
          out.on('close', () => zip.readEntry())
          stream.pipe(out)
        })
      })
      zip.readEntry()
    })
  })
}
