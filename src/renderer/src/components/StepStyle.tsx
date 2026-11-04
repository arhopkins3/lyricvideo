import { useStore, guarded } from '../store'
import type { ScriptStyle, StyleSettings } from '../../../shared/types'
import { defaultStyle } from '../../../shared/types'
import Preview from './Preview'

const FONT_PRESETS_FA = [
  'Vazirmatn, "Noto Naskh Arabic", "Geeza Pro", sans-serif',
  '"Geeza Pro", "Noto Naskh Arabic", sans-serif',
  '"Noto Nastaliq Urdu", "Geeza Pro", serif',
  '"Baghdad", "Geeza Pro", serif',
  '"Damascus", "Geeza Pro", sans-serif'
]
const FONT_PRESETS_LATIN = [
  'Inter, "Helvetica Neue", Arial, sans-serif',
  '"Helvetica Neue", Helvetica, Arial, sans-serif',
  'Georgia, "Times New Roman", serif',
  '"Avenir Next", Avenir, sans-serif',
  '"SF Mono", Menlo, monospace'
]

export default function StepStyle(): JSX.Element {
  const handle = useStore((s) => s.handle)!
  const updateProject = useStore((s) => s.updateProject)
  const setStep = useStore((s) => s.setStep)
  const p = handle.project
  const st = p.style
  const set = (patch: Partial<StyleSettings>) => updateProject((pr) => ({ ...pr, style: { ...pr.style, ...patch } }))
  const setBg = (patch: Partial<StyleSettings['background']>) => set({ background: { ...st.background, ...patch } })
  const setScript = (key: 'farsi' | 'finglish' | 'english', patch: Partial<ScriptStyle>) => set({ [key]: { ...st[key], ...patch } })

  const chooseImage = async () => {
    const file = await guarded(() => window.api.project.chooseBackgroundImage(p.id))
    if (file) setBg({ kind: 'image', imageFile: file })
  }

  return (
    <div className="step style">
      <div className="style-main">
        <Preview className="style-preview" />
        <p className="muted small center">Preview follows the playhead. Press space to play.</p>
      </div>
      <div className="style-panel">
        <h3>Output</h3>
        <div className="row">
          <label className="field compact">
            <span>Size</span>
            <select
              value={`${st.width}x${st.height}`}
              onChange={(e) => {
                const [w, h] = e.target.value.split('x').map(Number)
                set({ width: w, height: h })
              }}
            >
              <option value="1920x1080">1920 × 1080 (landscape)</option>
              <option value="1080x1920">1080 × 1920 (vertical)</option>
              <option value="1080x1080">1080 × 1080 (square)</option>
              <option value="1280x720">1280 × 720</option>
            </select>
          </label>
          <label className="field compact">
            <span>FPS</span>
            <select value={st.fps} onChange={(e) => set({ fps: Number(e.target.value) })}>
              <option value={24}>24</option>
              <option value={30}>30</option>
              <option value={60}>60</option>
            </select>
          </label>
        </div>

        <h3>Background</h3>
        <div className="row wrap">
          {(['solid', 'gradient', 'image', 'video'] as const).map((k) => (
            <button
              key={k}
              className={`btn small ${st.background.kind === k ? 'primary' : ''}`}
              disabled={k === 'video' && !p.source.videoFile}
              onClick={() => (k === 'image' && !st.background.imageFile ? chooseImage() : setBg({ kind: k }))}
            >
              {k === 'video' ? 'original video' : k}
            </button>
          ))}
        </div>
        {st.background.kind === 'solid' && (
          <label className="field compact">
            <span>Colour</span>
            <input type="color" value={st.background.color} onChange={(e) => setBg({ color: e.target.value })} />
          </label>
        )}
        {st.background.kind === 'gradient' && (
          <div className="row">
            <label className="field compact">
              <span>Top</span>
              <input type="color" value={st.background.gradientFrom} onChange={(e) => setBg({ gradientFrom: e.target.value })} />
            </label>
            <label className="field compact">
              <span>Bottom</span>
              <input type="color" value={st.background.gradientTo} onChange={(e) => setBg({ gradientTo: e.target.value })} />
            </label>
          </div>
        )}
        {st.background.kind === 'image' && (
          <div className="row">
            <span className="muted small mono">{st.background.imageFile}</span>
            <button className="btn small" onClick={chooseImage}>
              Change image…
            </button>
          </div>
        )}
        {(st.background.kind === 'image' || st.background.kind === 'video') && (
          <>
            <label className="field compact">
              <span>Darken {Math.round(st.background.dim * 100)}%</span>
              <input type="range" min={0} max={0.9} step={0.05} value={st.background.dim} onChange={(e) => setBg({ dim: parseFloat(e.target.value) })} />
            </label>
            <label className="field compact">
              <span>Blur {st.background.blur}px</span>
              <input type="range" min={0} max={40} step={1} value={st.background.blur} onChange={(e) => setBg({ blur: parseInt(e.target.value) })} />
            </label>
          </>
        )}

        <h3>Text</h3>
        <label className="field compact">
          <span>Vertical position</span>
          <input type="range" min={0.1} max={0.95} step={0.01} value={st.verticalPosition} onChange={(e) => set({ verticalPosition: parseFloat(e.target.value) })} />
        </label>
        <label className="field compact">
          <span>Row gap {st.lineGap}px</span>
          <input type="range" min={0} max={80} step={2} value={st.lineGap} onChange={(e) => set({ lineGap: parseInt(e.target.value) })} />
        </label>
        <label className="field compact">
          <span>Keep line visible after it ends: {st.lingerSeconds.toFixed(1)}s</span>
          <input type="range" min={0} max={4} step={0.1} value={st.lingerSeconds} onChange={(e) => set({ lingerSeconds: parseFloat(e.target.value) })} />
        </label>
        <div className="row wrap">
          <label className="small">
            <input type="checkbox" checked={st.textShadow} onChange={(e) => set({ textShadow: e.target.checked })} /> shadow
          </label>
          <label className="small">
            <input type="checkbox" checked={st.showUpcomingLine} onChange={(e) => set({ showUpcomingLine: e.target.checked })} /> show next line
          </label>
          <label className="small">
            highlight{' '}
            <select value={st.highlightMode} onChange={(e) => set({ highlightMode: e.target.value as StyleSettings['highlightMode'] })}>
              <option value="color">colour fill</option>
              <option value="glow">glow</option>
              <option value="underline">underline</option>
            </select>
          </label>
        </div>

        <ScriptPanel title="Farsi" value={st.farsi} presets={FONT_PRESETS_FA} onChange={(v) => setScript('farsi', v)} />
        <ScriptPanel title="Finglish" value={st.finglish} presets={FONT_PRESETS_LATIN} onChange={(v) => setScript('finglish', v)} />
        <ScriptPanel title="English" value={st.english} presets={FONT_PRESETS_LATIN} onChange={(v) => setScript('english', v)} />

        <div className="row between">
          <button className="btn ghost small" onClick={() => set(defaultStyle())}>
            Reset style
          </button>
          <button className="btn primary" onClick={() => setStep('export')}>
            Next: export →
          </button>
        </div>
      </div>
    </div>
  )
}

