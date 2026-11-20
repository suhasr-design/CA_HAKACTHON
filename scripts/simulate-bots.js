// Bot simulation: today's first-come-first-served queue vs. Fair Tickets' verified lottery.
// ALL DATA IS SYNTHETIC. This is a model with stated assumptions, not a measurement of a real sale.
// Usage: node scripts/simulate-bots.js [--seats 500] [--fans 1000] [--botAccounts 10000] [--borrowed 25] [--trials 200]

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), Number(arr[i + 1])]] : acc), [])
);
const P = {
  seats: args.seats ?? 500,
  fans: args.fans ?? 1000,                 // real fans, one person each
  botAccounts: args.botAccounts ?? 2000,   // accounts a scalper controls (cheap OTPs from SIM farms)
  captchaBlock: args.captchaBlock ?? 0.5,  // share of bot accounts stopped by captcha / OTP / rate limits
  fansEarly: args.fansEarly ?? 0.6,        // share of fans already in the waiting room when sales open
  borrowed: args.borrowed ?? 25,           // real identities (Aadhaar QRs) the scalper borrows from relatives etc.
  fanTicketsWanted: 2,                     // a fan buys for themselves + 1 friend in a normal queue
  botTicketsPerAccount: 4,                 // per-account cap in a normal queue
  trials: args.trials ?? 200,
};

// Seeded PRNG so results are reproducible.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Normal queue with a waiting room: everyone in the waiting room when sales open is put in
// random order (sort key in [0,1)); people arriving later queue behind them in arrival order.
// Unblocked bot accounts are always in the waiting room early.
function fcfs(rand) {
  const people = [];
  for (let i = 0; i < P.fans; i++) {
    const early = rand() < P.fansEarly;
    people.push({ bot: false, t: early ? rand() : 1 + rand() * 600, want: P.fanTicketsWanted });
  }
  for (let i = 0; i < P.botAccounts; i++) {
    if (rand() < P.captchaBlock) continue;
    people.push({ bot: true, t: rand(), want: P.botTicketsPerAccount });
  }
  people.sort((a, b) => a.t - b.t);
  let left = P.seats, bot = 0, fansServed = 0;
  for (const p of people) {
    if (left === 0) break;
    const n = Math.min(p.want, left);
    left -= n;
    if (p.bot) bot += n; else fansServed++;
  }
  return { botShare: bot / P.seats, fansServed };
}

// Fair Tickets: one verified human = one entry = at most one ticket. Bot accounts without a
// valid Anon Aadhaar proof can't register; only the borrowed identities get in.
function lottery(rand) {
  const entrants = [];
  for (let i = 0; i < P.fans; i++) entrants.push(false);
  for (let i = 0; i < P.borrowed; i++) entrants.push(true);
  for (let i = entrants.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [entrants[i], entrants[j]] = [entrants[j], entrants[i]];
  }
  const winners = entrants.slice(0, P.seats);
  const bot = winners.filter(Boolean).length;
  return { botShare: bot / P.seats, fansServed: winners.length - bot };
}

function summarise(results) {
  const shares = results.map((r) => r.botShare).sort((a, b) => a - b);
  const mean = shares.reduce((s, x) => s + x, 0) / shares.length;
  const fans = results.reduce((s, r) => s + r.fansServed, 0) / results.length;
  return { mean, p5: shares[Math.floor(0.05 * shares.length)], p95: shares[Math.floor(0.95 * shares.length)], fans };
}

const rand = mulberry32(20260118);
const a = summarise(Array.from({ length: P.trials }, () => fcfs(rand)));
const b = summarise(Array.from({ length: P.trials }, () => lottery(rand)));
const pct = (x) => `${(x * 100).toFixed(1)}%`;

console.log("\nBOT SIMULATION · SYNTHETIC DATA · model, not a real sale");
console.log("Assumptions:", JSON.stringify(P));
console.log("\n                          Bot share of tickets (mean, 5–95%)     Real fans who got a ticket");
console.log(`First-come queue          ${pct(a.mean).padEnd(8)} (${pct(a.p5)} – ${pct(a.p95)})`.padEnd(64) + `${a.fans.toFixed(0)} of ${P.fans}`);
console.log(`Fair Tickets lottery      ${pct(b.mean).padEnd(8)} (${pct(b.p5)} – ${pct(b.p95)})`.padEnd(64) + `${b.fans.toFixed(0)} of ${P.fans}`);
console.log("\nResale markup: unlimited in a normal queue; capped at 1× (face value) by the buyback contract.");
console.log("Limitation: the lottery result depends on how many real identities a scalper can borrow (--borrowed).\n");
