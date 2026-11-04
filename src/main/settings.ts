import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_FINGLISH_CONVENTIONS, type AppSettings } from '../shared/types'

interface StoredSettings extends Omit<AppSettings, 'hasApiKey'> {
  /** Base64 of safeStorage-encrypted API key (or plain when encryption unavailable, prefixed "plain:"). */
  apiKeyEnc?: string
  recent?: Array<{ path: string; title: string; openedAt: string }>
}

const DEFAULT_MODEL = 'claude-opus-5-5'

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

let cache: StoredSettings | null = null

function load(): StoredSettings {
  if (cache) return cache
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8')
    cache = { model: DEFAULT_MODEL, finglishConventions: DEFAULT_FINGLISH_CONVENTIONS, ...JSON.parse(raw) }
  } catch {
    cache = { model: DEFAULT_MODEL, finglishConventions: DEFAULT_FINGLISH_CONVENTIONS }
  }
  return cache!
}

function persist(): void {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
  fs.writeFileSync(settingsPath(), JSON.stringify(cache, null, 2))
}

export function getSettings(): AppSettings {
  const s = load()
  return {
    hasApiKey: Boolean(s.apiKeyEnc),
    model: s.model || DEFAULT_MODEL,
    finglishConventions: s.finglishConventions || DEFAULT_FINGLISH_CONVENTIONS,
    ytdlpPath: s.ytdlpPath,
    ffmpegPath: s.ffmpegPath,
    pythonPath: s.pythonPath,
    lastProjectDir: s.lastProjectDir
  }
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const s = load()
  const { hasApiKey: _ignored, ...rest } = patch
  Object.assign(s, rest)
  persist()
  return getSettings()
}

export function setApiKey(key: string): void {
  const s = load()
  const trimmed = key.trim()
  if (!trimmed) {
    delete s.apiKeyEnc
  } else if (safeStorage.isEncryptionAvailable()) {
    s.apiKeyEnc = safeStorage.encryptString(trimmed).toString('base64')
  } else {
    s.apiKeyEnc = 'plain:' + Buffer.from(trimmed, 'utf8').toString('base64')
  }
  persist()
}

export function getApiKey(): string | null {
  const s = load()
  if (!s.apiKeyEnc) return null
  if (s.apiKeyEnc.startsWith('plain:')) {
    return Buffer.from(s.apiKeyEnc.slice(6), 'base64').toString('utf8')
  }
  try {
    return safeStorage.decryptString(Buffer.from(s.apiKeyEnc, 'base64'))
  } catch {
    return null
  }
}

export function getModel(): string {
  return load().model || DEFAULT_MODEL
}

export function recentProjects(): Array<{ path: string; title: string; openedAt: string }> {
  return load().recent ?? []
}

export function addRecentProject(p: string, title: string): void {
  const s = load()
  const list = (s.recent ?? []).filter((r) => r.path !== p)
  list.unshift({ path: p, title, openedAt: new Date().toISOString() })
  s.recent = list.slice(0, 12)
  persist()
}
