import { describe, expect, it } from 'vitest'
import { extractPersianLyrics, hasLyricLines, htmlToLines } from '../src/main/lyricsPage'

const page = `<!doctype html><html><head><title>متن آهنگ</title><style>.x{}</style></head><body>
<nav><a href="/">خانه</a> <a href="/a">آهنگ‌ها</a></nav>
<h1>متن آهنگ دل من تنگه</h1>
<p>این آهنگ در سال ۱۳۹۸ منتشر شد و یکی از پرطرفدارترین آهنگ‌های خواننده است که در آن از عشق و دلتنگی می‌گوید و بسیار محبوب شد و در کنسرت‌ها اجرا گردید و مردم آن را دوست دارند و همیشه می‌خوانند.</p>
<div class="lyrics">
دل من تنگه برای تو<br>
عزیزم کجایی<br>
باز هم تو<br>
دل من تنگه برای تو<br>
عزیزم کجایی &amp; باز هم<br>
</div>
<h3>نظرات</h3><div class="comments"><p>عالی بود</p><p>ممنون</p></div>
<script>var x = "دل";</script>
</body></html>`

describe('lyrics page extraction', () => {
  it('turns html into lines and decodes entities', () => {
    const lines = htmlToLines('<p>a &amp; b</p><p>&#1583;&#x644;</p>')
    expect(lines.filter(Boolean)).toEqual(['a & b', 'دل'])
    expect(extractPersianLyrics('<h2>نظرات</h2><p>عالی بود</p>')).toBe('عالی بود')
  })

  it('picks the lyric block and skips navigation, prose and comments', () => {
    const text = extractPersianLyrics(page)
    expect(text.split('\n')).toEqual(['دل من تنگه برای تو', 'عزیزم کجایی', 'باز هم تو', 'دل من تنگه برای تو', 'عزیزم کجایی & باز هم'])
    expect(hasLyricLines(text)).toBe(true)
    expect(hasLyricLines('Lyrics left out because the song is copyrighted.')).toBe(false)
  })
})
