import React, { useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { NAMES, addressOf, deployment, errorText, fairTickets, nameOf, provider, wallet } from "../chain";
import { makePayload, verifyPayload } from "../gateQr";
import { Avatar, Card, Explain, Stat, beep } from "../ui.jsx";

// Saved gate data is namespaced by contract address, so a fresh deployment starts clean.
const ns = (k) => `${k}:${deployment.fairTickets}`;
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(ns(k))) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(ns(k), JSON.stringify(v)); } catch {} };

export default function Gate({ state }) {
  const [cache, setCache] = useState(() => load("ft-cache", null));
  const [scanned, setScanned] = useState(() => load("ft-scanned", {}));
  const [online, setOnline] = useState(true);
  const [results, setResults] = useState([]);
  const [paste, setPaste] = useState("");
  const [demoFan, setDemoFan] = useState(null);
  const [camOn, setCamOn] = useState(false);
  const [flash, setFlash] = useState(0);
  const camRef = useRef(null);

  useEffect(() => save("ft-scanned", scanned), [scanned]);

  const holders = state.tickets.filter((t) => t.status === 1);
  useEffect(() => {
    if (demoFan === null && holders.length) setDemoFan(holders[0].holder);
  }, [holders.length, demoFan]);

  const download = async () => {
    try {
      const live = await fairTickets().getLiveTickets();
      const list = {};
      live.ids.forEach((id, k) => {
        const seat = Number(live.seats[k]);
        list[Number(id)] = { holder: live.holders[k], seat, label: state.seatLabels[seat] };
      });
      const c = { list, at: Date.now(), block: await provider.getBlockNumber() };
      setCache(c);
      save("ft-cache", c);
    } catch (e) {
      alert(`Download failed: ${errorText(e)}`);
    }
  };

  const scan = (text, source) => {
    const r = verifyPayload(text, cache?.list || {}, scanned);
    if (r.ok) setScanned((s) => ({ ...s, [r.ticket]: Math.floor(Date.now() / 1000) }));
    beep(r.ok);
    setFlash((f) => f + 1);
    setResults((x) => [{ ...r, source, at: new Date().toLocaleTimeString() }, ...x].slice(0, 20));
  };

  // Simulated phones for the stage demo.
  const fanIdx = demoFan ? NAMES.findIndex((_, i) => addressOf(i) === demoFan) : -1;
  const fanTicket = holders.find((t) => t.holder === demoFan);
  const fanName = fanIdx >= 0 ? NAMES[fanIdx] : "";
  const sims = [
    { key: "live", icon: "📱", label: "Live QR", sub: "fresh, signed by the holder", need: true,
      fn: async () => scan(await makePayload(wallet(fanIdx), fanTicket.id), `${fanName}’s phone (live)`) },
    { key: "shot", icon: "🖼", label: "Screenshot", sub: "same QR, 2 minutes old", need: true,
      fn: async () => scan(await makePayload(wallet(fanIdx), fanTicket.id, { ageSeconds: 120 }), `Screenshot of ${fanName}’s QR`) },
    { key: "forge", icon: "🧪", label: "Forged copy", sub: "made without the holder’s key", need: true,
      fn: async () => scan(await makePayload(ethers.Wallet.createRandom(), fanTicket.id), `Forged copy of ${fanName}’s ticket`) },
    { key: "fake", icon: "🛑", label: "Fake ticket", sub: "bought on social media", need: false,
      fn: async () => scan(await makePayload(ethers.Wallet.createRandom(), 999), "Fake ticket #999 from Instagram") },
  ];

  useEffect(() => {
    if (!camOn) return;
    // Dense QR (it carries a full signature): use the browser's native BarcodeDetector when
    // available, a high-resolution stream and a large scan box.
    const cam = new Html5Qrcode("gate-cam", {
      verbose: false,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
    camRef.current = cam;
    // Ignore the same code only for 3 seconds (stops repeat beeps while the phone is held up),
    // so a second scan of the same ticket is still checked ("Already used").
    let last = "";
    let lastAt = 0;
    cam.start({ facingMode: "user" }, {
      fps: 15,
      qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.9); return { width: s, height: s }; },
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
  const okCount = results.filter((r) => r.ok).length;
  const badCount = results.length - okCount;

  return (
    <div className="stack">
      <div className="gate-top">
        <div className={`net ${online ? "net-on" : "net-off"}`}>
          <span className="net-dot" /> {online ? "Network online" : "Network OFF · offline mode"}
        </div>
        <div className="stats compact">
          <Stat label="Tickets cached" value={count} />
          <Stat label="Let in" value={Object.keys(scanned).length} tone="good" />
          <Stat label="Rejected this session" value={badCount} tone="bad" />
        </div>
      </div>

      <div className="gate-grid">
        <Card title="1 · Before doors open" icon="⬇" explain="gate-download">
          <p className="muted small">Download the valid-ticket list straight from the blockchain. After that, the scanner needs no internet.</p>
          <div className="row">
            <button className="btn primary" disabled={!online} onClick={download}>{cache ? "Refresh ticket list" : "Download ticket list"}</button>
            <button className={`btn ${online ? "ghost" : "danger"}`} onClick={() => setOnline((o) => !o)}>
              {online ? "📴 Switch network OFF" : "📶 Turn network back on"}
            </button>
          </div>
          {cache ? (
            <p className="good small">✓ {count} valid tickets cached at block {cache.block}, {new Date(cache.at).toLocaleTimeString()}</p>
          ) : <p className="warn small">No ticket list yet. Download it first.</p>}
          <button className="btn sm ghost" onClick={() => { setScanned({}); setResults([]); }}>Reset gate for a new run</button>
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

      <Card title="2 · Stage demo: phones at the gate" icon="📱" explain="gate-scan">
        <div className="row">
          <span className="small muted">Ticket holder:</span>
          {holders.length === 0 && <span className="warn small">No one holds a ticket yet. Claim one in the fan app.</span>}
          {holders.map((t) => (
            <button key={t.id} className={`chip ${demoFan === t.holder ? "on" : ""}`} onClick={() => setDemoFan(t.holder)}>
              <Avatar name={nameOf(t.holder)} size={20} /> {nameOf(t.holder)} · {t.label}
            </button>
          ))}
        </div>
        <div className="sims">
          {sims.map((s) => (
            <button key={s.key} className="sim" disabled={!cache || (s.need && !fanTicket)} onClick={s.fn}>
              <div className="sim-i">{s.icon}</div>
              <div className="sim-l">{s.label}</div>
              <div className="sim-s">{s.sub}</div>
            </button>
          ))}
        </div>
        <p className="tiny muted">Try the same live QR twice: the second scan is rejected as already used.</p>
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
          <Explain id="gate-scan" />
        </Card>
      </div>
    </div>
  );
}
