import { useEffect, useRef, useState } from 'react'
import type { Line, Word } from '../../../shared/types'
import { player } from '../lib/player'
import { usePlayerTime } from '../lib/usePlayer'
import { fmtTime, moveWords, wordRange } from '../lib/timing'

interface Props {
  lines: Line[]
  /** Pixels per second of the waveform above, so the track lines up with it. */
  pxPerSec: number
  /** Current horizontal scroll of the waveform in pixels. */
  scrollLeft: number
  /** Visible width in pixels. */
  viewWidth: number
  selectedLineId: string | null
  onSelectLine: (id: string) => void
  onWordsChange: (lineId: string, words: Word[]) => void
}

type Drag =
  | { kind: 'group'; originX: number; lines: Line[] }
  | { kind: 'edge'; lineId: string; wordIndex: number; edge: 'start' | 'end'; originX: number; words: Word[] }
  | { kind: 'band'; originX: number; currentX: number; additive: boolean }

const MIN_LEN = 0.05

/**
 * A second track under the waveform: one block per word, placed where the word becomes highlighted.
 *  - drag a word to slide it (edges that touched a neighbour stay attached)
 *  - drag a word's left/right edge to change where it starts/ends
 *  - click to select; ⇧-click selects a range; ⌘/Ctrl-click toggles; drag on empty track to box-select
 *  - ⌥-drag selects the word and the rest of its line
 *  - with a selection: drag any selected word to move them all; ← / → nudge by 50 ms (⇧ for 10 ms)
 */
