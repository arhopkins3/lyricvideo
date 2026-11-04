import { useEffect } from 'react'
import { useStore, connectEvents, guarded, STEPS } from './store'
import Home from './components/Home'
import SettingsModal from './components/SettingsModal'
import StepSource from './components/StepSource'
import StepLyrics from './components/StepLyrics'
import StepText from './components/StepText'
import StepAlign from './components/StepAlign'
import StepStyle from './components/StepStyle'
import StepExport from './components/StepExport'
import Transport from './components/Transport'
import { player } from './lib/player'

export default function App(): JSX.Element {
  const handle = useStore((s) => s.handle)
  const step = useStore((s) => s.step)
  const setStep = useStore((s) => s.setStep)
  const error = useStore((s) => s.error)
  const notice = useStore((s) => s.notice)
  const setError = useStore((s) => s.setError)
  const showSettings = useStore((s) => s.showSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const dirty = useStore((s) => s.dirty)
  const save = useStore((s) => s.save)
  const setHandle = useStore((s) => s.setHandle)

  useEffect(() => {
    connectEvents()
    const st = useStore.getState()
    st.refreshSettings()
    st.refreshTools()
  }, [])

  // Menu shortcuts from the main process.
  useEffect(() => {
    const handlers: Record<string, () => void> = {
      'menu:save': () => void save(false),
      'menu:saveAs': () => void save(true),
      'menu:settings': () => setShowSettings(true),
      'menu:open': () => void guarded(async () => {
        const h = await window.api.project.open()
        if (h) setHandle(h)
      }),
      'menu:new': () => setHandle(null),
      'menu:saveAndClose': () =>
        void save(false).then(() => {
          if (!useStore.getState().dirty) void window.api.app.closeNow()
        })
    }
    const offMenu = window.api.events.onMenu((action, arg) => {
      if (action === 'openPath' && arg) {
        void guarded(async () => setHandle(await window.api.project.openPath(arg)))
      } else {
        handlers[`menu:${action}`]?.()
      }
    })
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault()
        handlers[e.shiftKey ? 'menu:saveAs' : 'menu:save']()
      } else if (meta && e.key === ',') {
        e.preventDefault()
        handlers['menu:settings']()
      } else if (meta && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        handlers['menu:open']()
      } else if (e.key === ' ' && !isTyping(e)) {
        e.preventDefault()
        player.toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      offMenu()
    }
  }, [save, setShowSettings, setHandle])

  useEffect(() => {
    void window.api.app.setDirty(dirty)
  }, [dirty])

  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand" onClick={() => handle && setHandle(null)} title="Back to start">
          LyricVideo
        </div>
        {handle && (
          <nav className="steps">
            {STEPS.map((s) => (
              <button key={s.id} className={step === s.id ? 'active' : ''} onClick={() => setStep(s.id)}>
                {s.label}
              </button>
            ))}
          </nav>
        )}
        <div className="titlebar-right">
          {handle && (
            <>
              <span className="project-title">
                {handle.project.title}
                {dirty ? ' •' : ''}
              </span>
              <button className="btn small" onClick={() => void save(false)}>
                Save
              </button>
            </>
          )}
          <button className="btn small ghost" onClick={() => setShowSettings(true)}>
            Settings
          </button>
        </div>
      </header>
      {error && (
        <div className="banner error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}
      {notice && <div className="banner notice">{notice}</div>}
      <main className="content">
        {!handle ? (
          <Home />
        ) : (
          <>
            {step === 'source' && <StepSource />}
            {step === 'lyrics' && <StepLyrics />}
            {step === 'text' && <StepText />}
            {step === 'align' && <StepAlign />}
            {step === 'style' && <StepStyle />}
            {step === 'export' && <StepExport />}
          </>
        )}
      </main>
      {handle && <Transport />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}
