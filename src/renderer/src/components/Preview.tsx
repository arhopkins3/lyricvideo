import { useEffect, useRef } from 'react'
import { useStore, mediaUrl } from '../store'
import { player } from '../lib/player'
import { renderFrame } from '../render/frameRenderer'

/**
 * Live preview of the output frame. Draws into a canvas at the project's output size,
 * scaled to fit its container. The background video (if used) is a hidden element
 * synced to the master audio clock.
 */
export default function Preview({ className }: { className?: string }): JSX.Element {
  const handle = useStore((s) => s.handle)!
  const project = handle.project
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const projectRef = useRef(project)
  projectRef.current = project

  const bg = project.style.background
  const videoUrl = bg.kind === 'video' ? mediaUrl(project.id, project.source.videoFile) : null
  const imageUrl = bg.kind === 'image' ? mediaUrl(project.id, bg.imageFile) : null

  useEffect(() => {
    if (!imageUrl) {
      imgRef.current = null
      return
    }
    const img = new Image()
    img.src = imageUrl
    img.onload = () => {
      imgRef.current = img
      draw()
    }
    return () => {
      imgRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl])

  useEffect(() => {
    const v = videoRef.current
    player.attachVideo(videoUrl ? v : null)
    return () => player.attachVideo(null)
  }, [videoUrl])

  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const p = projectRef.current
    if (canvas.width !== p.style.width || canvas.height !== p.style.height) {
      canvas.width = p.style.width
      canvas.height = p.style.height
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    renderFrame(ctx, p, player.time, {
      width: p.style.width,
      height: p.style.height,
      bgImage: imgRef.current,
      bgVideo: videoUrl ? videoRef.current : null
    })
  }

  // Redraw on every player tick and whenever the project changes.
  useEffect(() => player.subscribe(draw), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    draw()
  }) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the video frame moving while paused-and-seeking (seeked events) and while playing.
  useEffect(() => {
    const v = videoRef.current
    if (!v || !videoUrl) return
    let raf = 0
    const loop = () => {
      if (player.playing) draw()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [videoUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`preview ${className ?? ''}`}>
      <canvas ref={canvasRef} />
      {videoUrl && <video ref={videoRef} src={videoUrl} muted playsInline preload="auto" onSeeked={draw} onLoadedData={draw} style={{ display: 'none' }} />}
    </div>
  )
}
