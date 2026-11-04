import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { player } from '../lib/player'
import { clicker } from '../lib/clicker'
import { usePlayerTime } from '../lib/usePlayer'
import { distributeWords, fmtTime, hasTiming, lineHasAnyTiming } from '../lib/timing'
import type { Line, Word } from '../../../shared/types'
import Preview from './Preview'
import Waveform from './Waveform'
import WordTimeline from './WordTimeline'
import ProgressBar, { LogPanel } from './ProgressBar'

type TapMode = 'off' | 'words' | 'lines'
const MODELS = ['large-v3-turbo', 'large-v3', 'medium', 'small']

export default function StepAlign(): JSX.Element {
  const handle = useStore((s) => s.handle)!
  const tools = useStore((s) => s.tools)
  const updateProject = useStore((s) => s.updateProject)
  const selectedLineId = useStore((s) => s.selectedLineId)
  const selectLine = useStore((s) => s.selectLine)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setStep = useStore((s) => s.setStep)
  const p = handle.project
  const lines = p.lines
  const [aligning, setAligning] = useState(false)
  const [model, setModel] = useState(MODELS[0])
  const [separate, setSeparate] = useState(false)
  const [tapMode, setTapMode] = useState<TapMode>('off')
  const cursor = useRef<{ line: number; word: number }>({ line: 0, word: 0 })
  const holding = useRef(false)
  const { time } = usePlayerTime()
  const selectedWordIds = useStore((s) => s.selectedWordIds)
  const [beep, setBeep] = useState(clicker.enabled)
  const loop = player.loop

  const selected = lines.find((l) => l.id === selectedLineId) ?? null

  // ---- beep markers: selected words, else the selected line's words, else every word inside the loop
  useEffect(() => {
    let words: Word[]
    if (selectedWordIds.size > 0) words = lines.flatMap((l) => l.words.filter((w) => selectedWordIds.has(w.id)))
    else if (selected) words = selected.words
    else if (loop) words = lines.flatMap((l) => l.words.filter((w) => typeof w.start === 'number' && w.start >= loop.start && w.start < loop.end))
    else words = []
    clicker.setTimes(words.map((w) => w.start).filter((t): t is number => typeof t === 'number'))
  }, [lines, selectedWordIds, selected, loop])

  const toggleBeep = () => {
    clicker.setEnabled(!beep)
    setBeep(!beep)
  }
  const pad = 0.35
  const loopLine = () => {
    if (!selected || !hasTiming(selected)) return
    player.playLoop({ start: Math.max(0, selected.start - pad), end: selected.end + pad })
  }
  const loopSelection = () => {
    const ws = lines.flatMap((l) => l.words.filter((w) => selectedWordIds.has(w.id) && typeof w.start === 'number' && typeof w.end === 'number'))
    if (ws.length === 0) return loopLine()
    player.playLoop({ start: Math.max(0, Math.min(...ws.map((w) => w.start!)) - pad), end: Math.max(...ws.map((w) => w.end!)) + pad })
  }
  const setLoopEdge = (edge: 'start' | 'end') => {
    const cur = loop ?? { start: Math.max(0, time - 2), end: time + 2 }
    const next = edge === 'start' ? { start: time, end: Math.max(time + 0.2, cur.end) } : { start: Math.min(cur.start, time - 0.2), end: time }
    player.setLoop(next)
  }
  const selectedIndex = selected ? lines.indexOf(selected) : -1

  const setLines = useCallback(
    (fn: (ls: Line[]) => Line[]) => updateProject((pr) => ({ ...pr, lines: fn(pr.lines) })),
    [updateProject]
  )

  // ------------------------------------------------------------------ line region dragging
  const onLineTimeChange = useCallback(
    (lineId: string, start: number, end: number) => {
      setLines((ls) =>
        ls.map((l) => {
          if (l.id !== lineId || !hasTiming(l)) return l
          const oldSpan = Math.max(0.001, l.end - l.start)
          const k = (end - start) / oldSpan
          const words = l.words.map((w) =>
            typeof w.start === 'number' && typeof w.end === 'number'
              ? { ...w, start: start + (w.start - l.start) * k, end: start + (w.end - l.start) * k }
              : w
          )
          return { ...l, start, end, words }
        })
      )
    },
    [setLines]
  )

  const setWords = useCallback(
    (lineId: string, words: Word[]) => {
      setLines((ls) =>
        ls.map((l) => {
          if (l.id !== lineId) return l
          const starts = words.map((w) => w.start).filter((x): x is number => typeof x === 'number')
          const ends = words.map((w) => w.end).filter((x): x is number => typeof x === 'number')
          return {
            ...l,
            words,
            start: starts.length ? Math.min(...starts) : l.start,
            end: ends.length ? Math.max(...ends) : l.end
          }
        })
      )
    },
    [setLines]
  )

  // ------------------------------------------------------------------ auto alignment
  const autoAlign = async () => {
    if (!tools?.alignerReady) {
      setShowSettings(true)
      return
    }
    setAligning(true)
    let res: Awaited<ReturnType<typeof window.api.align.run>> | undefined
    try {
      res = await window.api.align.run(p.id, lines, { model, separate })
    } catch (e) {
      const msg = String(e)
      if (!/cancelled/i.test(msg)) useStore.getState().setError(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
    setAligning(false)
    if (!res) return
    setLines((ls) =>
      ls.map((l) => {
        const r = res.lines.find((x) => x.id === l.id)
        if (!r) return l
        const words = l.words.map((w) => {
          const rw = r.words.find((x) => x.id === w.id)
          return rw ? { ...w, start: rw.start ?? w.start, end: rw.end ?? w.end } : w
        })
        return { ...l, start: r.start ?? l.start, end: r.end ?? l.end, words }
      })
    )
    useStore.getState().setNotice(res.notes ?? 'Alignment applied')
  }

  // ------------------------------------------------------------------ tap mode (hold Enter/T for each word or line)
  const startTap = (mode: TapMode) => {
    const from = selectedIndex >= 0 ? selectedIndex : 0
    cursor.current = { line: from, word: 0 }
    holding.current = false
    setTapMode(mode)
    const l = lines[from]
    if (l && typeof l.start === 'number') player.seek(Math.max(0, l.start - 1.5))
    player.play()
  }

  useEffect(() => {
    if (tapMode === 'off') return
    const isTap = (e: KeyboardEvent) => e.key === 'Enter' || e.key.toLowerCase() === 't'
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTapMode('off')
        return
      }
      if (!isTap(e) || e.repeat || holding.current) return
      e.preventDefault()
      holding.current = true
      const now = player.time
      const c = cursor.current
      setLines((ls) => {
        const next = ls.map((l) => ({ ...l, words: l.words.map((w) => ({ ...w })) }))
        const line = next[c.line]
        if (!line) return ls
        if (tapMode === 'words') {
          const w = line.words[c.word]
          if (!w) return ls
          w.start = now
          w.end = undefined
          if (c.word === 0) line.start = now
          // Any earlier word still open gets closed here.
          const prev = c.word > 0 ? line.words[c.word - 1] : next[c.line - 1]?.words.at(-1)
          if (prev && typeof prev.start === 'number' && (prev.end === undefined || prev.end > now)) prev.end = Math.max(prev.start + 0.05, now)
          if (c.word === 0 && next[c.line - 1]) {
            const pl = next[c.line - 1]
            if (typeof pl.start === 'number' && (pl.end === undefined || pl.end > now)) pl.end = Math.max(pl.start + 0.05, now)
          }
        } else {
          line.start = now
          line.end = undefined
          const pl = next[c.line - 1]
          if (pl && typeof pl.start === 'number' && (pl.end === undefined || pl.end > now)) pl.end = Math.max(pl.start + 0.05, now)
        }
        return next
      })
      selectLine(lines[c.line]?.id ?? null)
    }
    const up = (e: KeyboardEvent) => {
      if (!isTap(e) || !holding.current) return
      e.preventDefault()
      holding.current = false
      const now = player.time
      const c = cursor.current
      setLines((ls) => {
        const next = ls.map((l) => ({ ...l, words: l.words.map((w) => ({ ...w })) }))
        const line = next[c.line]
        if (!line) return ls
        if (tapMode === 'words') {
          const w = line.words[c.word]
          if (w) w.end = Math.max((w.start ?? now) + 0.05, now)
          line.end = Math.max(line.start ?? now, now)
        } else {
          line.end = Math.max((line.start ?? now) + 0.1, now)
          const timed = { ...line, start: line.start!, end: line.end }
          line.words = distributeWords(timed)
        }
        return next
      })
      // advance cursor
      if (tapMode === 'words') {
        if (c.word + 1 < (lines[c.line]?.words.length ?? 0)) cursor.current = { line: c.line, word: c.word + 1 }
        else cursor.current = { line: c.line + 1, word: 0 }
      } else {
        cursor.current = { line: c.line + 1, word: 0 }
      }
      if (cursor.current.line >= lines.length) {
        setTapMode('off')
        player.pause()
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [tapMode, lines, setLines, selectLine])

  // ------------------------------------------------------------------ misc tools
  const distribute = () => selected && hasTiming(selected) && setWords(selected.id, distributeWords(selected))
  const clearSelected = () =>
    selected && setLines((ls) => ls.map((l) => (l.id === selected.id ? { ...l, start: undefined, end: undefined, words: l.words.map((w) => ({ ...w, start: undefined, end: undefined })) } : l)))
  const clearAll = () => {
    if (!confirm('Remove all timing from every line?')) return
    setLines((ls) => ls.map((l) => ({ ...l, start: undefined, end: undefined, words: l.words.map((w) => ({ ...w, start: undefined, end: undefined })) })))
  }
  const nudge = (delta: number, fromHere: boolean) =>
    setLines((ls) =>
      ls.map((l, i) => {
        if (!selected) return l
        if (fromHere ? i < selectedIndex : l.id !== selected.id) return l
        const sh = (t?: number) => (typeof t === 'number' ? Math.max(0, t + delta) : t)
        return { ...l, start: sh(l.start), end: sh(l.end), words: l.words.map((w) => ({ ...w, start: sh(w.start), end: sh(w.end) })) }
      })
    )
  const setLineStartHere = () =>
    selected &&
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== selected.id) return l
        const end = typeof l.end === 'number' && l.end > time + 0.2 ? l.end : time + Math.max(1, l.words.length * 0.45)
        const timed = { ...l, start: time, end }
        return { ...timed, words: distributeWords(timed) }
      })
    )

  const tapWord = tapMode === 'words' ? lines[cursor.current.line]?.words[cursor.current.word] : null
  const tapLine = tapMode !== 'off' ? lines[cursor.current.line] : null
  const untimed = lines.filter((l) => !hasTiming(l)).length

  return (
    <div className="step align">
      <div className="align-top">
        <Preview className="align-preview" />
        <div className="lines-panel">
          <div className="row between">
            <h3>Lines</h3>
            <span className="muted small">{untimed > 0 ? `${untimed} untimed` : 'all timed'}</span>
          </div>
          <ul className="line-list">
            {lines.map((l, i) => {
              const active = hasTiming(l) && time >= l.start && time < l.end
              return (
                <li
                  key={l.id}
                  className={`${l.id === selectedLineId ? 'selected' : ''} ${active ? 'playing' : ''}`}
                  onClick={() => {
                    selectLine(l.id)
                    if (typeof l.start === 'number') player.seek(l.start)
                  }}
                >
                  <span className={`dot ${hasTiming(l) ? 'ok' : lineHasAnyTiming(l) ? 'warn' : 'bad'}`} />
                  <span className="idx muted">{i + 1}</span>
                  <span className="mono small muted">{fmtTime(l.start)}</span>
                  <span className="rtl grow">{l.fa}</span>
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      <div className="toolbar card">
        <div className="row wrap gap">
          <div className="row">
            <button className="btn primary" onClick={autoAlign} disabled={aligning || lines.length === 0}>
              {aligning ? 'Aligning…' : 'Auto-align words'}
            </button>
            <select value={model} onChange={(e) => setModel(e.target.value)} title="Whisper model (larger = slower, more accurate)">
              {MODELS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <label className="small">
              <input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} /> separate vocals
            </label>
            {aligning && (
              <button className="btn small ghost" onClick={() => window.api.align.cancel()}>
                Cancel
              </button>
            )}
          </div>
          <div className="sep" />
          {tapMode === 'off' ? (
            <>
              <button className="btn" onClick={() => startTap('words')} disabled={lines.length === 0}>
                Tap words {selectedIndex >= 0 ? `from line ${selectedIndex + 1}` : ''}
              </button>
              <button className="btn" onClick={() => startTap('lines')} disabled={lines.length === 0}>
                Tap lines {selectedIndex >= 0 ? `from line ${selectedIndex + 1}` : ''}
              </button>
            </>
          ) : (
            <div className="tap-hud">
              <b>Tap mode:</b> hold <kbd>Enter</kbd> (or <kbd>T</kbd>) while each {tapMode === 'words' ? 'word' : 'line'} is sung, release when it ends. <kbd>Esc</kbd> stops.
              <div className="tap-current rtl">
                {tapMode === 'words' ? (
                  <>
                    <span className="muted">{tapLine?.fa}</span> → <b>{tapWord?.fa}</b>
                  </>
                ) : (
                  <b>{tapLine?.fa}</b>
                )}
              </div>
              <button className="btn small" onClick={() => setTapMode('off')}>
                Stop
              </button>
            </div>
          )}
          <div className="sep" />
          <div className="row loop-tools">
            <span className="muted small">Loop</span>
            <button className="btn small" onClick={loopSelection} disabled={!selected && selectedWordIds.size === 0} title="Repeat the selected words (or the selected line) and play">
              ⟳ {selectedWordIds.size > 0 ? 'selection' : 'line'}
            </button>
            <button className="btn small" onClick={() => setLoopEdge('start')} title="Loop start = playhead">
              A
            </button>
            <button className="btn small" onClick={() => setLoopEdge('end')} title="Loop end = playhead">
              B
            </button>
            {loop && (
              <>
                <span className="mono small muted">
                  {fmtTime(loop.start)}–{fmtTime(loop.end)}
                </span>
                <button className="btn small ghost" onClick={() => player.setLoop(null)}>
                  off
                </button>
              </>
            )}
            <label className={`small beep-toggle ${beep ? 'on' : ''}`} title="Play a short beep exactly where each selected word starts, so you can hear whether the marker is early or late">
              <input type="checkbox" checked={beep} onChange={toggleBeep} /> beep at word starts
            </label>
          </div>
          <div className="sep" />
          <div className="row">
            <button className="btn small" onClick={setLineStartHere} disabled={!selected}>
              Line starts at playhead
            </button>
            <button className="btn small" onClick={distribute} disabled={!selected || !hasTiming(selected)}>
              Distribute words evenly
            </button>
            <button className="btn small" onClick={() => nudge(-0.1, false)} disabled={!selected}>
              −0.1s
            </button>
            <button className="btn small" onClick={() => nudge(0.1, false)} disabled={!selected}>
              +0.1s
            </button>
            <button className="btn small" onClick={() => nudge(-0.1, true)} disabled={!selected} title="Shift this line and all following lines">
              −0.1s from here
            </button>
            <button className="btn small" onClick={() => nudge(0.1, true)} disabled={!selected} title="Shift this line and all following lines">
              +0.1s from here
            </button>
            <button className="btn small ghost" onClick={clearSelected} disabled={!selected}>
              Clear line
            </button>
            <button className="btn small ghost" onClick={clearAll} disabled={lines.length === 0}>
              Clear all
            </button>
          </div>
        </div>
        <ProgressBar task="align" />
        {aligning && <LogPanel task="align" rows={3} />}
        {!tools?.alignerReady && (
          <p className="muted small">
            Automatic alignment needs the Python aligner.{' '}
            <button className="link" onClick={() => setShowSettings(true)}>
              Set it up in Settings
            </button>
            . You can still time lines by hand with tap mode.
          </p>
        )}
      </div>

      <Waveform onLineTimeChange={onLineTimeChange} onWordsChange={setWords} />

      {selected ? (
        <WordTimeline line={selected} onChange={(words) => setWords(selected.id, words)} />
      ) : (
        <p className="muted small">Select a line to edit its words.</p>
      )}

      <div className="row end">
        <button className="btn primary" onClick={() => setStep('style')}>
          Next: style →
        </button>
      </div>
    </div>
  )
}
