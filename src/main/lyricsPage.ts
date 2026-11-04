/**
 * Fetch a lyric web page and pull the Persian-script lyric lines out of it locally.
 * Claude is only used to find and rank the pages; it will not reproduce copyrighted
 * lyrics itself, so the app does the copying the user would otherwise do by hand.
 */

const PERSIAN = /[؀-ۿ]/g

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  zwnj: '‌',
  zwj: '‍'
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITIES[code.toLowerCase()] ?? m
  })
}

/** Convert HTML to plain text, one block element per line. */
export function htmlToLines(html: string): string[] {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, '')
    // Headings, links, buttons and form controls never hold lyric lines; mark them so they split lyric blocks.
    .replace(/<(h[1-6]|a|button|label|option|nav|select)\b[^>]*>/gi, '\n\u0001')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre|span)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(text)
    .split(/\r?\n/)
    .map((l) => l.replace(/[\t ]+/g, ' ').trim())
}

function persianCount(line: string): number {
  return (line.match(PERSIAN) ?? []).length
}

/**
 * Pick the densest run of Persian lines on the page: lyric sites wrap the lyrics in one
 * block, while navigation, comments and ads are scattered and short.
 */
export function extractPersianLyrics(html: string): string {
  const lines = htmlToLines(html)
  const isLyricLine = (text: string): boolean => {
    if (text.includes('\u0001')) return false
    const p = persianCount(text)
    const words = text.split(/\s+/).length
    // Lyric lines are mostly Persian letters and short; prose paragraphs and menus are not.
    return p >= 2 && p / text.replace(/\s/g, '').length > 0.5 && text.length <= 140 && words <= 14
  }
  // Group consecutive lyric lines; blank lines (from nested tags) are ignored, any other content splits groups.
  const groups: Array<Array<{ idx: number; text: string }>> = []
  let current: Array<{ idx: number; text: string }> = []
  lines.forEach((text, idx) => {
    if (!text) return
    if (isLyricLine(text)) {
      current.push({ idx, text })
    } else if (current.length) {
      groups.push(current)
      current = []
    }
  })
  if (current.length) groups.push(current)
  if (groups.length === 0) return ''
  const best = groups.reduce((a, b) => (score(b) > score(a) ? b : a))
  // Collapse blank-ish duplicates that come from nested tags.
  const out: string[] = []
  for (const { text } of best) {
    if (out[out.length - 1] !== text) out.push(text)
  }
  return out.join('\n')
}

function score(group: Array<{ text: string }>): number {
  return group.reduce((a, g) => a + g.text.length, 0) * Math.min(group.length, 40)
}

export function hasLyricLines(text: string, min = 4): boolean {
  return text.split('\n').filter((l) => persianCount(l) >= 2).length >= min
}

export async function fetchLyricsPage(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'fa,en;q=0.8'
      },
      redirect: 'follow'
    })
    if (!res.ok) throw new Error(`The page returned HTTP ${res.status}`)
    const html = await res.text()
    const lyrics = extractPersianLyrics(html)
    if (!hasLyricLines(lyrics)) {
      throw new Error('No Persian lyric block was found on that page (it may load the lyrics with JavaScript). Open the page and paste the lyrics into the editor.')
    }
    return lyrics
  } finally {
    clearTimeout(timer)
  }
}
