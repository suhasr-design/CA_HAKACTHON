import React, { useState } from "react";
import { deployment, errorText, fairTickets, short } from "../chain";
import { Card, Explain } from "../ui.jsx";

const MESSAGES = {
  0: { icon: "✕", cls: "res-bad", title: "This ticket does not exist", body: "It is fake. Do not pay for it." },
  1: { icon: "✓", cls: "res-ok", title: "Real ticket, but it can’t be sold to you", body: "Fair Tickets can’t be transferred. Anyone offering this ticket for sale is scamming you. Join the official waitlist instead." },
  2: { icon: "↻", cls: "res-warn", title: "This ticket is being returned", body: "Its holder sold it back at face value. It will go to the next verified fan on the waitlist, and can’t be bought privately." },
  3: { icon: "✕", cls: "res-bad", title: "This ticket is no longer valid", body: "It was returned and replaced. The seat belongs to someone else now, so any copy of this ticket is useless." },
};

export default function Check({ state }) {
  const [id, setId] = useState("");
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const check = async (value = id) => {
    setErr(""); setRes(null);
    const v = String(value).trim().replace(/^#/, "");
    if (!/^\d+$/.test(v)) { setErr("Enter a ticket number, like 3."); return; }
    setBusy(true);
    try {
      const c = await fairTickets().checkTicket(BigInt(v));
      setRes({ id: v, status: Number(c.status), holder: c.holder, label: c.label });
    } catch (e) {
      setErr(`Couldn’t check: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const m = res && MESSAGES[res.status];
  const examples = [...state.tickets.slice(0, 3).map((t) => t.id), 999];

  return (
    <div className="stack">
      <section className="check-hero">
        <div className="eyebrow">ANYONE · NO LOGIN</div>
        <h1>Someone selling you a ticket?<br /><span className="grad">Check it first.</span></h1>
        <div className="search">
          <span className="search-i">🔍</span>
          <input placeholder="Ticket number, e.g. 3" value={id} onChange={(e) => setId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && check()} />
          <button className="btn primary" disabled={busy} onClick={() => check()}>{busy ? "Checking…" : "Check"}</button>
        </div>
        <div className="row center-row">
          <span className="tiny muted">Try:</span>
          {examples.map((x) => <button key={x} className="chip" onClick={() => { setId(String(x)); check(x); }}>#{x}</button>)}
        </div>
        {err && <p className="bad">{err}</p>}
        {m && (
          <div className={`check-result ${m.cls}`}>
            <div className="check-icon">{m.icon}</div>
            <div>
              <div className="check-title">{m.title}</div>
              <p>{m.body}</p>
              {res.status !== 0 && (
                <p className="tiny muted">Ticket #{res.id}{res.label ? ` · seat ${res.label}` : ""}{res.holder && res.holder !== "0x0000000000000000000000000000000000000000" ? ` · bound to ${short(res.holder)}` : ""} · read live from the blockchain</p>
              )}
            </div>
          </div>
        )}
        <Explain id="check-search" />
      </section>

      <div className="grid-2">
        <Card title="Event facts anyone can verify" icon="🔒" explain="check-facts">
          <div className="facts">
            <div><span>Event</span><b>{state.eventName}</b></div>
            <div><span>Official contract</span><b className="mono">{deployment.fairTickets}</b></div>
            <div><span>Seat-list fingerprint</span><b className="mono">{state.inventoryRoot}</b></div>
            <div><span>Seats in public sale</span><b>{state.publicSeats}</b></div>
            <div><span>Declared sponsor / holds</span><b>{state.sponsorSeats} / {state.holdSeats}</b></div>
            <div><span>Tickets issued so far</span><b>{state.tickets.length}</b></div>
          </div>
        </Card>
        <Card title="Stay safe" icon="🛡">
          <ul className="tips">
            <li><b>No real ticket can be sold to you.</b> Anyone selling one on WhatsApp, Instagram or Telegram is a scammer.</li>
            <li><b>Want a seat?</b> Join the official waitlist. Returned seats go to the next fan in line at face value.</li>
            <li><b>Screenshots don’t work at the gate.</b> The real QR changes every 30 seconds.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
