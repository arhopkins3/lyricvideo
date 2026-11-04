import { useState } from 'react'
import { useStore } from '../store'
import { player } from '../lib/player'
import { usePlayerTime } from '../lib/usePlayer'
import { activeAt, fmtTime, hasTiming } from '../lib/timing'
import { Markdown } from '../lib/markdown'
import Preview from './Preview'

/**
 * Learning player: the video preview plus everything the project knows about the current line —
 * Farsi, Finglish, English, per-word glosses and the explanation — following the playhead.
 */
export default function StepPlay(): JSX.Element {
  const p = useStore((s) => s.handle!.project)
  const setStep = useStore((s) => s.setStep)
  const { time } = usePlayerTime()
  const [showSong, setShowSong] = useState(false)
  const [pinned, setPinned] = useState<string | null>(null)
  const state = activeAt(p, time)
  const line = pinned ? p.lines.find((l) => l.id === pinned) ?? null : state.line
  const wordIndex = line && line === state.line ? state.wordIndex : -1
  const timed = p.lines.filter(hasTiming).length
  const hasMeta = p.lines.some((l) => l.explanation || l.words.some((w) => w.gloss))

  return (
    <div className="step play">
      <div className="play-left">
        <Preview className="play-preview" />
        {!hasMeta && (
          <p className="muted small">
            No meanings yet.{' '}
            <button className="link" onClick={() => setStep('text')}>
              Generate everything in Translate
            </button>{' '}
            to see explanations and word glosses here.
          </p>
        )}
        {timed === 0 && (
          <p className="muted small">
            No timing yet.{' '}
            <button className="link" onClick={() => setStep('align')}>
              Align the lyrics
            </button>{' '}
            so the player can follow the song.
          </p>
        )}
        <ul className="play-lines">
          {p.lines.map((l, i) => (
            <li
              key={l.id}
              className={`${l === state.line ? 'playing' : ''} ${l.id === pinned ? 'pinned' : ''}`}
              onClick={() => {
                setPinned(null)
                if (typeof l.start === 'number') player.seek(l.start)
              }}
            >
              <span className="idx muted">{i + 1}</span>
              <span className="mono small muted">{fmtTime(l.start)}</span>
              <span className="rtl fa">{l.fa}</span>
              <span className="en muted">{l.en}</span>
              <button
                className="btn tiny ghost"
                title="Pin this line's notes while the song keeps playing"
                onClick={(e) => {
                  e.stopPropagation()
                  setPinned(pinned === l.id ? null : l.id)
                }}
              >
                {pinned === l.id ? 'unpin' : 'pin'}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="play-right">
        {line ? (
          <div className="card line-card">
            <div className="row between">
              <span className="muted small">
                Line {p.lines.indexOf(line) + 1} · {fmtTime(line.start)} – {fmtTime(line.end)}
                {pinned ? ' · pinned' : ''}
              </span>
              <div className="row">
                {typeof line.start === 'number' && (
                  <button className="btn tiny" onClick={() => player.seek(line.start!)} title="Replay this line">
                    ↺ replay
                  </button>
                )}
                {pinned && (
                  <button className="btn tiny ghost" onClick={() => setPinned(null)}>
                    follow playback
                  </button>
                )}
              </div>
            </div>
            <div className="line-fa rtl">
              {line.words.map((w, i) => (
                <span key={w.id} className={`w ${i === wordIndex ? 'current' : i < wordIndex ? 'sung' : ''}`}>
                  {w.fa}
                </span>
              ))}
            </div>
            <div className="line-fi">
              {line.words.every((w) => w.finglish !== undefined) ? (
                line.words.map((w, i) => (
                  <span key={w.id} className={`w ${i === wordIndex ? 'current' : i < wordIndex ? 'sung' : ''}`}>
                    {w.finglish}
                  </span>
                ))
              ) : (
                <span>{line.finglish}</span>
              )}
            </div>
            <div className="line-en">{line.en}</div>
            {line.words.some((w) => w.gloss) && (
              <div className="gloss-row big">
                {line.words.map((w, i) => (
                  <span key={w.id} className={`gloss-chip ${i === wordIndex ? 'current' : ''}`}>
                    <span className="rtl">{w.fa}</span>
                    <em>{w.finglish}</em>
                    <small>{w.gloss ?? '…'}</small>
                  </span>
                ))}
              </div>
            )}
            {line.explanation ? (
              <div className="explanation">
                <Markdown text={line.explanation} />
              </div>
            ) : (
              <p className="muted small">No explanation for this line yet.</p>
            )}
          </div>
        ) : (
          <div className="card line-card muted">
            {state.upcoming ? (
              <>
                Next: <span className="rtl">{state.upcoming.fa}</span> at {fmtTime(state.upcoming.start)}
              </>
            ) : (
              'Press space to play. The current line, its meaning and word glosses appear here.'
            )}
          </div>
        )}

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
      </div>
    </div>
  )
}
