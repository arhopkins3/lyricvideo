import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { useStore } from './store'
import { renderExportFrames } from './render/exportFrames'
import { player } from './lib/player'

// Debug handle used by the smoke test and handy in DevTools.
;(window as unknown as { __lv: unknown }).__lv = { store: useStore, renderExportFrames, player }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
