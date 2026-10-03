// Worker thread for load-test.mjs: runs one batch of per-user work and reports back.
import { parentPort } from 'node:worker_threads';
import { pool, signupFlow, statusFlow, confirmFlow, snapshot } from './load-core.mjs';

parentPort.on('message', async ({ task, users, conc, drop, cards }) => {
  try {
    if (task === 'signup') await pool(users, (u) => signupFlow(u, drop), conc);
    else if (task === 'status') await pool(users, (u) => statusFlow(u, drop), conc);
    else if (task === 'confirm-shared') await pool(users, (u, i) => confirmFlow(u, drop, 'confirm (shared cards)', cards[(u.winnerNo) % cards.length], `Winner ${u.winnerNo}`), conc);
    else if (task === 'confirm-own') await pool(users, (u) => confirmFlow(u, drop, 'confirm (own card)', `own-${u.id}`, `Winner ${u.winnerNo}`), conc);
    parentPort.postMessage({ ok: true, users, snap: snapshot() });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: String(err && err.stack || err) });
  }
});
