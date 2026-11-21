// Upload an Aadhaar Secure QR image -> read it in this browser -> prove on THIS laptop's prover (single-
// threaded Node, ~1.5 min, no browser memory limits). Only the decoded QR number goes to the local prover;
// it is not stored and is discarded once the proof is made.
import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

const EST_SECONDS = 90;
const STAGES = { queued: "Waiting for the prover…", signature: "Checking UIDAI’s signature…", witness: "Preparing the proof…", proving: "Making the zero-knowledge proof…", verifying: "Double-checking the proof…" };

/** Reads the QR from an image file, trying the full image and a 2x upscale for small screenshots. */
async function readQr(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    for (const scale of [1, 2, 0.5]) {
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      if (w < 100 || w > 5000) continue;
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, w, h);
      const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" });
      if (r?.data) return r.data.trim();
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function LaptopProver({ signal, seed, onProof, onUnavailable, label = "Upload the Aadhaar Secure QR" }) {
  const [state, setState] = useState({ step: "idle" }); // idle | reading | proving | error
  const [elapsed, setElapsed] = useState(0);
  const fileRef = useRef(null);
  const job = useRef(null);

  useEffect(() => {
    if (state.step !== "proving") return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/laptop-prove/${job.current}`, { cache: "no-store" });
        const j = await r.json();
        setElapsed(j.elapsed || 0);
        if (j.status === "done") { setState({ step: "done", seconds: j.seconds }); onProof(j.proof, j.seconds); }
        else if (j.status === "error") setState({ step: "error", error: j.error });
        else setState((s) => ({ ...s, stage: j.stage }));
      } catch { /* keep polling */ }
    }, 1500);
    return () => clearInterval(t);
  }, [state.step]);

  const pick = async (file) => {
    if (!file) return;
    setState({ step: "reading" });
    const qrData = await readQr(file).catch(() => null);
    if (fileRef.current) fileRef.current.value = ""; // drop the image from the page
    if (!qrData) return setState({ step: "error", error: "Couldn’t find a QR code in that image. Use a sharp, uncropped screenshot of the Secure QR." });
    if (!/^\d{100,}$/.test(qrData)) return setState({ step: "error", error: "That QR isn’t an Aadhaar Secure QR. Use mAadhaar → Show QR Code, or the QR on the e-Aadhaar PDF." });
    const r = await fetch("/api/laptop-prove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ qrData, signal, seed }) }).catch(() => null);
    if (r?.status === 403) { setState({ step: "idle" }); onUnavailable?.(); return; }
    const j = await r?.json().catch(() => ({}));
    if (!r?.ok) return setState({ step: "error", error: j?.error || "The laptop prover isn’t reachable." });
    job.current = j.id;
    setElapsed(0);
    setState({ step: "proving", stage: "queued" });
  };

  const pct = Math.min(97, Math.round((elapsed / EST_SECONDS) * 100));
  return (
    <div>
      {(state.step === "idle" || state.step === "error") && (
        <>
          <label style={S.upload}>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => pick(e.target.files?.[0])} />
            📷 {label}
          </label>
          <p style={S.small}>mAadhaar → Show QR Code (screenshot), or the big QR on the e-Aadhaar PDF.</p>
        </>
      )}
      {state.step === "reading" && <p style={S.small}>Reading the QR…</p>}
      {state.step === "proving" && (
        <div>
          <div style={S.stage}>{STAGES[state.stage] || "Working…"}</div>
          <div style={S.bar}><div style={{ ...S.fill, width: `${pct}%` }} /></div>
          <p style={S.small}>{elapsed}s · usually about {EST_SECONDS}s on this laptop. The QR stays on this laptop and is discarded after the proof.</p>
        </div>
      )}
      {state.step === "done" && <p style={{ ...S.small, color: "#0E9F6E", fontWeight: 600 }}>✓ Proof made in {state.seconds}s</p>}
      {state.step === "error" && <p style={{ ...S.small, color: "#E0364A" }}>✕ {state.error}</p>}
    </div>
  );
}

const S = {
  upload: { display: "inline-block", padding: "14px 22px", borderRadius: 14, background: "#3D5AFE", color: "#fff", fontSize: 18, fontWeight: 700, cursor: "pointer" },
  small: { color: "#5D6781", fontSize: 14, lineHeight: 1.5 },
  stage: { fontFamily: "'Space Grotesk', Arial", fontSize: 20, fontWeight: 700, color: "#18213A" },
  bar: { height: 10, borderRadius: 999, background: "#E2E8F2", overflow: "hidden", margin: "12px 0 6px" },
  fill: { height: "100%", background: "linear-gradient(90deg, #3D5AFE, #0FA88A)", transition: "width 1.2s linear" },
};
