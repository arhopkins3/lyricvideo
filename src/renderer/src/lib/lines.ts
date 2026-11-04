import { linesFromText, newId, type Line } from '../../../shared/types'

/**
 * Re-split edited lyric text into lines while keeping timing, translations and
 * explanations of lines whose Farsi text did not change.
 */
export function mergeLines(existing: Line[], text: string): Line[] {
  const fresh = linesFromText(text)
  const pool = [...existing]
  return fresh.map((nl) => {
    const idx = pool.findIndex((ol) => ol.fa === nl.fa)
    if (idx >= 0) {
      const [old] = pool.splice(idx, 1)
      return old
    }
    // Try a looser match: same words ignoring punctuation/spaces.
    const key = normKey(nl.fa)
    const idx2 = pool.findIndex((ol) => normKey(ol.fa) === key)
    if (idx2 >= 0) {
      const [old] = pool.splice(idx2, 1)
      return { ...old, fa: nl.fa, words: rewords(old, nl) }
    }
    return nl
  })
}

function normKey(s: string): string {
  return s.replace(/[\s‌،؛؟,.!?"'«»()\-]+/g, '').toLowerCase()
}

/** Keep word timings when the word count matches; otherwise fall back to the fresh words. */
function rewords(old: Line, fresh: Line): Line['words'] {
  if (old.words.length === fresh.words.length) {
    return fresh.words.map((w, i) => ({ ...old.words[i], fa: w.fa }))
  }
  return fresh.words
}

/** Set a line's Finglish; distribute per-word tokens when the count matches. */
export function setLineFinglish(line: Line, finglish: string): Line {
  const tokens = finglish.trim().split(/\s+/).filter(Boolean)
  const words = line.words.map((w, i) => ({
    ...w,
    finglish: tokens.length === line.words.length ? tokens[i] : undefined
  }))
  return { ...line, finglish, words }
}

export function splitLineAt(line: Line, wordIndex: number): [Line, Line] {
  const a = line.words.slice(0, wordIndex)
  const b = line.words.slice(wordIndex)
  const mk = (words: Line['words']): Line => ({
    id: newId(),
    fa: words.map((w) => w.fa).join(' '),
    finglish: words.every((w) => w.finglish !== undefined) ? words.map((w) => w.finglish).join(' ') : undefined,
    words,
    start: words[0]?.start,
    end: words[words.length - 1]?.end
  })
  return [mk(a), mk(b)]
}

export function joinLines(a: Line, b: Line): Line {
  const words = [...a.words, ...b.words]
  return {
    ...a,
    fa: `${a.fa} ${b.fa}`,
    finglish: a.finglish && b.finglish ? `${a.finglish} ${b.finglish}` : undefined,
    en: a.en && b.en ? `${a.en} ${b.en}` : a.en ?? b.en,
    explanation: undefined,
    words,
    start: a.start ?? b.start,
    end: b.end ?? a.end
  }
}
