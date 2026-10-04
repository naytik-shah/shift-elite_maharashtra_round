import { loadConfig } from './config.js';
import { run } from './runner.js';

const args = process.argv.slice(2);
const flags = new Set();
const sets = [];
let file = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--set') sets.push(args[++i]);
  else if (a.startsWith('--')) flags.add(a.slice(2));
  else file = a;
}

if (!file) {
  console.error('usage: node src/cli.js <config.yaml> [--set key=value] [--dry] [--no-db] [--no-upload]');
  process.exit(1);
}

try {
  const cfg = loadConfig(file, sets);
  await run(cfg, { dry: flags.has('dry'), noDb: flags.has('no-db'), noUpload: flags.has('no-upload') });
  process.exit(0);
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
