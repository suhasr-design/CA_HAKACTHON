import React from "react";
import { EVENT, eth, fmtLeft } from "../chain";
import { Card, Explain, Stat } from "../ui.jsx";

const FLOW = [
  { icon: "🔒", title: "Seat list locked", body: "Merkle root of every seat stored on-chain before the sale." },
  { icon: "🪪", title: "One human, one entry", body: "Anon Aadhaar zero-knowledge proof. No identity stored." },
  { icon: "🎲", title: "Public lottery", body: "Random seed + on-chain shuffle anyone can re-run." },
  { icon: "🎟", title: "Ticket bound to you", body: "Non-transferable. Can’t be sold to a stranger." },
  { icon: "🔁", title: "Face-value buyback", body: "Can’t attend? Seat goes to the next fan on the waitlist." },
  { icon: "🚪", title: "Live gate check", body: "QR answers the gate’s own code; gates share one entry list." },
];

const SCREENS = [
  { id: null, icon: "📱", title: "Fan app (Android)", who: "Fans · on their phone", body: "Own wallet in the phone’s secure storage. Verify with Aadhaar, join the lottery, hold a gate-bound QR ticket, sell back or accept a waitlist offer." },
  { id: "organiser", icon: "🛠", title: "Organiser dashboard", who: "Event organiser", body: "Create the event, run the sale step by step, the assisted ID desk, and prove the draw was fair." },
  { id: "gate", icon: "🚪", title: "Gate scanner", who: "Venue staff", body: "Gate code challenge, multi-gate sync, offline fallback and an identity help desk for lost phones." },
  { id: "check", icon: "🔍", title: "Check a ticket", who: "Anyone", body: "Look up any ticket before paying a stranger on social media." },
];

// How we differ from what exists today (from our competitor review).
const DIFF = [
  ["Who decides who gets a ticket?", "A queue or a secret “verified fan” score", "A public lottery anyone can re-run from on-chain data"],
  ["Bots and fake accounts", "OTP and captcha (SIM farms beat them)", "One Aadhaar = one entry, proven with zero knowledge"],
  ["Your identity", "Name, phone and often a face stored centrally", "Nothing stored: only an anonymous per-event code"],
  ["Can’t attend?", "Resell on a marketplace at any price", "Face-value buyback; seat goes to the next fan in line"],
  ["Screenshot or relayed QR", "Usually works once", "QR must answer the gate’s own 20-second code"],
  ["Trust", "Trust the platform", "Rules are in a public contract; even we can’t change them"],
];

const USES = [
  ["🎵", "Concerts & festivals", "High-demand shows where touts and bots buy out the first minutes."],
  ["🏏", "IPL / cricket matches", "Stadium seats, gate scanning at multiple entrances."],
  ["🛕", "Temple darshan slots", "Tirupati, Sabarimala-style quotas: one devotee, one slot, no agents."],
  ["🚆", "Tatkal-style quotas", "Limited, time-boxed allocations where agents use bot software."],
  ["🏥", "Hospital OPD tokens", "Fair daily token allocation without middlemen selling places."],
  ["🎓", "College fests & exams", "Limited seats, verified students, transparent allocation."],
];

