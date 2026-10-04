export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

export class Stats {
  constructor() {
    this.total = 0;
    this.r5xx = 0;
    this.r429 = 0;
    this.netErrors = 0;
    this.codes = {};
    this.latency = { entry: [], status: [] };
  }

  record(tag, res) {
    this.total++;
    if (res.status === 0) this.netErrors++;
    else if (res.status === 429) this.r429++;
    else if (res.status >= 500) this.r5xx++;

    const code = res.body?.error?.code || '';
    const key = `${tag}:${res.status}${code ? ':' + code : ''}`;
    this.codes[key] = (this.codes[key] || 0) + 1;

    if (res.status !== 0 && res.status !== 429 && this.latency[tag]) {
      this.latency[tag].push(res.ms);
    }
  }

  line() {
    return `requests ${this.total}, 429s ${this.r429}, 5xx ${this.r5xx}, net errors ${this.netErrors}`;
  }
}
