import React from "react";
import { eth, fmtLeft } from "../chain";
import { Card, Explain, Stat } from "../ui.jsx";

const FLOW = [
  { icon: "🔒", title: "Seat list locked", body: "Merkle root of every seat stored on-chain before the sale." },
  { icon: "🪪", title: "One human, one entry", body: "Anon Aadhaar zero-knowledge proof. No identity stored." },
  { icon: "🎲", title: "Public lottery", body: "Chainlink VRF seed + on-chain shuffle anyone can re-run." },
  { icon: "🎟", title: "Ticket bound to you", body: "Non-transferable. Can’t be sold to a stranger." },
  { icon: "🔁", title: "Face-value buyback", body: "Can’t attend? Seat goes to the next fan on the waitlist." },
  { icon: "📴", title: "Offline gate", body: "Rotating signed QR, checked with no internet." },
];

const SCREENS = [
  { id: null, icon: "📱", title: "Fan app (Android)", who: "Fans · on their phone", body: "Verify with Anon Aadhaar, join the lottery, hold a rotating QR ticket, sell back or accept a waitlist offer. Open it in Expo Go." },
  { id: "organiser", icon: "🛠", title: "Organiser dashboard", who: "Event organiser", body: "Run the sale step by step, watch the seat map live and prove the draw was fair." },
  { id: "gate", icon: "🚪", title: "Gate scanner", who: "Venue staff", body: "Download the valid-ticket list, go offline, and accept or reject QR codes in under a second." },
  { id: "check", icon: "🔍", title: "Check a ticket", who: "Anyone", body: "Look up any ticket before paying a stranger on social media." },
];

export default function Home({ state, go }) {
  const live = state.tickets.filter((t) => t.status === 1).length;
  const zk = Object.values(state.regKinds).filter((k) => k === "zk").length;
  const waitlist = state.phase === 4 ? Math.max(0, state.entrants.length - state.nextWaitlistIndex) : 0;
  const closes = state.regCloses - state.chainTime;

  return (
    <div className="stack">
      <section className="hero">
        <div className="hero-glow" />
        <div className="hero-body">
          <div className="eyebrow">THE BIG HACK 2.0 · CYBERSECURITY & BLOCKCHAIN · B2</div>
          <h1>Tickets for fans.<br /><span className="grad">Not for bots.</span></h1>
          <p className="hero-sub">{state.eventName}: a ticketing system where every ticket belongs to one verified human, resale can’t be exploited and fakes fail at the gate.</p>
          <div className="hero-cta">
            <button className="btn primary lg" onClick={() => go("organiser")}>Organiser dashboard →</button>
            <button className="btn ghost lg" onClick={() => go("gate")}>Gate scanner</button>
          </div>
        </div>
        <div className="poster">
          <div className="poster-top">LIVE · DEMO NIGHT</div>
          <div className="poster-title">{state.eventName.split("·")[0]}</div>
          <div className="poster-sub">{state.eventName.split("·").slice(1).join("·")}</div>
          <div className="poster-row"><span>Face price</span><b>{eth(state.facePrice)}</b></div>
          <div className="poster-row"><span>Public seats</span><b>{state.publicSeats}</b></div>
          <div className="poster-row"><span>Status</span><b>{["Setup", state.chainTime < state.regCloses ? `Registration · ${fmtLeft(closes)} left` : "Registration closed", "Drawing", "Shuffling", "Sale open"][state.phase]}</b></div>
        </div>
      </section>

      <div className="stats">
        <Stat label="Verified people registered" value={state.entrants.length} sub={`${zk} with a real ZK proof`} />
        <Stat label="Public seats" value={state.publicSeats} sub={`+${state.sponsorSeats} sponsor · ${state.holdSeats} holds declared`} />
        <Stat label="Live tickets" value={live} tone="good" />
        <Stat label="On the waitlist" value={waitlist} />
      </div>
      <Explain id="home-hero" />

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
