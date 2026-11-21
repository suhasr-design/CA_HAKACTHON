// Fan Pass kiosk: a box-office counter, partner desk, college fest desk or the organiser's laptop.
// 1. The fan reads out the 6-character code from their phone.
// 2. They upload their Aadhaar Secure QR HERE; the zero-knowledge proof is made in this browser.
// 3. Only the proof (bound to the fan's Fan Pass ID) goes to the blockchain; the kiosk pays the gas.
// 4. The kiosk wipes the session and is ready for the next fan.
// The QR never leaves this browser tab and nothing personal is stored.
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnonAadhaarProvider, LogInWithAnonAadhaar, useAnonAadhaar, useProver } from "@anon-aadhaar/react";
import { hash as aaHash, packGroth16Proof } from "@anon-aadhaar/core";
import LaptopProver from "./laptopProver.jsx";

const KIOSK = new URLSearchParams(window.location.search).get("name") || "Fan Pass kiosk";
const api = async (path, body) => {
  const r = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
};

// Default: prove on this laptop's prover (~1.5 min, reliable). A kiosk running on another computer
// can't use it and falls back to the in-browser prover (BrowserProve below).
function Prove({ req, onIssued, onCancel }) {
  const [browser, setBrowser] = useState(false);
  const [msg, setMsg] = useState("");
  if (browser) return <BrowserProve req={req} onIssued={onIssued} onCancel={onCancel} />;
  const enroll = async (proof) => {
    setMsg("Issuing the Fan Pass on the blockchain…");
    try {
      onIssued(await api("/api/fanpass/enroll", { commitment: req.commitment, proof }));
    } catch (e) {
      setMsg(`✕ ${e.message}`);
    }
  };
  return (
    <div style={S.card}>
      <div style={S.step}>STEP 2 OF 3</div>
      <h2 style={S.h2}>Upload the fan’s Aadhaar Secure QR</h2>
      <div style={{ margin: "18px 0" }}>
        <LaptopProver signal={req.commitment} seed={req.seed} onProof={enroll} onUnavailable={() => setBrowser(true)} />
      </div>
      {msg && <p style={S.p}>{msg}</p>}
      <button style={S.ghost} onClick={onCancel}>Cancel and clear</button>
    </div>
  );
}

function BrowserProve({ req, onIssued, onCancel }) {
  const [aa, startReq] = useAnonAadhaar();
  const [, latest] = useProver();
  const sent = useRef(false);
  const [msg, setMsg] = useState("");
  const p = aa.status === "logged-in" ? latest?.proof : null;
  const bound = p && String(p.signalHash) === String(aaHash(req.commitment)) && String(p.nullifierSeed) === String(req.seed);

  useEffect(() => {
    if (!bound || sent.current) return;
    sent.current = true;
    setMsg("Issuing the Fan Pass on the blockchain…");
    api("/api/fanpass/enroll", {
      commitment: req.commitment,
      proof: { nullifier: String(p.nullifier), timestamp: String(p.timestamp), revealArray: [p.ageAbove18, p.gender, p.pincode, p.state].map(String), groth16Proof: packGroth16Proof(p.groth16Proof).map(String) },
    }).then((r) => { startReq({ type: "logout" }); onIssued(r); })
      .catch((e) => { startReq({ type: "logout" }); setMsg(`✕ ${e.message}`); sent.current = false; });
  }, [bound, p]);

  return (
    <div style={S.card}>
      <div style={S.step}>STEP 2 OF 3</div>
      <h2 style={S.h2}>Upload the fan’s Aadhaar Secure QR</h2>
      <p style={S.p}>mAadhaar → Show QR Code (screenshot), or the big QR on the e-Aadhaar PDF.</p>
      <div style={{ margin: "18px 0" }}><LogInWithAnonAadhaar nullifierSeed={BigInt(req.seed)} signal={req.commitment} /></div>
      <p style={S.p}>{msg || (aa.status === "logging-in"
        ? "⏳ Making the zero-knowledge proof in this browser: 2–5 minutes the first time (the proving key is cached after that)."
        : "The QR is read only inside this browser tab.")}</p>
      <button style={S.ghost} onClick={() => { startReq({ type: "logout" }); onCancel(); }}>Cancel and clear</button>
    </div>
  );
}

