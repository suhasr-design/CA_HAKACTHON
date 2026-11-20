// Anon Aadhaar bridge for the Fair Tickets Android app.
// The official Anon Aadhaar prover runs in a browser engine, so the mobile app opens this
// page in a WebView. It makes a REAL zero-knowledge proof (test mode) bound to the fan's
// wallet (signal) and the event (nullifier seed), then hands it back to the app, which
// sends the registration transaction itself.
import React, { useEffect, useRef } from "react";
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

function Bridge() {
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
      <div style={S.badge}>ANON AADHAAR · TEST MODE</div>
      <h1 style={S.h1}>Prove you’re a real, unique person</h1>
      <p style={S.p}>Upload a <b>test</b> Aadhaar QR. Your phone creates a zero-knowledge proof. The event learns only that you are a unique resident, not your name or Aadhaar number.</p>
      <div style={S.box}>
        <LogInWithAnonAadhaar nullifierSeed={BigInt(seed)} signal={signal} />
        <p style={S.small}>
          {aa.status === "logging-in" ? "Generating your proof… the first one can take a minute."
            : bound ? "✓ Proof ready. Returning to the app…"
            : aa.status === "logged-in" ? "This proof belongs to another wallet or event."
            : "Tap Login, then choose your test QR image."}
        </p>
        {p && !bound && <button style={S.btn} onClick={() => { sent.current = false; startReq({ type: "logout" }); }}>Clear and prove again</button>}
      </div>
      <p style={S.small}>No test QR? Generate one at documentation.anon-aadhaar.pse.dev/docs/generate-qr. Test data only; never use a real Aadhaar.</p>
      <p style={{ ...S.small, wordBreak: "break-all" }}>Bound to wallet {signal.slice(0, 8)}…{signal.slice(-6)}</p>
    </div>
  );
}

const S = {
  wrap: { fontFamily: "Inter, Arial, sans-serif", color: "#F2EFFF", background: "#0C0A1D", minHeight: "100vh", padding: "24px 18px", boxSizing: "border-box", width: "100%", maxWidth: 520, margin: "0 auto", overflowWrap: "anywhere" },
  badge: { color: "#2BD4A4", fontSize: 12, letterSpacing: "0.15em", fontWeight: 700 },
  h1: { fontFamily: "'Space Grotesk', Arial", fontSize: 26, margin: "10px 0" },
  p: { color: "#A7A0D2", lineHeight: 1.5 },
  box: { background: "#17133A", border: "1px solid #2C2660", borderRadius: 16, padding: 16, margin: "16px 0" },
  small: { color: "#A7A0D2", fontSize: 13, lineHeight: 1.5 },
  btn: { marginTop: 8, padding: "10px 14px", borderRadius: 10, border: "1px solid #FFB547", background: "transparent", color: "#FFB547", fontSize: 14 },
};

document.body.style.margin = "0";
document.body.style.background = "#0C0A1D";
document.documentElement.style.overflowX = "hidden";
document.body.style.overflowX = "hidden";
createRoot(document.getElementById("root")).render(
  <AnonAadhaarProvider _useTestAadhaar={true} _appName="Fair Tickets">
    <Bridge />
  </AnonAadhaarProvider>
);
