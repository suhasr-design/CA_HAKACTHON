import { ethers } from "ethers";
import { deployment } from "./chain";

// Gate QR formats:
//  v3 (challenge-response, default at our gates):  "FT3.<ticketId>.<gateCode>.<base64 signature>"
//     signed message: "FairTickets3|<contract>|<ticketId>|<gateCode>"
//     The gate shows a 4-digit code that changes every 20 s. The fan's app signs THAT code, so a QR
//     can't be prepared in advance, screenshotted, or relayed from elsewhere later. The gate checks the
//     code against its own clock, so a wrong phone clock doesn't matter.
//  v2 (time-based):  "FT2.<ticketId>.<unixSeconds>.<base64 signature>" — accepted only when the gate
//     code is switched off (e.g. self-service lanes).
//  v1 (legacy JSON) — same rule as v2.
// In every format the holder is RECOVERED from the signature and must match the ticket list.
export const ROTATE_SECONDS = 30;
export const MAX_AGE_SECONDS = 60;
export const GATE_CODE_SECONDS = 20;

const messageV1 = (c, t, h, ts) => `FairTickets|${c.toLowerCase()}|${t}|${h.toLowerCase()}|${ts}`;
const messageV2 = (c, t, ts) => `FairTickets2|${c.toLowerCase()}|${t}|${ts}`;
const messageV3 = (c, t, code) => `FairTickets3|${c.toLowerCase()}|${t}|${code}`;

/** A fresh random 4-digit gate code. */
export const newGateCode = () => String(Math.floor(1000 + Math.random() * 9000));

/**
 * Build a payload signed by `signer` (used by the stage simulator; the Android app does the same).
 * With `code`: v3 challenge-response. Without: v2, optionally aged to fake a screenshot.
 */
export async function makePayload(signer, ticketId, { ageSeconds = 0, code = null } = {}) {
  if (code) {
    const sig = await signer.signMessage(messageV3(deployment.fairTickets, ticketId, code));
    return `FT3.${Number(ticketId)}.${code}.${ethers.encodeBase64(sig)}`;
  }
  const ts = Math.floor(Date.now() / 1000) - ageSeconds;
  const sig = await signer.signMessage(messageV2(deployment.fairTickets, ticketId, ts));
  return `FT2.${Number(ticketId)}.${ts}.${ethers.encodeBase64(sig)}`;
}

const recover = (msg, b64) => {
  try { return ethers.verifyMessage(msg, ethers.hexlify(ethers.decodeBase64(b64))); } catch { return null; }
};

function parse(text) {
  const t = String(text).trim();
  if (t.startsWith("FT3.")) {
    const [, id, code, b64] = t.split(".");
    if (!id || !code || !b64) return null;
    return { v: 3, t: Number(id), code, signer: recover(messageV3(deployment.fairTickets, id, code), b64) };
  }
  if (t.startsWith("FT2.")) {
    const [, id, ts, b64] = t.split(".");
    if (!id || !ts || !b64) return null;
    return { v: 2, t: Number(id), ts: Number(ts), signer: recover(messageV2(deployment.fairTickets, id, ts), b64) };
  }
  try {
    const p = JSON.parse(t);
    if (!p || p.v !== 1 || !p.s) return null;
    if (String(p.c).toLowerCase() !== deployment.fairTickets.toLowerCase()) return { wrongEvent: true, t: p.t };
    let signer = null;
    try { signer = ethers.verifyMessage(messageV1(p.c, p.t, p.h, p.ts), p.s); } catch {}
    return { v: 1, t: Number(p.t), ts: Number(p.ts), signer, claimed: p.h };
  } catch {
    return null;
  }
}

/**
 * Gate scanner check against the cached ticket list (no blockchain needed).
 * @param cache   { [ticketId]: { holder, label } } downloaded before doors opened
 * @param scanned { [ticketId]: { gate, at } | unixSeconds } tickets already let in (all synced gates)
 * @param opts    { codes: [current, previous], requireCode: boolean }
 */
export function verifyPayload(text, cache, scanned, { codes = [], requireCode = false } = {}) {
  const p = parse(text);
  if (!p) return { ok: false, reason: "Not a Fair Tickets QR code" };
  if (p.wrongEvent) return { ok: false, reason: "Wrong event: this QR is for a different event", ticket: p.t };

  if (p.v === 3) {
    if (!codes.includes(p.code)) return { ok: false, reason: "Wrong or expired gate code: this QR wasn’t made at this gate just now (relayed or old)", ticket: p.t };
  } else {
    if (requireCode) return { ok: false, reason: "Gate code required: enter the code shown at the gate in your app", ticket: p.t };
    const age = Math.floor(Date.now() / 1000) - p.ts;
    if (age > MAX_AGE_SECONDS) return { ok: false, reason: `Expired QR (${age}s old): screenshot or forwarded code`, ticket: p.t };
    if (age < -30) return { ok: false, reason: "QR time is in the future: tampered clock", ticket: p.t };
  }

  if (!p.signer) return { ok: false, reason: "Forged: invalid signature", ticket: p.t };
  if (p.claimed && p.signer.toLowerCase() !== p.claimed.toLowerCase())
    return { ok: false, reason: "Forged: not signed by the ticket holder’s key", ticket: p.t };

  const entry = cache[p.t];
  if (!entry) return { ok: false, reason: "Ticket not in the valid list: fake, returned or replaced", ticket: p.t };
  if (entry.holder.toLowerCase() !== p.signer.toLowerCase())
    return { ok: false, reason: "Forged: not signed by the ticket holder’s key", ticket: p.t };
  const used = scanned[p.t];
  if (used) {
    const at = typeof used === "object" ? used.at : used;
    const where = typeof used === "object" && used.gate ? ` at ${used.gate}` : "";
    return { ok: false, reason: `Already entered${where} at ${new Date(at * 1000).toLocaleTimeString()}`, ticket: p.t };
  }
  return { ok: true, reason: `Valid: seat ${entry.label || "#" + entry.seat}`, ticket: p.t, holder: p.signer };
}
