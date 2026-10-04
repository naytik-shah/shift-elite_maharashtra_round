import { percentile } from './stats.js';

const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

// labels: Map entryId -> { isBot, botType }
export function computeResults({ runId, cfg, seats, labels, draw, slots, holders, stats, guarantees, botCards }) {
  const side = (id) => labels.get(id);
  const count = (ids) => {
    const c = { honest: 0, bot: 0, unknown: 0 };
    for (const id of ids) {
      const l = side(id);
      if (!l) c.unknown++;
      else if (l.isBot) c.bot++;
      else c.honest++;
    }
    return c;
  };

  const entries = count(draw.manifest.map((e) => e.entryId));
  const winners = count(draw.ranking.slice(0, seats));
  const confirmed = count(slots.filter((s) => s.state === 'CONFIRMED').map((s) => s.entryId));

  const botSlotIds = new Set(draw.ranking.slice(0, seats).filter((id) => side(id)?.isBot));
  for (const id of holders) if (side(id)?.isBot) botSlotIds.add(id);

  const totalEntries = entries.honest + entries.bot;
  const botEntryShare = totalEntries ? entries.bot / totalEntries : 0;
  const botWinShare = seats ? winners.bot / seats : 0;
  const botAdvantageRatio = botEntryShare > 0 ? botWinShare / botEntryShare : 0;
  const botSeatConversion = botSlotIds.size ? confirmed.bot / botSlotIds.size : 0;

  const idealHonest = Math.min(seats, entries.honest);
  const honestFairShareDeviation = idealHonest ? Math.abs(winners.honest - idealHonest) / idealHonest : 0;

  // Medium and High tiers carry weight 0.20 and 0.05
  let flaggedHonest = 0;
  for (const e of draw.manifest) {
    const l = side(e.entryId);
    if (l && !l.isBot && e.weight <= 0.2) flaggedHonest++;
  }
  const falsePositiveRate = entries.honest ? flaggedHonest / entries.honest : 0;

  const results = {
    runId,
    scenario: cfg.scenario,
    botSharePercent: cfg.botSharePercent,
    defences: { ...cfg.defences },
    config: { seats, honestUsers: cfg.honestUsers, botAccounts: cfg.botAccounts, botCards },
    entries: { honest: entries.honest, bot: entries.bot },
    winners: { honest: winners.honest, bot: winners.bot },
    confirmed: { honest: confirmed.honest, bot: confirmed.bot },
    botAdvantageRatio: round(botAdvantageRatio),
    botSeatConversion: round(botSeatConversion),
    honestFairShareDeviation: round(honestFairShareDeviation),
    falsePositiveRate: round(falsePositiveRate),
    latencyMs: {
      entryP95: Math.round(percentile(stats.latency.entry, 0.95)),
      statusP95: Math.round(percentile(stats.latency.status, 0.95)),
    },
    errors5xx: stats.r5xx,
    rateLimited: stats.r429,
    hardGuarantees: {
      oversoldSeats: guarantees.oversoldSeats,
      cardsWithTwoSeats: guarantees.cardsWithTwoSeats,
      usersWithTwoEntries: guarantees.usersWithTwoEntries,
      drawReproducible: draw.ok,
    },
  };

  return { results, unknown: { entries: entries.unknown, winners: winners.unknown, confirmed: confirmed.unknown } };
}
