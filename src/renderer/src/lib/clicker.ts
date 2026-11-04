import { player } from './player'

/**
 * Plays a very short beep exactly when the playhead crosses each marker time, so you can hear
 * whether a word's start marker sits early or late against the vocal. Beeps are scheduled a
 * little ahead on the Web Audio clock for sample-accurate timing, and rescheduled after seeks
 * (including loop jumps) and whenever the marker list changes.
 */
class Clicker {
  private ctx: AudioContext | null = null
  private times: number[] = []
  private scheduled = new Set<number>()
  private _enabled = false
  private readonly horizon = 0.25 // seconds of look-ahead

  constructor() {
    player.subscribe(() => this.onTick())
    player.audio.addEventListener('seeking', () => this.scheduled.clear())
    player.audio.addEventListener('seeked', () => this.scheduled.clear())
    player.audio.addEventListener('pause', () => this.scheduled.clear())
  }

  get enabled(): boolean {
    return this._enabled
  }
  setEnabled(v: boolean): void {
    this._enabled = v
    this.scheduled.clear()
    if (v) this.ensureContext()
  }
  setTimes(times: number[]): void {
    this.times = [...times].sort((a, b) => a - b)
    this.scheduled.clear()
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext()
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  private onTick(): void {
    if (!this._enabled || !player.playing || this.times.length === 0) return
    const ctx = this.ensureContext()
    const now = player.time
    const rate = player.rate || 1
    const loop = player.loop
    for (const t of this.times) {
      if (t < now - 0.01) continue
      if (t > now + this.horizon) break
      if (loop && t >= loop.end) break
      const key = Math.round(t * 1000)
      if (this.scheduled.has(key)) continue
      this.scheduled.add(key)
      this.beep(ctx.currentTime + Math.max(0, (t - now) / rate))
    }
  }

  private beep(when: number): void {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 1250
    gain.gain.setValueAtTime(0, when)
    gain.gain.linearRampToValueAtTime(0.35, when + 0.003)
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.045)
    osc.connect(gain).connect(ctx.destination)
    osc.start(when)
    osc.stop(when + 0.05)
  }
}

export const clicker = new Clicker()
