import { describe, expect, it } from 'vitest'
import { activeAt, changePoints, distributeWords, stateKey } from '../src/renderer/src/lib/timing'
import { planExport } from '../src/renderer/src/render/exportFrames'
import { mergeLines, setLineFinglish } from '../src/renderer/src/lib/lines'
import { defaultStyle, linesFromText, type Project } from '../src/shared/types'

function project(): Project {
  const lines = linesFromText('دل من تنگه\nبرای تو\nباز هم تو')
  lines[0].start = 1
  lines[0].end = 3
  lines[0].words = distributeWords(lines[0])
  lines[1].start = 4
  lines[1].end = 5
  lines[1].words = distributeWords(lines[1])
  return {
    version: 1,
    id: 'p',
    title: 't',
    source: { type: 'file', audioFile: 'audio.mp3', durationSec: 10 },
    lines,
    lyricCandidates: [],
    translationCandidates: [],
    style: { ...defaultStyle(), lingerSeconds: 0.5 },
    finglishConventions: '',
    createdAt: '',
    updatedAt: ''
  }
}

describe('timing', () => {
  it('splits text into lines and words', () => {
    const lines = linesFromText(' سلام دنیا \n\nخوبی؟ ')
    expect(lines).toHaveLength(2)
    expect(lines[0].words.map((w) => w.fa)).toEqual(['سلام', 'دنیا'])
  })

  it('distributes words across the line span by length', () => {
    const p = project()
    const w = p.lines[0].words
    expect(w[0].start).toBe(1)
    expect(w[w.length - 1].end).toBeCloseTo(3)
    expect(w[1].start).toBeCloseTo(w[0].end!)
  })

  it('finds the active line and word, honouring linger', () => {
    const p = project()
    expect(activeAt(p, 0.5).line).toBeNull()
    expect(activeAt(p, 1.0).lineIndex).toBe(0)
    expect(activeAt(p, 1.0).wordIndex).toBe(0)
    expect(activeAt(p, 2.9).wordIndex).toBe(2)
    // linger keeps the line on screen briefly after it ends
    expect(activeAt(p, 3.2).lineIndex).toBe(0)
    expect(activeAt(p, 3.8).line).toBeNull()
    expect(activeAt(p, 3.8).upcoming?.id).toBe(p.lines[1].id)
    // untimed lines never show
    expect(activeAt(p, 9).line).toBeNull()
  })

  it('plans export segments that cover the whole song without duplicates', () => {
    const p = project()
    const plan = planExport(p, 10)
    const total = plan.segments.reduce((a, s) => a + s.duration, 0)
    expect(total).toBeCloseTo(10)
    expect(plan.segments[0].start).toBe(0)
    for (let i = 1; i < plan.segments.length; i++) {
      expect(plan.segments[i].key).not.toBe(plan.segments[i - 1].key)
      expect(plan.segments[i].start).toBeCloseTo(plan.segments[i - 1].start + plan.segments[i - 1].duration)
    }
    expect(changePoints(p, 10)).toContain(1)
    expect(stateKey(p, 0)).toBe(':-1:')
  })
})

describe('lines', () => {
  it('keeps timing for unchanged lines when lyrics are re-applied', () => {
    const p = project()
    const merged = mergeLines(p.lines, 'دل من تنگه\nخط جدید\nبرای تو')
    expect(merged).toHaveLength(3)
    expect(merged[0].id).toBe(p.lines[0].id)
    expect(merged[0].start).toBe(1)
    expect(merged[1].start).toBeUndefined()
    expect(merged[2].id).toBe(p.lines[1].id)
  })

  it('assigns per-word finglish when the token count matches', () => {
    const p = project()
    const l = setLineFinglish(p.lines[0], 'del-e man tange')
    expect(l.words.map((w) => w.finglish)).toEqual(['del-e', 'man', 'tange'])
    const bad = setLineFinglish(p.lines[0], 'del man')
    expect(bad.words.every((w) => w.finglish === undefined)).toBe(true)
    expect(bad.finglish).toBe('del man')
  })
})
