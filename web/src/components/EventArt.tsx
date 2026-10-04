import { useId } from 'react'
import type { Drop } from '@/api'

// Original key art for each kind of event, drawn as SVG so it stays sharp at any size, weighs
// almost nothing and needs no image hosting. A drop with its own posterUrl still wins (see Poster).

function seeded(id: string) {
  let h = 2166136261
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

export type ArtKind = 'concert' | 'festival' | 'conference' | 'comedy' | 'abstract'

export function artKind(drop: Pick<Drop, 'id' | 'name' | 'category'>): ArtKind {
  const t = `${drop.category ?? ''} ${drop.name} ${drop.id}`.toLowerCase()
  if (/concert|music|live|night|gig|neon/.test(t)) return 'concert'
  if (/fest|carnival|fair|campus/.test(t)) return 'festival'
  if (/confer|summit|talk|tech|builder|workshop/.test(t)) return 'conference'
  if (/comed|stand.?up|theatre|theater|show/.test(t)) return 'comedy'
  return 'abstract'
}

const W = 640
const H = 400

function Concert({ uid, rnd }: { uid: string; rnd: () => number }) {
  const stars = Array.from({ length: 46 }, () => ({ x: rnd() * W, y: rnd() * 190, r: 0.6 + rnd() * 1.4, o: 0.35 + rnd() * 0.65 }))
  const slits = [118, 134, 148, 160, 170, 178, 184]
  const vlines = Array.from({ length: 17 }, (_, i) => i - 8)
  const hlines = [236, 244, 256, 272, 296, 330, 380]
  return (
    <>
      <defs>
        <linearGradient id={`${uid}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0c0422" />
          <stop offset="0.55" stopColor="#3a0a5e" />
          <stop offset="1" stopColor="#c0185a" />
        </linearGradient>
        <linearGradient id={`${uid}u`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd84a" />
          <stop offset="1" stopColor="#ff3d7f" />
        </linearGradient>
        <mask id={`${uid}m`}>
          <rect width={W} height={H} fill="#fff" />
          {slits.map((y, i) => <rect key={y} x="200" y={y + 60} width="240" height={2 + i * 1.6} fill="#000" />)}
        </mask>
        <linearGradient id={`${uid}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a0630" />
          <stop offset="1" stopColor="#07020f" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${uid}s)`} />
      {stars.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={s.o} />)}
      <circle cx="320" cy="210" r="104" fill={`url(#${uid}u)`} mask={`url(#${uid}m)`} />
      <rect x="0" y="232" width={W} height="168" fill={`url(#${uid}f)`} />
      <line x1="0" y1="232" x2={W} y2="232" stroke="#ff4f93" strokeWidth="2" />
      {vlines.map((k) => <line key={k} x1="320" y1="232" x2={320 + k * 96} y2={H} stroke="#ff4f93" strokeOpacity="0.55" strokeWidth="1.4" />)}
      {hlines.map((y) => <line key={y} x1="0" y1={y} x2={W} y2={y} stroke="#ff7a45" strokeOpacity="0.5" strokeWidth="1.2" />)}
    </>
  )
}

function Festival({ uid, rnd }: { uid: string; rnd: () => number }) {
  const flags = Array.from({ length: 13 }, (_, i) => {
    const x = 20 + i * 50
    const sag = Math.sin((i / 12) * Math.PI) * 38
    return { x, y: 54 + sag, c: ['#ff6a2b', '#ffd23f', '#16b3a4', '#ffffff', '#e2336b'][i % 5] }
  })
  const crowd = Array.from({ length: 24 }, (_, i) => ({ x: 14 + i * 27 + rnd() * 10, h: 34 + rnd() * 26, up: rnd() > 0.45 }))
  return (
    <>
      <defs>
        <linearGradient id={`${uid}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff9f3d" />
          <stop offset="0.6" stopColor="#ff5f3a" />
          <stop offset="1" stopColor="#c8325e" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${uid}s)`} />
      <circle cx="420" cy="196" r="88" fill="#ffe7a3" opacity="0.92" />
      <path d={`M0 270 Q120 214 250 262 T500 244 T${W} 262 V${H} H0 Z`} fill="#6d1f55" />
      <path d={`M0 306 Q160 262 320 300 T${W} 286 V${H} H0 Z`} fill="#3e1241" />
      <path d={`M0 20 Q${W / 2} 120 ${W} 20`} fill="none" stroke="#2a0d2e" strokeWidth="2" />
      {flags.map((f, i) => <path key={i} d={`M${f.x - 13} ${f.y - 2} L${f.x + 13} ${f.y - 2} L${f.x} ${f.y + 28} Z`} fill={f.c} />)}
      <rect x="0" y="352" width={W} height="48" fill="#1c0a22" />
      {crowd.map((p, i) => (
        <g key={i} fill="#1c0a22" stroke="#1c0a22" strokeWidth="5" strokeLinecap="round">
          <circle cx={p.x} cy={352 - p.h} r="9" stroke="none" />
          <rect x={p.x - 9} y={352 - p.h + 12} width="18" height={p.h} rx="8" stroke="none" />
          {p.up && <path d={`M${p.x - 8} ${352 - p.h + 20} L${p.x - 18} ${352 - p.h - 4}`} fill="none" />}
          {p.up && <path d={`M${p.x + 8} ${352 - p.h + 20} L${p.x + 18} ${352 - p.h - 4}`} fill="none" />}
        </g>
      ))}
    </>
  )
}

function Conference({ uid, rnd }: { uid: string; rnd: () => number }) {
  const blocks = Array.from({ length: 22 }, () => ({ x: Math.floor(rnd() * 14) * 46, y: Math.floor(rnd() * 8) * 50, w: 40 + Math.floor(rnd() * 2) * 46, h: 40 + Math.floor(rnd() * 2) * 50, o: 0.06 + rnd() * 0.22 }))
  const nodes = [[90, 290], [210, 210], [330, 250], [450, 150], [560, 190], [300, 90]]
  return (
    <>
      <defs>
        <linearGradient id={`${uid}s`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#06182a" />
          <stop offset="1" stopColor="#0b3d5c" />
        </linearGradient>
        <pattern id={`${uid}g`} width="46" height="50" patternUnits="userSpaceOnUse">
          <path d="M46 0H0V50" fill="none" stroke="#7fd4ff" strokeOpacity="0.12" strokeWidth="1" />
        </pattern>
        <radialGradient id={`${uid}r`} cx="0.7" cy="0.25" r="0.6">
          <stop offset="0" stopColor="#ff6a2b" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ff6a2b" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${uid}s)`} />
      <rect width={W} height={H} fill={`url(#${uid}g)`} />
      <rect width={W} height={H} fill={`url(#${uid}r)`} />
      {blocks.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill="#7fd4ff" opacity={b.o} />)}
      <polyline points={nodes.map((n) => n.join(',')).join(' ')} fill="none" stroke="#ff7a45" strokeWidth="2.5" strokeLinejoin="round" />
      {nodes.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="13" fill="#0b3d5c" stroke="#ff7a45" strokeWidth="2.5" />
          <circle cx={x} cy={y} r="4.5" fill="#ffd23f" />
        </g>
      ))}
    </>
  )
}

