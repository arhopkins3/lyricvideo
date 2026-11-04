import { useState } from 'react'
import { useStore, guarded } from '../store'
import { setLineFinglish } from '../lib/lines'
import { Markdown } from '../lib/markdown'
import ProgressBar, { LogPanel } from './ProgressBar'

export default function StepText(): JSX.Element {
  const handle = useStore((s) => s.handle)!
  const updateProject = useStore((s) => s.updateProject)
  const setStep = useStore((s) => s.setStep)
  const settings = useStore((s) => s.settings)
  const p = handle.project
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [showSong, setShowSong] = useState(false)
  const [showCandidates, setShowCandidates] = useState(false)
  const canUseClaude = Boolean(settings?.hasApiKey) && p.lines.length > 0

  /** Latest project state (the enrich pipeline runs several steps and must not use a stale closure). */
  const current = () => useStore.getState().handle!.project

  const generate = async (what: 'finglish' | 'english' | 'both', onlyEmpty: boolean): Promise<boolean> => {
    const pr0 = current()
    const lines = pr0.lines.filter((l) =>
      !onlyEmpty ? true : what === 'english' ? !l.en : what === 'finglish' ? !l.finglish : !l.en || !l.finglish
    )
    if (lines.length === 0) return true
    setBusy('text')
    const res = await guarded(() =>
      window.api.claude.generateText({
        projectId: pr0.id,
        lines,
        what,
        conventions: pr0.finglishConventions,
        title: pr0.title,
        artist: pr0.artist
      })
    )
    setBusy(null)
    if (!res) return false
    updateProject((pr) => ({
      ...pr,
      lines: pr.lines.map((l) => {
        const r = res.lines.find((x) => x.id === l.id)
        if (!r) return l
        let next = { ...l }
        if (r.en !== undefined) next.en = r.en
        if (r.finglish !== undefined) {
          next.finglish = r.finglish
          if (r.words) next.words = next.words.map((w) => ({ ...w, finglish: r.words!.find((x) => x.id === w.id)?.finglish ?? w.finglish }))
        }
        return next
      })
    }))
    return true
  }

  const explainAll = async (onlyMissing: boolean): Promise<boolean> => {
    const pr0 = current()
    const lineIds = pr0.lines.filter((l) => !onlyMissing || !l.explanation).map((l) => l.id)
    if (lineIds.length === 0) return true
    setBusy('explain')
    const res = await guarded(() => window.api.claude.explainLines({ lines: pr0.lines, lineIds, title: pr0.title, artist: pr0.artist }))
    setBusy(null)
    if (!res) return false
    updateProject((pr) => ({
      ...pr,
      lines: pr.lines.map((l) => {
        const r = res.lines.find((x) => x.id === l.id)
        if (!r) return l
        return {
          ...l,
          explanation: r.explanation,
          words: l.words.map((w) => ({ ...w, gloss: r.words.find((x) => x.id === w.id)?.gloss ?? w.gloss }))
        }
      })
    }))
    return true
  }

  const explainSongIfMissing = async (force: boolean): Promise<boolean> => {
    if (!force && current().songExplanation) return true
    setBusy('song')
    const text = await guarded(() => {
      const pr0 = current()
      return window.api.claude.explainSong({ lines: pr0.lines, title: pr0.title, artist: pr0.artist })
    })
    setBusy(null)
    if (!text) return false
    updateProject((pr) => ({ ...pr, songExplanation: text }))
    return true
  }

  /** One click: transliteration + translation, then every line's meaning and word glosses, then the song overview. */
  const enrichAll = async (force: boolean) => {
    setBusy('all')
    const ok = (await generate('both', !force)) && (await explainAll(!force)) && (await explainSongIfMissing(force))
    setBusy(null)
    if (ok) useStore.getState().setNotice('All metadata generated and stored in the project. Save (⌘S) to keep it in the package.')
  }

  const searchTranslations = async () => {
    setBusy('translations')
    const res = await guarded(() => window.api.claude.searchTranslations(p.id, p.lines, { title: p.title, artist: p.artist }))
    setBusy(null)
    if (res) {
      updateProject((pr) => ({ ...pr, translationCandidates: [...res, ...pr.translationCandidates] }))
      setShowCandidates(true)
    }
  }

  const applyTranslation = (id: string, onlyEmpty: boolean) => {
    const c = p.translationCandidates.find((x) => x.id === id)
    if (!c) return
    updateProject((pr) => ({
      ...pr,
      lines: pr.lines.map((l, i) => {
        const t = c.lines[i]?.trim()
        if (!t) return l
        if (onlyEmpty && l.en) return l
        return { ...l, en: t }
      })
    }))
  }

  const explainLine = async (lineId: string) => {
    setBusy(lineId)
    const text = await guarded(() => window.api.claude.explainLine({ lines: p.lines, lineId, title: p.title, artist: p.artist }))
    setBusy(null)
    if (text) {
      updateProject((pr) => ({ ...pr, lines: pr.lines.map((l) => (l.id === lineId ? { ...l, explanation: text } : l)) }))
      setOpen(lineId)
    }
  }

  const explainSong = async () => {
    if (await explainSongIfMissing(true)) setShowSong(true)
  }

  const setField = (lineId: string, field: 'finglish' | 'en', value: string) =>
    updateProject((pr) => ({
      ...pr,
      lines: pr.lines.map((l) => (l.id !== lineId ? l : field === 'finglish' ? setLineFinglish(l, value) : { ...l, en: value }))
    }))

  return (
    <div className="step">
      <div className="row between wrap">
        <h2>Transliteration, translation &amp; meaning</h2>
        <div className="row wrap">
          <button className="btn primary" disabled={!canUseClaude || !!busy} onClick={() => enrichAll(false)} title="Finglish, English, every line's meaning with word glosses, and the song overview — only what is still missing">
            {busy === 'all' ? 'Generating…' : 'Generate everything with Claude'}
          </button>
          <details className="more-actions">
            <summary className="btn small ghost">More…</summary>
            <div className="row wrap">
              <button className="btn small" disabled={!canUseClaude || !!busy} onClick={() => enrichAll(true)}>
                Regenerate everything
              </button>
              <button className="btn small" disabled={!canUseClaude || !!busy} onClick={() => generate('finglish', false)}>
                Finglish only
              </button>
              <button className="btn small" disabled={!canUseClaude || !!busy} onClick={() => generate('english', false)}>
                English only
              </button>
              <button className="btn small" disabled={!canUseClaude || !!busy} onClick={() => explainAll(false)}>
                Re-explain all lines
              </button>
              <button className="btn small" disabled={!canUseClaude || !!busy} onClick={explainSong}>
                {p.songExplanation ? 'Re-explain song' : 'Explain the song'}
              </button>
              <button className="btn small" disabled={!canUseClaude || !!busy} onClick={searchTranslations}>
                Search web for translations
              </button>
            </div>
          </details>
        </div>
      </div>
      <MetaSummary />
      <ProgressBar task="text" />
      <ProgressBar task="translations" />
      <ProgressBar task="explain" />
      {busy === 'translations' && <LogPanel task="translations" rows={3} />}

      {p.songExplanation && (
        <div className="card">
          <div className="row between">
            <h3>About this song</h3>
            <button className="btn small ghost" onClick={() => setShowSong(!showSong)}>
              {showSong ? 'Hide' : 'Show'}
            </button>
          </div>
          {showSong && <Markdown text={p.songExplanation} />}
        </div>
      )}

      {p.translationCandidates.length > 0 && (
        <div className="card">
          <div className="row between">
            <h3>Translations found on the web ({p.translationCandidates.length})</h3>
            <button className="btn small ghost" onClick={() => setShowCandidates(!showCandidates)}>
              {showCandidates ? 'Hide' : 'Show'}
            </button>
          </div>
          {showCandidates &&
            p.translationCandidates.map((c) => (
              <div key={c.id} className="candidate">
                <div className="row between">
                  <div>
                    <b>{c.source}</b>{' '}
                    {c.url && (
                      <button className="link small" onClick={() => window.api.shell.openExternal(c.url!)}>
                        {c.url}
                      </button>
                    )}
                    <div className="muted small">
                      {c.lines.filter((x) => x.trim()).length} of {p.lines.length} lines translated. {c.notes}
                    </div>
                  </div>
                  <div className="row">
                    <button className="btn small" onClick={() => applyTranslation(c.id, true)}>
                      Fill empty lines
                    </button>
                    <button className="btn small primary" onClick={() => applyTranslation(c.id, false)}>
                      Use for all lines
                    </button>
                  </div>
                </div>
                <details>
                  <summary className="small muted">Preview</summary>
                  <ol className="translation-preview">
                    {c.lines.map((t, i) => (
                      <li key={i}>
                        <span className="rtl">{p.lines[i]?.fa}</span>
                        <span>{t || <i className="muted">—</i>}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              </div>
            ))}
        </div>
      )}

      <table className="lines-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Farsi</th>
            <th>Finglish</th>
            <th>English</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {p.lines.map((l, i) => (
            <LineRows
              key={l.id}
              index={i}
              line={l}
              open={open === l.id}
              busy={busy === l.id}
              canExplain={canUseClaude && !busy}
              onToggle={() => setOpen(open === l.id ? null : l.id)}
              onExplain={() => explainLine(l.id)}
              onChange={(f, v) => setField(l.id, f, v)}
            />
          ))}
        </tbody>
      </table>
      <div className="row end">
        <button className="btn primary" onClick={() => setStep('align')}>
          Next: align to audio →
        </button>
      </div>
    </div>
  )
}

function LineRows(props: {
  index: number
  line: import('../../../shared/types').Line
  open: boolean
  busy: boolean
  canExplain: boolean
  onToggle: () => void
  onExplain: () => void
  onChange: (field: 'finglish' | 'en', value: string) => void
}): JSX.Element {
  const { line: l, index: i } = props
  const perWordOk = l.words.every((w) => w.finglish !== undefined)
  return (
    <>
      <tr>
        <td className="muted">{i + 1}</td>
        <td className="rtl fa-cell">{l.fa}</td>
        <td>
          <input
            value={l.finglish ?? ''}
            placeholder="finglish"
            onChange={(e) => props.onChange('finglish', e.target.value)}
            title={perWordOk ? 'Per-word highlighting enabled' : `Needs exactly ${l.words.length} words for per-word highlighting`}
            className={l.finglish && !perWordOk ? 'warn-border' : ''}
          />
        </td>
        <td>
          <input value={l.en ?? ''} placeholder="english" onChange={(e) => props.onChange('en', e.target.value)} />
        </td>
        <td className="nowrap">
          {l.explanation ? (
            <button className="btn small" onClick={props.onToggle}>
              {props.open ? 'Hide' : 'Meaning'}
            </button>
          ) : (
            <button className="btn small ghost" onClick={props.onExplain} disabled={!props.canExplain}>
              {props.busy ? '…' : 'Explain'}
            </button>
          )}
        </td>
      </tr>
      {props.open && l.explanation && (
        <tr className="explanation-row">
          <td></td>
          <td colSpan={4}>
            {l.words.some((w) => w.gloss) && (
              <div className="gloss-row">
                {l.words.map((w) => (
                  <span key={w.id} className="gloss-chip">
                    <span className="rtl">{w.fa}</span>
                    <small>{w.gloss ?? '…'}</small>
                  </span>
                ))}
              </div>
            )}
            <Markdown text={l.explanation} />
            <button className="link small" onClick={props.onExplain} disabled={!props.canExplain}>
              Regenerate explanation
            </button>
          </td>
        </tr>
      )}
    </>
  )
}

function MetaSummary(): JSX.Element {
  const p = useStore((s) => s.handle!.project)
  const n = p.lines.length
  const count = (f: (l: import('../../../shared/types').Line) => boolean) => p.lines.filter(f).length
  const items = [
    ['Finglish', count((l) => !!l.finglish)],
    ['English', count((l) => !!l.en)],
    ['Line meanings', count((l) => !!l.explanation)],
    ['Word glosses', count((l) => l.words.length > 0 && l.words.every((w) => !!w.gloss))]
  ] as const
  return (
    <div className="meta-summary">
      {items.map(([label, c]) => (
        <span key={label} className={`pill ${c === n && n > 0 ? 'high' : c > 0 ? 'medium' : ''}`}>
          {label} {c}/{n}
        </span>
      ))}
      <span className={`pill ${p.songExplanation ? 'high' : ''}`}>Song overview {p.songExplanation ? '✓' : '–'}</span>
      <span className="muted small">All of this is stored in the project and travels with the .lvproj package.</span>
    </div>
  )
}
