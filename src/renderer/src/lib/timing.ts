import type { Line, Project, Word } from '../../../shared/types'

export interface ActiveState {
  lineIndex: number
  line: Line | null
  wordIndex: number
  /** The line that starts next (for the "upcoming" hint). */
  upcoming: Line | null
}

export function hasTiming(l: Line): l is Line & { start: number; end: number } {
  return typeof l.start === 'number' && typeof l.end === 'number'
}

/** Which line/word is active at time t, honouring the linger period after a line ends. */
export function activeAt(project: Project, t: number): ActiveState {
  const linger = project.style.lingerSeconds
  const lines = project.lines
  let lineIndex = -1
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!hasTiming(l)) continue
    const next = nextTimed(lines, i)
    const visibleEnd = next ? Math.min(l.end + linger, next.start) : l.end + linger
    if (t >= l.start && t < visibleEnd) {
      lineIndex = i
      break
    }
  }
  const line = lineIndex >= 0 ? lines[lineIndex] : null
  let wordIndex = -1
  if (line) {
    for (let i = 0; i < line.words.length; i++) {
      const w = line.words[i]
      if (typeof w.start === 'number' && t >= w.start) wordIndex = i
    }
  }
  let upcoming: Line | null = null
  for (const l of lines) {
    if (hasTiming(l) && l.start > t) {
      upcoming = l
      break
    }
  }
  return { lineIndex, line, wordIndex, upcoming }
}

function nextTimed(lines: Line[], from: number): (Line & { start: number; end: number }) | null {
  for (let j = from + 1; j < lines.length; j++) {
    const l = lines[j]
    if (hasTiming(l)) return l
  }
  return null
}

/** A key that changes whenever the rendered frame would change. Used to deduplicate export frames. */
export function stateKey(project: Project, t: number): string {
  const s = activeAt(project, t)
  const up = project.style.showUpcomingLine ? s.upcoming?.id ?? '' : ''
  return `${s.line?.id ?? ''}:${s.wordIndex}:${up}`
}

/** All times at which the rendered frame may change, sorted and deduplicated. */
export function changePoints(project: Project, duration: number): number[] {
  const linger = project.style.lingerSeconds
  const pts = new Set<number>([0])
  const push = (v: number | undefined) => {
    if (typeof v === 'number' && v >= 0 && v <= duration) pts.add(Math.round(v * 1000) / 1000)
  }
  for (const l of project.lines) {
    push(l.start)
    push(l.end)
    if (typeof l.end === 'number') push(l.end + linger)
    for (const w of l.words) {
      push(w.start)
      push(w.end)
    }
  }
  return Array.from(pts).sort((a, b) => a - b)
}

export function fmtTime(t: number | undefined): string {
  if (typeof t !== 'number' || !Number.isFinite(t)) return '–:––.––'
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

export function lineHasAnyTiming(l: Line): boolean {
  return hasTiming(l) || l.words.some((w) => typeof w.start === 'number')
}

/** Spread word timings evenly over the line's span, weighted by word length. */
export function distributeWords(line: Line): Word[] {
  if (!hasTiming(line)) return line.words
  const weights = line.words.map((w) => Math.max(1, w.fa.length))
  const total = weights.reduce((a, b) => a + b, 0)
  let t = line.start
  return line.words.map((w, i) => {
    const d = ((line.end - line.start) * weights[i]) / total
    const out = { ...w, start: t, end: t + d }
    t += d
    return out
  })
}

const MIN_WORD = 0.05
/** Two edges closer than this are treated as attached and stay attached when one side moves. */
const GLUE = 0.03

/**
 * Slide a set of words (possibly across several lines) by `delta` seconds as one rigid group.
 * Word order within a line is preserved (the move is clamped), and edges that were touching an
 * unselected neighbour stay attached: moving a late word earlier stretches it to the next word
 * instead of leaving a gap, and the previous word shrinks or grows to meet it.
 * Returns the updated word arrays per line (only lines that changed).
 */
export function moveWords(lines: Line[], selectedIds: Set<string>, delta: number): Map<string, Word[]> {
  const out = new Map<string, Word[]>()
  if (selectedIds.size === 0 || delta === 0) return out
  // Clamp delta so order is preserved in every affected line and nothing goes below zero.
  let lo = -Infinity
  let hi = Infinity
  for (const line of lines) {
    const idx = line.words.map((w, i) => (selectedIds.has(w.id) ? i : -1)).filter((i) => i >= 0)
    if (idx.length === 0) continue
    const first = line.words[idx[0]]
    const last = line.words[idx[idx.length - 1]]
    if (first.start === undefined || last.start === undefined) continue
    const prev = line.words[idx[0] - 1]
    const next = line.words[idx[idx.length - 1] + 1]
    lo = Math.max(lo, -first.start, prev?.start !== undefined ? prev.start + MIN_WORD - first.start : -Infinity)
    hi = Math.min(hi, next?.start !== undefined ? next.start - MIN_WORD - last.start : Infinity)
  }
  if (lo === -Infinity && hi === Infinity) return out
  const d = Math.min(hi, Math.max(lo, delta))
  if (!Number.isFinite(d) || d === 0) return out
  for (const line of lines) {
    const idx = line.words.map((w, i) => (selectedIds.has(w.id) ? i : -1)).filter((i) => i >= 0)
    if (idx.length === 0) continue
    const words = line.words.map((w) => ({ ...w }))
    for (const i of idx) {
      const w = words[i]
      if (w.start === undefined || w.end === undefined) continue
      w.start += d
      w.end += d
    }
    const firstI = idx[0]
    const lastI = idx[idx.length - 1]
    const prev = words[firstI - 1]
    const first = words[firstI]
    const oldFirst = line.words[firstI]
    if (prev && prev.end !== undefined && prev.start !== undefined && oldFirst.start !== undefined && Math.abs(prev.end - oldFirst.start) <= GLUE) {
      prev.end = Math.max(prev.start + MIN_WORD, first.start!)
    }
    const next = words[lastI + 1]
    const last = words[lastI]
    const oldLast = line.words[lastI]
    if (next && next.start !== undefined && oldLast.end !== undefined && Math.abs(oldLast.end - next.start) <= GLUE) {
      last.end = Math.max(last.start! + MIN_WORD, next.start)
    }
    out.set(line.id, words)
  }
  return out
}

/** Ids of all words in document order between (and including) two word ids. */
export function wordRange(lines: Line[], fromId: string, toId: string): string[] {
  const all = lines.flatMap((l) => l.words.map((w) => w.id))
  const a = all.indexOf(fromId)
  const b = all.indexOf(toId)
  if (a < 0 || b < 0) return [toId]
  return all.slice(Math.min(a, b), Math.max(a, b) + 1)
}
