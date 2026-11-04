import { useEffect, useReducer } from 'react'
import { player } from './player'

/** Re-renders the component on every player tick (≈60 Hz while playing). Use sparingly. */
export function usePlayerTime(): { time: number; playing: boolean; duration: number; rate: number } {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => player.subscribe(force), [])
  return { time: player.time, playing: player.playing, duration: player.duration, rate: player.rate }
}