function Kiosk() {
  const [code, setCode] = useState("");
  const [req, setReq] = useState(null);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  const [mode, setMode] = useState("real");
  const [served, setServed] = useState(0);

  useEffect(() => { fetch("/mobile-deployment.json", { cache: "no-store" }).then((r) => r.json()).then((d) => setMode(d.aadhaarMode === "test" ? "test" : "real")).catch(() => {}); }, []);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => { setDone(null); setReq(null); setCode(""); }, 8000);
    return () => clearTimeout(t);
  }, [done]);

  const lookup = async () => {
    setErr("");
    try { setReq(await api(`/api/fanpass/request/${code.trim().toUpperCase()}`)); } catch (e) { setErr(e.message); }
  };
  const reset = () => { setReq(null); setCode(""); setErr(""); setDone(null); };

  return (
    <div style={S.wrap}>
      <div style={S.top}>
        <div><div style={S.brand}>Fair Tickets · {KIOSK}</div><div style={S.sub}>{mode === "real" ? "Real Aadhaar (UIDAI keys)" : "Test mode"} · {served} passes issued this session</div></div>
        <div style={S.privacy}>🔒 QR stays in this browser · nothing personal stored</div>
      </div>

      {done ? (
        <div style={{ ...S.card, borderColor: "#A8E6CF", background: "#E6F8F1", textAlign: "center" }}>
          <div style={{ fontSize: 64 }}>✅</div>
          <h2 style={S.h2}>Fan Pass {done.replaced ? "replaced (old phone’s pass retired)" : "issued"}</h2>
          <p style={S.p}>The fan’s phone updates by itself. They can now join any event in seconds. {done.members} Fan Pass holders in total.</p>
          <button style={S.primary} onClick={reset}>Next fan</button>
          <p style={S.small}>This screen clears itself in a few seconds.</p>
        </div>
      ) : !req ? (
        <div style={S.card}>
          <div style={S.step}>STEP 1 OF 3</div>
          <h2 style={S.h2}>Enter the code shown on the fan’s phone</h2>
          <p style={S.p}>In the app: Get Fan Pass → “Get my Fan Pass at a kiosk”.</p>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <input style={S.input} value={code} maxLength={6} placeholder="ABC123" autoFocus
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} onKeyDown={(e) => e.key === "Enter" && code.length === 6 && lookup()} />
            <button style={S.primary} disabled={code.length !== 6} onClick={lookup}>Continue</button>
          </div>
          {err && <p style={{ ...S.p, color: "#E0364A" }}>{err}</p>}
        </div>
      ) : (
        <AnonAadhaarProvider key={req.commitment} _useTestAadhaar={mode === "test"} _appName="Fair Tickets kiosk">
          <Prove req={req} onCancel={reset} onIssued={(r) => { setServed((n) => n + 1); setDone(r); }} />
        </AnonAadhaarProvider>
      )}

      <div style={S.steps}>
        {["Code from the fan’s phone", "Aadhaar Secure QR → zero-knowledge proof", "Fan Pass issued on-chain"].map((t, i) => (
          <div key={t} style={S.stepBox}><b>{i + 1}</b> {t}</div>
        ))}
      </div>
    </div>
  );
}

const S = {
  wrap: { fontFamily: "Inter, Arial, sans-serif", color: "#18213A", background: "#F5F7FB", minHeight: "100vh", padding: "28px 24px", boxSizing: "border-box", maxWidth: 820, margin: "0 auto" },
  top: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 },
  brand: { fontFamily: "'Space Grotesk', Arial", fontSize: 24, fontWeight: 700 },
  sub: { color: "#5D6781", fontSize: 13 },
  privacy: { background: "#E6F8F1", color: "#0B7A55", border: "1px solid #A8E6CF", borderRadius: 999, padding: "8px 14px", fontSize: 13, fontWeight: 600 },
  card: { background: "#FFFFFF", border: "1px solid #DFE5EF", borderRadius: 22, padding: 28, boxShadow: "0 12px 32px rgba(24,33,58,0.10)" },
  step: { color: "#0E9F6E", fontSize: 12, letterSpacing: "0.15em", fontWeight: 700 },
  h2: { fontFamily: "'Space Grotesk', Arial", fontSize: 30, margin: "8px 0" },
  p: { color: "#5D6781", fontSize: 16, lineHeight: 1.5 },
  small: { color: "#5D6781", fontSize: 13 },
  input: { flex: 1, fontFamily: "'Space Grotesk', Arial", fontSize: 40, letterSpacing: "0.25em", textAlign: "center", padding: "10px 12px", borderRadius: 14, border: "2px solid #C9D3FF", background: "#F5F7FB", color: "#18213A", minWidth: 0 },
  primary: { padding: "14px 22px", borderRadius: 14, border: "none", background: "#3D5AFE", color: "#fff", fontSize: 18, fontWeight: 700, cursor: "pointer" },
  ghost: { marginTop: 10, padding: "10px 16px", borderRadius: 12, border: "1px solid #DFE5EF", background: "#fff", color: "#18213A", fontSize: 14, cursor: "pointer" },
  steps: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginTop: 18 },
  stepBox: { background: "#fff", border: "1px solid #DFE5EF", borderRadius: 14, padding: 12, fontSize: 14, color: "#5D6781" },
};

document.body.style.margin = "0";
document.body.style.background = "#F5F7FB";
createRoot(document.getElementById("root")).render(<Kiosk />);
