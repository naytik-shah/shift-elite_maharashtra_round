export const BOT_TYPES = {
  s1: 'naive_farm',
  s2: 'stealth_farm',
  s3: 'retry_spammer',
  s4: 'flooder',
  s5: 'payment_reuse',
};

const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Krishna', 'Ishaan', 'Rohan', 'Arjun', 'Karan', 'Dev', 'Nikhil',
  'Ananya', 'Diya', 'Isha', 'Kavya', 'Meera', 'Neha', 'Priya', 'Riya', 'Sneha', 'Tanvi',
  'Rahul', 'Amit', 'Sanjay', 'Vikram', 'Manish', 'Pooja', 'Anjali', 'Divya', 'Harsh', 'Jay',
  'Zeal', 'Naytik', 'Jash', 'Parth', 'Yash', 'Om', 'Khushi', 'Mansi', 'Raj', 'Smit'];
const LAST = ['Shah', 'Patel', 'Mehta', 'Desai', 'Joshi', 'Sharma', 'Verma', 'Gupta', 'Iyer', 'Nair',
  'Reddy', 'Rao', 'Kapoor', 'Singh', 'Kumar', 'Jain', 'Bhatt', 'Trivedi', 'Pandya', 'Modi',
  'Thakkar', 'Parekh', 'Dave', 'Vyas', 'Chauhan', 'Yadav', 'Mishra', 'Pillai', 'Menon', 'Bose'];
const BRANCH = ['bce', 'bcs', 'bec', 'bme', 'bit', 'mca'];
const SEPS = ['', '.', '_'];

const subnet = (rng) => `${rng.int(20, 126)}.${rng.int(0, 255)}.${rng.int(0, 255)}`;
const host = (net, rng) => `${net}.${rng.int(2, 254)}`;
const pad = (n, w) => String(n).padStart(w, '0');

function honestOffset(rng, windowMs) {
  const lo = 0.01 * windowMs;
  const hi = 0.97 * windowMs;
  if (rng.chance(0.35)) {
    // some people rush in early
    return Math.min(lo - Math.log(1 - rng.next()) * 0.2 * windowMs, hi);
  }
  return lo + rng.next() * (hi - lo);
}

