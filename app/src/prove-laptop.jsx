// "Prove on the laptop": phones are too weak for the 584 MB Anon Aadhaar proving key, so a phone
// can ask for its proof to be generated here. The fan uploads their Secure QR IN THIS BROWSER TAB;
// the proof is bound to the phone's wallet and only the proof is relayed back to the phone.
// The QR itself never leaves this tab (it isn't sent to the dev server or anywhere else).
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnonAadhaarProvider, LogInWithAnonAadhaar, useAnonAadhaar, useProver } from "@anon-aadhaar/react";
import { hash as aaHash, packGroth16Proof } from "@anon-aadhaar/core";
import { nameOf } from "./chain";
import LaptopProver from "./laptopProver.jsx";

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// Default: this laptop's prover (~1.5 min, reliable on a 6 GB laptop). Falls back to the in-browser
// prover only if this page is opened on another computer.
function Prover({ req, onDone }) {
  const [browser, setBrowser] = useState(false);
  const [status, setStatus] = useState("");
  if (browser) return <BrowserProver req={req} onDone={onDone} />;
  const relay = async (proof) => {
    try {
      const r = await fetch(`/api/proof/${req.signal}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "proof", ...proof }) });
      if (!r.ok) throw new Error(`relay said ${r.status}`);
      setStatus("✓ Proof sent. It’s used automatically (phone registration or help-desk check).");
      setTimeout(onDone, 2500);
    } catch (e) {
      setStatus(`Couldn't send the proof: ${e.message}`);
    }
  };
  return (
    <div style={S.box}>
      <div style={S.label}>Proving for</div>
      <div style={S.big}>{nameOf(req.signal) || short(req.signal)}</div>
      <div style={S.small}>wallet {short(req.signal)}</div>
      <div style={{ margin: "16px 0" }}>
        <LaptopProver signal={req.signal} seed={req.seed} onProof={relay} onUnavailable={() => setBrowser(true)} label="Upload the fan’s Aadhaar Secure QR" />
      </div>
      {status && <p style={S.small}>{status}</p>}
    </div>
  );
}

function BrowserProver({ req, onDone }) {
  const [aa, startReq] = useAnonAadhaar();
  const [, latest] = useProver();
  const sent = useRef(false);
  const [status, setStatus] = useState("");
  const p = aa.status === "logged-in" ? latest?.proof : null;
  const bound = p && String(p.signalHash) === String(aaHash(req.signal)) && String(p.nullifierSeed) === String(req.seed);

  useEffect(() => {
    if (!bound || sent.current) return;
    sent.current = true;
    const msg = {
      type: "proof",
      nullifier: String(p.nullifier),
      timestamp: String(p.timestamp),
      revealArray: [p.ageAbove18, p.gender, p.pincode, p.state].map(String),
      groth16Proof: packGroth16Proof(p.groth16Proof).map(String),
    };
    fetch(`/api/proof/${req.signal}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(msg) })
      .then((r) => {
        if (!r.ok) throw new Error(`relay said ${r.status}`);
        setStatus("✓ Proof sent to the phone. It will register automatically.");
        startReq({ type: "logout" }); // forget this fan's proof state in this browser
        setTimeout(onDone, 2500);
      })
      .catch((e) => { sent.current = false; setStatus(`Couldn't send the proof: ${e.message}`); });
  }, [bound, p]);

  return (
    <div style={S.box}>
      <div style={S.label}>Proving for</div>
      <div style={S.big}>{nameOf(req.signal) || short(req.signal)}</div>
      <div style={S.small}>wallet {short(req.signal)} · event seed {req.seed}</div>
      <div style={{ margin: "16px 0" }}>
        <LogInWithAnonAadhaar nullifierSeed={BigInt(req.seed)} signal={req.signal} />
      </div>
      <p style={S.small}>
        {status ||
          (aa.status === "logging-in" ? "Generating the proof in this browser… about 2–5 minutes the first time (downloads the 280 MB proving key once, then it's cached)."
            : aa.status === "logged-in" && !bound ? "That proof is for a different wallet or event. Log out and try again."
            : "Click Login, upload the fan's Aadhaar Secure QR (screenshot from mAadhaar or e-Aadhaar).")}
      </p>
      {aa.status === "logged-in" && !bound && (
        <button style={S.btn} onClick={() => { sent.current = false; startReq({ type: "logout" }); }}>Log out</button>
      )}
    </div>
  );
}

function App() {
  const [mode, setMode] = useState(null);
  const [reqs, setReqs] = useState([]);
  const [active, setActive] = useState(null);

  useEffect(() => {
    fetch("/mobile-deployment.json", { cache: "no-store" }).then((r) => r.json())
      .then((d) => setMode(d.aadhaarMode === "test" ? "test" : "real")).catch(() => setMode("real"));
  }, []);
  useEffect(() => {
    const tick = () => fetch("/api/proof-requests", { cache: "no-store" }).then((r) => r.json()).then(setReqs).catch(() => {});
    tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, []);

  if (!mode) return <div style={S.wrap}>Loading…</div>;
  return (
    <div style={S.wrap}>
      <div style={{ ...S.badge, color: mode === "real" ? C.good : C.amber }}>LAPTOP PROVER · {mode === "real" ? "REAL AADHAAR" : "TEST MODE"}</div>
      <h1 style={S.h1}>Generate a fan’s Aadhaar proof on this laptop</h1>
      <p style={S.p}>
        Phones can’t comfortably run the 584 MB proving step, so they ask for help here. The QR is read <b>only inside this
        browser tab</b>; the phone receives just the zero-knowledge proof, which is locked to its own wallet. Nobody else can use it.
      </p>

      {active ? (
        <AnonAadhaarProvider key={active.signal} _useTestAadhaar={mode === "test"} _appName="Fair Tickets">
          <Prover req={active} onDone={() => setActive(null)} />
          <button style={S.link} onClick={() => setActive(null)}>← back to waiting phones</button>
        </AnonAadhaarProvider>
      ) : (
        <div style={S.box}>
          <div style={S.label}>Phones waiting for a proof</div>
          {reqs.length === 0 && <p style={S.small}>None yet. On the phone: Verify → “Phone too slow? Prove on the laptop”.</p>}
          {reqs.map((r) => (
            <button key={r.signal} style={S.req} onClick={() => setActive(r)}>
              <b>{nameOf(r.signal) || short(r.signal)}</b>
              <span style={S.small}> · {short(r.signal)} · waiting {Math.max(0, Math.round((Date.now() - r.at) / 1000))}s</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Bright theme, same palette as the website (styles.css).
const C = { bg: "#F5F7FB", card: "#FFFFFF", line: "#DFE5EF", ink: "#18213A", muted: "#5D6781", accent: "#3D5AFE", soft: "#EBEFFF", good: "#0E9F6E", amber: "#A86200" };
const S = {
  wrap: { fontFamily: "Inter, Arial, sans-serif", color: C.ink, background: C.bg, minHeight: "100vh", padding: "32px 20px", boxSizing: "border-box", maxWidth: 640, margin: "0 auto" },
  badge: { fontSize: 12, letterSpacing: "0.15em", fontWeight: 700 },
  h1: { fontFamily: "'Space Grotesk', Arial", fontSize: 28, margin: "10px 0", color: C.ink },
  p: { color: C.muted, lineHeight: 1.55 },
  box: { background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, margin: "18px 0", boxShadow: "0 4px 16px rgba(24,33,58,0.06)" },
  label: { color: C.muted, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase" },
  big: { fontFamily: "'Space Grotesk', Arial", fontSize: 24, marginTop: 4 },
  small: { color: C.muted, fontSize: 13, lineHeight: 1.5 },
  req: { display: "block", width: "100%", textAlign: "left", marginTop: 10, padding: "12px 14px", borderRadius: 12, border: "1px solid #C9D3FF", background: C.soft, color: C.ink, fontSize: 15, cursor: "pointer" },
  btn: { marginTop: 8, padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.amber}`, background: "#FFF6E3", color: C.amber, fontSize: 14, cursor: "pointer" },
  link: { background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 14, padding: 0, fontWeight: 600 },
};

document.body.style.margin = "0";
document.body.style.background = C.bg;
createRoot(document.getElementById("root")).render(<App />);
