// Fan Pass page, opened by the Android app in a WebView (served by the laptop, runs on the phone).
// The Fan Pass secret never travels over the network: the app injects it into this page
// (window.FT_PASS_SECRET) before load, and only commitments and zero-knowledge proofs are sent.
//   ?mode=enroll    get a Fan Pass (once): at a kiosk with a pairing code, or on this phone
//   ?mode=register  join this event with the pass (Semaphore proof, ~1-3 s)
//   ?mode=desk      help-desk check: prove this phone holds the pass of the person at the desk
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Identity, Group, generateProof } from "@semaphore-protocol/core";
import { AnonAadhaarProvider, LogInWithAnonAadhaar, useAnonAadhaar, useProver } from "@anon-aadhaar/react";
import { hash as aaHash, packGroth16Proof } from "@anon-aadhaar/core";

const params = new URLSearchParams(window.location.search);
const mode = params.get("mode") || "enroll";
const wallet = params.get("wallet") || "";
const ARTIFACTS = { wasm: "/semaphore/semaphore-20.wasm", zkey: "/semaphore/semaphore-20.zkey" };

const post = (msg) => {
  const text = JSON.stringify(msg);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(text);
  else window.parent?.postMessage(text, "*");
};
const api = async (path, body) => {
  const r = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
};
const toJson = (p) => JSON.parse(JSON.stringify(p, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

function useIdentity() {
  const [id, setId] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let tries = 0;
    const t = setInterval(() => {
      const s = window.FT_PASS_SECRET;
      if (s) { clearInterval(t); try { setId(new Identity(s)); } catch (e) { setErr(String(e.message || e)); } }
      else if (++tries > 30) { clearInterval(t); setErr("This page must be opened from the Fair Tickets app."); }
    }, 100);
    return () => clearInterval(t);
  }, []);
  return [id, err];
}

