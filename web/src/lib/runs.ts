import { api, type RunResult } from '@/api'

// Several dashboard panels read the uploaded runs. One shared read keeps a page load from
// firing dozens of requests, which would trip the per address rate limit.
let cached: { at: number; p: Promise<RunResult[]> } | null = null

export function loadRuns(maxAgeMs = 60_000): Promise<RunResult[]> {
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.p
  const p = (async () => {
    const list = (await api.admin.runs()).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 14)
    const files: RunResult[] = []
    // A few at a time, so the burst stays well under the limit.
    for (let i = 0; i < list.length; i += 4) {
      const part = await Promise.all(list.slice(i, i + 4).map((r) => api.admin.run(r.runId).catch(() => null)))
      files.push(...part.filter((f): f is RunResult => !!f))
    }
    return files
  })()
  cached = { at: Date.now(), p }
  p.catch(() => { if (cached?.p === p) cached = null })
  return p
}
