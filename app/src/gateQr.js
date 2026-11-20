import { ethers } from "ethers";
import { deployment } from "./chain";

// Rotating QR payload: { v, c: contract, t: ticketId, h: holder, ts: unix seconds, s: signature }
export const ROTATE_SECONDS = 30;
export const MAX_AGE_SECONDS = 60;

const message = (c, t, h, ts) => `FairTickets|${c.toLowerCase()}|${t}|${h.toLowerCase()}|${ts}`;

/** Fan's phone: sign a fresh payload with the holder's private key (works offline). */
export async function makePayload(signer, ticketId, { ageSeconds = 0, holderOverride } = {}) {
  const c = deployment.fairTickets;
  const h = holderOverride || signer.address;
  const ts = Math.floor(Date.now() / 1000) - ageSeconds;
  const s = await signer.signMessage(message(c, ticketId, h, ts));
  return JSON.stringify({ v: 1, c, t: Number(ticketId), h, ts, s });
}

/**
 * Gate scanner: verify a payload against the cached ticket list. No network needed.
 * @param cache  { [ticketId]: { holder, label } } downloaded before doors opened
 * @param scanned { [ticketId]: unixSeconds } tickets already let in
 */
export function verifyPayload(text, cache, scanned) {
  let p;
  try {
    p = JSON.parse(text);
  } catch {
    return { ok: false, reason: "Not a Fair Tickets QR code" };
  }
  if (!p || p.v !== 1 || !p.s) return { ok: false, reason: "Not a Fair Tickets QR code" };
  if (String(p.c).toLowerCase() !== deployment.fairTickets.toLowerCase())
    return { ok: false, reason: "Wrong event: this QR is for a different event" };

  const age = Math.floor(Date.now() / 1000) - Number(p.ts);
  if (age > MAX_AGE_SECONDS) return { ok: false, reason: `Expired QR (${age}s old): screenshot or forwarded code`, ticket: p.t };
  if (age < -30) return { ok: false, reason: "QR time is in the future: tampered clock", ticket: p.t };

  let signer;
  try {
    signer = ethers.verifyMessage(message(p.c, p.t, p.h, p.ts), p.s);
  } catch {
    return { ok: false, reason: "Forged: invalid signature", ticket: p.t };
  }
  if (signer.toLowerCase() !== String(p.h).toLowerCase())
    return { ok: false, reason: "Forged: not signed by the ticket holder's key", ticket: p.t };

  const entry = cache[p.t];
  if (!entry) return { ok: false, reason: "Ticket not in the valid list: fake, returned or replaced", ticket: p.t };
  if (entry.holder.toLowerCase() !== signer.toLowerCase())
    return { ok: false, reason: "Not this person's ticket", ticket: p.t };
  if (scanned[p.t]) return { ok: false, reason: `Already used at ${new Date(scanned[p.t] * 1000).toLocaleTimeString()}`, ticket: p.t };

  return { ok: true, reason: `Valid: seat ${entry.label || "#" + entry.seat}`, ticket: p.t, holder: signer };
}
