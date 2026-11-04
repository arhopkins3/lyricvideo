import type { Line, Project, ScriptStyle } from '../../../shared/types'
import { activeAt } from '../lib/timing'

export interface RenderOptions {
  width: number
  height: number
  /** When true the background is left transparent (export over video). */
  transparent?: boolean
  bgImage?: HTMLImageElement | null
  bgVideo?: HTMLVideoElement | null
}

/**
 * Draws one frame of the lyric video at time t. The same code is used for the live preview
 * and for the export so the output matches the preview exactly.
 */
export function renderFrame(ctx: CanvasRenderingContext2D, project: Project, t: number, opts: RenderOptions): void {
  const { width: W, height: H } = opts
  const style = project.style
  ctx.save()
  ctx.clearRect(0, 0, W, H)
  if (!opts.transparent) drawBackground(ctx, project, opts)
  ctx.restore()

  const state = activeAt(project, t)
  const line = state.line
  const rows: Array<{ kind: 'fa' | 'fi' | 'en'; style: ScriptStyle }> = []
  if (style.farsi.visible) rows.push({ kind: 'fa', style: style.farsi })
  if (style.finglish.visible) rows.push({ kind: 'fi', style: style.finglish })
  if (style.english.visible) rows.push({ kind: 'en', style: style.english })
  if (!line || rows.length === 0) return

  const maxWidth = W * 0.9
  // Measure every row first so the block can be centred on verticalPosition.
  const measured = rows.map((r) => layoutRow(ctx, line, r.kind, r.style, maxWidth))
  const upcoming = style.showUpcomingLine && state.upcoming && style.farsi.visible ? state.upcoming : null
  const upcomingSize = style.farsi.fontSize * 0.55
  const totalHeight =
    measured.reduce((a, m) => a + m.lineHeight, 0) +
    style.lineGap * (measured.length - 1) +
    (upcoming ? upcomingSize * 1.4 + style.lineGap : 0)
  let y = style.verticalPosition * H - totalHeight / 2
  measured.forEach((m, i) => {
    const r = rows[i]
    drawRow(ctx, m, r.kind, r.style, state.wordIndex, W / 2, y, style)
    y += m.lineHeight + style.lineGap
  })
  if (upcoming) {
    ctx.save()
    ctx.globalAlpha = 0.45
    ctx.font = fontString(style.farsi, upcomingSize)
    ctx.fillStyle = style.farsi.color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.direction = 'ltr'
    if (style.textShadow) shadow(ctx)
    ctx.fillText(fitText(ctx, upcoming.fa, maxWidth), W / 2, y)
    ctx.restore()
  }
}

export function drawBackground(ctx: CanvasRenderingContext2D, project: Project, opts: RenderOptions): void {
  const { width: W, height: H } = opts
  const bg = project.style.background
  if (bg.kind === 'solid') {
    ctx.fillStyle = bg.color
    ctx.fillRect(0, 0, W, H)
    return
  }
  if (bg.kind === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, bg.gradientFrom)
    g.addColorStop(1, bg.gradientTo)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    return
  }
  const source: CanvasImageSource | null = bg.kind === 'image' ? opts.bgImage ?? null : opts.bgVideo ?? null
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  if (source) {
    const sw = 'videoWidth' in source ? source.videoWidth : (source as HTMLImageElement).naturalWidth
    const sh = 'videoHeight' in source ? source.videoHeight : (source as HTMLImageElement).naturalHeight
    if (sw && sh) {
      const scale = Math.max(W / sw, H / sh)
      const dw = sw * scale
      const dh = sh * scale
      ctx.save()
      if (bg.blur > 0) ctx.filter = `blur(${bg.blur}px)`
      try {
        ctx.drawImage(source, (W - dw) / 2, (H - dh) / 2, dw, dh)
      } catch {
        /* video not ready yet */
      }
      ctx.restore()
    }
  }
  if (bg.dim > 0) {
    ctx.fillStyle = `rgba(0,0,0,${bg.dim})`
    ctx.fillRect(0, 0, W, H)
  }
}

