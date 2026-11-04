import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import type { ExplainLinesResult, GenerateTextRequest, GenerateTextResult, LyricSearchQuery } from '../shared/api'
import { newId, type Line, type LyricCandidate, type TranslationCandidate } from '../shared/types'
import { getApiKey, getModel } from './settings'
import { log, progress } from './events'
import { fetchLyricsPage, hasLyricLines } from './lyricsPage'

const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

function client(): Anthropic {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('No Anthropic API key configured. Add one in Settings.')
  // Electron's main process can take a while on long searches; allow 10 minutes per request.
  return new Anthropic({ apiKey, timeout: 10 * 60 * 1000, maxRetries: 2 })
}

type BetaMessage = Anthropic.Beta.Messages.BetaMessage
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam

function textOf(msg: BetaMessage): string {
  return msg.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

function assertNotRefused(msg: BetaMessage): void {
  if (msg.stop_reason === 'refusal') {
    const why = msg.stop_details && 'explanation' in msg.stop_details ? msg.stop_details.explanation : ''
    throw new Error(`Claude declined this request${why ? `: ${why}` : '.'}`)
  }
}

/**
 * Runs a web-search-enabled conversation until Claude ends its turn (resuming `pause_turn`),
 * then returns the full transcript so a structured-output call can summarise it.
 */
async function researchTurn(
  task: string,
  system: string,
  userPrompt: string,
  maxSearches: number
): Promise<BetaMessageParam[]> {
  const anthropic = client()
  const messages: BetaMessageParam[] = [{ role: 'user', content: userPrompt }]
  for (let round = 0; round < 6; round++) {
    progress({ task, fraction: -1, message: round === 0 ? 'Claude is searching the web…' : 'Still searching…' })
    const stream = anthropic.beta.messages.stream({
      model: getModel(),
      max_tokens: 32000,
      system,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: maxSearches },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: maxSearches }
      ],
      messages
    })
    stream.on('text', (delta) => {
      if (delta.trim()) log(task, delta)
    })
    const msg = await stream.finalMessage()
    assertNotRefused(msg)
    messages.push({ role: 'assistant', content: msg.content })
    if (msg.stop_reason !== 'pause_turn') return messages
  }
  return messages
}

async function structured<T extends z.ZodType>(
  task: string,
  system: string,
  transcript: BetaMessageParam[],
  instruction: string,
  schema: T
): Promise<z.infer<T>> {
  const anthropic = client()
  progress({ task, fraction: -1, message: 'Organising results…' })
  const msg = await anthropic.beta.messages.parse({
    model: getModel(),
    max_tokens: 32000,
    system,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
    messages: [...transcript, { role: 'user', content: instruction }]
  })
  assertNotRefused(msg)
  if (!msg.parsed_output) throw new Error('Claude returned no structured result. Try again.')
  return msg.parsed_output
}

// ---------------------------------------------------------------- Lyrics search

const LyricCandidatesSchema = z.object({
  candidates: z.array(
    z.object({
      source: z.string().describe('Website or publisher name'),
      url: z.string().describe('URL the lyrics were taken from, empty if unknown'),
      title: z.string(),
      artist: z.string(),
      lyrics: z.string().describe('Farsi lyrics in Persian script, one line per line, if you reproduce them; otherwise an empty string'),
      notes: z.string().describe('How this version differs from others, completeness, trustworthiness'),
      confidence: z.enum(['high', 'medium', 'low'])
    })
  )
})

const LYRICS_SYSTEM = `You are a research assistant inside a desktop app that builds Farsi karaoke videos for language learners.
Your job is to find web pages that carry the authentic Persian-script lyrics of a song. Search several sources (lyric sites, music databases, fan pages, the artist's own channels), fetch the pages that look promising and compare them: completeness, whether repeated choruses are written out, spelling quality, whether the page is the official or best-known source.
The app downloads the chosen page itself and extracts the lyric lines locally, so you do not need to reproduce the lyrics; report the exact page URL of each version instead. If you can quote the lyrics, do so in Persian script with one lyric line per line; if you choose not to, leave the lyrics field empty and the app will use the page.
If different sources disagree (different verses, different ordering, different spellings), report them as separate candidates so the user can choose.`