// ---------------------------------------------------------------- enrol (once)
function Enroll({ id, dep }) {
  const [status, setStatus] = useState("checking"); // checking | choose | kiosk | phone | done
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const commitment = id.commitment.toString();

  useEffect(() => {
    api(`/api/fanpass/status?commitment=${commitment}`).then((s) => setStatus(s.member ? "done" : "choose")).catch((e) => { setErr(e.message); setStatus("choose"); });
  }, [commitment]);
  useEffect(() => {
    if (status === "done") post({ type: "pass", commitment, enrolled: true });
    if (status !== "kiosk" && status !== "phone") return;
    const t = setInterval(() => api(`/api/fanpass/status?commitment=${commitment}`).then((s) => s.member && setStatus("done")).catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [status, commitment]);

  const atKiosk = async () => {
    setErr("");
    try { setCode((await api("/api/fanpass/request", { commitment })).code); setStatus("kiosk"); } catch (e) { setErr(e.message); }
  };

  return (
    <>
      <div style={S.badge}>FAN PASS · {dep.aadhaarMode === "test" ? "TEST MODE" : "REAL AADHAAR"}</div>
      <h1 style={S.h1}>Prove you’re a real person, once</h1>
      <p style={S.p}>Your Fan Pass lets you join any event in about two seconds. You prove your Aadhaar <b>one time</b>; nobody ever learns who you are.</p>
      <div style={S.small}>Fan Pass ID <span style={S.mono}>{commitment.slice(0, 6)}…{commitment.slice(-4)}</span></div>

      {status === "checking" && <div style={S.box}>Checking your pass…</div>}
      {status === "done" && <div style={{ ...S.box, borderColor: "#A8E6CF", background: "#E6F8F1" }}><b style={{ color: C.good }}>✓ Your Fan Pass is active.</b><p style={S.small}>Returning to the app…</p></div>}

      {status === "choose" && (
        <>
          <div style={S.box}>
            <b>At a Fan Pass kiosk (recommended · 2–5 min)</b>
            <p style={S.small}>Box office, partner desk or the organiser’s laptop. You read out a code and upload your Aadhaar Secure QR there. The kiosk sends only the proof; your QR isn’t kept.</p>
            <button style={S.primary} onClick={atKiosk}>Get my Fan Pass at a kiosk</button>
          </div>
          <div style={S.box}>
            <b>On this phone</b>
            <p style={S.small}>Needs ~600 MB of memory and can take several minutes; may not finish on older phones.</p>
            <button style={S.btn} onClick={() => setStatus("phone")}>Prove on this phone</button>
          </div>
        </>
      )}
      {status === "kiosk" && (
        <div style={S.box}>
          <div style={S.small}>Show this code at the kiosk</div>
          <div style={S.code}>{code}</div>
          <p style={S.small}>⏳ Waiting for the kiosk… this page updates by itself. Kiosk page: <b>{window.location.host}/kiosk.html</b></p>
          <button style={S.btn} onClick={() => setStatus("choose")}>Back</button>
        </div>
      )}
      {status === "phone" && (
        <AnonAadhaarProvider _useTestAadhaar={dep.aadhaarMode === "test"} _appName="Fair Tickets">
          <PhoneEnroll commitment={commitment} seed={dep.fanPass.seed} onDone={() => setStatus("done")} />
        </AnonAadhaarProvider>
      )}
      {err && <p style={{ ...S.small, color: C.bad }}>{err}</p>}
    </>
  );
}

function PhoneEnroll({ commitment, seed, onDone }) {
  const [aa] = useAnonAadhaar();
  const [, latest] = useProver();
  const sent = useRef(false);
  const [msg, setMsg] = useState("");
  const p = aa.status === "logged-in" ? latest?.proof : null;
  const bound = p && String(p.signalHash) === String(aaHash(commitment)) && String(p.nullifierSeed) === String(seed);
  useEffect(() => {
    if (!bound || sent.current) return;
    sent.current = true;
    setMsg("Issuing your pass…");
    api("/api/fanpass/enroll", { commitment, proof: { nullifier: String(p.nullifier), timestamp: String(p.timestamp), revealArray: [p.ageAbove18, p.gender, p.pincode, p.state].map(String), groth16Proof: packGroth16Proof(p.groth16Proof).map(String) } })
      .then(onDone).catch((e) => { setMsg(e.message); sent.current = false; });
  }, [bound, p]);
  return (
    <div style={S.box}>
      <LogInWithAnonAadhaar nullifierSeed={BigInt(seed)} signal={commitment} />
      <p style={S.small}>{msg || (aa.status === "logging-in" ? "Generating the proof on this phone… keep the app open." : "Tap Login and choose your Aadhaar Secure QR (mAadhaar screenshot or e-Aadhaar).")}</p>
    </div>
  );
}

// ---------------------------------------------------------------- register for this event (seconds)
function Register({ id, dep }) {
  const [step, setStep] = useState("Preparing…");
  const [err, setErr] = useState("");
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const t0 = performance.now();
        setStep("Loading the list of Fan Pass holders…");
        const tree = await api("/api/fanpass/tree");
        const group = new Group(tree.leaves.map(BigInt));
        for (const i of tree.removed) group.removeMember(i);
        if (group.indexOf(id.commitment) < 0) throw new Error("Your Fan Pass isn’t active. Get it first.");
        setStep("Making your proof (zero-knowledge)…");
        const proof = await generateProof(id, group, BigInt(wallet), BigInt(dep.fanPass.passScope), dep.fanPass.treeDepth || 20, ARTIFACTS);
        const secs = ((performance.now() - t0) / 1000).toFixed(1);
        setStep(`Proof ready in ${secs}s. Registering…`);
        const r = await api("/api/pass-register", { fan: wallet, proof: toJson(proof) });
        post({ type: "registered", seconds: secs, funded: r.funded });
        setStep(`✓ Registered in ${secs}s`);
      } catch (e) {
        setErr(String(e.message || e));
        post({ type: "error", error: String(e.message || e) });
      }
    })();
  }, []);
  return (
    <>
      <div style={S.badge}>FAN PASS · JOINING THE DRAW</div>
      <h1 style={S.h1}>{err ? "Couldn’t register" : step}</h1>
      <p style={S.p}>Your proof says “I hold a Fan Pass” and gives a code unique to you <i>for this event only</i>, so you can’t enter twice and events can’t track you.</p>
      {err && <p style={{ ...S.p, color: C.bad }}>{err}</p>}
    </>
  );
}

