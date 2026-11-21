import React, { useCallback, useEffect, useRef, useState } from "react";
import { deployment, errorText, loadState, short } from "./chain";
import { ExplainCtx, PhaseStepper, phaseName, useToast } from "./ui.jsx";
import Home from "./pages/Home.jsx";
import Organiser from "./pages/Organiser.jsx";
import Gate from "./pages/Gate.jsx";
import Check from "./pages/Check.jsx";

// The fan experience lives only in the Android app (../mobile). The website is for the
// organiser, venue staff and the public.
const TABS = [
  { id: "home", label: "Home", icon: "✦" },
  { id: "organiser", label: "Organiser", icon: "🛠" },
  { id: "gate", label: "Gate scanner", icon: "🚪" },
  { id: "check", label: "Check a ticket", icon: "🔍" },
];
const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

// URL hash: #gate, #fan&as=3, #organiser, #check. Lets each screen live in its own window on stage.
function readHash() {
  const parts = new URLSearchParams(window.location.hash.slice(1).replace(/^([a-z-]+)(&|$)/i, "tab=$1$2"));
  const tab = TABS.find((t) => t.id === (parts.get("tab") || "").toLowerCase())?.id;
  const as = parts.get("as");
  return { tab, as: as !== null && !isNaN(Number(as)) ? Number(as) : undefined };
}

export default function App() {
  const initial = readHash();
  const [tab, setTab] = useState(() => {
    const t = initial.tab || safeGet("ft-tab");
    return TABS.some((x) => x.id === t) ? t : "home";
  });
  const [account, setAccount] = useState(initial.as ?? Number(safeGet("ft-account") ?? 1));
  const [explain, setExplain] = useState(safeGet("ft-explain") === "1");
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [log, setLog] = useState([]);
  const toast = useToast();

  // One refresh at a time: with 100+ seats and a crowd, a slow poll must not pile up behind the next.
  const inflight = useRef(null);
  const refresh = useCallback(async () => {
    if (inflight.current) return inflight.current;
    inflight.current = (async () => {
      try {
        setState(await loadState());
        setError("");
      } catch (e) {
        setError(`Can't reach the local blockchain at ${deployment.rpcUrl}. Is "npm run chain" running, and did you run "npm run deploy:local"? (${errorText(e)})`);
      } finally {
        inflight.current = null;
      }
    })();
    return inflight.current;
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => safeSet("ft-tab", tab), [tab]);
  useEffect(() => safeSet("ft-account", String(account)), [account]);
  useEffect(() => safeSet("ft-explain", explain ? "1" : "0"), [explain]);
  useEffect(() => {
    const onHash = () => { const h = readHash(); if (h.tab) setTab(h.tab); if (h.as !== undefined) setAccount(h.as); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  /** Runs a blockchain action, shows a toast and logs it. Returns true on success. */
  const run = useCallback(async (label, fn, { quiet = false } = {}) => {
    const stamp = new Date().toLocaleTimeString();
    try {
      const res = await fn();
      if (res?.wait) await res.wait();
      setLog((l) => [{ ok: true, text: label, stamp }, ...l].slice(0, 40));
      if (!quiet) toast({ ok: true, title: label });
      await refresh();
      return true;
    } catch (e) {
      const msg = errorText(e);
      setLog((l) => [{ ok: false, text: `${label}: ${msg}`, stamp }, ...l].slice(0, 40));
      toast({ ok: false, title: `${label}: rejected`, body: msg });
      await refresh();
      return false;
    }
  }, [refresh, toast]);

  const props = { state, account, setAccount, run, refresh, log, go: setTab };

  return (
    <ExplainCtx.Provider value={explain}>
      <div className="shell">
        <header className="topbar">
          <div className="brand" onClick={() => setTab("home")}>
            <div className="logo">FT</div>
            <div>
              <div className="brand-name">Fair Tickets</div>
              <div className="brand-sub">The Chip Architects · B2</div>
            </div>
          </div>
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={t.id === tab ? "active" : ""} onClick={() => setTab(t.id)}>
                <span className="tab-i">{t.icon}</span>{t.label}
              </button>
            ))}
          </nav>
          <div className="top-right">
            <label className="switch" title="Show presenter notes on every screen">
              <input type="checkbox" checked={explain} onChange={(e) => setExplain(e.target.checked)} />
              <span className="switch-ui" /> Presenter notes
            </label>
            <span className="mobile-pill" title="Fans use the Fair Tickets Android app">📱 Fans: Android app</span>
            <button className="btn primary sm refresh-btn" title="Reload this page with the latest data from the blockchain (Ctrl+R)"
              onClick={() => window.location.reload()}>↻ Refresh</button>
          </div>
        </header>

        {state && (
          <div className="statusbar">
            <span className="live-dot" /> Live on local chain · block {state.blockNumber}
            <PhaseStepper phase={state.phase} />
            <span className="demo-note">Demo: local Hardhat chain · test ETH · Anon Aadhaar <b>{deployment.aadhaarMode === "test" ? "test mode" : "REAL Aadhaar (UIDAI keys)"}</b> · mock Chainlink VRF · synthetic crowd labelled</span>
          </div>
        )}

        {error && <div className="error-banner">{error}</div>}

        <main className="main">
          {!state && !error && <div className="loading">Connecting to the blockchain…</div>}
          {state && tab === "home" && <Home {...props} />}
          {state && tab === "organiser" && <Organiser {...props} />}
          {state && tab === "gate" && <Gate {...props} />}
          {state && tab === "check" && <Check {...props} />}
        </main>
        <footer className="foot">Phase: {state ? phaseName(state.phase) : "—"} · Contract {short(deployment.fairTickets)} · Local demo chain (test ETH). The synthetic crowd is labelled; real fans prove with Aadhaar.</footer>
      </div>
    </ExplainCtx.Provider>
  );
}