function Comedy({ uid }: { uid: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${uid}c`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5a0f1c" />
          <stop offset="0.5" stopColor="#8f1c2e" />
          <stop offset="1" stopColor="#5a0f1c" />
        </linearGradient>
        <pattern id={`${uid}p`} width="64" height={H} patternUnits="userSpaceOnUse">
          <rect width="64" height={H} fill={`url(#${uid}c)`} />
          <rect width="26" height={H} fill="#000" opacity="0.22" />
          <rect x="26" width="10" height={H} fill="#fff" opacity="0.05" />
        </pattern>
        <linearGradient id={`${uid}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6dc" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff6dc" stopOpacity="0.04" />
        </linearGradient>
        <radialGradient id={`${uid}v`} cx="0.5" cy="0.5" r="0.7">
          <stop offset="0.45" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.7" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${uid}p)`} />
      <rect y="338" width={W} height="62" fill="#1a0a0c" />
      <polygon points="300,0 340,0 470,338 170,338" fill={`url(#${uid}b)`} />
      <ellipse cx="320" cy="338" rx="150" ry="16" fill="#fff6dc" opacity="0.28" />
      <g stroke="#0e0506" strokeWidth="5" strokeLinecap="round" fill="#0e0506">
        <line x1="320" y1="338" x2="320" y2="212" />
        <path d="M298 338 H342" />
        <path d="M320 212 q0 -22 -16 -26" fill="none" />
        <ellipse cx="302" cy="176" rx="11" ry="16" transform="rotate(-24 302 176)" stroke="none" />
      </g>
      <rect width={W} height={H} fill={`url(#${uid}v)`} />
    </>
  )
}

function Abstract({ uid, rnd, id }: { uid: string; rnd: () => number; id: string }) {
  const palettes = [
    ['#101b34', '#2c4a8a', '#ff6a2b', '#ffd27a'],
    ['#14221d', '#2f6b56', '#ff7a45', '#f4e3b2'],
    ['#221427', '#6a2c70', '#ff5a36', '#ffc7a8'],
    ['#1b1b1d', '#4a4e57', '#ff6a2b', '#e8e9ec'],
    ['#2a1410', '#8a3a24', '#ffb347', '#fff1d6'],
  ]
  const p = palettes[Math.floor(rnd() * palettes.length)]
  const arcs = Array.from({ length: 7 }, (_, i) => ({ cx: rnd() * W, cy: 120 + rnd() * 240, r: 50 + i * 26 + rnd() * 30 }))
  void id
  return (
    <>
      <defs>
        <linearGradient id={`${uid}s`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={p[0]} />
          <stop offset="1" stopColor={p[1]} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${uid}s)`} />
      {arcs.map((a, i) => <circle key={i} cx={a.cx} cy={a.cy} r={a.r} fill="none" stroke={i % 3 === 0 ? p[2] : p[3]} strokeOpacity={i % 3 === 0 ? 0.9 : 0.22} strokeWidth={i % 3 === 0 ? 3 : 1.5} />)}
      <circle cx={140 + rnd() * 360} cy={140 + rnd() * 120} r="52" fill={p[2]} />
    </>
  )
}

export default function EventArt({ drop, className }: { drop: Pick<Drop, 'id' | 'name' | 'category'>; className?: string }) {
  const uid = useId().replace(/:/g, '')
  const kind = artKind(drop)
  const rnd = seeded(drop.id)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={`${drop.name} artwork`} className={className} width={W} height={H}>
      {kind === 'concert' && <Concert uid={uid} rnd={rnd} />}
      {kind === 'festival' && <Festival uid={uid} rnd={rnd} />}
      {kind === 'conference' && <Conference uid={uid} rnd={rnd} />}
      {kind === 'comedy' && <Comedy uid={uid} />}
      {kind === 'abstract' && <Abstract uid={uid} rnd={rnd} id={drop.id} />}
    </svg>
  )
}
