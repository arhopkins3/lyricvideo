import { useRef, useState } from 'react'
import { useStore, guarded, mediaUrl } from '../store'
import { renderExportFrames, planExport } from '../render/exportFrames'
import { hasTiming } from '../lib/timing'
import ProgressBar, { LogPanel } from './ProgressBar'

export default function StepExport(): JSX.Element {
  const handle = useStore((s) => s.handle)!
  const save = useStore((s) => s.save)
  const p = handle.project
  const [busy, setBusy] = useState(false)
  const [renderMsg, setRenderMsg] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const duration = p.source.durationSec
  const timed = p.lines.filter(hasTiming).length
  const plan = planExport(p, duration)
  const bg = p.style.background

  const run = async () => {
    const safe = (p.title || 'lyric-video').replace(/[\\/:*?"<>|]+/g, '_')
    const out = await window.api.exporter.chooseOutput(`${safe}.mp4`)
    if (!out) return
    setBusy(true)
    setResult(null)
    abort.current = new AbortController()
    const res = await guarded(async () => {
      const { exportDir } = await window.api.exporter.begin(p.id)
      let bgImage: HTMLImageElement | null = null
      if (bg.kind === 'image' && bg.imageFile) {
        bgImage = await loadImage(mediaUrl(p.id, bg.imageFile)!)
      }
      const frames = await renderExportFrames(p, duration, exportDir, bgImage, (f, m) => setRenderMsg(`${Math.round(f * 100)}% · ${m}`), abort.current!.signal)
      setRenderMsg(null)
      return window.api.exporter.finish(
        p.id,
        exportDir,
        { outputPath: out, width: p.style.width, height: p.style.height, fps: p.style.fps, duration, background: bg },
        frames
      )
    })
    setBusy(false)
    setRenderMsg(null)
    if (res) setResult(res)
  }

  const cancel = () => {
    abort.current?.abort()
    window.api.exporter.cancel()
  }

  return (
    <div className="step narrow">
      <h2>Export video</h2>
      <div className="card">
        <dl className="meta">
          <dt>Output</dt>
          <dd>
            {p.style.width} × {p.style.height} @ {p.style.fps} fps, H.264 MP4 with AAC audio
          </dd>
          <dt>Background</dt>
          <dd>{bg.kind === 'video' ? 'original video (composited with ffmpeg)' : bg.kind}</dd>
          <dt>Lines</dt>
          <dd>
            {timed} of {p.lines.length} lines timed{timed < p.lines.length ? ' — untimed lines will not appear' : ''}
          </dd>
          <dt>Frames</dt>
          <dd>{plan.segments.length} distinct frames to render (one per word change)</dd>
        </dl>
        <div className="row">
          <button className="btn primary" onClick={run} disabled={busy || timed === 0}>
            {busy ? 'Exporting…' : 'Export MP4…'}
          </button>
          {busy && (
            <button className="btn ghost" onClick={cancel}>
              Cancel
            </button>
          )}
        </div>
        {renderMsg && <p className="small">{renderMsg}</p>}
        <ProgressBar task="export" />
        {busy && <LogPanel task="export" rows={3} />}
        {result && (
          <p className="small">
            Done: <span className="mono">{result}</span>{' '}
            <button className="link" onClick={() => window.api.shell.showInFolder(result)}>
              Show in Finder
            </button>
          </p>
        )}
      </div>

      <div className="card">
        <h3>Save project package</h3>
        <p className="muted small">
          A <code>.lvproj</code> file keeps the audio, the video, lyrics, timing, translations, explanations and style so you can
          reopen it later and keep learning or re-export.
        </p>
        <div className="row">
          <button className="btn" onClick={() => save(false)}>
            Save
          </button>
          <button className="btn ghost" onClick={() => save(true)}>
            Save as…
          </button>
          {p.savedPath && <span className="muted small mono">{p.savedPath}</span>}
        </div>
        <ProgressBar task="save" />
      </div>
    </div>
  )
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load background image'))
    img.src = url
  })
}