export async function searchLyrics(query: LyricSearchQuery): Promise<LyricCandidate[]> {
  const parts = [
    query.title ? `Song title: ${query.title}` : '',
    query.artist ? `Artist: ${query.artist}` : '',
    query.hints ? `Extra hints from the user: ${query.hints}` : ''
  ].filter(Boolean)
  const transcript = await researchTurn(
    'lyrics',
    LYRICS_SYSTEM,
    `Find the full Persian-script lyrics for this song.\n${parts.join('\n')}\n\nSearch in Persian as well as English (e.g. "متن آهنگ <title> <artist>"). Fetch at least two full sources when you can and report the lyrics of each as a separate version, with the source URL. Finish by listing each candidate's complete lyrics.`,
    10
  )
  const out = await structured(
    'lyrics',
    LYRICS_SYSTEM,
    transcript,
    'Now return every distinct version of the lyrics you found as structured candidates, each with the exact URL of its page. Put the lyrics in Persian script, one lyric line per line, in the lyrics field when you reproduce them; otherwise leave that field empty. Order by confidence.',
    LyricCandidatesSchema
  )
  const candidates: LyricCandidate[] = []
  for (const c of out.candidates) {
    let text = c.lyrics.trim()
    let notes = c.notes
    if (!hasLyricLines(text) && c.url) {
      progress({ task: 'lyrics', fraction: -1, message: `Fetching lyrics from ${c.source}…` })
      try {
        text = await fetchLyricsPage(c.url)
        notes = `Lyrics extracted from the page by the app. ${notes}`
      } catch (err) {
        notes = `${notes} (Could not extract the lyrics automatically: ${(err as Error).message})`
      }
    }
    candidates.push({
      id: newId(),
      source: c.source,
      url: c.url || undefined,
      title: c.title,
      artist: c.artist,
      text,
      notes,
      confidence: c.confidence
    })
  }
  progress({ task: 'lyrics', fraction: 1, message: `Found ${candidates.length} candidate(s)`, done: true })
  return candidates
}

export { fetchLyricsPage }

// ---------------------------------------------------------------- Transliteration / translation

const TextSchema = z.object({
  lines: z.array(
    z.object({
      index: z.number().int().describe('0-based index of the line in the input'),
      words: z.array(z.string()).describe('One Finglish token per Farsi word, same count and order as the input words'),
      english: z.string().describe('Natural English translation of the whole line')
    })
  )
})

function textSystem(conventions: string): string {
  return `You help an English speaker learn Farsi through song lyrics.
Transliteration rules (Finglish): ${conventions}
Translation rules: translate each line into natural English that keeps the imagery and emotional register of the original; prefer what the lyric means to a Persian speaker over a word-for-word gloss. Keep it to one line of English per Farsi line.
Always keep the word count of the Finglish tokens identical to the number of Farsi words given for that line, in the same order, so the app can highlight word by word. If a Farsi "word" is really two words joined, still produce exactly one token for it (join with a hyphen).`
}

export async function generateText(req: GenerateTextRequest): Promise<GenerateTextResult> {
  const anthropic = client()
  const lines = req.lines
  const result: GenerateTextResult = { lines: [] }
  // Work in chunks so a long song does not produce one giant response.
  const CHUNK = 24
  for (let offset = 0; offset < lines.length; offset += CHUNK) {
    const slice = lines.slice(offset, offset + CHUNK)
    progress({
      task: 'text',
      fraction: offset / lines.length,
      message: `Generating ${req.what === 'both' ? 'Finglish and English' : req.what} for lines ${offset + 1}–${offset + slice.length} of ${lines.length}…`
    })
    const payload = slice
      .map((l, i) => `${i}: ${l.words.map((w) => w.fa).join(' ')}`)
      .join('\n')
    const context = [req.title ? `Song: ${req.title}` : '', req.artist ? `Artist: ${req.artist}` : ''].filter(Boolean).join(', ')
    const msg = await anthropic.beta.messages.parse({
      model: getModel(),
      max_tokens: 32000,
      system: textSystem(req.conventions),
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(TextSchema) },
      messages: [
        {
          role: 'user',
          content: `${context ? context + '\n' : ''}Lines (index: words separated by single spaces):\n${payload}\n\nFor every line return the Finglish tokens (exactly one per Farsi word) and the English translation.`
        }
      ]
    })
    assertNotRefused(msg)
    const parsed = msg.parsed_output
    if (!parsed) throw new Error('Claude returned no structured result. Try again.')
    for (const item of parsed.lines) {
      const line = slice[item.index]
      if (!line) continue
      const words = fitTokens(item.words, line.words.length)
      const entry: GenerateTextResult['lines'][number] = { id: line.id }
      if (req.what !== 'english') {
        entry.finglish = words.join(' ')
        entry.words = line.words.map((w, i) => ({ id: w.id, finglish: words[i] }))
      }
      if (req.what !== 'finglish') entry.en = item.english.trim()
      result.lines.push(entry)
    }
  }
  progress({ task: 'text', fraction: 1, message: 'Done', done: true })
  return result
}

