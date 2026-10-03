import { sha256 } from '../lib/hash.js';

export const GENESIS_HASH = '0'.repeat(64);

// Appends one row to the hash chain. Call it inside the same transaction as the action it records.
// The advisory lock keeps the chain strictly one row at a time; it is released at commit.
export async function appendAudit(client, dropId, type, payloadObj) {
  await client.query('SELECT pg_advisory_xact_lock(3)');
  const last = await client.query('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1');
  const prevHash = last.rows[0] ? last.rows[0].hash : GENESIS_HASH;
  const seqRow = await client.query("SELECT nextval('audit_seq') AS seq");
  const seq = seqRow.rows[0].seq;
  const payload = JSON.stringify(payloadObj ?? {});
  const hash = sha256(`${prevHash}|${seq}|${type}|${payload}`);
  await client.query(
    'INSERT INTO audit_log (seq, drop_id, type, payload, prev_hash, hash) VALUES ($1,$2,$3,$4,$5,$6)',
    [seq, dropId, type, payload, prevHash, hash],
  );
  return { seq, hash };
}