function ScriptPanel({ title, value, presets, onChange }: { title: string; value: ScriptStyle; presets: string[]; onChange: (v: Partial<ScriptStyle>) => void }): JSX.Element {
  return (
    <div className="script-panel">
      <div className="row between">
        <h4>
          <label>
            <input type="checkbox" checked={value.visible} onChange={(e) => onChange({ visible: e.target.checked })} /> {title}
          </label>
        </h4>
        <label className="small">
          <input type="checkbox" checked={value.bold} onChange={(e) => onChange({ bold: e.target.checked })} /> bold
        </label>
      </div>
      <label className="field compact">
        <span>Font</span>
        <input list={`fonts-${title}`} value={value.fontFamily} onChange={(e) => onChange({ fontFamily: e.target.value })} />
        <datalist id={`fonts-${title}`}>
          {presets.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </label>
      <div className="row">
        <label className="field compact">
          <span>Size {value.fontSize}</span>
          <input type="range" min={16} max={160} value={value.fontSize} onChange={(e) => onChange({ fontSize: parseInt(e.target.value) })} />
        </label>
        <label className="field compact">
          <span>Colour</span>
          <input type="color" value={value.color} onChange={(e) => onChange({ color: e.target.value })} />
        </label>
        <label className="field compact">
          <span>Highlight</span>
          <input type="color" value={value.highlightColor} onChange={(e) => onChange({ highlightColor: e.target.value })} />
        </label>
      </div>
    </div>
  )
}
