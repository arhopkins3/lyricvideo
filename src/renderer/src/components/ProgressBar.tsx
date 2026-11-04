import { useStore } from '../store'

export default function ProgressBar({ task }: { task: string }): JSX.Element | null {
  const p = useStore((s) => s.progress[task])
  if (!p || p.done) return null
  return (
    <div className="progress">
      <div className="progress-track">
        <div
          className={`progress-fill ${p.fraction < 0 ? 'indeterminate' : ''}`}
          style={p.fraction >= 0 ? { width: `${Math.round(p.fraction * 100)}%` } : undefined}
        />
      </div>
      <div className="progress-label">{p.message}</div>
    </div>
  )
}

export function LogPanel({ task, rows = 6 }: { task: string; rows?: number }): JSX.Element | null {
  const logs = useStore((s) => s.logs)
  const mine = logs.filter((l) => l.task === task).slice(-rows)
  if (mine.length === 0) return null
  return (
    <pre className="log">
      {mine.map((l, i) => (
        <div key={i}>{l.line}</div>
      ))}
    </pre>
  )
}