export function buildPopulation(cfg, rng) {
  const windowMs = cfg.windowSeconds * 1000;
  const users = [];
  const emails = new Set();

  const makeEmail = (local) => {
    let l = local;
    for (;;) {
      const e = `${l}@${rng.pick(cfg.emailDomains)}`;
      if (!emails.has(e)) {
        emails.add(e);
        return e;
      }
      l = `${local}${rng.int(10, 9999)}`;
    }
  };

  const base = (type, botType) => ({
    idx: users.length,
    type,
    botType,
    isBot: botType !== null,
    cookie: null,
    entryId: null,
    confirmTried: false,
    willConfirm: true,
  });

  const name = () => `${rng.pick(FIRST)} ${rng.pick(LAST)}`;

  // honest users
  const h = cfg.honest;
  const collegeNets = Array.from({ length: h.collegeSubnets }, () => subnet(rng));
  const commonFps = Array.from({ length: h.commonFpPool }, () => rng.hex(32));

  for (let i = 0; i < cfg.honestUsers; i++) {
    const u = base('honest', null);
    const college = rng.chance(h.collegeShare);
    u.ip = college ? host(rng.pick(collegeNets), rng) : host(subnet(rng), rng);
    u.fp = rng.chance(h.commonFpShare) ? rng.pick(commonFps) : rng.hex(32);
    u.payerName = name();

    const rollStyle = rng.chance(college ? 0.6 : 0.05);
    const local = rollStyle
      ? `${rng.int(19, 24)}${rng.pick(BRANCH)}${pad(rng.int(1, 9999), 4)}`
      : `${rng.pick(FIRST)}${rng.pick(SEPS)}${rng.pick(LAST)}${rng.chance(0.5) ? rng.int(1, 99) : ''}`.toLowerCase();
    u.email = makeEmail(local);

    u.card = `card-h-${i}`;
    u.offsetMs = honestOffset(rng, windowMs);
    u.willConfirm = rng.chance(h.confirmRate);
    users.push(u);
  }

  // bots, split across types by the mix
  const mix = Object.entries(cfg.bots.mix);
  let left = cfg.botAccounts;
  const counts = mix.map(([, w], i) => {
    const c = i === mix.length - 1 ? left : Math.min(left, Math.round(cfg.botAccounts * w));
    left -= c;
    return c;
  });

  let botCards = 0;

  mix.forEach(([type, ], mi) => {
    const n = counts[mi];
    if (n <= 0) return;
    const p = cfg.bots[type];
    const botType = BOT_TYPES[type];
    botCards += p.cards;
    const card = (k) => `card-${type}-${k}`;

    if (type === 's1') {
      const net = subnet(rng);
      const hosts = Array.from({ length: p.hosts }, () => host(net, rng));
      const fp = rng.hex(32);
      const start = 0.05 * windowMs;
      const interval = Math.max(1, (p.spanFraction * windowMs) / n);
      for (let i = 0; i < n; i++) {
        const u = base(type, botType);
        u.ip = hosts[i % hosts.length];
        u.fp = fp;
        u.email = makeEmail(`acct${pad(i + 1, 5)}`);
        u.payerName = name();
        u.card = card(i % p.cards);
        u.offsetMs = start + i * interval;
        u.retry429 = 0;
        users.push(u);
      }
    } else if (type === 's2' || type === 's5') {
      const poolSize = Math.max(20, Math.ceil(n * (p.proxyPoolRatio ?? 0.5)));
      const pool = Array.from({ length: poolSize }, () => host(subnet(rng), rng));
      for (let i = 0; i < n; i++) {
        const u = base(type, botType);
        u.ip = rng.pick(pool);
        u.fp = rng.hex(32);
        u.email = makeEmail(`${rng.pick(FIRST)}${rng.pick(SEPS)}${rng.pick(LAST)}${rng.int(0, 9999)}`.toLowerCase());
        u.payerName = name();
        u.card = card(rng.int(0, p.cards - 1));
        u.offsetMs = 0.02 * windowMs + rng.next() * 0.95 * windowMs;
        u.retry429 = p.retry429 ?? 3;
        users.push(u);
      }
    } else if (type === 's3') {
      const nets = [subnet(rng), subnet(rng)];
      const ips = Array.from({ length: p.ips }, (_, k) => host(nets[k % nets.length], rng));
      const fps = ips.map(() => rng.hex(32));
      const centres = Array.from({ length: 5 }, () => rng.next() * 0.9 * windowMs);
      for (let i = 0; i < n; i++) {
        const u = base(type, botType);
        u.ip = ips[i % ips.length];
        u.fp = fps[i % ips.length];
        u.email = makeEmail(`spam${rng.hex(6)}`);
        u.payerName = name();
        u.card = card(i % p.cards);
        u.offsetMs = Math.max(0, rng.pick(centres) + rng.int(0, 3000));
        users.push(u);
      }
    } else if (type === 's4') {
      const net = subnet(rng);
      const ips = Array.from({ length: p.ips }, () => host(net, rng));
      for (let i = 0; i < n; i++) {
        const u = base(type, botType);
        u.ip = ips[i % ips.length];
        u.fp = rng.hex(32);
        u.email = makeEmail(`flood${rng.hex(7)}`);
        u.payerName = name();
        u.card = card(i % p.cards);
        u.offsetMs = rng.next() * 0.05 * windowMs;
        users.push(u);
      }
    }
  });

  users.forEach((u, i) => {
    u.idx = i;
  });

  const summary = {};
  for (const u of users) {
    const k = u.type;
    summary[k] = (summary[k] || 0) + 1;
  }
  return { users, summary, botCards };
}
