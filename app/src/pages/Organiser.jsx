import React, { useState } from "react";
import {
  CROWD, EVENT, NAMES, addressOf, crowdWallet, deployment, errorText, eth, fairTickets, fastForward, fmtLeft, fmtTime,
  inventorySeats, isCrowd, isSyntheticAccount, nameOf, revealArgs, short, syntheticProof, verifyDraw, vrf, wallet,
} from "../chain";
import { ethers } from "ethers";
import { Avatar, Card, Explain, KindBadge, Stat } from "../ui.jsx";

export default function Organiser({ state, run, log }) {
  const org = wallet(0);
  const ft = fairTickets(org);
  const now = state.chainTime;
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState(null);
  const unrevealed = [...Array(state.publicSeats).keys()].filter((i) => !state.seatLabels[i]);
  const zk = Object.values(state.regKinds).filter((k) => k === "zk").length;
  const live = state.tickets.filter((t) => t.status === 1).length;
  const waitlistLeft = state.phase === 4 ? Math.max(0, state.entrants.length - state.nextWaitlistIndex) : 0;
  const unclaimed = state.phase === 4 && now > state.claimDeadline
    ? [...Array(state.winnerCount).keys()].filter((p) => !state.seatIssued[p] && !state.offers[p].active) : [];
  const expired = state.offers.filter((o) => o.active && now > o.deadline);

  const batch = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  // Labelled synthetic crowd: named demo fans + the generated crowd. Each fan sends from its own
  // wallet, so they can go in parallel batches.
  const crowdMembers = [
    ...(deployment.syntheticAccounts || []).map((i) => ({ name: NAMES[i], signer: () => wallet(i), address: addressOf(i) })),
    ...CROWD.map((c) => ({ name: c.name, signer: () => crowdWallet(c), address: c.address })),
  ];
  const parallel = async (items, fn, size = 20) => {
    let ok = 0;
    for (let k = 0; k < items.length; k += size) {
      const res = await Promise.allSettled(items.slice(k, k + size).map(async (x) => { const tx = await fn(x); await tx.wait(); }));
      ok += res.filter((r) => r.status === "fulfilled").length;
    }
    return ok;
  };
  const crowd = () => batch(async () => {
    const todo = crowdMembers.filter((m) => !state.entrants.includes(m.address));
    await run(`Synthetic crowd registered`, async () => {
      const ok = await parallel(todo, (m) => {
        const p = syntheticProof(m.name);
        return fairTickets(m.signer()).register(p.nullifier, p.timestamp, p.revealArray, p.groth16Proof);
      });
      if (ok < todo.length) throw new Error(`${todo.length - ok} of ${todo.length} failed`);
    });
  });
  const syntheticWinners = state.phase === 4
    ? [...Array(state.winnerCount).keys()].filter((p) => !state.seatIssued[p] && state.seatLabels[p] && crowdMembers.some((m) => m.address === state.entrants[p]))
    : [];
  const claimSynthetic = () => batch(() => run(`${syntheticWinners.length} synthetic winners paid and claimed`, async () => {
    const byAddr = new Map(crowdMembers.map((m) => [m.address, m]));
    await parallel(syntheticWinners, (p) => fairTickets(byAddr.get(state.entrants[p]).signer()).claimTicket(p, { value: state.facePrice }));
  }));

  // The single "next action" for the current state of the sale.
  let next = null;
  if (state.phase === 1 && now < state.regCloses) {
    next = { title: "Registration is open", body: `Fans are registering. It closes in ${fmtLeft(state.regCloses - now)}. Add the synthetic crowd, let a real fan prove live, then jump the clock.`,
      actions: [
        { label: `Add synthetic crowd (${crowdMembers.filter((m) => !state.entrants.includes(m.address)).length})`, fn: crowd },
        { label: "⏩ Close registration now", fn: () => run("Registration closed (clock moved to closing time)", () => fastForward(state.regCloses - now + 60)), ghost: true },
      ] };
  } else if (state.phase === 1) {
    next = { title: "Registration closed: request the random seed", body: "The entrant list is now frozen. Only now do we ask Chainlink VRF for randomness, so nobody can time their entry.",
      actions: [{ label: "🎲 Request draw", fn: () => run("Randomness requested from VRF", () => ft.requestDraw()) }] };
  } else if (state.phase === 2) {
    next = { title: "Waiting for Chainlink VRF", body: "VRF returns a random number with a proof that nobody chose it. On the local chain, our VRF mock delivers it.",
      actions: [{ label: "Deliver randomness", fn: async () => { const id = await fairTickets().vrfRequestId(); return run("VRF randomness delivered", () => vrf(org).fulfill(id)); } }] };
  } else if (state.phase === 3) {
    next = { title: "Shuffle on-chain", body: "A Fisher–Yates shuffle using the VRF seed. Anyone can call this, and anyone can re-run it.",
      actions: [{ label: "🔀 Run shuffle", fn: () => run("Shuffle complete", () => ft.runShuffle(200)) }] };
  } else if (unrevealed.length) {
    next = { title: "Reveal seats against the locked root", body: "Each seat is proven to be in the Merkle root committed before the sale. A fake seat would fail.",
      actions: [{ label: `Reveal ${unrevealed.length} seats`, fn: () => run(`${unrevealed.length} seats revealed and proven`, () => ft.revealSeats(...revealArgs(unrevealed))) }] };
  } else if (now <= state.claimDeadline) {
    next = { title: "Winners are claiming", body: `Winners pay face value in the fan app. The claim window closes in ${fmtLeft(state.claimDeadline - now)}.`,
      actions: [
        ...(syntheticWinners.length ? [{ label: `Synthetic winners pay (${syntheticWinners.length})`, fn: claimSynthetic }] : []),
        { label: "⏩ End claim window (+25 h)", fn: () => run("Clock moved forward 25 h", () => fastForward(25 * 3600)), ghost: true },
      ] };
  } else if (unclaimed.length || expired.length) {
    next = { title: "Pass unused seats to the waitlist", body: "Unclaimed seats and expired offers move to the next verified fan in line.",
      actions: [
        ...(unclaimed.length ? [{ label: `Release ${unclaimed.length} unclaimed`, fn: () => batch(async () => { for (const p of unclaimed) await run(`Seat ${state.seatLabels[p]} offered to the waitlist`, () => ft.releaseUnclaimed(p)); }) }] : []),
        ...(expired.length ? [{ label: `Move ${expired.length} expired offers`, fn: () => batch(async () => { for (const o of expired) await run(`Offer for ${state.seatLabels[o.seat]} moved on`, () => ft.expireOffer(o.seat)); }) }] : []),
      ] };
  } else {
    next = { title: "Sale is live", body: "Fans hold tickets, can sell back at face value, and waitlisted fans get offers. Use the gate scanner at the event.",
      actions: [{ label: "⏩ Expire open offers (+2 h)", fn: () => run("Clock moved forward 2 h", () => fastForward(2 * 3600 + 60)), ghost: true }] };
  }

  return (
    <div className="stack">
      <div className="stats">
        <Stat label="Verified people" value={state.entrants.length} sub={`${zk} real ZK · ${state.entrants.length - zk} synthetic`} />
        <Stat label="Public seats" value={state.publicSeats} sub={`${state.publicSeats - unrevealed.length} revealed`} />
        <Stat label="Live tickets" value={live} tone="good" />
        <Stat label="Waitlist left" value={waitlistLeft} />
        <Stat label="Proceeds" value={eth(state.organiserBalance)} sub="refunds go straight to fans" />
      </div>
      <Explain id="org-stats" />

      <div className="grid-2-1">
        <Card title="Next step" icon="▶" className="next-card" explain="org-steps">
          <h3 className="next-title">{next.title}</h3>
          <p className="muted">{next.body}</p>
          <div className="row">
            {next.actions.map((a) => (
              <button key={a.label} disabled={busy} className={`btn ${a.ghost ? "ghost" : "primary"} lg`} onClick={a.fn}>{busy ? "Working…" : a.label}</button>
            ))}
          </div>
          <details className="advanced">
            <summary>Clock controls (local demo chain only)</summary>
            <div className="row">
              <button className="btn sm" onClick={() => run("Clock +31 min", () => fastForward(31 * 60))}>+31 min</button>
              <button className="btn sm" onClick={() => run("Clock +2 h", () => fastForward(2 * 3600 + 60))}>+2 h (offer window)</button>
              <button className="btn sm" onClick={() => run("Clock +25 h", () => fastForward(25 * 3600))}>+25 h (claim window)</button>
            </div>
            <p className="tiny muted">Chain time {fmtTime(now)} · buyback closes {fmtTime(state.buybackDeadline)}</p>
          </details>
        </Card>

        <Card title="Seat list commitment" icon="🔒" explain="org-inventory">
          <div className="tiny muted">MERKLE ROOT (LOCKED BEFORE THE SALE)</div>
          <div className="mono root">{state.inventoryRoot}</div>
          <div className="cat-row">
            <span><b>{state.publicSeats}</b> public</span>
            <span><b>{state.sponsorSeats}</b> sponsor</span>
            <span><b>{state.holdSeats}</b> artist holds</span>
          </div>
          <div className="row">
            <button className="btn sm" disabled={state.organiserBalance === 0n} onClick={() => run("Proceeds withdrawn", () => ft.withdrawProceeds())}>Withdraw proceeds</button>
            <button className="btn sm" onClick={async () => {
              // Merged entry list from all gates (venue LAN), hashed and anchored on-chain after the event.
              let scans = {};
              try { scans = await (await fetch(`/api/gate/scans?contract=${deployment.fairTickets}`)).json(); } catch {}
              const sorted = Object.keys(scans).sort((a, b) => a - b).map((k) => [k, scans[k]]);
              const h = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(sorted)));
              run(`Gate log anchored (${sorted.length} entries, all gates)`, () => ft.submitScanLog(h, sorted.length));
            }}>Anchor gate log</button>
          </div>
        </Card>
      </div>

      <div className="grid-2">
        <CreateEvent />
        <AssistedDesk state={state} ft={ft} run={run} />
      </div>

      <Card title="Live seat map" icon="▦" explain="org-seatmap" right={<Legend />}>
        <SeatMap state={state} />
      </Card>

      <Card title="Lottery board" icon="🎲" explain="org-lottery" right={state.phase === 4 && (
        <button className="btn sm" onClick={() => setCheck(verifyDraw(state.randomSeed, state.registrationOrder, state.entrants))}>Verify the draw independently</button>
      )}>
        {state.entrants.length > 0 && (
          <p className="small">
            <b>{state.entrants.length}</b> verified people for <b>{state.publicSeats}</b> seats.{" "}
            {state.entrants.length > state.publicSeats
              ? <>After the shuffle, positions 1–{state.publicSeats} win; person #{state.publicSeats + 1} is <b>waitlist #1</b> and gets the first returned seat. <span className="muted">({state.entrants.length - state.publicSeats} on the waitlist.)</span></>
              : <>Everyone gets a seat.</>}
          </p>
        )}
        {state.phase >= 3 && <div className="seed">VRF seed <span className="mono">{state.randomSeed.toString().slice(0, 30)}…</span></div>}
        {check && (
          <div className={`verify ${check.match ? "ok" : "bad"}`}>
            {check.match ? "✓ Recomputed from the public registration list + VRF seed: exact match. The draw was fair." : "✗ Mismatch"}
          </div>
        )}
        {state.entrants.length === 0 ? <p className="muted">No one has registered yet.</p> : (
          <div className="board">
            {state.entrants.map((a, i) => {
              const t = state.tickets.find((x) => x.holder === a && x.status !== 3);
              const offer = state.offers.find((o) => o.active && o.fan === a);
              const winner = state.phase === 4 && i < state.winnerCount;
              const wl = state.phase === 4 && i >= state.winnerCount;
              return (
                <div key={a} className={`board-row ${winner ? "is-win" : ""} ${wl ? "is-wait" : ""}`} style={{ animationDelay: `${i * 40}ms` }}>
                  <span className="board-n">{state.phase === 4 ? i + 1 : "·"}</span>
                  <Avatar name={nameOf(a)} size={26} />
                  <span className="board-name">{nameOf(a)}</span>
                  <KindBadge kind={state.regKinds[a]} />
                  <span className="board-res">
                    {state.phase < 4 ? "In the draw" : winner ? `Winner · ${state.seatLabels[i] || "seat ?"}` : `Waitlist #${i - state.winnerCount + 1}`}
                    {t && <span className="pill-s good"> 🎟 #{t.id}{t.status === 2 ? " returning" : ""}</span>}
                    {offer && <span className="pill-s warn"> offered {state.seatLabels[offer.seat]}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Activity" icon="≡">
        {log.length === 0 ? <p className="muted small">Actions appear here.</p> : (
          <div className="activity">
            {log.map((l, i) => <div key={i} className={l.ok ? "ok" : "bad"}><span className="muted">{l.stamp}</span> {l.ok ? "✓" : "✕"} {l.text}</div>)}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- create a real event
function CreateEvent() {
  const [f, setF] = useState({
    title: EVENT.title || "", venue: EVENT.venue || "", startsAt: (EVENT.startsAt || "").slice(0, 16),
    priceInr: EVENT.priceInr ?? 4500, priceEth: EVENT.priceEth || "0.05",
    publicSeats: EVENT.publicSeats ?? 100, sponsorSeats: EVENT.sponsorSeats ?? 10, holdSeats: EVENT.holdSeats ?? 5,
    assistedCap: EVENT.assistedCap ?? 5, registrationMinutes: 120, crowd: (deployment.crowd || []).length || 120,
  });
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const create = async () => {
    if (!confirm("Create this event? It replaces the current demo event (new contract, fresh registrations).")) return;
    setBusy(true);
    setStatus("Deploying the event contract and locking the seat list… (about 30 s)");
    try {
      const body = { ...f, startsAt: f.startsAt ? `${f.startsAt}:00+05:30` : "" };
      const r = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      setStatus("✓ Event created. Reloading…");
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      setStatus(`✕ ${e.message}`);
      setBusy(false);
    }
  };
  return (
    <Card title="Create an event" icon="＋" explain="org-create">
      <div className="form-grid">
        <label className="wide">Event name<input value={f.title} onChange={set("title")} placeholder="Artist / match / event" /></label>
        <label className="two">Venue<input value={f.venue} onChange={set("venue")} placeholder="Stadium, city" /></label>
        <label>Date & time (IST)<input type="datetime-local" value={f.startsAt} onChange={set("startsAt")} /></label>
        <label>Price (₹)<input type="number" min="0" value={f.priceInr} onChange={set("priceInr")} /></label>
        <label>Demo chain price (ETH)<input value={f.priceEth} onChange={set("priceEth")} /></label>
        <label>Registration (minutes)<input type="number" min="2" value={f.registrationMinutes} onChange={set("registrationMinutes")} /></label>
        <label>Public seats<input type="number" min="1" max="500" value={f.publicSeats} onChange={set("publicSeats")} /></label>
        <label>Sponsor seats<input type="number" min="0" value={f.sponsorSeats} onChange={set("sponsorSeats")} /></label>
        <label>Artist holds<input type="number" min="0" value={f.holdSeats} onChange={set("holdSeats")} /></label>
        <label>ID-desk quota<input type="number" min="0" value={f.assistedCap} onChange={set("assistedCap")} /></label>
        <label className="two">Synthetic crowd (labelled demo fans)<input type="number" min="0" max="300" value={f.crowd} onChange={set("crowd")} /></label>
      </div>
      <div className="row">
        <button className="btn primary" disabled={busy || !f.title} onClick={create}>{busy ? "Creating…" : "Create event"}</button>
        <span className="small muted">{status || "Only from the organiser laptop. Sponsor seats and holds are declared publicly."}</span>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- assisted ID desk
function AssistedDesk({ state, ft, run }) {
  const [fan, setFan] = useState("");
  const [docType, setDocType] = useState("Passport");
  const [docNo, setDocNo] = useState("");
  const open = state.phase === 1 && state.chainTime < state.regCloses;
  const full = state.assistedCount >= state.assistedCap;
  const valid = /^0x[0-9a-fA-F]{40}$/.test(fan.trim()) && docNo.trim().length >= 5;
  const submit = () => {
    // Only a salted hash of the document is stored: the same document can't register twice.
    const docHash = ethers.keccak256(ethers.toUtf8Bytes(`${docType}|${docNo.trim().toUpperCase()}|${deployment.nullifierSeed}`));
    run(`${short(fan.trim())} registered at the ID desk`, () => ft.assistedRegister(fan.trim(), docHash)).then((ok) => ok && (setFan(""), setDocNo("")));
  };
  return (
    <Card title="Assisted ID desk" icon="🛂" explain="org-assisted"
      right={<span className={`badge ${full ? "badge-asst" : "badge-zk"}`}>{state.assistedCount} / {state.assistedCap} used</span>}>
      <p className="small muted">For fans Aadhaar doesn’t cover: foreign visitors, minors with a guardian. Staff check the document in person; only its hash goes on-chain, under a quota fixed before the sale.</p>
      <div className="form-grid">
        <label className="wide">Fan’s wallet (shown in their app)<input value={fan} onChange={(e) => setFan(e.target.value)} placeholder="0x…" /></label>
        <label>Document<select value={docType} onChange={(e) => setDocType(e.target.value)}><option>Passport</option><option>OCI card</option><option>Guardian + birth certificate</option></select></label>
        <label className="two">Document number<input value={docNo} onChange={(e) => setDocNo(e.target.value)} placeholder="checked in person" /></label>
      </div>
      <button className="btn" disabled={!open || full || !valid} onClick={submit}>
        {!open ? "Registration is closed" : full ? "Quota used up" : "Register at the desk"}
      </button>
    </Card>
  );
}

function Legend() {
  return (
    <div className="legend">
      <span><i className="sq s-free" />open</span>
      <span><i className="sq s-sold" />ticket</span>
      <span><i className="sq s-ret" />returning</span>
      <span><i className="sq s-off" />offered</span>
      <span><i className="sq s-lock" />declared hold</span>
    </div>
  );
}

function SeatMap({ state }) {
  const seats = inventorySeats();
  return (
    <div className="seatmap">
      <div className="stage">STAGE</div>
      <div className="seats">
        {seats.map((s) => {
          if (s.category !== "public") {
            return <div key={s.index} className="seat s-lock" title={`${s.label} · ${s.category} (declared before sale)`}>{s.label}<small>{s.category}</small></div>;
          }
          const t = state.tickets.find((x) => x.seat === s.index && x.status !== 3);
          const offer = state.offers[s.index]?.active ? state.offers[s.index] : null;
          const cls = t?.status === 2 ? "s-ret" : t ? "s-sold" : offer ? "s-off" : "s-free";
          const who = t ? nameOf(t.holder) : offer ? `offer → ${nameOf(offer.fan)}` : state.seatLabels[s.index] ? "unclaimed" : "not revealed";
          return (
            <div key={s.index} className={`seat ${cls}`} title={`${s.label}: ${who}`}>
              {s.label}<small>{who}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}
