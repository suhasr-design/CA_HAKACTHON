import { ethers } from "ethers";
import { deployment } from "./chain";

// Rotating gate QR. Two formats are accepted:
//  v2 (compact, used by the Android app and the web simulator):  "FT2.<ticketId>.<unixSeconds>.<base64 signature>"
//     signed message: "FairTickets2|<contract>|<ticketId>|<unixSeconds>"
//     The holder is RECOVERED from the signature, so the address doesn't need to be in the QR.
//     ~110 characters -> a small, low-density QR that webcams read easily.
//  v1 (legacy JSON): { v: 1, c, t, h, ts, s }
export const ROTATE_SECONDS = 30;
export const MAX_AGE_SECONDS = 60;

const messageV1 = (c, t, h, ts) => `FairTickets|${c.toLowerCase()}|${t}|${h.toLowerCase()}|${ts}`;
const messageV2 = (c, t, ts) => `FairTickets2|${c.toLowerCase()}|${t}|${ts}`;

/**
 * Sign a fresh compact payload with the holder's private key (works offline).
 * signerOverride lets the demo build a forgery: signed by the wrong key.
 */
export async function makePayload(signer, ticketId, { ageSeconds = 0 } = {}) {
  const ts = Math.floor(Date.now() / 1000) - ageSeconds;
  const sig = await signer.signMessage(messageV2(deployment.fairTickets, ticketId, ts));
  return `FT2.${Number(ticketId)}.${ts}.${ethers.encodeBase64(sig)}`;
}

function parse(text) {
  const t = String(text).trim();
  if (t.startsWith("FT2.")) {
    const [, id, ts, b64] = t.split(".");
    if (!id || !ts || !b64) return null;
    try {
      const sig = ethers.hexlify(ethers.decodeBase64(b64));
      const signer = ethers.verifyMessage(messageV2(deployment.fairTickets, id, ts), sig);
      return { t: Number(id), ts: Number(ts), signer, claimed: null };
    } catch {
      return { t: Number(id), ts: Number(ts), signer: null, claimed: null };
    }
  }
  try {
    const p = JSON.parse(t);
    if (!p || p.v !== 1 || !p.s) return null;
    if (String(p.c).toLowerCase() !== deployment.fairTickets.toLowerCase()) return { wrongEvent: true, t: p.t };
    let signer = null;
    try { signer = ethers.verifyMessage(messageV1(p.c, p.t, p.h, p.ts), p.s); } catch {}
    return { t: Number(p.t), ts: Number(p.ts), signer, claimed: p.h };
  } catch {
    return null;
  }
}

/**
 * Gate scanner: verify a payload against the cached ticket list. No network needed.
 * @param cache  { [ticketId]: { holder, label } } downloaded before doors opened
 * @param scanned { [ticketId]: unixSeconds } tickets already let in
 */
export function verifyPayload(text, cache, scanned) {
  const p = parse(text);
  if (!p) return { ok: false, reason: "Not a Fair Tickets QR code" };
  if (p.wrongEvent) return { ok: false, reason: "Wrong event: this QR is for a different event", ticket: p.t };

  const age = Math.floor(Date.now() / 1000) - p.ts;
  if (age > MAX_AGE_SECONDS) return { ok: false, reason: `Expired QR (${age}s old): screenshot or forwarded code`, ticket: p.t };
  if (age < -30) return { ok: false, reason: "QR time is in the future: tampered clock", ticket: p.t };

  if (!p.signer) return { ok: false, reason: "Forged: invalid signature", ticket: p.t };
  if (p.claimed && p.signer.toLowerCase() !== p.claimed.toLowerCase())
    return { ok: false, reason: "Forged: not signed by the ticket holder's key", ticket: p.t };

  const entry = cache[p.t];
  if (!entry) return { ok: false, reason: "Ticket not in the valid list: fake, returned or replaced", ticket: p.t };
  if (entry.holder.toLowerCase() !== p.signer.toLowerCase())
    return { ok: false, reason: "Forged: not signed by the ticket holder's key", ticket: p.t };
  if (scanned[p.t]) return { ok: false, reason: `Already used at ${new Date(scanned[p.t] * 1000).toLocaleTimeString()}`, ticket: p.t };

  return { ok: true, reason: `Valid: seat ${entry.label || "#" + entry.seat}`, ticket: p.t, holder: p.signer };
}
