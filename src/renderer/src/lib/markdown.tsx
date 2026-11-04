/** Minimal markdown rendering for Claude's explanations: headings, bullets, bold, paragraphs. */
export function Markdown({ text }: { text: string }): JSX.Element {
  const blocks: JSX.Element[] = []
  const lines = text.split(/\r?\n/)
  let list: string[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) {
      blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>)
      para = []
    }
    if (list.length) {
      blocks.push(
        <ul key={blocks.length}>
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>
      )
      list = []
    }
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      flush()
      const level = h[1].length
      blocks.push(level <= 2 ? <h4 key={blocks.length}>{inline(h[2])}</h4> : <h5 key={blocks.length}>{inline(h[2])}</h5>)
      continue
    }
    const b = line.match(/^\s*[-*•]\s+(.*)$/)
    if (b) {
      if (para.length) flush()
      list.push(b[1])
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    if (list.length) flush()
    para.push(line)
  }
  flush()
  return <div className="md">{blocks}</div>
}

function inline(s: string): Array<string | JSX.Element> {
  const parts: Array<string | JSX.Element> = []
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index))
    if (m[1]) parts.push(<b key={k++}>{m[1]}</b>)
    else parts.push(<code key={k++}>{m[2]}</code>)
    last = m.index + m[0].length
  }
  if (last < s.length) parts.push(s.slice(last))
  return parts
}
