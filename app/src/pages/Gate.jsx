import React, { useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { QRCodeSVG } from "qrcode.react";
import { CROWD, NAMES, addressOf, crowdWallet, deployment, errorText, fairTickets, nameOf, provider, wallet } from "../chain";
import { GATE_CODE_SECONDS, makePayload, newGateCode, verifyPayload } from "../gateQr";
import { Avatar, Card, Explain, Stat, beep } from "../ui.jsx";

// Saved gate data is namespaced by contract address, so a fresh event starts clean.
const ns = (k) => `${k}:${deployment.fairTickets}`;
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(ns(k))) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(ns(k), JSON.stringify(v)); } catch {} };
// Each browser tab is one gate (open two tabs to show Gate A and Gate B).
const tabGate = () => { try { return sessionStorage.getItem("ft-gate") || "Gate A"; } catch { return "Gate A"; } };
const GATES = ["Gate A", "Gate B", "Gate C"];

export default function Gate({ state }) {
  const [gate, setGate] = useState(tabGate);
  const [cache, setCache] = useState(() => load("ft-cache", null));
  const [scanned, setScanned] = useState(() => load(`ft-scanned-${tabGate()}`, {}));
  const [pending, setPending] = useState(() => load(`ft-pending-${tabGate()}`, []));
  const [online, setOnline] = useState(true);   // internet / blockchain
  const [lan, setLan] = useState(true);         // venue LAN between gates
  const [lanUp, setLanUp] = useState(null);
  const [requireCode, setRequireCode] = useState(true);
  const [codes, setCodes] = useState(() => ({ cur: newGateCode(), prev: newGateCode(), left: GATE_CODE_SECONDS }));
  const [results, setResults] = useState([]);
  const [paste, setPaste] = useState("");
  const [demoFan, setDemoFan] = useState(null);
  const [camOn, setCamOn] = useState(false);
  const [flash, setFlash] = useState(0);

  // Refs so the camera callback always sees the latest values.
  const live = useRef({});
  live.current = { cache, scanned, codes, requireCode, lan, gate };

  useEffect(() => { try { sessionStorage.setItem("ft-gate", gate); } catch {} }, [gate]);
  useEffect(() => save(`ft-scanned-${gate}`, scanned), [scanned, gate]);
  useEffect(() => save(`ft-pending-${gate}`, pending), [pending, gate]);

  // Gate code: new 4-digit code every 20 s; the previous one stays valid for one more period.
  useEffect(() => {
    const t = setInterval(() => setCodes((c) => (c.left <= 1 ? { cur: newGateCode(), prev: c.cur, left: GATE_CODE_SECONDS } : { ...c, left: c.left - 1 })), 1000);
    return () => clearInterval(t);
  }, []);

  // Gate sync: pull every gate's entries from the venue LAN, and push entries made while it was down.
  useEffect(() => {
    if (!lan) { setLanUp(false); return; }
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`/api/gate/scans?contract=${deployment.fairTickets}`, { cache: "no-store" });
        const all = await r.json();
        if (!alive) return;
        setLanUp(true);
        setScanned((s) => ({ ...s, ...all }));
        if (live.current && pending.length) {
          const left = [];
          for (const p of pending) {
            const j = await fetch("/api/gate/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contract: deployment.fairTickets, ticket: p.ticket, gate: p.gate }) }).then((x) => x.json()).catch(() => null);
            if (!j) { left.push(p); continue; }
            if (!j.ok && j.already?.gate !== p.gate) {
              setResults((x) => [{ ok: false, reason: `Sync conflict: ticket #${p.ticket} was also let in at ${j.already.gate} while the LAN was down`, source: "Gate sync", at: new Date().toLocaleTimeString() }, ...x].slice(0, 30));
            }
          }
          setPending(left);
        }
      } catch {
        if (alive) setLanUp(false);
      }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [lan, pending]);

  const holders = state.tickets.filter((t) => t.status === 1);
  useEffect(() => {
    if (demoFan === null && holders.length) setDemoFan(holders[0].holder);
  }, [holders.length, demoFan]);

  const download = async () => {
    try {
      const liveT = await fairTickets().getLiveTickets();
      const list = {};
      liveT.ids.forEach((id, k) => {
        const seat = Number(liveT.seats[k]);
        list[Number(id)] = { holder: liveT.holders[k], seat, label: state.seatLabels[seat] };
      });
      const c = { list, at: Date.now(), block: await provider.getBlockNumber() };
      setCache(c);
      save("ft-cache", c);
    } catch (e) {
      alert(`Download failed: ${errorText(e)}`);
    }
  };

  const record = (r, source) => {
    beep(r.ok);
    setFlash((f) => f + 1);
    setResults((x) => [{ ...r, source, at: new Date().toLocaleTimeString() }, ...x].slice(0, 30));
  };

  /** Mark a ticket as entered: atomically on the venue LAN, or locally (queued) if the LAN is down. */
  const admit = async (ticket) => {
    const { lan: lanOn, gate: g } = live.current;
    const at = Math.floor(Date.now() / 1000);
    if (lanOn) {
      try {
        const j = await fetch("/api/gate/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contract: deployment.fairTickets, ticket, gate: g }) }).then((x) => x.json());
        if (!j.ok) return { ok: false, already: j.already };
        setScanned((s) => ({ ...s, [ticket]: j.entry }));
        return { ok: true, synced: true };
      } catch { /* LAN unreachable: fall through to local */ }
    }
    setScanned((s) => ({ ...s, [ticket]: { gate: g, at } }));
    setPending((p) => [...p, { ticket, gate: g, at }]);
    return { ok: true, synced: false };
  };

  const scan = async (text, source) => {
    const { cache: c, scanned: s, codes: k, requireCode: rc } = live.current;
    let r = verifyPayload(text, c?.list || {}, s, { codes: [k.cur, k.prev], requireCode: rc });
    if (r.ok) {
      const a = await admit(r.ticket);
      if (!a.ok) r = { ok: false, ticket: r.ticket, reason: `Already entered at ${a.already.gate} at ${new Date(a.already.at * 1000).toLocaleTimeString()}` };
      else if (!a.synced) r = { ...r, reason: `${r.reason} · LAN down: recorded locally, will sync` };
    }
    record(r, source);
  };

  // Simulated phones for the stage demo.
  const fanIdx = demoFan ? NAMES.findIndex((_, i) => addressOf(i) === demoFan) : -1;
  const crowdFan = demoFan ? CROWD.find((c) => c.address === demoFan) : null;
  const fanSigner = fanIdx >= 0 ? wallet(fanIdx) : crowdFan ? crowdWallet(crowdFan) : null;
  const fanTicket = holders.find((t) => t.holder === demoFan);
  const fanName = demoFan ? nameOf(demoFan) : "";
  const sims = [
    { key: "live", icon: "📱", label: "Live QR", sub: "signed for this gate’s code now", need: true,
      fn: async () => scan(await makePayload(fanSigner, fanTicket.id, { code: codes.cur }), `${fanName}’s phone (live)`) },
    { key: "relay", icon: "📡", label: "Relayed / old QR", sub: "made for an earlier code", need: true,
      fn: async () => scan(await makePayload(fanSigner, fanTicket.id, { code: newGateCode() }), `Relayed copy of ${fanName}’s QR`) },
    { key: "forge", icon: "🧪", label: "Forged copy", sub: "made without the holder’s key", need: true,
      fn: async () => scan(await makePayload(ethers.Wallet.createRandom(), fanTicket.id, { code: codes.cur }), `Forged copy of ${fanName}’s ticket`) },
    { key: "fake", icon: "🛑", label: "Fake ticket", sub: "bought on social media", need: false,
      fn: async () => scan(await makePayload(ethers.Wallet.createRandom(), 999, { code: codes.cur }), "Fake ticket #999 from Instagram") },
  ];

  useEffect(() => {
    if (!camOn) return;
    const cam = new Html5Qrcode("gate-cam", {
      verbose: false,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
    // Ignore the same code only for 3 seconds (stops repeat beeps while the phone is held up).
    let last = "";
    let lastAt = 0;
    cam.start({ facingMode: "user" }, {
      fps: 15,
      qrbox: (w, h) => { const sz = Math.floor(Math.min(w, h) * 0.9); return { width: sz, height: sz }; },
      videoConstraints: { width: { ideal: 1920 }, height: { ideal: 1080 } },
    }, (text) => {
      const now = Date.now();
      if (text === last && now - lastAt < 3000) return;
      last = text;
      lastAt = now;
      scan(text, "Camera");
    }).catch((e) => { alert(`Camera error: ${e}`); setCamOn(false); });
    return () => { cam.isScanning && cam.stop().catch(() => {}); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camOn]);

  const latest = results[0];
  const count = cache ? Object.keys(cache.list).length : 0;
  const entered = Object.keys(scanned).length;
  const mine = Object.values(scanned).filter((v) => typeof v === "object" && v.gate === gate).length;
  const badCount = results.filter((r) => !r.ok).length;

  return (
    <div className="stack">
      <div className="gate-top">
        <div className="row">
          <div className="gate-pick">
            {GATES.map((g) => (
              <button key={g} className={`chip ${g === gate ? "on" : ""}`} onClick={() => { setGate(g); setScanned(load(`ft-scanned-${g}`, {})); setPending(load(`ft-pending-${g}`, [])); }}>🚪 {g}</button>
            ))}
          </div>
          <div className={`net ${online ? "net-on" : "net-off"}`}><span className="net-dot" /> {online ? "Internet on" : "Internet OFF"}</div>
          <span className={`sync-pill ${lan && lanUp ? "sync-on" : "sync-off"}`}>
            {lan && lanUp ? "⇄ Gates synced (venue LAN)" : `⚠ LAN down: local only${pending.length ? ` · ${pending.length} to sync` : ""}`}
          </span>
        </div>
        <div className="stats compact">
          <Stat label="Tickets cached" value={count} />
          <Stat label={`Entered (all gates)`} value={entered} sub={`${mine} at ${gate}`} tone="good" />
          <Stat label="Rejected here" value={badCount} tone="bad" />
        </div>
      </div>

      <div className="gate-grid">
        <Card title="1 · Before doors open" icon="⬇" explain="gate-download">
          <p className="muted small">Download the valid-ticket list from the blockchain. After that the gate needs no internet; gates share entries over the venue LAN.</p>
          <div className="row">
            <button className="btn primary" disabled={!online} onClick={download}>{cache ? "Refresh ticket list" : "Download ticket list"}</button>
            <button className={`btn ${online ? "ghost" : "danger"}`} onClick={() => setOnline((o) => !o)}>{online ? "📴 Internet OFF" : "📶 Internet on"}</button>
            <button className={`btn ${lan ? "ghost" : "danger"}`} onClick={() => setLan((o) => !o)}>{lan ? "🔌 Unplug venue LAN" : "🔌 Reconnect LAN"}</button>
          </div>
          {cache ? <p className="good small">✓ {count} valid tickets cached at block {cache.block}, {new Date(cache.at).toLocaleTimeString()}</p>
            : <p className="warn small">No ticket list yet. Download it first.</p>}
          <label className="switch"><input type="checkbox" checked={requireCode} onChange={(e) => setRequireCode(e.target.checked)} /><span className="switch-ui" /> Require gate code (anti-relay)</label>
          <div className="row">
            <button className="btn sm ghost" onClick={async () => {
              setScanned({}); setPending([]); setResults([]);
              await fetch("/api/gate/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contract: deployment.fairTickets }) }).catch(() => {});
            }}>Reset all gates for a new run</button>
          </div>
        </Card>

        <div className="stack">
          <Card title={`${gate} code`} icon="🔢" explain="gate-code">
            <div className="gate-code-row">
              {requireCode && (
                <div className="gate-code-qr" title="Fans scan this with the Fair Tickets app">
                  <QRCodeSVG value={`FTGATE|${deployment.fairTickets.toLowerCase()}|${gate}|${codes.cur}`} size={150} level="M" marginSize={2} />
                </div>
              )}
              <div className="gate-code">{requireCode ? codes.cur : "––––"}</div>
            </div>
            <div className="gate-code-bar"><div style={{ width: `${(codes.left / GATE_CODE_SECONDS) * 100}%` }} /></div>
            <p className="tiny muted center">{requireCode ? `Fans scan this QR with the app (or type the digits); their ticket QR is signed for it. New code in ${codes.left}s.` : "Gate code off: time-based QRs accepted."}</p>
          </Card>
          <div key={flash} className={`scanner ${latest ? (latest.ok ? "scan-ok" : "scan-bad") : ""}`}>
            {!latest ? (
              <div className="scanner-idle">
                <div className="viewfinder"><div className="scanline" /></div>
                <div className="muted">Waiting for a ticket…</div>
              </div>
            ) : (
              <div className="scanner-result">
                <div className="scan-icon">{latest.ok ? "✓" : "✕"}</div>
                <div className="scan-word">{latest.ok ? "ENTER" : "REJECT"}</div>
                <div className="scan-reason">{latest.reason}</div>
                <div className="scan-src">{latest.source}{latest.holder ? ` · ${nameOf(latest.holder)}` : ""} · {latest.at}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <Card title="2 · Stage demo: phones at the gate" icon="📱" explain="gate-scan">
        <div className="row">
          <span className="small muted">Ticket holder:</span>
          {holders.length === 0 && <span className="warn small">No one holds a ticket yet. Claim one in the fan app.</span>}
          {holders.slice(0, 12).map((t) => (
            <button key={t.id} className={`chip ${demoFan === t.holder ? "on" : ""}`} onClick={() => setDemoFan(t.holder)}>
              <Avatar name={nameOf(t.holder)} size={20} /> {nameOf(t.holder)} · {t.label}
            </button>
          ))}
          {holders.length > 12 && <span className="tiny muted">+{holders.length - 12} more</span>}
        </div>
        <div className="sims">
          {sims.map((s) => (
            <button key={s.key} className="sim" disabled={!cache || (s.need && (!fanTicket || !fanSigner))} onClick={s.fn}>
              <div className="sim-i">{s.icon}</div>
              <div className="sim-l">{s.label}</div>
              <div className="sim-s">{s.sub}</div>
            </button>
          ))}
        </div>
        <p className="tiny muted">Open this page in a second tab, pick Gate B, and scan the same ticket: it’s rejected as already entered at Gate A.</p>
        <Explain id="gate-sync" />
      </Card>

      <div className="gate-grid">
        <Card title="Scan a real phone" icon="📷">
          <button className="btn" disabled={!cache} onClick={() => setCamOn((c) => !c)}>{camOn ? "Stop camera" : "Start camera"}</button>
          <div id="gate-cam" className="cam" style={{ display: camOn ? "block" : "none" }} />
          <label className="field">…or paste QR data (“Copy QR data” in the fan app)
            <textarea rows="3" value={paste} onChange={(e) => setPaste(e.target.value)} />
          </label>
          <button className="btn sm" disabled={!cache || !paste} onClick={() => scan(paste.trim(), "Pasted QR")}>Verify pasted QR</button>
        </Card>

        <HelpDesk cache={cache} online={online} regKinds={state.regKinds} onAdmit={async (ticket, who) => {
          const a = await admit(ticket);
          record(a.ok ? { ok: true, ticket, reason: `Identity verified at the help desk: admitted`, holder: who }
            : { ok: false, ticket, reason: `Already entered at ${a.already.gate}` }, "Help desk");
        }} />
      </div>

      <Card title="Scan history" icon="≡">
        {results.length === 0 ? <p className="muted small">No scans yet.</p> : (
          <div className="history">
            {results.map((r, i) => (
              <div key={i} className={`hist ${r.ok ? "ok" : "bad"}`}>
                <span className="hist-i">{r.ok ? "✓" : "✕"}</span>
                <div><div className="small"><b>{r.reason}</b></div><div className="tiny muted">{r.source} · {r.at}</div></div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- identity help desk
// Dead or lost phone, or a random spot-check against phone/wallet selling: the fan re-proves with
// Aadhaar (laptop prover). The fresh proof must be valid for the ticket holder's wallet AND give the
// same nullifier as the registration, i.e. it's the same person who registered.
function HelpDesk({ cache, online, regKinds, onAdmit }) {
  const [ticket, setTicket] = useState("");
  const [stage, setStage] = useState("idle"); // idle | waiting | checking | done
  const [result, setResult] = useState(null);
  const [got, setGot] = useState({ aadhaar: false, phone: false });
  const entry = cache?.list?.[Number(ticket)];
  const isPass = !!(entry && regKinds?.[entry.holder] === "pass" && deployment.fanPass);
  // Fan Pass holders re-prove Aadhaar for the Fan Pass registry; direct entrants for this event.
  const seed = isPass ? deployment.fanPass.seed : deployment.nullifierSeed;

  useEffect(() => {
    if (stage !== "waiting" || !entry) return;
    const t = setInterval(async () => {
      const ra = await fetch(`/api/proof/${entry.holder}`, { cache: "no-store" }).catch(() => null);
      const rp = isPass ? await fetch(`/api/desk-proof/${entry.holder}`, { cache: "no-store" }).catch(() => null) : null;
      const haveA = ra?.status === 200;
      const haveP = !isPass || rp?.status === 200;
      setGot({ aadhaar: haveA, phone: isPass && haveP });
      if (!haveA || !haveP) return;
      const p = await ra.json();
      const desk = isPass ? await rp.json() : null;
      setStage("checking");
      try {
        const router = new ethers.Contract(deployment.aadhaarRouter, deployment.abi.router, provider);
        const valid = await router.verifyAnonAadhaarProof(BigInt(seed), BigInt(p.nullifier), BigInt(p.timestamp), BigInt(entry.holder), p.revealArray.map(BigInt), p.groth16Proof.map(BigInt));
        const ft = fairTickets();
        const regs = await ft.queryFilter(ft.filters.Registered(entry.holder), 0, "latest");
        const registered = regs.length ? regs[regs.length - 1].args.nullifier : null;
        let same = false;
        if (!isPass) {
          same = registered !== null && registered === BigInt(p.nullifier);
        } else {
          // 1) The person at the desk -> their current Fan Pass. 2) The phone holds THAT pass (one-member
          // group proof). 3) That pass made this ticket's entry (same per-event nullifier).
          const fp = new ethers.Contract(deployment.fanPass.fanPass, deployment.fanPass.abi, provider);
          const commitment = (await fp.passOfAadhaar(BigInt(p.nullifier))).toString();
          const vr = commitment === "0" ? { ok: false } : await (await fetch("/api/desk-verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proof: desk, commitment }) })).json();
          const entryN = BigInt(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string", "uint256"], ["fanpass", BigInt(desk.nullifier)])));
          same = vr.ok && BigInt(desk.message) === BigInt(entry.holder) && String(desk.scope) === String(deployment.fanPass.passScope) && registered === entryN;
        }
        setResult({ valid, same });
      } catch (e) {
        setResult({ error: errorText(e) });
      }
      setStage("done");
    }, 3000);
    return () => clearInterval(t);
  }, [stage, entry, isPass, seed]);

  const request = async () => {
    setResult(null);
    setGot({ aadhaar: false, phone: false });
    if (isPass) await fetch(`/api/desk-proof/${entry.holder}`, { method: "DELETE" }).catch(() => {});
    const r = await fetch("/api/proof-request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signal: entry.holder, seed }) }).catch(() => null);
    setStage(r?.ok ? "waiting" : "idle");
  };

  return (
    <Card title="Help desk: lost phone · ID spot-check" icon="🛟" explain="gate-desk">
      <div className="row">
        <input style={{ width: 120 }} placeholder="Ticket #" value={ticket} onChange={(e) => { setTicket(e.target.value.replace(/\D/g, "")); setStage("idle"); setResult(null); }} />
        {entry ? <span className="small"><b>{nameOf(entry.holder)}</b> · seat {entry.label} · <span className="mono tiny">{entry.holder.slice(0, 10)}…</span></span>
          : ticket ? <span className="small bad">Not in the valid ticket list</span> : <span className="small muted">From the cached list (works offline)</span>}
      </div>
      {entry && stage === "idle" && (
        <button className="btn primary" disabled={!online} onClick={request}>Ask the fan to re-prove with Aadhaar</button>
      )}
      {stage === "waiting" && (
        <div className="small">
          <p>{got.aadhaar ? "✓" : "⏳"} The fan uploads their Aadhaar QR at <b>{window.location.host}/prove.html</b> (this request is listed there). Only the proof comes back.</p>
          {isPass && <p>{got.phone ? "✓" : "⏳"} On their phone: ticket → <b>Help desk check</b>. The phone proves it holds the Fan Pass that entered this ticket. <span className="muted">(Dead phone? Restore the Fan Pass backup on any phone.)</span></p>}
        </div>
      )}
      {stage === "checking" && <p className="small">Checking the proof against the blockchain…</p>}
      {result && (
        result.error ? <div className="verify bad">Couldn’t check: {result.error}</div>
          : result.valid && result.same ? (
            <>
              <div className="verify ok">✓ Same person who registered: valid Aadhaar proof for this wallet, and the anonymous code matches the registration.</div>
              <button className="btn primary" onClick={() => { onAdmit(Number(ticket), entry.holder); setStage("idle"); setResult(null); setTicket(""); }}>Admit (marks the ticket as entered)</button>
            </>
          ) : <div className="verify bad">✕ {result.valid ? "Valid Aadhaar, but a DIFFERENT person from the one who registered (phone or wallet was sold or lent)." : "Proof not valid for this ticket holder."} Do not admit.</div>
      )}
      <p className="tiny muted">Use for a dead or lost phone (ticket is admitted without the phone) and for random spot-checks: a tout’s buyer can’t produce the original fan’s Aadhaar.</p>
    </Card>
  );
}
