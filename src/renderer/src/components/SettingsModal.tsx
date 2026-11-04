import { useEffect, useState } from 'react'
import { useStore, guarded } from '../store'
import { DEFAULT_FINGLISH_CONVENTIONS } from '../../../shared/types'
import ProgressBar, { LogPanel } from './ProgressBar'

export default function SettingsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const settings = useStore((s) => s.settings)
  const tools = useStore((s) => s.tools)
  const refreshSettings = useStore((s) => s.refreshSettings)
  const refreshTools = useStore((s) => s.refreshTools)
  const [key, setKey] = useState('')
  const [model, setModel] = useState('')
  const [conv, setConv] = useState('')
  const [test, setTest] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (settings) {
      setModel(settings.model)
      setConv(settings.finglishConventions)
    }
  }, [settings])

  const saveKey = async () => {
    await guarded(() => window.api.settings.setApiKey(key))
    setKey('')
    await refreshSettings()
  }
  const testKey = async () => {
    setTest('Testing…')
    const r = await window.api.settings.testApiKey()
    setTest(r.message)
  }
  const saveMisc = async () => {
    await guarded(() => window.api.settings.update({ model, finglishConventions: conv }))
    await refreshSettings()
  }
  const setup = async () => {
    setBusy(true)
    await guarded(() => window.api.tools.setupAligner())
    setBusy(false)
    await refreshTools()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Settings</h2>
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <section>
          <h3>Anthropic API key</h3>
          <p className="muted small">
            Stored encrypted on this Mac with the system keychain. Status:{' '}
            <b>{settings?.hasApiKey ? 'configured' : 'not set'}</b>
          </p>
          <div className="row">
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-ant-…"
              autoComplete="off"
            />
            <button className="btn primary" onClick={saveKey} disabled={!key.trim()}>
              Save key
            </button>
            <button className="btn" onClick={testKey} disabled={!settings?.hasApiKey}>
              Test
            </button>
            {settings?.hasApiKey && (
              <button
                className="btn ghost"
                onClick={async () => {
                  await window.api.settings.clearApiKey()
                  await refreshSettings()
                }}
              >
                Remove
              </button>
            )}
          </div>
          {test && <p className="small">{test}</p>}
          <label className="field">
            <span>Model</span>
            <input value={model} onChange={(e) => setModel(e.target.value)} onBlur={saveMisc} />
          </label>
        </section>

        <section>
          <h3>Finglish conventions</h3>
          <p className="muted small">Instructions given to Claude when transliterating. Used for new projects.</p>
          <textarea rows={4} value={conv} onChange={(e) => setConv(e.target.value)} onBlur={saveMisc} />
          <button className="link" onClick={() => setConv(DEFAULT_FINGLISH_CONVENTIONS)}>
            Reset to default
          </button>
        </section>

        <section>
          <h3>Tools</h3>
          <table className="tools">
            <tbody>
              <ToolRow name="yt-dlp" ok={tools?.ytdlp.found} detail={tools?.ytdlp.path ?? 'brew install yt-dlp'} version={tools?.ytdlp.version} />
              <ToolRow name="ffmpeg" ok={tools?.ffmpeg.found} detail={tools?.ffmpeg.path ?? 'brew install ffmpeg'} version={tools?.ffmpeg.version} />
              <ToolRow name="python3" ok={tools?.python.found} detail={tools?.python.path ?? 'brew install python'} version={tools?.python.version} />
              <ToolRow
                name="aligner"
                ok={tools?.alignerReady}
                detail={tools?.alignerReady ? tools.alignerVenv : 'Python environment with faster-whisper, used for automatic word timing'}
              />
            </tbody>
          </table>
          <div className="row">
            <button className="btn" onClick={setup} disabled={busy || !tools?.python.found}>
              {tools?.alignerReady ? 'Reinstall aligner' : 'Set up aligner'}
            </button>
            <button className="btn ghost" onClick={() => refreshTools()}>
              Re-detect
            </button>
          </div>
          <ProgressBar task="aligner-setup" />
          <LogPanel task="aligner-setup" rows={4} />
          <p className="muted small">
            Optional: for cleaner timing on busy mixes, install vocal separation into the same environment:{' '}
            <code>{tools?.alignerVenv}/bin/pip install -r resources/aligner/requirements-separation.txt</code>
          </p>
        </section>
      </div>
    </div>
  )
}

function ToolRow({ name, ok, detail, version }: { name: string; ok?: boolean; detail?: string; version?: string }): JSX.Element {
  return (
    <tr>
      <td>
        <span className={`dot ${ok ? 'ok' : 'bad'}`} /> {name}
      </td>
      <td className="muted small">{version ?? ''}</td>
      <td className="muted small mono">{detail}</td>
    </tr>
  )
}
