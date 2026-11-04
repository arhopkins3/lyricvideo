/**
 * Single audio element that acts as the master clock for the whole app.
 * The waveform, the preview canvas and the background video all follow it.
 */
type Listener = () => void

class Player {
  readonly audio: HTMLAudioElement
  private listeners = new Set<Listener>()
  private video: HTMLVideoElement | null = null
  private raf = 0

  constructor() {
    this.audio = new Audio()
    this.audio.preload = 'auto'
    const emit = () => this.emit()
    this.audio.addEventListener('play', () => {
      this.video?.play().catch(() => undefined)
      this.tick()
      emit()
    })
    this.audio.addEventListener('pause', () => {
      this.video?.pause()
      cancelAnimationFrame(this.raf)
      emit()
    })
    this.audio.addEventListener('seeked', () => {
      this.syncVideo(true)
      emit()
    })
    this.audio.addEventListener('ratechange', () => {
      if (this.video) this.video.playbackRate = this.audio.playbackRate
      emit()
    })
    this.audio.addEventListener('loadedmetadata', emit)
    this.audio.addEventListener('ended', emit)
  }

  load(url: string | null): void {
    if (!url) {
      this.audio.removeAttribute('src')
      this.audio.load()
      return
    }
    if (this.audio.src !== url) {
      this.audio.src = url
      this.audio.load()
    }
    this.emit()
  }

  /** Attach (or detach) a muted video element that mirrors the audio clock. */
  attachVideo(video: HTMLVideoElement | null): void {
    this.video = video
    if (video) {
      video.muted = true
      video.playbackRate = this.audio.playbackRate
      this.syncVideo(true)
      if (!this.audio.paused) video.play().catch(() => undefined)
    }
  }

  private syncVideo(force = false): void {
    const v = this.video
    if (!v) return
    const drift = Math.abs(v.currentTime - this.audio.currentTime)
    if (force || drift > 0.12) v.currentTime = this.audio.currentTime
  }

  private tick = (): void => {
    this.syncVideo()
    this.emit()
    if (!this.audio.paused) this.raf = requestAnimationFrame(this.tick)
  }

  get time(): number {
    return this.audio.currentTime
  }
  get duration(): number {
    return Number.isFinite(this.audio.duration) ? this.audio.duration : 0
  }
  get playing(): boolean {
    return !this.audio.paused
  }
  get rate(): number {
    return this.audio.playbackRate
  }

  play(): void {
    this.audio.play().catch(() => undefined)
  }
  pause(): void {
    this.audio.pause()
  }
  toggle(): void {
    if (this.audio.paused) this.play()
    else this.pause()
  }
  seek(t: number): void {
    const d = this.duration || Infinity
    this.audio.currentTime = Math.max(0, Math.min(t, d))
    this.emit()
  }
  setRate(r: number): void {
    this.audio.playbackRate = r
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit(): void {
    for (const l of this.listeners) l()
  }
}

export const player = new Player()
