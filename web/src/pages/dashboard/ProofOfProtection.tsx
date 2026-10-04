import { sha256 } from 'js-sha256'
import { Check, Fingerprint, Gauge, Hand, Link2, Scale, ShieldCheck, Ticket, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { api, type LiveStats, type RunResult } from '@/api'
import { Button } from '@/components/ui/button'
import { Card, SectionTitle } from '@/components/ui/card'
import { formatNumber } from '@/lib/format'
import { forceHumanCheck, useProtection } from '@/lib/protection'
import { solvePow } from '@/lib/pow'
import { loadRuns } from '@/lib/runs'
import { cn } from '@/lib/utils'

function Block({ icon, title, children, proof }: { icon: ReactNode; title: string; children: ReactNode; proof: ReactNode }) {
  return (
    <Card>
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-fill">{icon}</span>
        <h3 className="type-headline">{title}</h3>
      </div>
      <div className="type-body mt-3 space-y-2 [&_strong]:font-semibold [&_strong]:text-ink">{children}</div>
      <div className="mt-4 rounded-2xl border border-line p-4">
        <p className="type-caption mb-2 uppercase tracking-wide">Live proof</p>
        {proof}
      </div>
    </Card>
  )
}

function Result({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <p role="status" className={cn('type-strong mt-3 flex items-start gap-2 rounded-2xl px-4 py-3', ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger')}>
      {ok ? <Check className="mt-0.5 size-4 shrink-0" strokeWidth={3} /> : <X className="mt-0.5 size-4 shrink-0" strokeWidth={3} />}
      <span>{children}</span>
    </p>
  )
}

function span(seconds: number) {
  if (seconds < 90) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} seconds`
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes`
  if (seconds < 172800) return `${(seconds / 3600).toFixed(1)} hours`
  return `${Math.round(seconds / 86400)} days`
}

// Measures how many hashes this machine does per second on the main thread.
function hashRate() {
  const end = performance.now() + 250
  let n = 0
  while (performance.now() < end) { sha256(`bench-${n}`); n++ }
  return n / 0.25
}

function PuzzleProof() {
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ bits: number; ms: number; rate: number } | null>(null)
  const [error, setError] = useState('')

  const run = async () => {
    setBusy(true)
    setError('')
    try {
      const ch = await api.getPowChallenge('entry')
      const t0 = performance.now()
      await solvePow(ch)
      setRes({ bits: ch.difficulty, ms: Math.round(performance.now() - t0), rate: hashRate() })
    } catch {
      setError('Could not fetch a puzzle. The address may be rate limited, try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  const real = 18
  const perPuzzle = res ? 2 ** real / res.rate : 0
  return (
    <>
      <Button variant="gray" size="sm" busy={busy} onClick={run}>Solve a live puzzle</Button>
      {error && <p role="alert" className="type-caption mt-2 text-danger">{error}</p>}
      {res && (
        <div className="mt-3 space-y-2">
          <Result ok>
            Solved a {res.bits} bit puzzle from this server in {res.ms} ms. This machine does about {formatNumber(Math.round(res.rate))} hashes per second.
          </Result>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-2xl bg-fill px-2 py-2.5"><dd className="type-strong tabular-nums">{span(perPuzzle)}</dd><dt className="type-caption">1 puzzle at {real} bits</dt></div>
            <div className="rounded-2xl bg-fill px-2 py-2.5"><dd className="type-strong tabular-nums">{span(perPuzzle * 2)}</dd><dt className="type-caption">1 account, 2 puzzles</dt></div>
            <div className="rounded-2xl bg-fill px-2 py-2.5"><dd className="type-strong tabular-nums">{span(perPuzzle * 2 * 50000)}</dd><dt className="type-caption">50,000 accounts</dt></div>
          </dl>
          <p className="type-caption">Real mode uses {real} bits. This demo server uses an easy test difficulty for requests that carry the test key. The 50,000 account figure is one core of this machine.</p>
        </div>
      )}
    </>
  )
}

function HumanProof() {
  const p = useProtection()
  const [busy, setBusy] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const tryIt = async () => {
    setBusy(true)
    setCancelled(false)
    try { await forceHumanCheck() } catch { setCancelled(true) } finally { setBusy(false) }
  }
  const h = p.humanCheck
  return (
    <>
      <Button variant="gray" size="sm" busy={busy} onClick={tryIt}>Try the human check</Button>
      {h && <Result ok>Last pass: {h.method === 'drag' ? `dragged for ${(h.ms / 1000).toFixed(1)} s, ${h.samples} movement samples recorded` : 'by keyboard'}.</Result>}
      {cancelled && <p className="type-caption mt-2">Closed without finishing.</p>}
      <p className="type-caption mt-2">Try dragging in a perfectly straight line at a steady speed. It is refused as automated.</p>
    </>
  )
}

function DrawProof({ dropId }: { dropId: string }) {
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState<{ ok: boolean; text: string } | null>(null)
  const check = async () => {
    setBusy(true)
    try {
      const d = await api.getDraw(dropId)
      if (!d.seed) setOut({ ok: false, text: 'The draw has not run yet, so the seed is still secret. Only its hash is public.' })
      else if (sha256(d.seed) === d.seedCommit) setOut({ ok: true, text: `SHA-256 of the revealed seed equals the hash published before entries opened (${d.seedCommit.slice(0, 12)}...).` })
      else setOut({ ok: false, text: 'The revealed seed does not match the published hash.' })
    } catch {
      setOut({ ok: false, text: 'Could not load the draw.' })
    } finally { setBusy(false) }
  }
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="gray" size="sm" busy={busy} onClick={check}>Check the seed now</Button>
        <a href={`#/verify/${encodeURIComponent(dropId)}`} className="type-strong inline-flex h-9 items-center rounded-full bg-fill px-4">Re-run the whole draw</a>
      </div>
      {out && <Result ok={out.ok}>{out.text}</Result>}
    </>
  )
}

function AuditProof({ dropId }: { dropId: string }) {
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState<{ ok: boolean; text: string } | null>(null)
  const verify = async () => {
    setBusy(true)
    try {
      const events = [...(await api.admin.audit(dropId))].sort((a, b) => a.seq - b.seq)
      if (!events.length) { setOut({ ok: false, text: 'Nothing is logged for this drop yet.' }); return }
      let linked = 0
      for (let i = 0; i < events.length; i++) {
        const e = events[i]
        if (sha256(`${e.prevHash}|${e.seq}|${e.type}|${e.payload}`) !== e.hash) {
          setOut({ ok: false, text: `Row #${e.seq} (${e.type}) does not match its hash. The log was changed.` })
          return
        }
        if (i > 0 && events[i - 1].seq + 1 === e.seq) {
          if (events[i - 1].hash !== e.prevHash) { setOut({ ok: false, text: `Row #${e.seq} does not follow from the row before it.` }); return }
          linked++
        }
      }
      setOut({ ok: true, text: `${events.length} rows recomputed in your browser. Every hash matches${linked ? `, and ${linked} rows chain straight onto the one before` : ''}.` })
    } catch {
      setOut({ ok: false, text: 'Could not load the audit log.' })
    } finally { setBusy(false) }
  }
  return (
    <>
      <Button variant="gray" size="sm" busy={busy} onClick={verify}>Verify the audit log</Button>
      {out && <Result ok={out.ok}>{out.text}</Result>}
    </>
  )
}

export default function ProofOfProtection({ dropId, live }: { dropId: string; live: LiveStats | null }) {
  const [runs, setRuns] = useState<RunResult[] | null>(null)
  useEffect(() => { loadRuns().then(setRuns).catch(() => setRuns([])) }, [])

  const withBots = (runs ?? []).filter((r) => (r.entries?.bot ?? 0) > 0 && r.winners)
  const latest = withBots.find((r) => r.scenario === 'S6') ?? withBots[0]
  const s5 = (runs ?? []).find((r) => r.scenario === 'S5' && r.winners && r.confirmed)
  const scored = live?.scored === true || (typeof live?.scored === 'string' && /done|scored|true/i.test(live.scored))

  return (
    <section>
      <SectionTitle>How every protection works, with proof</SectionTitle>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Block icon={<ShieldCheck className="size-5" />} title="Proof-of-work puzzle" proof={<PuzzleProof />}>
          <p><strong>Before a login code or an entry is accepted, the browser must solve a small maths puzzle.</strong> It has to find a number that makes the SHA-256 hash of a server prefix start with a set number of zero bits.</p>
          <p><strong>Cost grows with each extra bit: about 2 to the power of N hashes.</strong> One person pays a moment. A farm of 50,000 accounts pays that for every login and every entry, while the server checks an answer with a single hash.</p>
          <p><strong>Busy addresses get harder puzzles, up to 4 extra bits, and every puzzle works once, from the address that asked, for one purpose.</strong></p>
        </Block>

        <Block icon={<Gauge className="size-5" />} title="Rate limits" proof={
          <>
            <p className="type-title tabular-nums">{live?.rateLimitedPerMin != null ? formatNumber(live.rateLimitedPerMin) : '...'} <span className="type-body">requests refused per minute</span></p>
            <p className="type-caption mt-1">Use "Fire 90 requests" in the control room above to watch the limit act on a flood from this browser.</p>
          </>
        }>
          <p><strong>Every request is counted per address, per /24 network and per signed-in session, and over-limit requests get a 429 with a wait time.</strong></p>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>60 requests per minute</strong> per address, <strong>600</strong> per /24 network</li>
            <li><strong>5 code requests per 10 minutes</strong> per address, <strong>3</strong> per email</li>
            <li><strong>5 entry attempts per minute</strong> per session, <strong>5 wrong codes</strong> then the code is dead</li>
          </ul>
          <p><strong>If Redis is down, writes are refused rather than allowed.</strong> Postgres still guards every rule, so limits only add speed protection.</p>
        </Block>

        <Block icon={<Hand className="size-5" />} title="Human check" proof={<HumanProof />}>
          <p><strong>A drag puzzle appears before login and entry. The gap exists only as pixels on a canvas, so a script cannot read where it is.</strong></p>
          <p><strong>The check also looks at how the piece was moved: it needs at least half a second, enough movement samples, and rejects a perfectly straight, steady motion.</strong> A keyboard route keeps it accessible.</p>
          <p><strong>Honest limit: this check lives in the browser. A program that calls the API directly never sees it, so the server-side defences are what stop those.</strong> Server verification of a token is the next step.</p>
        </Block>

        <Block
          icon={<Fingerprint className="size-5" />}
          title="Cluster scoring"
          proof={
            <>
              <p className="type-body">Scoring for this drop: <strong className="text-ink">{scored ? 'done' : 'not run yet'}</strong></p>
              {latest?.botAdvantageRatio != null && (
                <p className="type-body mt-1">
                  Latest bot run, {latest.scenario} with {latest.botSharePercent}% bots: bot advantage <strong className="text-ink">{latest.botAdvantageRatio.toFixed(2)}</strong>
                  {latest.falsePositiveRate != null ? `, honest entries wrongly lowered ${(latest.falsePositiveRate * 100).toFixed(1)}%` : ''}.
                </p>
              )}
              {!runs && <p className="type-caption mt-1">Loading runs...</p>}
            </>
          }
        >
          <p><strong>After entries close, every entry is scored on four signal families: device, network, timing and email patterns, plus the size of the cluster it belongs to.</strong></p>
          <p><strong>Weights: risk 0 to 29 keeps 1.00, 30 to 59 gets 0.50, 60 to 84 gets 0.20, 85 and above gets 0.05. Nobody is banned.</strong></p>
          <p><strong>A two-signal guard means one odd signal alone, such as a shared hostel network, never lowers anyone's weight.</strong></p>
        </Block>

        <Block
          icon={<Ticket className="size-5" />}
          title="One card, one seat"
          proof={
            s5 && s5.winners && s5.confirmed ? (
              <p className="type-body">
                Payment reuse run: bots won <strong className="text-ink">{formatNumber(s5.winners.bot)}</strong> seats but only{' '}
                <strong className="text-ink">{formatNumber(s5.confirmed.bot)}</strong> could pay, because they shared a few cards.
              </p>
            ) : <p className="type-body">Run the payment reuse scenario to see how many bot wins turn into paid seats.</p>
          }
        >
          <p><strong>Each payment card can confirm one seat per drop. Only a keyed hash of the card is stored, enforced by a unique index in the database.</strong></p>
          <p><strong>A bot account that wins still needs its own real card and a named ticket. Unpaid seats expire and move down the waitlist.</strong></p>
        </Block>

        <Block icon={<Scale className="size-5" />} title="Verifiable draw" proof={<DrawProof dropId={dropId} />}>
          <p><strong>The hash of the secret seed is published before entries open, and the seed itself after the draw.</strong> The organiser cannot pick a seed after seeing the entries.</p>
          <p><strong>Anyone can re-run the weighted draw from the published seed and the entry list and get the same ranking.</strong> A weight lowers an entry's chance, it never removes it.</p>
        </Block>

        <Block icon={<Link2 className="size-5" />} title="Tamper-evident audit log" proof={<AuditProof dropId={dropId} />}>
          <p><strong>Close, scoring, draw, confirmations, expiries and promotions are written to a log where each row's hash includes the row before it.</strong></p>
          <p><strong>Changing any past row breaks every hash after it, and this page recomputes the hashes in your browser rather than trusting the server.</strong></p>
        </Block>
      </div>
    </section>
  )
}