export default function WordTrack(props: Props): JSX.Element {
  const { lines, pxPerSec, scrollLeft, viewWidth } = props
  const { time } = usePlayerTime()
  const [drag, setDrag] = useState<Drag | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const selRef = useRef(selected)
  selRef.current = selected

  const applyMove = (base: Line[], ids: Set<string>, delta: number) => {
    for (const [lineId, words] of moveWords(base, ids, delta)) propsRef.current.onWordsChange(lineId, words)
  }

  // ---- dragging
  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      if (drag.kind === 'band') {
        setDrag({ ...drag, currentX: e.clientX })
        return
      }
      const dt = (e.clientX - drag.originX) / pxPerSec
      if (drag.kind === 'group') {
        applyMove(drag.lines, selRef.current, dt)
        return
      }
      const words = drag.words.map((w) => ({ ...w }))
      const w = words[drag.wordIndex]
      const prev = words[drag.wordIndex - 1]
      const next = words[drag.wordIndex + 1]
      const o = drag.words[drag.wordIndex]
      if (o.start === undefined || o.end === undefined) return
      if (drag.edge === 'start') {
        const lo = prev?.start !== undefined ? prev.start + MIN_LEN : 0
        w.start = Math.min(o.end - MIN_LEN, Math.max(lo, o.start + dt))
      } else {
        const hi = next?.end !== undefined ? next.end : Infinity
        w.end = Math.min(hi, Math.max(o.start + MIN_LEN, o.end + dt))
      }
      propsRef.current.onWordsChange(drag.lineId, words)
    }
    const up = (e: PointerEvent) => {
      if (drag.kind === 'band') {
        const rect = trackRef.current?.getBoundingClientRect()
        if (rect) {
          const x0 = Math.min(drag.originX, e.clientX) - rect.left + scrollLeft
          const x1 = Math.max(drag.originX, e.clientX) - rect.left + scrollLeft
          if (x1 - x0 < 4) {
            // A plain click on empty track: seek and clear the selection.
            player.seek(x0 / pxPerSec)
            if (!drag.additive) setSelected(new Set())
          } else {
            const t0 = x0 / pxPerSec
            const t1 = x1 / pxPerSec
            const hit = propsRef.current.lines.flatMap((l) =>
              l.words.filter((w) => w.start !== undefined && w.end !== undefined && w.end > t0 && w.start < t1).map((w) => w.id)
            )
            setSelected((s) => new Set(drag.additive ? [...s, ...hit] : hit))
          }
        }
      }
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, pxPerSec, scrollLeft])

  // ---- keyboard nudging of the selection
  useEffect(() => {
    if (selected.size === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelected(new Set())
        return
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return
      e.preventDefault()
      const delta = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.01 : 0.05)
      applyMove(propsRef.current.lines, selected, delta)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const visibleStart = scrollLeft / pxPerSec
  const visibleEnd = (scrollLeft + viewWidth) / pxPerSec

  const selectWord = (line: Line, w: Word, e: React.MouseEvent | React.PointerEvent): Set<string> => {
    let next: Set<string>
    if (e.shiftKey && anchor) {
      next = new Set([...(e.metaKey || e.ctrlKey ? selected : []), ...wordRange(lines, anchor, w.id)])
    } else if (e.metaKey || e.ctrlKey) {
      next = new Set(selected)
      if (next.has(w.id)) next.delete(w.id)
      else next.add(w.id)
      setAnchor(w.id)
    } else if (e.altKey) {
      const i = line.words.indexOf(w)
      next = new Set(line.words.slice(i).map((x) => x.id))
      setAnchor(w.id)
    } else if (selected.has(w.id)) {
      next = selected // dragging a member of the selection keeps the group
    } else {
      next = new Set([w.id])
      setAnchor(w.id)
    }
    setSelected(next)
    selRef.current = next
    props.onSelectLine(line.id)
    return next
  }

  const bandRect = (() => {
    if (!drag || drag.kind !== 'band') return null
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return null
    const a = Math.min(drag.originX, drag.currentX) - rect.left
    const b = Math.max(drag.originX, drag.currentX) - rect.left
    return b - a < 4 ? null : { left: a, width: b - a }
  })()

  return (
    <div
      className="word-track"
      ref={trackRef}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        setDrag({ kind: 'band', originX: e.clientX, currentX: e.clientX, additive: e.shiftKey || e.metaKey || e.ctrlKey })
      }}
    >
      <div className="word-track-inner" style={{ transform: `translateX(${-scrollLeft}px)` }}>
        {lines.map((line, li) =>
          line.words.map((w, wi) => {
            if (w.start === undefined || w.end === undefined) return null
            if (w.end < visibleStart - 1 || w.start > visibleEnd + 1) return null
            const left = w.start * pxPerSec
            const width = Math.max(8, (w.end - w.start) * pxPerSec)
            const active = time >= w.start && time < w.end
            const isSel = selected.has(w.id)
            const inSelectedLine = props.selectedLineId === line.id
            return (
              <div
                key={w.id}
                className={`wt-word ${active ? 'active' : ''} ${isSel ? 'selected' : ''} ${inSelectedLine ? 'in-line' : ''} ${li % 2 ? 'odd' : ''}`}
                style={{ left, width }}
                title={`${w.fa}${w.finglish ? ` (${w.finglish})` : ''}  ${fmtTime(w.start)} – ${fmtTime(w.end)}`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  e.stopPropagation()
                  selectWord(line, w, e)
                  if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
                    player.seek(w.start!)
                    setDrag({ kind: 'group', originX: e.clientX, lines: propsRef.current.lines })
                  }
                }}
              >
                <div
                  className="wt-handle left"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    setDrag({ kind: 'edge', lineId: line.id, wordIndex: wi, edge: 'start', originX: e.clientX, words: line.words })
                  }}
                />
                {width > 26 && (
                  <div className="wt-label">
                    <span className="rtl">{w.fa}</span>
                    {width > 60 && w.finglish && <small>{w.finglish}</small>}
                  </div>
                )}
                <div
                  className="wt-handle right"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    setDrag({ kind: 'edge', lineId: line.id, wordIndex: wi, edge: 'end', originX: e.clientX, words: line.words })
                  }}
                />
              </div>
            )
          })
        )}
        <div className="wt-playhead" style={{ left: time * pxPerSec }} />
      </div>
      {bandRect && <div className="wt-band" style={bandRect} />}
      {selected.size > 1 && <div className="wt-hint">{selected.size} words selected · drag any of them to move together · Esc to clear</div>}
    </div>
  )
}
