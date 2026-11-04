import type { ExportFrame, Project } from '../../../shared/types'
import { changePoints, stateKey } from '../lib/timing'
import { renderFrame } from './frameRenderer'

export interface ExportPlan {
  /** Distinct visual states with their on-screen duration. */
  segments: Array<{ start: number; duration: number; key: string }>
}

/** Collapse the change points into segments where the frame is identical. */
export function planExport(project: Project, duration: number): ExportPlan {
  const pts = changePoints(project, duration)
  if (pts[pts.length - 1] < duration) pts.push(duration)
  const segments: ExportPlan['segments'] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const start = pts[i]
    const end = pts[i + 1]
    if (end - start < 0.0005) continue
    const key = stateKey(project, start + 0.0005)
    const last = segments[segments.length - 1]
    if (last && last.key === key) last.duration = end - last.start
    else segments.push({ start, duration: end - start, key })
  }
  return { segments }
}

/**
 * Render every distinct frame to PNG and ship it to the main process.
 * Returns the frame list for the ffmpeg concat demuxer.
 */
export async function renderExportFrames(
  project: Project,
  duration: number,
  exportDir: string,
  bgImage: HTMLImageElement | null,
  onProgress: (fraction: number, message: string) => void,
  signal: AbortSignal
): Promise<ExportFrame[]> {
  const { segments } = planExport(project, duration)
  const { width, height } = project.style
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const transparent = project.style.background.kind === 'video'
  const frames: ExportFrame[] = []
  for (let i = 0; i < segments.length; i++) {
    if (signal.aborted) throw new Error('Export cancelled')
    const seg = segments[i]
    renderFrame(ctx, project, seg.start + 0.0005, { width, height, transparent, bgImage })
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Could not encode a frame')
    const file = `f${String(i).padStart(5, '0')}.png`
    await window.api.exporter.writeFrame(exportDir, file, await blob.arrayBuffer())
    frames.push({ start: seg.start, duration: seg.duration, file })
    if (i % 5 === 0) onProgress(i / segments.length, `Rendering frames… ${i + 1} / ${segments.length}`)
  }
  onProgress(1, `Rendered ${frames.length} frames`)
  return frames
}
