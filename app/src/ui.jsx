import React, { createContext, useCallback, useContext, useState } from "react";
import confetti from "canvas-confetti";
import { EXPLAIN } from "./explain";
import { PHASES } from "./chain";

// ---------------------------------------------------------------- presenter notes
export const ExplainCtx = createContext(false);

export function Explain({ id }) {
  const on = useContext(ExplainCtx);
  const e = EXPLAIN[id];
  if (!on || !e) return null;
  return (
    <div className="explain">
      <div className="explain-h">🎤 Presenter notes</div>
      <p><b>What it shows:</b> {e.shows}</p>
      <p><b>Say:</b> “{e.say}”</p>
    </div>
  );
}

// ---------------------------------------------------------------- toasts
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((x) => [...x, { id, ...t }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), t.ok ? 3500 : 6000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.ok ? "toast-ok" : "toast-bad"}`}>
            <span className="toast-i">{t.ok ? "✓" : "✕"}</span>
            <div>
              <div className="toast-t">{t.title}</div>
              {t.body && <div className="toast-b">{t.body}</div>}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------- building blocks
export function Card({ title, icon, right, children, className = "", explain }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <div className="card-h">
          <h2>{icon && <span className="card-icon">{icon}</span>}{title}</h2>
          {right}
        </div>
      )}
      {children}
      {explain && <Explain id={explain} />}
    </section>
  );
}

export function Stat({ label, value, sub, tone = "" }) {
  return (
    <div className={`stat ${tone}`}>
      <div className="stat-v">{value}</div>
      <div className="stat-l">{label}</div>
      {sub && <div className="stat-s">{sub}</div>}
    </div>
  );
}

const AVATAR_COLORS = ["#3D5AFE", "#E64980", "#0E9F6E", "#E8930C", "#1C9AD6", "#7B5CFF", "#2F9E44", "#F76707"];
export function Avatar({ name, size = 32 }) {
  const c = AVATAR_COLORS[[...name].reduce((s, ch) => s + ch.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return (
    <span className="avatar" style={{ width: size, height: size, background: c, fontSize: size * 0.42 }}>
      {name === "Scalper" ? "🤖" : name.slice(0, 1)}
    </span>
  );
}

export function KindBadge({ kind }) {
  if (kind === "zk") return <span className="badge badge-zk" title="Registered with a real Anon Aadhaar zero-knowledge proof">ZK proof ✓</span>;
  if (kind === "synthetic") return <span className="badge badge-syn" title="Synthetic demo account">synthetic</span>;
  if (kind === "pass") return <span className="badge badge-zk" title="Registered with a Fan Pass (Aadhaar proved once, Semaphore proof per event)">Fan Pass ✓</span>;
  if (kind === "assisted") return <span className="badge badge-asst" title="Registered at the in-person ID desk (capped, public quota)">ID desk</span>;
  return null;
}

/** Circular countdown ring. */
export function Ring({ left, total, size = 54, children }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, left / total));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" />
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-fg"
          strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="ring-t">{children}</div>
    </div>
  );
}

export function PhaseStepper({ phase }) {
  const steps = [
    { p: 1, label: "Registration" },
    { p: 2, label: "Randomness" },
    { p: 3, label: "Shuffle" },
    { p: 4, label: "Sale & buyback" },
  ];
  return (
    <ol className="phases">
      {steps.map((s) => (
        <li key={s.p} className={phase > s.p ? "done" : phase === s.p ? "now" : ""}>
          <span className="phase-dot">{phase > s.p ? "✓" : s.p}</span>
          <span>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}
export const phaseName = (p) => PHASES[p];

// ---------------------------------------------------------------- effects
export function celebrate() {
  try {
    confetti({ particleCount: 140, spread: 75, origin: { y: 0.6 }, colors: ["#3D5AFE", "#0FA88A", "#E8930C", "#F2557A"] });
  } catch {}
}

let audioCtx;
export function beep(ok) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = ok ? "sine" : "square";
    o.frequency.value = ok ? 880 : 180;
    g.gain.setValueAtTime(0.08, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + (ok ? 0.25 : 0.45));
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + (ok ? 0.25 : 0.45));
  } catch {}
}
