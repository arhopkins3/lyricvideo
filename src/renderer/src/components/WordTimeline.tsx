import { useEffect, useRef, useState } from 'react'
import type { Line, Word } from '../../../shared/types'
import { player } from '../lib/player'
import { usePlayerTime } from '../lib/usePlayer'
import { fmtTime } from '../lib/timing'

interface Props {
  line: Line
  onChange: (words: Word[]) => void
}

/**
 * Editor for the words of one line. Shows the line's span as a strip; word boundaries can be dragged,
 * clicking a word seeks to it, and each word has "set start/end to playhead" buttons.
 */
export default function WordTimeline({ line, onChange }: Props): JSX.Element {
  const { time } = usePlayerTime()
  const stripRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const words = line.words
  const timed = words.every((w) => typeof w.start === 'number' && typeof w.end === 'number')
  const pad = 0.4
  const t0 = typeof line.start === 'number' ? Math.max(0, line.start - pad) : 0
  const t1 = typeof line.end === 'number' ? line.end + pad : t0 + 5
  const span = Math.max(0.5, t1 - t0)
  const toX = (t: number) => ((t - t0) / span) * 100

  useEffect(() => {
    if (drag === null) return
    const move = (e: PointerEvent) => {
      const el = stripRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      const t = t0 + frac * span
      const next = words.map((w) => ({ ...w }))
      const a = next[drag]
      const b = next[drag + 1]
      const lo = (a.start ?? t0) + 0.05
      const hi = (b.end ?? t1) - 0.05
      const clamped = Math.min(hi, Math.max(lo, t))
      a.end = clamped
      b.start = clamped
      onChange(next)
    }
    const up = () => setDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, words, onChange, t0, t1, span])

  const setWordTime = (i: number, field: 'start' | 'end', t: number) => {
    const next = words.map((w) => ({ ...w }))
    next[i][field] = t
    // Keep neighbours consistent.
    if (field === 'start' && i > 0 && (next[i - 1].end ?? 0) > t) next[i - 1].end = t
    if (field === 'end' && i < next.length - 1 && (next[i + 1].start ?? Infinity) < t) next[i + 1].start = t
    if (field === 'start' && (next[i].end ?? Infinity) < t + 0.05) next[i].end = t + 0.05
    onChange(next)
  }

  return (
    <div className="word-timeline">
      <div className="row between">
        <h3 className="rtl grow">{line.fa}</h3>
        <span className="muted small mono">
          {fmtTime(line.start)} – {fmtTime(line.end)}
        </span>
      </div>
      {!timed ? (
        <p className="muted small">This line has no word timing yet. Use auto-align, tap mode, or "Distribute evenly".</p>
      ) : (
        <div ref={stripRef} className="strip">
          {words.map((w, i) => {
            const left = toX(w.start!)
            const width = toX(w.end!) - left
            const active = time >= w.start! && time < w.end!
            return (
              <div
                key={w.id}
                className={`word-block ${active ? 'active' : ''}`}
                style={{ left: `${left}%`, width: `${Math.max(0.5, width)}%` }}
                onClick={() => player.seek(w.start!)}
                title={`${fmtTime(w.start)} – ${fmtTime(w.end)}`}
              >
                <span className="fa">{w.fa}</span>
                {w.finglish && <span className="fi">{w.finglish}</span>}
                {i < words.length - 1 && (
                  <div
                    className="boundary"
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      setDrag(i)
                    }}
                  />
                )}
              </div>
            )
          })}
          <div className="playhead" style={{ left: `${Math.min(100, Math.max(0, toX(time)))}%` }} />
        </div>
      )}
      <table className="word-table">
        <tbody>
          {words.map((w, i) => (
            <tr key={w.id} className={time >= (w.start ?? Infinity) && time < (w.end ?? -1) ? 'active' : ''}>
              <td className="rtl fa-cell">{w.fa}</td>
              <td className="muted small">{w.finglish ?? ''}</td>
              <td className="mono small">
                <button className="btn tiny" onClick={() => setWordTime(i, 'start', time)} title="Set start to playhead">
                  ⇤ {fmtTime(w.start)}
                </button>
              </td>
              <td className="mono small">
                <button className="btn tiny" onClick={() => setWordTime(i, 'end', time)} title="Set end to playhead">
                  {fmtTime(w.end)} ⇥
                </button>
              </td>
              <td>
                <button className="btn tiny ghost" onClick={() => typeof w.start === 'number' && player.seek(w.start)}>
                  ▶
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