/** Force a token list to the expected length: merge extras into the last token, pad with empty strings. */
function fitTokens(tokens: string[], count: number): string[] {
  const t = tokens.map((s) => s.trim()).filter(Boolean)
  if (t.length === count) return t
  if (t.length > count) {
    const head = t.slice(0, count - 1)
    head.push(t.slice(count - 1).join('-'))
    return head
  }
  // Fewer tokens than words: split joined tokens on hyphens first, then pad.
  const expanded = t.flatMap((s) => (s.includes('-') && t.length < count ? s.split('-') : [s]))
  const base = expanded.length <= count ? expanded : t
  while (base.length < count) base.push('')
  return base.slice(0, count)
}

// ---------------------------------------------------------------- Translation search

const TranslationCandidatesSchema = z.object({
  candidates: z.array(
    z.object({
      source: z.string(),
      url: z.string(),
      lines: z.array(z.string()).describe('English translation, one entry per original lyric line, same order'),
      notes: z.string()
    })
  )
})

export async function searchTranslations(lines: Line[], query: LyricSearchQuery): Promise<TranslationCandidate[]> {
  const system = `You find existing English translations of Persian song lyrics on the web (lyric translation sites, fan blogs, video descriptions, forums). Report each distinct translation you find with its source.`
  const lyrics = lines.map((l, i) => `${i}: ${l.fa}`).join('\n')
  const transcript = await researchTurn(
    'translations',
    system,
    `Find published English translations for this song.\n${query.title ? `Title: ${query.title}\n` : ''}${query.artist ? `Artist: ${query.artist}\n` : ''}\nThe lyrics, numbered by line:\n${lyrics}\n\nSearch in English and Persian (e.g. "ترجمه انگلیسی آهنگ ..."). Fetch the pages, and for each translation you find, match its lines to the numbered lyric lines above.`,
    8
  )
  const out = await structured(
    'translations',
    system,
    transcript,
    `Return each distinct translation as a candidate. For every candidate give exactly ${lines.length} entries in "lines", one per numbered lyric line in order; use an empty string where the source has no translation for that line.`,
    TranslationCandidatesSchema
  )
  progress({ task: 'translations', fraction: 1, message: `Found ${out.candidates.length} translation(s)`, done: true })
  return out.candidates.map((c) => ({
    id: newId(),
    source: c.source,
    url: c.url || undefined,
    lines: c.lines,
    notes: c.notes
  }))
}

// ---------------------------------------------------------------- Explanations

const EXPLAIN_SYSTEM = `You are a warm, knowledgeable Persian friend explaining song lyrics to an English speaker who is learning Farsi.
Explain what the words actually mean to a native speaker: idioms, poetic images, cultural or religious references, slang, register (formal/colloquial), wordplay, and what feeling the line carries. Point out useful vocabulary and grammar briefly. Mention when a phrase is sung in a colloquial form that differs from written Farsi.
Write in plain prose or short bullet points. Do not repeat the full translation unless it helps. Be concrete and avoid padding.`

export async function explainLine(req: { lines: Line[]; lineId: string; title?: string; artist?: string }): Promise<string> {
  const anthropic = client()
  const idx = req.lines.findIndex((l) => l.id === req.lineId)
  if (idx < 0) throw new Error('Line not found')
  const line = req.lines[idx]
  const context = req.lines
    .slice(Math.max(0, idx - 3), idx + 4)
    .map((l, i) => `${Math.max(0, idx - 3) + i === idx ? '>> ' : '   '}${l.fa}${l.en ? `  —  ${l.en}` : ''}`)
    .join('\n')
  progress({ task: 'explain', fraction: -1, message: 'Asking Claude…' })
  const stream = anthropic.beta.messages.stream({
    model: getModel(),
    max_tokens: 8000,
    system: EXPLAIN_SYSTEM,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    output_config: { effort: 'medium' },
    messages: [
      {
        role: 'user',
        content: `${req.title ? `Song: ${req.title}` : ''}${req.artist ? ` by ${req.artist}` : ''}\n\nSurrounding lines (the one marked >> is the one to explain):\n${context}\n\nExplain the marked line:\n${line.fa}\n${line.finglish ? `Finglish: ${line.finglish}\n` : ''}${line.en ? `Current translation: ${line.en}\n` : ''}`
      }
    ]
  })
  const msg = await stream.finalMessage()
  assertNotRefused(msg)
  progress({ task: 'explain', fraction: 1, message: 'Done', done: true })
  return textOf(msg).trim()
}

