import { useEffect, useState } from 'react'
import { useStore, guarded } from '../store'
import { mergeLines } from '../lib/lines'
import ProgressBar, { LogPanel } from './ProgressBar'

export default function StepLyrics(): JSX.Element {
  const handle = useStore((s) => s.handle)!
  const updateProject = useStore((s) => s.updateProject)
  const setStep = useStore((s) => s.setStep)
  const settings = useStore((s) => s.settings)
  const p = handle.project
  const [title, setTitle] = useState(p.title)
  const [artist, setArtist] = useState(p.artist ?? '')
  const [hints, setHints] = useState('')
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState(p.lines.map((l) => l.fa).join('\n'))
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    setText(p.lines.map((l) => l.fa).join('\n'))
  }, [p.id, p.lines])

  const search = async () => {
    setBusy(true)
    const res = await guarded(() => window.api.claude.searchLyrics(p.id, { title, artist, hints }))
    setBusy(false)
    if (res) {
      updateProject((pr) => ({ ...pr, lyricCandidates: [...res, ...pr.lyricCandidates] }))
    }
  }

  const useCandidate = (id: string) => {
    const c = p.lyricCandidates.find((x) => x.id === id)
    if (!c) return
    updateProject((pr) => ({
      ...pr,
      chosenLyricCandidateId: id,
      lines: mergeLines(pr.lines, c.text),
      title: pr.title === 'Untitled' && c.title ? c.title : pr.title,
      artist: pr.artist || c.artist || pr.artist
    }))
    setText(c.text)
  }

  const apply = () => updateProject((pr) => ({ ...pr, lines: mergeLines(pr.lines, text) }))
  const dirtyText = text.trim() !== p.lines.map((l) => l.fa).join('\n').trim()

  return (
    <div className="step two-col">
      <div className="col">
        <h2>Find lyrics</h2>
        <div className="card">
          <label className="field">
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>Artist</span>
            <input value={artist} onChange={(e) => setArtist(e.target.value)} />
          </label>
          <label className="field">
            <span>Hints (album, year, a line you remember…)</span>
            <input value={hints} onChange={(e) => setHints(e.target.value)} />
          </label>
          <button className="btn primary" onClick={search} disabled={busy || !settings?.hasApiKey}>
            {busy ? 'Searching…' : 'Search the web with Claude'}
          </button>
          {!settings?.hasApiKey && <p className="muted small">Add an API key in Settings to search.</p>}
          <ProgressBar task="lyrics" />
          {busy && <LogPanel task="lyrics" rows={4} />}
        </div>

        {p.lyricCandidates.length > 0 && (
          <div className="candidates">
            <h3>Candidates ({p.lyricCandidates.length})</h3>
            {p.lyricCandidates.map((c) => (
              <div key={c.id} className={`card candidate ${p.chosenLyricCandidateId === c.id ? 'chosen' : ''}`}>
                <div className="row between">
                  <div>
                    <b>{c.source}</b> <span className={`pill ${c.confidence ?? ''}`}>{c.confidence}</span>
                    <div className="muted small">
                      {c.title}
                      {c.artist ? ` — ${c.artist}` : ''} · {c.text.split('\n').length} lines
                    </div>
                  </div>
                  <div className="row">
                    {c.url && (
                      <button className="btn small ghost" onClick={() => window.api.shell.openExternal(c.url!)}>
                        Source ↗
                      </button>
                    )}
                    <button className="btn small" onClick={() => setPreview(preview === c.id ? null : c.id)}>
                      {preview === c.id ? 'Hide' : 'Preview'}
                    </button>
                    <button className="btn small primary" onClick={() => useCandidate(c.id)}>
                      Use this
                    </button>
                  </div>
                </div>
                {c.notes && <p className="small">{c.notes}</p>}
                {preview === c.id && <pre className="lyrics-preview rtl">{c.text}</pre>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="col">
        <h2>Lyrics ({p.lines.length} lines)</h2>
        <p className="muted small">
          One lyric line per row. Edit freely (paste your own lyrics here if you prefer). Lines whose text does not change keep
          their timing and translations.
        </p>
        <textarea className="lyrics-editor rtl" rows={24} value={text} onChange={(e) => setText(e.target.value)} dir="rtl" />
        <div className="row between">
          <button className="btn" onClick={apply} disabled={!dirtyText}>
            Apply changes
          </button>
          <button className="btn primary" onClick={() => setStep('text')} disabled={p.lines.length === 0}>
            Next: translate →
          </button>
        </div>
      </div>
    </div>
  )
}
