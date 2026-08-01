import { useEffect, useRef, useState } from 'react'
import { H, SCENES, VIDEOS, W, isVideoWp, markVideoBroken, videoSrcOf } from '../lib/wallpaper'
import { useWallpaper } from '../state/wallpaper'
import { tauri } from '../ipc/tauri'
import type { UnlistenFn } from '../ipc/tauri'

const PAUSE_DELAY = 1500

export function useHeroWallpaper(screenOn = true) {
  const { wpCur, wpAnimOn, custom } = useWallpaper()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [posterSrc, setPosterSrc] = useState('')
  const [posterReady, setPosterReady] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const [canvasReady, setCanvasReady] = useState(false)
  const mouse = useRef({ mx: 0, my: 0, tmx: 0, tmy: 0 })
  const curRef = useRef(wpCur)
  curRef.current = wpCur
  const animRef = useRef(wpAnimOn)
  animRef.current = wpAnimOn
  const vis = useRef({ screen: screenOn, shown: !document.hidden, focus: true, inView: true })

  const ctx = () => {
    const c = canvasRef.current
    return c ? c.getContext('2d') : null
  }

  const onScreen = () => {
    const s = vis.current
    return s.screen && s.shown && s.focus && s.inView
  }

  const pauseTimer = useRef(0)
  const rafRef = useRef(0)

  const needsCanvasLoop = () =>
    animRef.current && !isVideoWp(curRef.current) && !!SCENES[curRef.current] && onScreen()

  const stopLoop = () => {
    if (!rafRef.current) return
    cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
  }

  const startLoop = () => {
    if (rafRef.current || !needsCanvasLoop()) return
    let last = 0
    const loop = (ts: number) => {
      if (!needsCanvasLoop()) {
        rafRef.current = 0
        return
      }
      rafRef.current = requestAnimationFrame(loop)
      if (ts - last < 33) return
      last = ts
      const m = mouse.current
      m.mx += (m.tmx - m.mx) * 0.06
      m.my += (m.tmy - m.my) * 0.06
      const g = ctx()
      if (g && SCENES[curRef.current]) SCENES[curRef.current].draw(g, ts / 1000, m.mx * 1.6, m.my * 1.2)
    }
    rafRef.current = requestAnimationFrame(loop)
  }

  const apply = (play: boolean) => {
    const wrap = wrapRef.current
    if (!wrap) return
    wrap.querySelectorAll('video').forEach((v) => {
      if (play) {
        if (v.paused && (v.currentSrc || v.src)) v.play().catch(() => {})
      } else if (!v.paused) v.pause()
    })
  }

  const sync = () => {
    if (!wrapRef.current) return
    if (needsCanvasLoop()) startLoop()
    else stopLoop()
    if (pauseTimer.current) {
      clearTimeout(pauseTimer.current)
      pauseTimer.current = 0
    }
    if (onScreen() && animRef.current) {
      requestAnimationFrame(() => apply(true))
      return
    }
    if (!animRef.current) {
      apply(false)
      return
    }
    pauseTimer.current = window.setTimeout(() => {
      pauseTimer.current = 0
      apply(false)
    }, PAUSE_DELAY)
  }

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = W
    c.height = H
    const g = c.getContext('2d')
    if (g && SCENES[curRef.current]) SCENES[curRef.current].draw(g, 10, 0, 0)
  }, [])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const ready = () => setVideoReady(true)
    // Losing the clip is not fatal: the poster underneath stays on screen, so drop the
    // source instead of switching wallpapers (another missing clip would loop forever).
    const onErr = () => {
      markVideoBroken(curRef.current)
      setVideoReady(false)
      v.removeAttribute('src')
      delete v.dataset.src
    }
    ;['playing', 'canplay', 'loadeddata'].forEach((ev) => v.addEventListener(ev, ready))
    v.addEventListener('error', onErr)
    return () => {
      ;['playing', 'canplay', 'loadeddata'].forEach((ev) => v.removeEventListener(ev, ready))
      v.removeEventListener('error', onErr)
    }
  }, [])

  // WKWebView may fire neither canplay nor loadeddata; fall back to polling readyState.
  useEffect(() => {
    if (!isVideoWp(wpCur) || videoReady || !videoSrcOf(wpCur)) return
    const t = setInterval(() => {
      const v = videoRef.current
      if (v && v.readyState >= 2) setVideoReady(true)
    }, 400)
    return () => clearInterval(t)
  }, [wpCur, videoReady])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (isVideoWp(wpCur)) {
      const wp = VIDEOS.find((x) => x.id === wpCur)!
      setCanvasReady(false)
      setVideoReady(false)
      setPosterSrc(wp.poster)
      setPosterReady(true)
      const src = videoSrcOf(wpCur)
      if (!src) {
        v.pause()
        v.removeAttribute('src')
        delete v.dataset.src
        return
      }
      // Streamed directly: loading the file into a Blob leaked memory on every preview hover.
      if (v.dataset.src !== src) {
        v.src = src
        v.dataset.src = src
        v.load()
      }
      if (!animRef.current) setVideoReady(true)
      sync()
    } else {
      v.pause()
      setVideoReady(false)
      setPosterReady(false)
      const g = ctx()
      if (g && SCENES[wpCur]) SCENES[wpCur].draw(g, 10, 0, 0)
      requestAnimationFrame(() => setCanvasReady(true))
    }
  }, [wpCur])

  useEffect(() => {
    sync()
    if (!isVideoWp(wpCur) && !wpAnimOn) {
      const g = ctx()
      if (g && SCENES[wpCur]) SCENES[wpCur].draw(g, 10, 0, 0)
    }
  }, [wpAnimOn, wpCur, custom])

  useEffect(() => {
    vis.current.screen = screenOn
    sync()
  }, [screenOn])

  useEffect(() => {
    const onVis = () => {
      vis.current.shown = !document.hidden
      sync()
    }
    const onFocus = () => {
      vis.current.focus = true
      sync()
    }
    const onBlur = () => {
      vis.current.focus = false
      sync()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    const T = tauri()
    let dead = false
    const un: UnlistenFn[] = []
    if (T)
      void Promise.all([
        T.event.listen('tauri://focus', onFocus),
        T.event.listen('tauri://blur', onBlur),
      ])
        .then((fns) => {
          if (dead) fns.forEach((f) => f())
          else un.push(...fns)
        })
        .catch(() => {})
    return () => {
      dead = true
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      un.forEach((f) => f())
    }
  }, [])

  useEffect(
    () => () => {
      if (pauseTimer.current) clearTimeout(pauseTimer.current)
    },
    [],
  )

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        vis.current.inView = entries.some((e) => e.isIntersecting)
        sync()
      },
      { threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => stopLoop, [])

  // Parallax exists only on canvas scenes; getBoundingClientRect per mousemove forces layout.
  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!rafRef.current) return
    const r = e.currentTarget.getBoundingClientRect()
    mouse.current.tmx = ((e.clientX - r.left) / r.width - 0.5) * 2
    mouse.current.tmy = ((e.clientY - r.top) / r.height - 0.5) * 2
  }
  const onMouseLeave = () => {
    mouse.current.tmx = 0
    mouse.current.tmy = 0
  }

  return { canvasRef, videoRef, wrapRef, posterSrc, posterReady, videoReady, canvasReady, onMouseMove, onMouseLeave }
}

export function WpThumb({ scene }: { scene: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.width = W
    c.height = H
    const g = c.getContext('2d')
    if (g) SCENES[scene].draw(g, 10, 0, 0)
  }, [scene])
  return <canvas ref={ref} />
}
