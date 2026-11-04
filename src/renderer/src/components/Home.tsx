import React, { useEffect, useState } from 'react'
import { useStore, guarded } from '../store'
import ProgressBar, { LogPanel } from './ProgressBar'

export default function Home(): JSX.Element {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [recent, setRecent] = useState<Array<{ path: string; title: string; openedAt: string }>>([])
  const setHandle = useStore((s) => s.setHandle)
  const tools = useStore((s) => s.tools)
  const settings = useStore((s) => s.settings)
  const setShowSettings = useStore((s) => s.setShowSettings)

  useEffect(() => {
    window.api.project.recent().then(setRecent)
  }, [])

  const fromYoutube = async () => {
    if (!url.trim()) return
    setBusy(true)
    const h = await guarded(() => window.api.project.fromYoutube(url.trim()))
    setBusy(false)
    if (h) setHandle(h)
  }
  const fromFile = async () => {
    setBusy(true)
    const h = await guarded(() => window.api.project.fromFile())
    setBusy(false)
    if (h) setHandle(h)
  }
  const open = async (path?: string) => {
    setBusy(true)
    const h = await guarded(() => (path ? window.api.project.openPath(path) : window.api.project.open()))
    setBusy(false)
    if (h) setHandle(h)
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    const path = file ? window.api.files.pathFor(file) : ''
    if (!path) return
    setBusy(true)
    const h = await guarded(() => window.api.project.importPath(path))
    setBusy(false)
    if (h) setHandle(h)
  }

  const missing: string[] = []
  if (tools && !tools.ytdlp.found) missing.push('yt-dlp')
  if (tools && !tools.ffmpeg.found) missing.push('ffmpeg')

  return (
    <div className="home" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <h1>Build a Farsi lyric video</h1>
      <p className="muted">
        Import a song, let Claude find the lyrics, add Finglish and English, time every word on the waveform, and
        export a karaoke-style video.
      </p>

      {(missing.length > 0 || (settings && !settings.hasApiKey)) && (
        <div className="card warn">
          {missing.length > 0 && (
            <p>
              Missing tools: <b>{missing.join(', ')}</b>. Install with Homebrew:
              <code> brew install {missing.join(' ')}</code>
            </p>
          )}
          {settings && !settings.hasApiKey && (
            <p>
              No Anthropic API key yet. Lyric search, translation and explanations need one.{' '}
              <button className="link" onClick={() => setShowSettings(true)}>
                Open Settings
              </button>
            </p>
          )}
        </div>
      )}

      <div className="home-grid">
        <section className="card">
          <h2>From YouTube</h2>
          <p className="muted small">The video is downloaded (up to 1080p) and its audio extracted to MP3. The video can be used as the background.</p>
          <div className="row">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              onKeyDown={(e) => e.key === 'Enter' && fromYoutube()}
              disabled={busy}
            />
            <button className="btn primary" onClick={fromYoutube} disabled={busy || !url.trim()}>
              Download
            </button>
          </div>
          <ProgressBar task="download" />
          <LogPanel task="download" rows={3} />
        </section>
        <section className="card">
          <h2>From a file</h2>
          <p className="muted small">Import an MP3 (or any audio/video file on your Mac).</p>
          <button className="btn" onClick={fromFile} disabled={busy}>
            Choose file…
          </button>
          <p className="muted small">…or drop a file anywhere on this screen.</p>
        </section>
        <section className="card">
          <h2>Open a project</h2>
          <p className="muted small">Open a saved .lvproj package with everything inside it.</p>
          <button className="btn" onClick={() => open()} disabled={busy}>
            Open…
          </button>
          {recent.length > 0 && (
            <ul className="recent">
              {recent.map((r) => (
                <li key={r.path}>
                  <button className="link" onClick={() => open(r.path)} disabled={busy} title={r.path}>
                    {r.title}
                  </button>
                  <span className="muted small">{new Date(r.openedAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
