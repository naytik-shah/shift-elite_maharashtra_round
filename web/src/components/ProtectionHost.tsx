import { Check, Loader2, ShieldCheck, TimerReset, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@/api'
import { Button } from '@/components/ui/button'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { protection, registerHumanCheck, useProtection } from '@/lib/protection'
import { useRoute } from '@/lib/router'
import { cn } from '@/lib/utils'

const W = 300
const H = 160
const S = 46
const TOL = 8

const rand = (min: number, max: number) => {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return min + (a[0] / 0xffffffff) * (max - min)
}

interface Challenge { gx: number; gy: number; startX: number; startY: number; seed: number }

const newChallenge = (): Challenge => ({
  gx: Math.round(rand(110, W - S - 14)),
  gy: Math.round(rand(16, H - S - 16)),
  startX: Math.round(rand(8, 44)),
  startY: Math.round(rand(10, H - S - 10)),
  seed: Math.round(rand(1, 1e6)),
})

// The gap only exists as pixels on a canvas, so a script cannot read its position from the page.
function paint(bg: HTMLCanvasElement, piece: HTMLCanvasElement, c: Challenge) {
  const ctx = bg.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, `hsl(${(c.seed * 7) % 360} 55% 38%)`)
  g.addColorStop(1, `hsl(${(c.seed * 13 + 90) % 360} 60% 52%)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  for (let i = 0; i < 26; i++) {
    ctx.beginPath()
    ctx.fillStyle = `hsla(${rand(0, 360)} 60% ${rand(30, 80)}% / ${rand(0.15, 0.45)})`
    ctx.arc(rand(0, W), rand(0, H), rand(6, 26), 0, Math.PI * 2)
    ctx.fill()
  }
  for (let i = 0; i < 380; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rand(0.02, 0.1)})`
    ctx.fillRect(rand(0, W), rand(0, H), 2, 2)
  }

  // Cut the piece out of the picture, then darken the hole it leaves.
  const pc = piece.getContext('2d')!
  pc.clearRect(0, 0, S, S)
  pc.save()
  pc.beginPath()
  pc.roundRect(1, 1, S - 2, S - 2, 9)
  pc.clip()
  pc.drawImage(bg, c.gx, c.gy, S, S, 0, 0, S, S)
  pc.restore()
  pc.lineWidth = 2
  pc.strokeStyle = 'rgba(255,255,255,0.9)'
  pc.beginPath()
  pc.roundRect(1, 1, S - 2, S - 2, 9)
  pc.stroke()

  ctx.save()
  ctx.beginPath()
  ctx.roundRect(c.gx + 1, c.gy + 1, S - 2, S - 2, 9)
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.stroke()
  ctx.restore()
}

interface Sample { t: number; x: number; y: number }

// Real hands wobble and change speed. A script that moves in a straight line at a steady pace does not.
function looksHuman(samples: Sample[]) {
  if (samples.length < 6) return false
  const dur = samples[samples.length - 1].t - samples[0].t
  if (dur < 450) return false
  const speeds: number[] = []
  for (let i = 1; i < samples.length; i++) {
    const dt = Math.max(1, samples[i].t - samples[i - 1].t)
    speeds.push(Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y) / dt)
  }
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length
  const sd = Math.sqrt(speeds.reduce((a, b) => a + (b - mean) ** 2, 0) / speeds.length)
  const a = samples[0]
  const b = samples[samples.length - 1]
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const off = Math.max(...samples.map((p) => Math.abs((b.y - a.y) * (p.x - a.x) - (b.x - a.x) * (p.y - a.y)) / len))
  const steady = mean > 0 && sd / mean < 0.08 && off < 1.5
  return !steady
}

