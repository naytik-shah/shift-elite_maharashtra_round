import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { shortHash } from '@/lib/format'

// A labelled hash in short form with a copy button for the full value.
export default function CopyRow({ label, value, pending }: { label: string; value?: string | null; pending: string }) {
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
    <div className="flex min-h-[3.5rem] items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="type-strong">{label}</p>
        <p className={value ? 'type-caption truncate font-mono' : 'type-caption'} title={value ?? undefined}>
          {value ? shortHash(value, 12, 6) : pending}
        </p>
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
