import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import type { DrawInfo, Drop } from '@/api'
import { shortHash } from '@/lib/format'
import { Rows, SectionTitle } from './ui/card'

function HashRow({ label, value, pending }: { label: string; value: string | null; pending: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked, nothing to do */ }
  }
  return (
    <div className="flex min-h-[3.75rem] items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        {value ? (
          <p className="truncate font-mono text-xs text-muted" title={value}>{shortHash(value, 14, 8)}</p>
        ) : (
          <p className="text-xs text-muted">{pending}</p>
        )}
      </div>
      {value && (
        <button
          onClick={copy}
          aria-label={copied ? `${label} copied` : `Copy ${label}`}
          className="-mr-2.5 grid size-11 shrink-0 place-items-center rounded-full text-primary-text"
        >
          {copied ? <Check className="size-[1.125rem]" /> : <Copy className="size-[1.125rem]" />}
        </button>
      )}
    </div>
  )
}

export default function FairnessCard({ drop, draw }: { drop: Drop; draw?: DrawInfo | null }) {
  return (
    <section>
      <SectionTitle>Check the draw yourself</SectionTitle>
      <Rows>
        <HashRow label="Seed commitment" value={draw?.seedCommit ?? drop.seedCommit} pending="" />
        <HashRow label="Entry list hash" value={draw?.manifestHash ?? null} pending="Published when entries close" />
        <HashRow label="Revealed seed" value={draw?.seed ?? null} pending="Revealed after the draw" />
      </Rows>
      <p className="mt-2 px-1 text-xs text-muted">
        The seed is sealed before entries open. Hash the revealed seed with SHA 256 and it has to match the commitment, so it cannot be swapped after seeing who entered.
      </p>
    </section>
  )
}
