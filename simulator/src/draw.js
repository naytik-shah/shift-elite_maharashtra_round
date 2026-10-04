import crypto from 'node:crypto';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Weighted ranking as in PRD 9.1: key = ln(u) / weight, biggest key first.
export function rankEntries(seed, manifest) {
  const scored = manifest.map((e) => {
    const h = crypto.createHmac('sha256', seed).update(e.entryId).digest('hex');
    const u = (parseInt(h.slice(0, 13), 16) + 1) / (2 ** 52 + 1);
    return { id: e.entryId, key: Math.log(u) / e.weight };
  });
  scored.sort((a, b) => (b.key !== a.key ? b.key - a.key : a.id < b.id ? -1 : 1));
  return scored.map((s) => s.id);
}

export async function verifyDraw(api, org, dropId) {
  const base = `/drops/${dropId}/draw`;
  const [draw, man, res] = await Promise.all([
    api.req('GET', base, { user: org, tag: 'verify' }),
    api.req('GET', `${base}/manifest`, { user: org, tag: 'verify', timeoutMs: 120000 }),
    api.req('GET', `${base}/results`, { user: org, tag: 'verify', timeoutMs: 120000 }),
  ]);
  if (draw.status !== 200 || man.status !== 200 || res.status !== 200) {
    return { ok: false, reason: 'draw endpoints failed', manifest: [], ranking: [], seats: 0 };
  }

  const manifest = man.body.entries.map((e) => ({ entryId: e.entryId, weight: Number(e.weight) }));
  const { seed, seedCommit, manifestHash } = draw.body;
  const checks = {
    seedCommit: sha(seed) === seedCommit,
    manifestHash: sha(JSON.stringify(manifest)) === manifestHash,
    ranking: false,
  };
  const mine = rankEntries(seed, manifest);
  const theirs = res.body.ranking;
  checks.ranking = mine.length === theirs.length && mine.every((id, i) => id === theirs[i]);

  return {
    ok: checks.seedCommit && checks.manifestHash && checks.ranking,
    checks,
    manifest,
    ranking: theirs,
    seats: res.body.seats,
  };
}
