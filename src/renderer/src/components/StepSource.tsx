import { useStore, mediaUrl } from '../store'
import { fmtTime } from '../lib/timing'

export default function StepSource(): JSX.Element {
  const handle = useStore((s) => s.handle)!
  const updateProject = useStore((s) => s.updateProject)
  const setStep = useStore((s) => s.setStep)
  const p = handle.project
  const thumb = mediaUrl(p.id, p.source.thumbnailFile)

  return (
    <div className="step narrow">
      <h2>Source</h2>
      <div className="card row gap">
        {thumb && <img className="thumb" src={thumb} alt="" />}
        <div className="grow">
          <label className="field">
            <span>Title</span>
            <input value={p.title} onChange={(e) => updateProject((pr) => ({ ...pr, title: e.target.value }))} />
          </label>
          <label className="field">
            <span>Artist</span>
            <input value={p.artist ?? ''} onChange={(e) => updateProject((pr) => ({ ...pr, artist: e.target.value }))} />
          </label>
          <dl className="meta">
            <dt>Origin</dt>
            <dd>
              {p.source.type === 'youtube' ? (
                <button className="link" onClick={() => window.api.shell.openExternal(p.source.url!)}>
                  {p.source.url}
                </button>
              ) : (
                p.source.originalFileName
              )}
            </dd>
            <dt>Duration</dt>
            <dd>{fmtTime(p.source.durationSec)}</dd>
            <dt>Video</dt>
            <dd>{p.source.videoFile ? 'available (can be used as background)' : 'none – audio only'}</dd>
            <dt>Saved as</dt>
            <dd className="mono small">{p.savedPath ?? 'not saved yet'}</dd>
          </dl>
        </div>
      </div>
      <label className="field">
        <span>Finglish conventions for this project</span>
        <textarea
          rows={3}
          value={p.finglishConventions}
          onChange={(e) => updateProject((pr) => ({ ...pr, finglishConventions: e.target.value }))}
        />
      </label>
      <div className="row end">
        <button className="btn primary" onClick={() => setStep('lyrics')}>
          Next: find lyrics →
        </button>
      </div>
    </div>
  )
}