interface RowLayout {
  tokens: Array<{ text: string; width: number; wordIndex: number }>
  totalWidth: number
  fontSize: number
  lineHeight: number
  rtl: boolean
  spaceWidth: number
}

function fontString(s: ScriptStyle, size: number): string {
  return `${s.bold ? 'bold ' : ''}${size}px ${s.fontFamily}`
}

function layoutRow(
  ctx: CanvasRenderingContext2D,
  line: Line,
  kind: 'fa' | 'fi' | 'en',
  style: ScriptStyle,
  maxWidth: number
): RowLayout {
  const rtl = kind === 'fa'
  let tokens: Array<{ text: string; wordIndex: number }>
  if (kind === 'fa') {
    tokens = line.words.map((w, i) => ({ text: w.fa, wordIndex: i }))
  } else if (kind === 'fi') {
    const perWord = line.words.every((w) => w.finglish !== undefined)
    tokens = perWord
      ? line.words.map((w, i) => ({ text: w.finglish ?? '', wordIndex: i })).filter((t) => t.text)
      : [{ text: line.finglish ?? '', wordIndex: -1 }]
  } else {
    tokens = [{ text: line.en ?? '', wordIndex: -1 }]
  }
  ctx.direction = 'ltr'
  ctx.textAlign = 'left'
  let fontSize = style.fontSize
  let measured: RowLayout['tokens'] = []
  let spaceWidth = 0
  let totalWidth = 0
  for (let attempt = 0; attempt < 12; attempt++) {
    ctx.font = fontString(style, fontSize)
    spaceWidth = ctx.measureText(' ').width
    measured = tokens.map((t) => ({ ...t, width: ctx.measureText(t.text).width }))
    totalWidth = measured.reduce((a, m) => a + m.width, 0) + spaceWidth * Math.max(0, measured.length - 1)
    if (totalWidth <= maxWidth || fontSize < 16) break
    fontSize = Math.floor(fontSize * Math.max(0.6, maxWidth / totalWidth) * 0.98)
  }
  return { tokens: measured, totalWidth, fontSize, lineHeight: fontSize * (rtl ? 1.7 : 1.3), rtl, spaceWidth }
}

function shadow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = 'rgba(0,0,0,0.75)'
  ctx.shadowBlur = 12
  ctx.shadowOffsetY = 3
}

function drawRow(
  ctx: CanvasRenderingContext2D,
  row: RowLayout,
  kind: 'fa' | 'fi' | 'en',
  style: ScriptStyle,
  activeWord: number,
  centerX: number,
  y: number,
  settings: Project['style']
): void {
  ctx.save()
  ctx.font = fontString(style, row.fontSize)
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.direction = 'ltr'
  const baselineY = y + (row.lineHeight - row.fontSize) / 2
  // Lay tokens out left-to-right in screen space; for RTL rows reverse the visual order.
  const visual = row.rtl ? [...row.tokens].reverse() : row.tokens
  let x = centerX - row.totalWidth / 2
  for (const tok of visual) {
    const isCurrent = tok.wordIndex >= 0 && tok.wordIndex === activeWord
    const isSung = tok.wordIndex >= 0 && tok.wordIndex < activeWord
    const highlight = kind === 'en' ? false : isCurrent || isSung
    ctx.save()
    if (settings.textShadow) shadow(ctx)
    ctx.fillStyle = highlight && settings.highlightMode !== 'underline' ? style.highlightColor : style.color
    if (isCurrent && settings.highlightMode === 'glow') {
      ctx.shadowColor = style.highlightColor
      ctx.shadowBlur = Math.max(16, row.fontSize * 0.45)
      ctx.shadowOffsetY = 0
    }
    // Each word is drawn as its own run, so Farsi letters still join correctly inside the word.
    ctx.fillText(tok.text, x, baselineY)
    if (isCurrent && settings.highlightMode === 'underline') {
      ctx.shadowBlur = 0
      ctx.fillStyle = style.highlightColor
      ctx.fillRect(x, baselineY + row.fontSize * 1.08, tok.width, Math.max(3, row.fontSize * 0.07))
    }
    ctx.restore()
    x += tok.width + row.spaceWidth
  }
  ctx.restore()
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 4 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -2)
  return t + '…'
}