// ---------------------------------------------------------------- help-desk ownership check
function Desk({ id, dep }) {
  const [state, setState] = useState("Preparing…");
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        // Proof of membership in a one-person group {my pass}, for this event and this wallet. The desk
        // compares it with the pass of the person who re-proved Aadhaar at the desk.
        const proof = await generateProof(id, new Group([id.commitment]), BigInt(wallet), BigInt(dep.fanPass.passScope), dep.fanPass.treeDepth || 20, ARTIFACTS);
        await api(`/api/desk-proof/${wallet}`, toJson(proof));
        setState("✓ Sent to the help desk");
        post({ type: "desk", ok: true });
      } catch (e) {
        setState(`✕ ${e.message || e}`);
      }
    })();
  }, []);
  return (<><div style={S.badge}>HELP DESK CHECK</div><h1 style={S.h1}>{state}</h1><p style={S.p}>This proves the phone holds the Fan Pass that entered the draw for this ticket. Nothing personal is shared.</p></>);
}

function Root() {
  const [id, idErr] = useIdentity();
  const [dep, setDep] = useState(null);
  useEffect(() => { fetch("/mobile-deployment.json", { cache: "no-store" }).then((r) => r.json()).then(setDep).catch(() => {}); }, []);
  return (
    <div style={S.wrap}>
      {idErr ? <p style={{ ...S.p, color: C.bad }}>{idErr}</p>
        : !id || !dep ? <p style={S.p}>Loading…</p>
        : !dep.fanPass ? <p style={S.p}>This event doesn’t use Fan Pass.</p>
        : mode === "register" ? <Register id={id} dep={dep} />
        : mode === "desk" ? <Desk id={id} dep={dep} />
        : <Enroll id={id} dep={dep} />}
    </div>
  );
}

const C = { bg: "#F5F7FB", card: "#FFFFFF", line: "#DFE5EF", ink: "#18213A", muted: "#5D6781", accent: "#3D5AFE", good: "#0E9F6E", bad: "#E0364A" };
const S = {
  wrap: { fontFamily: "Inter, Arial, sans-serif", color: C.ink, background: C.bg, minHeight: "100vh", padding: "24px 18px", boxSizing: "border-box", maxWidth: 520, margin: "0 auto", overflowWrap: "anywhere" },
  badge: { fontSize: 12, letterSpacing: "0.15em", fontWeight: 700, color: C.good },
  h1: { fontFamily: "'Space Grotesk', Arial", fontSize: 26, margin: "10px 0", color: C.ink },
  p: { color: C.muted, lineHeight: 1.5 },
  small: { color: C.muted, fontSize: 13, lineHeight: 1.5 },
  mono: { fontFamily: "ui-monospace, monospace", color: C.ink },
  box: { background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, margin: "14px 0", boxShadow: "0 4px 16px rgba(24,33,58,0.06)" },
  code: { fontFamily: "'Space Grotesk', Arial", fontSize: 44, fontWeight: 700, letterSpacing: "0.2em", color: C.accent, textAlign: "center", margin: "8px 0" },
  primary: { marginTop: 8, padding: "12px 16px", borderRadius: 10, border: "none", background: C.accent, color: "#fff", fontSize: 15, fontWeight: 600, width: "100%" },
  btn: { marginTop: 8, padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.line}`, background: C.card, color: C.ink, fontSize: 14, width: "100%" },
};

document.body.style.margin = "0";
document.body.style.background = C.bg;
createRoot(document.getElementById("root")).render(<Root />);
