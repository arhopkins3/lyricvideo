import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.js'
import { player } from '../lib/player'
import { useStore } from '../store'
import { hasTiming } from '../lib/timing'
import type { Line, Word } from '../../../shared/types'
import WordTrack from './WordTrack'

interface Props {
  onLineTimeChange: (lineId: string, start: number, end: number) => void
  onWordsChange: (lineId: string, words: Word[]) => void
}

/** Waveform timeline sharing the master audio element, with one draggable region per timed line. */
export default function Waveform({ onLineTimeChange, onWordsChange }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<RegionsPlugin | null>(null)
  const regionMap = useRef(new Map<string, Region>())
  const [zoom, setZoom] = useState(120)
  const [ready, setReady] = useState(false)
  const [view, setView] = useState({ pxPerSec: 120, scrollLeft: 0, width: 0 })
  const handle = useStore((s) => s.handle)!
  const lines = handle.project.lines
  const selectedLineId = useStore((s) => s.selectedLineId)
  const selectLine = useStore((s) => s.selectLine)
  const onChangeRef = useRef(onLineTimeChange)
  onChangeRef.current = onLineTimeChange

  useEffect(() => {
    if (!containerRef.current) return
    const regions = RegionsPlugin.create()
    const ws = WaveSurfer.create({
      container: containerRef.current,
      media: player.audio,
      waveColor: '#3b4a5c',
      progressColor: '#7aa2f7',
      cursorColor: '#ffd166',
      cursorWidth: 2,
      height: 110,
      minPxPerSec: zoom,
      normalize: true,
      autoScroll: true,
      autoCenter: false,
      plugins: [regions, TimelinePlugin.create({ height: 18, timeInterval: 1, primaryLabelInterval: 5, style: { color: '#8aa0b8', fontSize: '10px' } })]
    })
    const syncView = () => {
      const duration = ws.getDuration()
      const wrapper = ws.getWrapper()
      if (!duration || !wrapper) return
      const scroller = wrapper.parentElement
      setView({
        pxPerSec: wrapper.clientWidth / duration,
        scrollLeft: scroller ? scroller.scrollLeft : ws.getScroll(),
        width: scroller ? scroller.clientWidth : wrapper.clientWidth
      })
    }
    ws.on('ready', () => {
      setReady(true)
      syncView()
    })
    ws.on('redrawcomplete', syncView)
    ws.on('zoom', () => requestAnimationFrame(syncView))
    ws.on('scroll', syncView)
    const ro = new ResizeObserver(syncView)
    ro.observe(containerRef.current)
    regions.on('region-updated', (r) => {
      onChangeRef.current(r.id, r.start, r.end)
    })
    regions.on('region-clicked', (r, e) => {
      e.stopPropagation()
      selectLine(r.id)
      player.seek(r.start)
    })
    wsRef.current = ws
    regionsRef.current = regions
    return () => {
      ro.disconnect()
      ws.destroy()
      wsRef.current = null
      regionsRef.current = null
      regionMap.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle.project.id])

  useEffect(() => {
    if (ready) wsRef.current?.zoom(zoom)
  }, [zoom, ready])

  // Sync regions with lines.
  useEffect(() => {
    const regions = regionsRef.current
    if (!regions || !ready) return
    const seen = new Set<string>()
    lines.forEach((l, i) => {
      if (!hasTiming(l)) return
      seen.add(l.id)
      const selected = l.id === selectedLineId
      const color = selected ? 'rgba(255, 209, 102, 0.28)' : i % 2 ? 'rgba(122,162,247,0.14)' : 'rgba(158,206,106,0.14)'
      const existing = regionMap.current.get(l.id)
      if (existing) {
        if (Math.abs(existing.start - l.start) > 0.001 || Math.abs(existing.end - l.end) > 0.001) {
          existing.setOptions({ start: l.start, end: l.end })
        }
        existing.setOptions({ color })
        setContent(existing, l, selected)
      } else {
        const r = regions.addRegion({ id: l.id, start: l.start, end: l.end, color, drag: true, resize: true, minLength: 0.1 })
        setContent(r, l, selected)
        regionMap.current.set(l.id, r)
      }
    })
    for (const [id, r] of regionMap.current) {
      if (!seen.has(id)) {
        r.remove()
        regionMap.current.delete(id)
      }
    }
  }, [lines, ready, selectedLineId])

  return (
    <div className="waveform">
      <div ref={containerRef} className="waveform-canvas" />
      {ready && view.width > 0 && (
        <WordTrack
          lines={lines}
          pxPerSec={view.pxPerSec}
          scrollLeft={view.scrollLeft}
          viewWidth={view.width}
          selectedLineId={selectedLineId}
          onSelectLine={selectLine}
          onWordsChange={onWordsChange}
        />
      )}
      <div className="row waveform-tools">
        <span className="muted small">Zoom</span>
        <input type="range" min={20} max={600} value={zoom} onChange={(e) => setZoom(parseInt(e.target.value))} />
        <span className="muted small">
          Lines: drag a block to move it, drag its edges to resize. Words (lower track): drag to slide, ⌥-drag to slide the rest of the line with it, drag an edge to stretch, click then ← → to nudge (⇧ for fine steps).
        </span>
      </div>
    </div>
  )
}

function setContent(r: Region, l: Line, selected: boolean): void {
  const el = document.createElement('div')
  el.className = `region-label ${selected ? 'selected' : ''}`
  el.dir = 'rtl'
  el.textContent = l.fa.length > 40 ? l.fa.slice(0, 40) + '…' : l.fa
  r.setContent(el)
}
