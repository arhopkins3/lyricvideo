import { usePlayerTime } from '../lib/usePlayer'
import { player } from '../lib/player'
import { fmtTime } from '../lib/timing'

export default function Transport(): JSX.Element {
  const { time, playing, duration, rate } = usePlayerTime()
  return (
    <footer className="transport">
      <button className="btn icon" onClick={() => player.seek(0)} title="Go to start">
        ⏮
      </button>
      <button className="btn icon" onClick={() => player.seek(time - 5)} title="Back 5s">
        ‹5
      </button>
      <button className="btn icon primary" onClick={() => player.toggle()} title="Play / pause (space)">
        {playing ? '❚❚' : '▶'}
      </button>
      <button className="btn icon" onClick={() => player.seek(time + 5)} title="Forward 5s">
        5›
      </button>
      <span className="time mono">
        {fmtTime(time)} / {fmtTime(duration)}
      </span>
      <input
        className="scrub"
        type="range"
        min={0}
        max={duration || 1}
        step={0.01}
        value={Math.min(time, duration || 1)}
        onChange={(e) => player.seek(parseFloat(e.target.value))}
      />
      <label className="rate">
        Speed
        <select value={rate} onChange={(e) => player.setRate(parseFloat(e.target.value))}>
          {[0.5, 0.65, 0.75, 0.85, 1, 1.25].map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
      </label>
    </footer>
  )
}
