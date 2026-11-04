import { useEffect, useRef, useState } from 'react'
import type { Line, Word } from '../../../shared/types'
import { player } from '../lib/player'
import { usePlayerTime } from '../lib/usePlayer'
import { fmtTime } from '../lib/timing'

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

type Drag = { lineId: string; wordIndex: number; mode: 'move' | 'start' | 'end' | 'ripple'; originX: number; words: Word[] }

const MIN_LEN = 0.05

/**
 * A second track under the waveform: one block per word, placed where the word becomes highlighted.
 * Drag a block to slide it, drag its left/right edge to change where it starts/ends,
 * ⌥-drag to slide it together with every later word in the line,
 * click to select, then ← / → nudge by 50 ms (⇧ for 10 ms).
 */
export default function WordTrack(props: Props): JSX.Element {
  const { lines, pxPerSec, scrollLeft, viewWidth } = props
  const { time } = usePlayerTime()
  const [drag, setDrag] = useState<Drag | null>(null)
  const [selected, setSelected] = useState<{ lineId: string; wordIndex: number } | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  // ---- dragging
  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      const dt = (e.clientX - drag.originX) / pxPerSec
      const words = drag.words.map((w) => ({ ...w }))
      const w = words[drag.wordIndex]
      const prev = words[drag.wordIndex - 1]
      const next = words[drag.wordIndex + 1]
      const o = drag.words[drag.wordIndex]
      if (o.start === undefined || o.end === undefined) return
      if (drag.mode === 'ripple') {
        // Move this word and every word after it in the line by the same amount.
        const lo = prev?.start !== undefined ? prev.start + MIN_LEN - o.start : -o.start
        const d = Math.max(lo, dt)
        for (let i = drag.wordIndex; i < words.length; i++) {
          const ow = drag.words[i]
          if (ow.start === undefined || ow.end === undefined) continue
          words[i].start = ow.start + d
          words[i].end = ow.end + d
        }
      } else if (drag.mode === 'move') {
        const len = o.end - o.start
        let start = o.start + dt
        const lo = prev?.start !== undefined ? prev.start + MIN_LEN : 0
        const hi = next?.start !== undefined ? next.start - MIN_LEN : Infinity
        start = Math.min(hi, Math.max(lo, start))
        w.start = start
        w.end = start + len
      } else if (drag.mode === 'start') {
        const lo = prev?.start !== undefined ? prev.start + MIN_LEN : 0
        w.start = Math.min(o.end - MIN_LEN, Math.max(lo, o.start + dt))
      } else {
        const hi = next?.end !== undefined ? next.end : Infinity
        w.end = Math.min(hi, Math.max(o.start + MIN_LEN, o.end + dt))
      }
      propsRef.current.onWordsChange(drag.lineId, words)
    }
    const up = () => setDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, pxPerSec])

  // ---- keyboard nudging of the selected word
  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return
      e.preventDefault()
      const line = propsRef.current.lines.find((l) => l.id === selected.lineId)
      if (!line) return
      const delta = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.01 : 0.05)
      const words = line.words.map((w) => ({ ...w }))
      const w = words[selected.wordIndex]
      if (w.start === undefined || w.end === undefined) return
      const prev = words[selected.wordIndex - 1]
      const next = words[selected.wordIndex + 1]
      const lo = prev?.start !== undefined ? prev.start + MIN_LEN : 0
      const hi = next?.start !== undefined ? next.start - MIN_LEN : Infinity
      const start = Math.min(hi, Math.max(lo, w.start + delta))
      const len = w.end - w.start
      w.start = start
      w.end = start + len
      propsRef.current.onWordsChange(line.id, words)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const visibleStart = scrollLeft / pxPerSec
  const visibleEnd = (scrollLeft + viewWidth) / pxPerSec

  const seekFromEvent = (e: React.MouseEvent) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    player.seek((e.clientX - rect.left + scrollLeft) / pxPerSec)
  }

  return (
    <div className="word-track" ref={trackRef} onClick={seekFromEvent}>
      <div className="word-track-inner" style={{ transform: `translateX(${-scrollLeft}px)` }}>
        {lines.map((line, li) =>
          line.words.map((w, wi) => {
            if (w.start === undefined || w.end === undefined) return null
            if (w.end < visibleStart - 1 || w.start > visibleEnd + 1) return null
            const left = w.start * pxPerSec
            const width = Math.max(8, (w.end - w.start) * pxPerSec)
            const active = time >= w.start && time < w.end
            const isSel = selected?.lineId === line.id && selected.wordIndex === wi
            const inSelectedLine = props.selectedLineId === line.id
            return (
              <div
                key={w.id}
                className={`wt-word ${active ? 'active' : ''} ${isSel ? 'selected' : ''} ${inSelectedLine ? 'in-line' : ''} ${li % 2 ? 'odd' : ''}`}
                style={{ left, width }}
                title={`${w.fa}${w.finglish ? ` (${w.finglish})` : ''}  ${fmtTime(w.start)} – ${fmtTime(w.end)}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setSelected({ lineId: line.id, wordIndex: wi })
                  props.onSelectLine(line.id)
                  player.seek(w.start!)
                }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  e.stopPropagation()
                  setSelected({ lineId: line.id, wordIndex: wi })
                  props.onSelectLine(line.id)
                  setDrag({ lineId: line.id, wordIndex: wi, mode: e.altKey ? 'ripple' : 'move', originX: e.clientX, words: line.words })
                }}
              >
                <div
                  className="wt-handle left"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    setDrag({ lineId: line.id, wordIndex: wi, mode: 'start', originX: e.clientX, words: line.words })
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
                    setDrag({ lineId: line.id, wordIndex: wi, mode: 'end', originX: e.clientX, words: line.words })
                  }}
                />
              </div>
            )
          })
        )}
        <div className="wt-playhead" style={{ left: time * pxPerSec }} />
      </div>
    </div>
  )
}