export default function Home({ state, go }) {
  const live = state.tickets.filter((t) => t.status === 1).length;
  const zk = Object.values(state.regKinds).filter((k) => k === "zk").length;
  const waitlist = state.phase === 4 ? Math.max(0, state.entrants.length - state.nextWaitlistIndex) : 0;
  const closes = state.regCloses - state.chainTime;
  const title = EVENT.title || state.eventName.split("·")[0];
  const when = EVENT.startsAt ? new Date(EVENT.startsAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "";
  const n = state.entrants.length;
  const seats = state.publicSeats;

  return (
    <div className="stack">
      <section className="hero">
        <div className="hero-glow" />
        <div className="hero-body">
          <div className="eyebrow">THE BIG HACK 2.0 · CYBERSECURITY & BLOCKCHAIN · B2</div>
          <h1>Tickets for fans.<br /><span className="grad">Not for bots.</span></h1>
          <p className="hero-sub">Every ticket belongs to one verified human, chosen by a lottery anyone can check. Resale can’t be exploited and fakes fail at the gate.</p>
          <div className="hero-cta">
            <button className="btn primary lg" onClick={() => go("organiser")}>Organiser dashboard →</button>
            <button className="btn ghost lg" onClick={() => go("gate")}>Gate scanner</button>
          </div>
        </div>
        <div className="poster">
          <div className="poster-top">ON SALE · FAIR LOTTERY</div>
          <div className="poster-title">{title}</div>
          <div className="poster-sub">{EVENT.venue || state.eventName.split("·").slice(1).join("·")}</div>
          {when && <div className="poster-row"><span>When</span><b>{when}</b></div>}
          <div className="poster-row"><span>Face price</span><b>{EVENT.priceInr ? `₹${Number(EVENT.priceInr).toLocaleString("en-IN")} · ` : ""}{eth(state.facePrice)}</b></div>
          <div className="poster-row"><span>Public seats</span><b>{seats}</b></div>
          <div className="poster-row"><span>Status</span><b>{["Setup", state.chainTime < state.regCloses ? `Registration · ${fmtLeft(closes)} left` : "Registration closed", "Drawing", "Shuffling", "Sale open"][state.phase]}</b></div>
        </div>
      </section>

      <div className="stats">
        <Stat label="Verified people registered" value={n} sub={`${zk} with a real Aadhaar ZK proof`} />
        <Stat label="Public seats" value={seats} sub={`+${state.sponsorSeats} sponsor · ${state.holdSeats} holds declared`} />
        <Stat label="Live tickets" value={live} tone="good" />
        <Stat label="On the waitlist" value={waitlist} />
      </div>
      <Explain id="home-hero" />

      <Card title={`${Math.max(n, seats + 1)} people, ${seats} seats: who gets in?`} icon="🎲" explain="home-101">
        <div className="grid-2">
          <div>
            <p><b>Everyone who registers in the window has exactly the same chance.</b> Registering first, refreshing faster or running a bot gives no advantage.</p>
            <ol className="tips">
              <li><b>Registration closes</b> and the entry list is frozen on-chain.</li>
              <li><b>A random seed</b> nobody could predict is produced <i>after</i> the list is frozen.</li>
              <li><b>The whole list is shuffled</b> on-chain with that seed. Positions 1–{seats} win a seat.</li>
              <li><b>Person #{seats + 1} becomes waitlist #1.</b> The first returned or unclaimed seat is offered to them automatically, at face value.</li>
              <li><b>Anyone can re-run the shuffle</b> from public data and get the identical order.</li>
            </ol>
          </div>
          <div className="lottery-live">
            <div className="tiny muted">THIS EVENT, LIVE</div>
            <div className="ll-row"><span>Registered</span><b>{n}</b></div>
            <div className="ll-row"><span>Seats</span><b>{seats}</b></div>
            <div className="ll-row"><span>Chance per person</span><b>{n ? `${Math.min(100, (seats / n) * 100).toFixed(1)}%` : "—"}</b></div>
            <div className="ll-row"><span>Will be waitlisted</span><b>{Math.max(0, n - seats)}</b></div>
            <div className="bar"><div style={{ width: `${n ? Math.min(100, (seats / n) * 100) : 0}%` }} /></div>
            <p className="tiny muted">Demand {n > seats ? "exceeds" : "is within"} supply. {n > seats ? `The ${seats + 1}th person onward waits in a fair, public order.` : "Everyone registered would get a seat."}</p>
          </div>
        </div>
      </Card>

      <Card title="How a ticket stays fair" icon="✦" explain="home-flow">
        <div className="flow">
          {FLOW.map((f, i) => (
            <div key={f.title} className="flow-step" style={{ animationDelay: `${i * 80}ms` }}>
              <div className="flow-i">{f.icon}</div>
              <div className="flow-t">{f.title}</div>
              <div className="flow-b">{f.body}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="What’s different from today’s ticketing" icon="⚖">
        <div className="diff">
          <div className="diff-row diff-h"><span /><span>Today (queues, platforms, NFT tickets)</span><span>Fair Tickets</span></div>
          {DIFF.map(([q, a, b]) => (
            <div key={q} className="diff-row"><span><b>{q}</b></span><span className="muted">{a}</span><span className="good-ink">{b}</span></div>
          ))}
        </div>
      </Card>

      <Card title="Where else this works" icon="🌏">
        <div className="uses">
          {USES.map(([i, t, b]) => (
            <div key={t} className="use"><div className="use-i">{i}</div><div><div className="use-t">{t}</div><div className="small muted">{b}</div></div></div>
          ))}
        </div>
        <p className="tiny muted">Anywhere demand exceeds supply and a fair, verifiable “one person, one chance” rule matters.</p>
      </Card>

      <Card title="Four apps, one blockchain" icon="◎" explain="home-screens">
        <div className="screens">
          {SCREENS.map((s) => (
            <button key={s.title} className={`screen-card ${s.id ? "" : "is-mobile"}`} onClick={() => s.id && go(s.id)}>
              <div className="screen-i">{s.icon}</div>
              <div className="screen-t">{s.title}</div>
              <div className="screen-w">For: {s.who}</div>
              <div className="screen-b">{s.body}</div>
              <div className="screen-go">{s.id ? "Open →" : "On the phone"}</div>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