function HumanCheck({ onPassed }: { onPassed: (method: 'drag' | 'keyboard', ms: number, samples: number) => void }) {
  const [c, setC] = useState<Challenge>(newChallenge)
  const [pos, setPos] = useState({ x: c.startX, y: c.startY })
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState(false)
  const bg = useRef<HTMLCanvasElement>(null)
  const piece = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ dx: number; dy: number; samples: Sample[]; start: number } | null>(null)

  useEffect(() => {
    if (bg.current && piece.current) paint(bg.current, piece.current, c)
  }, [c])

  const retry = (text: string) => {
    setMsg(text)
    const n = newChallenge()
    setC(n)
    setPos({ x: n.startX, y: n.startY })
  }

  const finish = (method: 'drag' | 'keyboard', x: number, y: number, samples: Sample[], ms: number) => {
    const close = Math.abs(x - c.gx) <= TOL && Math.abs(y - c.gy) <= TOL
    if (!close) return retry('Not quite. Drop the piece into the dark gap.')
    if (method === 'drag' && !looksHuman(samples)) return retry('That looked automated. Please drag it by hand.')
    setDone(true)
    setMsg('')
    setTimeout(() => onPassed(method, ms, samples.length), 650)
  }

  const clampPos = (x: number, y: number) => ({ x: Math.max(0, Math.min(W - S, x)), y: Math.max(0, Math.min(H - S, y)) })

  const down = (e: React.PointerEvent) => {
    if (done) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const t = performance.now()
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, samples: [{ t, x: pos.x, y: pos.y }], start: t }
    setMsg('')
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = clampPos(e.clientX - d.dx, e.clientY - d.dy)
    d.samples.push({ t: performance.now(), x: p.x, y: p.y })
    setPos(p)
  }
  const up = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    const last = d.samples[d.samples.length - 1]
    finish('drag', last.x, last.y, d.samples, Math.round(performance.now() - d.start))
  }
  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 12 : 4
    const m: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (m[e.key]) { e.preventDefault(); setPos((p) => clampPos(p.x + m[e.key][0], p.y + m[e.key][1])) }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish('keyboard', pos.x, pos.y, [], 0) }
  }

  return (
    <div className="space-y-3">
      <div className="relative mx-auto touch-none select-none overflow-hidden rounded-2xl border border-line" style={{ width: W, height: H, maxWidth: '100%' }}>
        <canvas ref={bg} width={W} height={H} className="block" aria-hidden />
        <canvas
          ref={piece}
          width={S}
          height={S}
          role="slider"
          tabIndex={0}
          aria-label="Puzzle piece. Drag it into the gap, or use the arrow keys and press Enter."
          aria-valuetext={`x ${Math.round(pos.x)}, y ${Math.round(pos.y)}`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={key}
          className={cn('absolute cursor-grab rounded-[9px] shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing', done && 'ring-2 ring-ok')}
          style={{ left: pos.x, top: pos.y, width: S, height: S, transition: drag.current ? 'none' : 'left 0.15s, top 0.15s' }}
        />
        {done && (
          <div className="absolute inset-0 grid place-items-center bg-black/35">
            <span className="grid size-14 place-items-center rounded-full bg-ok text-white"><Check className="size-7" strokeWidth={3} /></span>
          </div>
        )}
      </div>
      <p role="status" className={cn('type-caption min-h-5 text-center', msg && 'text-danger')}>
        {done ? 'You are human. Continuing.' : msg || 'Drag the piece into the dark gap.'}
      </p>
      <Button type="button" variant="plain" size="sm" className="w-full" onClick={() => retry('')}>Try a different picture</Button>
    </div>
  )
}

export default function ProtectionHost() {
  const p = useProtection()
  // The organiser view is never told it is going too fast, its polling shares the limit with everything else.
  const onDashboard = useRoute().name === 'dashboard'
  const [open, setOpen] = useState(false)
  const pending = useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null)

  const ask = useCallback(() => new Promise<void>((resolve, reject) => {
    pending.current = { resolve, reject }
    setOpen(true)
  }), [])

  useEffect(() => {
    registerHumanCheck(ask)
    return () => registerHumanCheck(null)
  }, [ask])

  const passed = (method: 'drag' | 'keyboard', ms: number, samples: number) => {
    protection.humanPassed(method, ms, samples)
    setOpen(false)
    pending.current?.resolve()
    pending.current = null
  }
  const cancelled = () => {
    setOpen(false)
    pending.current?.reject(new ApiError('HUMAN_CHECK', 'The human check was not completed.'))
    pending.current = null
  }

  // Keeps the "puzzle solved" note visible long enough to read it.
  const [recent, setRecent] = useState(false)
  useEffect(() => {
    if (!p.pow) return
    setRecent(true)
    const id = setTimeout(() => setRecent(false), 2600)
    return () => clearTimeout(id)
  }, [p.pow])

  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!p.rateLimit) return
    const id = setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= (protection.get().rateLimit?.until ?? 0)) protection.clearRateLimit()
    }, 500)
    return () => clearInterval(id)
  }, [p.rateLimit])
  const wait = p.rateLimit ? Math.max(0, Math.ceil((p.rateLimit.until - now) / 1000)) : 0

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && cancelled()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[65] bg-black/55" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed top-1/2 left-1/2 z-[70] max-h-[92dvh] w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card bg-bg p-5 text-ink shadow-2xl outline-none"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <DialogPrimitive.Title className="type-title">Quick human check</DialogPrimitive.Title>
                <p className="type-body mt-1">This keeps automated accounts from taking seats.</p>
              </div>
              <DialogPrimitive.Close aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-full bg-fill text-muted hover:text-ink">
                <X className="size-4" />
              </DialogPrimitive.Close>
            </div>
            {open && <HumanCheck onPassed={passed} />}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {p.rateLimit && wait > 0 && !onDashboard && (
        <div role="alert" className="fixed inset-x-3 top-3 z-[60] mx-auto flex max-w-md items-start gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-warn shadow-lg">
          <TimerReset className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="type-strong">You are going too fast</p>
            <p className="type-caption text-warn">Fair Drop slows down repeated requests from one address. Try again in {wait}s.</p>
          </div>
        </div>
      )}

      {(p.solving || recent) && (
        <div role="status" className="fixed inset-x-3 bottom-24 z-[60] mx-auto flex max-w-sm items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-bg shadow-lg sm:bottom-6">
          {p.solving ? <Loader2 className="size-5 shrink-0 animate-spin" /> : <ShieldCheck className="size-5 shrink-0" />}
          <div className="min-w-0">
            <p className="type-strong text-bg">{p.solving ? 'Checking your device' : 'Device check passed'}</p>
            <p className="type-caption truncate text-bg/70">
              {p.solving
                ? `Solving a ${p.solving.bits} bit puzzle in your browser`
                : p.pow && `${p.pow.bits} bit puzzle solved in ${p.pow.ms} ms`}
            </p>
          </div>
        </div>
      )}
    </>
  )
}
