import { Check, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorMessage, type DrawInfo } from '@/api'
import CopyRow from '@/components/CopyRow'
import { Button } from '@/components/ui/button'
import { Card, Rows, SectionTitle } from '@/components/ui/card'
import { isDrawn } from '@/lib/eventStatus'
import { formatNumber, shortHash } from '@/lib/format'
import { go } from '@/lib/router'
import { cn } from '@/lib/utils'
import type { VerifyReport, VerifyRequest } from '@/lib/verify.worker'
import { useApp } from '@/state'

type Phase = 'idle' | 'loading' | 'running' | 'done' | 'error'

function Check3({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <span className="type-strong">{label}</span>
      <span className={cn('flex items-center gap-1.5 text-[0.8125rem] font-semibold', ok ? 'text-ok' : 'text-danger')}>
        {ok ? <Check className="size-4" strokeWidth={3} /> : <X className="size-4" strokeWidth={3} />}
        {ok ? 'Matches' : 'Does not match'}
      </span>
    </div>
  )
}

// Public page. Fetches the seed, the entry list and the published ranking, then runs
// the draw again in a worker and compares.
export default function Verify({ id }: { id?: string }) {
  const { drops, dropsLoading, patchDrop } = useApp()
  const drawn = drops.filter(isDrawn)
  const drop = drops.find((d) => d.id === id)
  const [phase, setPhase] = useState<Phase>('idle')
  const [draw, setDraw] = useState<DrawInfo | null>(null)
  const [report, setReport] = useState<VerifyReport | null>(null)
  const [error, setError] = useState('')
  const worker = useRef<Worker | null>(null)
  const runId = useRef(0)

  const run = useCallback(async (dropId: string) => {
    const mine = ++runId.current
    worker.current?.terminate()
    setPhase('loading')
    setReport(null)
    setError('')
    try {
      const info = await api.getDraw(dropId)
      if (mine !== runId.current) return
      setDraw(info)
      if (!info.seed || !info.manifestHash) { setPhase('idle'); return }
      const [entries, results] = await Promise.all([api.getManifest(dropId), api.getResults(dropId)])
      if (mine !== runId.current) return
      setPhase('running')
      const w = new Worker(new URL('../lib/verify.worker.ts', import.meta.url), { type: 'module' })
      worker.current = w
      w.onmessage = (e: MessageEvent<VerifyReport>) => {
        if (mine !== runId.current) return
        setReport(e.data)
        setPhase('done')
        w.terminate()
      }
      w.onerror = () => { if (mine === runId.current) { setError('The check could not run in this browser.'); setPhase('error') } }
      w.postMessage({ seed: info.seed, seedCommit: info.seedCommit, manifestHash: info.manifestHash, entries, results } satisfies VerifyRequest)
    } catch (err) {
      if (mine !== runId.current) return
      setError(errorMessage(err))
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    if (!id) return
    // A direct link can land here before the drop list knows this drop.
    api.getDrop(id).then((d) => patchDrop(id, d)).catch(() => {})
    run(id)
    return () => { runId.current++; worker.current?.terminate() }
  }, [id, run, patchDrop])

  if (!id) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="type-display px-1">Verify a draw</h1>
          <p className="type-body mt-1 px-1">Run any finished draw again in your browser.</p>
        </div>
        {dropsLoading ? (
          <div aria-busy className="surface h-20 animate-pulse rounded-card" />
        ) : drawn.length === 0 ? (
          <Card>
            <h2 className="type-title">No draw has run yet</h2>
            <p className="type-body mt-1">Come back after the draw.</p>
          </Card>
        ) : (
          <Rows>
            {drawn.map((d) => (
              <a key={d.id} href={`#/verify/${encodeURIComponent(d.id)}`} className="flex min-h-[3.5rem] items-center justify-between gap-4 py-3">
                <span className="type-strong">{d.name}</span>
                <span className="text-[0.8125rem] font-semibold text-primary-text">Verify</span>
              </a>
            ))}
          </Rows>
        )}
      </div>
    )
  }

  const pending = phase === 'idle' && draw && (!draw.seed || !draw.manifestHash)
  const allOk = !!report && report.seedOk && report.manifestOk && report.rankingOk

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="type-display px-1">Verify the draw</h1>
        <p className="type-body mt-1 px-1">{drop?.name ?? id}</p>
      </div>

      {(phase === 'loading' || phase === 'running') && (
        <Card aria-busy aria-live="polite">
          <h2 className="type-title">{phase === 'loading' ? 'Fetching the draw data' : 'Running the draw again'}</h2>
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-fill"><div className="h-full w-1/3 animate-pulse rounded-full bg-primary" /></div>
        </Card>
      )}

      {pending && (
        <Card>
          <h2 className="type-title">The draw has not run yet</h2>
          <p className="type-body mt-1">The seed is revealed after the draw. Until then only its hash is public.</p>
          <Button variant="tinted" size="lg" className="mt-5 w-full" onClick={() => run(id)}>Check again</Button>
        </Card>
      )}

      {phase === 'error' && (
        <Card>
          <h2 className="type-title">Could not verify</h2>
          <p role="alert" className="type-body mt-1">{error}</p>
          <Button size="lg" className="mt-5 w-full" onClick={() => run(id)}>Try again</Button>
        </Card>
      )}

      {report && (
        <>
          <div aria-live="polite" className={cn('animate-rise rounded-card border p-5 sm:p-6', allOk ? 'border-ok bg-ok-soft' : 'border-danger bg-danger-soft')}>
            <p className={cn('type-display', allOk ? 'text-ok' : 'text-danger')}>{allOk ? 'MATCH' : 'MISMATCH'}</p>
            <p className="type-strong mt-1">
              {formatNumber(report.checked)} entries checked in {report.ms} ms, {formatNumber(report.seats)} seats.
            </p>
            {report.mismatch && (
              <p className="type-body mt-2 text-ink">
                First difference at rank {formatNumber(report.mismatch.position)}: this browser got{' '}
                <span className="font-mono">{report.mismatch.expected ? shortHash(report.mismatch.expected, 8, 4) : 'nothing'}</span>, the published result has{' '}
                <span className="font-mono">{report.mismatch.got ? shortHash(report.mismatch.got, 8, 4) : 'nothing'}</span>.
              </p>
            )}
          </div>

          <section>
            <SectionTitle>Checks</SectionTitle>
            <Rows>
              <Check3 ok={report.seedOk} label="Seed against its published hash" />
              <Check3 ok={report.manifestOk} label="Entry list against its hash" />
              <Check3 ok={report.rankingOk} label="Ranking against the published result" />
            </Rows>
          </section>
        </>
      )}

      {draw && (
        <section>
          <SectionTitle>Published values</SectionTitle>
          <Rows>
            <CopyRow label="Seed hash" value={draw.seedCommit} pending="" />
            <CopyRow label="Revealed seed" value={draw.seed} pending="After the draw" />
            <CopyRow label="Entry list hash" value={draw.manifestHash} pending="After the draw" />
          </Rows>
        </section>
      )}

      <Button variant="plain" className="w-full" onClick={() => go('verify')}>Verify another drop</Button>
    </div>
  )
}
