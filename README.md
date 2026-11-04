# LyricVideo

A macOS desktop app for building Farsi karaoke / lyric videos while learning the language.

- Import an MP3 or paste a YouTube link (video is downloaded, audio extracted).
- A Claude agent searches the web for the lyrics and offers candidates to pick from.
- Claude generates Finglish transliteration (per word) and English translation, or finds existing translations online.
- Ask for explanations of what each line really means: idioms, slang, cultural context, and a whole-song overview.
- Automatic word-level alignment, then fix the timing on a waveform with draggable line blocks and word boundaries, or tap words in time with the music.
- Style the output (fonts, colours, highlight mode, solid / gradient / image / original-video background) and export a 1920x1080 MP4.
- Save everything, media included, as one `.lvproj` package that reopens offline.

## Requirements (macOS)

```bash
brew install node ffmpeg yt-dlp python
```

- Node 20+ to run the app from source.
- `ffmpeg` and `yt-dlp` are detected on PATH / Homebrew; you can also set explicit paths in Settings.
- Python 3.10+ is used only for the automatic aligner (installed into a private virtual environment from Settings).
- An Anthropic API key (console.anthropic.com), pasted into Settings. It is stored encrypted with the macOS keychain.

## Run from source

```bash
npm install
npm run dev
```

`npm run dev` starts the Electron app with hot reload. If it ever fails with `Error: Electron uninstall`, the Electron binary was not downloaded during `npm install`; `npm run dev` now fetches it automatically, or run `node node_modules/electron/install.js` by hand. Other scripts:

```bash
npm run typecheck      # TypeScript for main + renderer
npm test               # unit tests (vitest)
npm run build          # production bundles into out/
npm run package:mac    # unpacked .app in release/mac-arm64 (or mac/)
npm run dist:mac       # .dmg and .zip in release/
```

The packaged app is unsigned; on first launch right-click the app and choose Open.

## Workflow

1. **Source** – title/artist, Finglish conventions for this project.
2. **Lyrics** – "Search the web with Claude" returns candidate lyrics with sources. Pick one or paste your own. The editor is one line per lyric line; lines are split into words on spaces.
3. **Translate** – generate Finglish + English, search the web for published translations, and ask for a meaning explanation per line or for the whole song. Every cell is editable. A Finglish line gets per-word highlighting when it has exactly one token per Farsi word.
4. **Align** – "Auto-align words" runs the Python aligner (faster-whisper transcription in Farsi matched to the lyric words). Then adjust:
   - drag or resize line blocks on the waveform (words scale with the line),
   - drag word boundaries in the line strip, or set a word's start/end to the playhead,
   - **Tap mode**: play the song and hold `Enter` (or `T`) for the duration of each word (or each line), release when it ends.
   - nudge a line, or everything from a line onwards, by 0.1 s.
   Space toggles playback everywhere; the speed selector slows the song down for learning.
5. **Style** – live preview of the frame. Choose which scripts are shown, fonts, sizes, colours, highlight mode, position, and the background (solid, gradient, image, or the original video with dim/blur).
6. **Export** – renders one PNG per word change with the same canvas renderer used for the preview, and ffmpeg composites them over the background and muxes the audio into an H.264 MP4.

Save with ⌘S. The `.lvproj` is a zip of `project.json`, `audio.mp3`, `video.mp4` (if any) and the background image.

## Automatic alignment

Settings → "Set up aligner" creates `~/Library/Application Support/lyricvideo/aligner-venv` and installs `faster-whisper`. The first alignment downloads the chosen Whisper model (`large-v3-turbo` by default, ~1.6 GB). Models run on CPU; a 4-minute song takes roughly 1–3 minutes on Apple Silicon.

For songs with heavy instrumentation, vocal separation helps a lot. It is optional because it pulls in PyTorch:

```bash
~/Library/Application\ Support/lyricvideo/aligner-venv/bin/pip install -r resources/aligner/requirements-separation.txt
```

Then tick "separate vocals" next to the Auto-align button.

Words the recogniser did not hear are interpolated between their neighbours, so expect to fix a few by hand; the report after alignment says how many matched directly.

## Claude usage

All Claude calls go through the main process using the official `@anthropic-ai/sdk` (`claude-opus-5-5` by default, changeable in Settings). Lyric and translation searches use the server-side web search and web fetch tools, then a structured-output pass turns the findings into candidates. Server-side refusal fallback is enabled on every request.

## Layout

```
src/main        Electron main process: IPC, settings, media download, Claude, aligner runner, ffmpeg export, project packages
src/preload     contextBridge API exposed to the renderer as window.api
src/renderer    React UI (zustand store, wavesurfer timeline, canvas renderer)
src/shared      Types shared across processes
resources/aligner  Python sidecar (align.py) + requirements
docs/DESIGN.md  Design decisions
tests/          Unit tests (vitest); resources/aligner/test_align.py for the aligner matching logic
```

## Notes

- Downloading from YouTube may be against YouTube's terms for some content; use it for material you have the right to use.
- The app has only been exercised on Linux under a virtual display during development; file dialogs, keychain storage and the packaged `.app` should be verified on a Mac.