const ExplainLinesSchema = z.object({
  lines: z.array(
    z.object({
      index: z.number().int().describe('Index of the line as numbered in the request'),
      explanation: z.string().describe('What the line means to a native speaker: idioms, imagery, register, cultural references, useful grammar'),
      words: z.array(
        z.object({
          index: z.number().int().describe('0-based index of the word within the line'),
          gloss: z.string().describe('Short English meaning of this word as used here, 1-4 words, e.g. "my heart", "is tight (longs)"')
        })
      )
    })
  )
})

/** Explain lines in batches with the whole song as context, and gloss every word. */
export async function explainLines(req: {
  lines: Line[]
  lineIds: string[]
  title?: string
  artist?: string
}): Promise<ExplainLinesResult> {
  const anthropic = client()
  const wanted = req.lines.filter((l) => req.lineIds.includes(l.id))
  const result: ExplainLinesResult = { lines: [] }
  if (wanted.length === 0) return result
  const songText = req.lines.map((l, i) => `${i}: ${l.fa}${l.en ? `  —  ${l.en}` : ''}`).join('\n')
  const CHUNK = 10
  for (let offset = 0; offset < wanted.length; offset += CHUNK) {
    const slice = wanted.slice(offset, offset + CHUNK)
    progress({
      task: 'explain',
      fraction: offset / wanted.length,
      message: `Explaining lines ${offset + 1}–${offset + slice.length} of ${wanted.length}…`
    })
    const ask = slice
      .map((l) => {
        const i = req.lines.indexOf(l)
        return `${i}: ${l.words.map((w, wi) => `[${wi}] ${w.fa}`).join(' ')}`
      })
      .join('\n')
    const msg = await anthropic.beta.messages.parse({
      model: getModel(),
      max_tokens: 32000,
      system: EXPLAIN_SYSTEM,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(ExplainLinesSchema) },
      messages: [
        {
          role: 'user',
          content: `${req.title ? `Song: ${req.title}` : ''}${req.artist ? ` by ${req.artist}` : ''}\n\nFull lyrics for context (line number: Farsi — English):\n${songText}\n\nExplain these lines (line number: words with their indices). For each line give the explanation and a short gloss for every word index listed:\n${ask}`
        }
      ]
    })
    assertNotRefused(msg)
    const parsed = msg.parsed_output
    if (!parsed) throw new Error('Claude returned no structured result. Try again.')
    for (const item of parsed.lines) {
      const line = req.lines[item.index]
      if (!line || !slice.includes(line)) continue
      result.lines.push({
        id: line.id,
        explanation: item.explanation.trim(),
        words: item.words
          .filter((w) => line.words[w.index])
          .map((w) => ({ id: line.words[w.index].id, gloss: w.gloss.trim() }))
      })
    }
  }
  progress({ task: 'explain', fraction: 1, message: 'Done', done: true })
  return result
}

export async function explainSong(req: { lines: Line[]; title?: string; artist?: string }): Promise<string> {
  const anthropic = client()
  const lyrics = req.lines.map((l) => `${l.fa}${l.en ? `  —  ${l.en}` : ''}`).join('\n')
  progress({ task: 'explain', fraction: -1, message: 'Asking Claude…' })
  const stream = anthropic.beta.messages.stream({
    model: getModel(),
    max_tokens: 12000,
    system: EXPLAIN_SYSTEM,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    output_config: { effort: 'medium' },
    messages: [
      {
        role: 'user',
        content: `${req.title ? `Song: ${req.title}` : ''}${req.artist ? ` by ${req.artist}` : ''}\n\nLyrics:\n${lyrics}\n\nGive an overview of this song for a learner: what it is about, the story or emotional arc, who the singer is addressing, the cultural background (era, genre, the artist's place in Iranian music if you know it), recurring images and the key vocabulary worth remembering. Use headed sections.`
      }
    ]
  })
  const msg = await stream.finalMessage()
  assertNotRefused(msg)
  progress({ task: 'explain', fraction: 1, message: 'Done', done: true })
  return textOf(msg).trim()
}

export async function testApiKey(): Promise<{ ok: boolean; message: string }> {
  try {
    const anthropic = client()
    const model = await anthropic.models.retrieve(getModel())
    return { ok: true, message: `Key works. Model: ${model.display_name}` }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, message: 'Invalid API key.' }
    if (err instanceof Anthropic.APIError) return { ok: false, message: `API error ${err.status}: ${err.message}` }
    return { ok: false, message: (err as Error).message }
  }
}
