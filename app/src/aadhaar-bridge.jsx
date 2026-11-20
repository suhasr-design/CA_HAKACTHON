// Anon Aadhaar bridge for the Fair Tickets Android app.
// The official Anon Aadhaar prover runs in a browser engine, so the mobile app opens this
// page in a WebView. It makes a REAL zero-knowledge proof bound to the fan's wallet (signal)
// and the event (nullifier seed), then hands it back to the app, which sends the registration
// transaction itself.
//
// Mode comes from the deployment the laptop is serving (/mobile-deployment.json):
//   real -> genuine Aadhaar Secure QR, checked against UIDAI's real signing keys
//   test -> Anon Aadhaar test QR (rehearsals only)
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnonAadhaarProvider, LogInWithAnonAadhaar, useAnonAadhaar, useProver } from "@anon-aadhaar/react";
import { hash as aaHash, packGroth16Proof } from "@anon-aadhaar/core";

const params = new URLSearchParams(window.location.search);
const signal = params.get("signal") || "";
const seed = params.get("seed") || "0";

const send = (msg) => {
  const text = JSON.stringify(msg);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(text);
  else window.parent?.postMessage(text, "*");
};

// "Prove on the laptop": ask the laptop prover page for a proof bound to this wallet and poll for it.
function LaptopProof() {
  const [state, setState] = useState("idle"); // idle | waiting | done | error
  const sent = useRef(false);
  useEffect(() => {
    if (state !== "waiting") return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/proof/${signal}`, { cache: "no-store" });
        if (r.status !== 200 || sent.current) return;
        sent.current = true;
        send(await r.json());
        setState("done");
      } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, [state]);
  const start = async () => {
    try {
      const r = await fetch("/api/proof-request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signal, seed }) });
      setState(r.ok ? "waiting" : "error");
    } catch { setState("error"); }
  };
  return (
    <div style={S.help}>
      <b>Phone too slow? Prove on the laptop</b>
      <p style={{ margin: "6px 0" }}>The proving step needs ~600 MB of memory. A laptop does it in 2–5 minutes; the proof comes back here, locked to this wallet.</p>
      {state === "idle" && <button style={{ ...S.btn, borderColor: "#8F86FF", color: "#8F86FF" }} onClick={start}>Prove on the laptop</button>}
      {state === "waiting" && (
        <p style={{ margin: "6px 0", color: "#F2EFFF" }}>
          ⏳ Waiting… On the laptop open <b>{window.location.host}/prove.html</b>, pick this wallet ({signal.slice(0, 6)}…{signal.slice(-4)}) and upload the Aadhaar QR there.
        </p>
      )}
      {state === "done" && <p style={{ margin: "6px 0", color: "#2BD4A4" }}>✓ Proof received from the laptop. Returning to the app…</p>}
      {state === "error" && <p style={{ margin: "6px 0", color: "#FF6B8B" }}>Couldn't reach the laptop. <button style={S.btn} onClick={start}>Try again</button></p>}
    </div>
  );
}

function Bridge({ real }) {
  const [aa, startReq] = useAnonAadhaar();
  const [, latest] = useProver();
  const sent = useRef(false);
  const p = aa.status === "logged-in" ? latest?.proof : null;
  const bound = p && String(p.signalHash) === String(aaHash(signal)) && String(p.nullifierSeed) === String(seed);

  useEffect(() => {
    if (!bound || sent.current) return;
    sent.current = true;
    send({
      type: "proof",
      nullifier: String(p.nullifier),
      timestamp: String(p.timestamp),
      revealArray: [p.ageAbove18, p.gender, p.pincode, p.state].map(String),
      groth16Proof: packGroth16Proof(p.groth16Proof).map(String),
    });
  }, [bound, p]);

  return (
    <div style={S.wrap}>
      <div style={{ ...S.badge, color: real ? "#2BD4A4" : "#FFB547" }}>
        ANON AADHAAR · {real ? "REAL AADHAAR" : "TEST MODE"}
      </div>
      <h1 style={S.h1}>Prove you’re a real, unique person</h1>
      {real ? (
        <p style={S.p}>
          Upload your <b>Aadhaar Secure QR</b>. Your phone checks UIDAI’s signature and creates a
          zero-knowledge proof <b>on this device</b>. Nothing from your Aadhaar leaves the phone: the event
          only learns “unique, UIDAI-verified person”, never your name, number, address or photo.
        </p>
      ) : (
        <p style={S.p}>Upload a <b>test</b> Aadhaar QR. Your phone creates a zero-knowledge proof. The event learns only that you are a unique resident.</p>
      )}
      <div style={S.box}>
        <LogInWithAnonAadhaar nullifierSeed={BigInt(seed)} signal={signal} />
        <p style={S.small}>
          {aa.status === "logging-in" ? "Generating your proof on this phone… this can take 1–2 minutes. Keep the app open."
            : bound ? "✓ Proof ready. Returning to the app…"
            : aa.status === "logged-in" ? "This proof belongs to another wallet or event."
            : real ? "Tap Login, then choose a screenshot or photo of your Aadhaar Secure QR."
            : "Tap Login, then choose your test QR image."}
        </p>
        {p && !bound && <button style={S.btn} onClick={() => { sent.current = false; startReq({ type: "logout" }); }}>Clear and prove again</button>}
      </div>
      <LaptopProof />
      {real ? (
        <div style={S.help}>
          <b>Where do I get my Secure QR?</b>
          <ol style={S.ol}>
            <li><b>mAadhaar app</b> → My Aadhaar → <b>Show QR Code</b> → take a screenshot.</li>
            <li>Or <b>e-Aadhaar PDF</b> from myaadhaar.uidai.gov.in → the large QR code on the PDF (screenshot or crop it).</li>
          </ol>
          The old printed QR on PVC/paper cards from before 2019 doesn't contain a UIDAI signature and won't work.
        </div>
      ) : (
        <p style={S.small}>No test QR? Generate one at documentation.anon-aadhaar.pse.dev/docs/generate-qr.</p>
      )}
      <p style={{ ...S.small, wordBreak: "break-all" }}>Bound to wallet {signal.slice(0, 8)}…{signal.slice(-6)}</p>
    </div>
  );
}

function Root() {
  const forced = params.get("mode");
  const [mode, setMode] = useState(forced === "real" || forced === "test" ? forced : null);
  useEffect(() => {
    if (mode) return;
    fetch("/mobile-deployment.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setMode(d.aadhaarMode === "test" ? "test" : "real"))
      .catch(() => setMode("real"));
  }, [mode]);
  if (!mode) return <div style={S.wrap}><p style={S.p}>Loading…</p></div>;
  const real = mode === "real";
  // key forces a fresh provider (and prover state) if the mode ever changes
  return (
    <AnonAadhaarProvider key={mode} _useTestAadhaar={!real} _appName="Fair Tickets">
      <Bridge real={real} />
    </AnonAadhaarProvider>
  );
}

const S = {
  wrap: { fontFamily: "Inter, Arial, sans-serif", color: "#F2EFFF", background: "#0C0A1D", minHeight: "100vh", padding: "24px 18px", boxSizing: "border-box", width: "100%", maxWidth: 520, margin: "0 auto", overflowWrap: "anywhere" },
  badge: { fontSize: 12, letterSpacing: "0.15em", fontWeight: 700 },
  h1: { fontFamily: "'Space Grotesk', Arial", fontSize: 26, margin: "10px 0" },
  p: { color: "#A7A0D2", lineHeight: 1.5 },
  box: { background: "#17133A", border: "1px solid #2C2660", borderRadius: 16, padding: 16, margin: "16px 0" },
  help: { background: "#121030", border: "1px solid #2C2660", borderRadius: 14, padding: 14, color: "#A7A0D2", fontSize: 13, lineHeight: 1.55, marginBottom: 12 },
  ol: { margin: "8px 0", paddingLeft: 18 },
  small: { color: "#A7A0D2", fontSize: 13, lineHeight: 1.5 },
  btn: { marginTop: 8, padding: "10px 14px", borderRadius: 10, border: "1px solid #FFB547", background: "transparent", color: "#FFB547", fontSize: 14 },
};

document.body.style.margin = "0";
document.body.style.background = "#0C0A1D";
document.documentElement.style.overflowX = "hidden";
document.body.style.overflowX = "hidden";
createRoot(document.getElementById("root")).render(<Root />);
