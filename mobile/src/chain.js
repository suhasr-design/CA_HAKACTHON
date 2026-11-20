import { ethers } from "ethers";
import Constants from "expo-constants";

// The event config (contract address, ABI, demo keys) is NOT bundled into the app. It is
// fetched from the laptop at startup (served by the website at /mobile-deployment.json, written
// by scripts/deploy-local.js), so a fresh deployment never needs a new APK.

export const NAMES = [
  "Organiser", "Asha", "Bilal", "Chetan", "Divya", "Esha", "Farhan", "Gauri", "Harsh",
  "Isha", "Jai", "Kavya", "Lokesh", "Meera", "Nikhil", "Omkar", "Priya", "Rahul", "Sneha", "Scalper",
];
export const SCALPER = 19;
export const isSynthetic = (dep, i) => !!dep && dep.syntheticAccounts.includes(i);
export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

/**
 * The laptop running the blockchain and the website.
 * - In Expo Go: the dev server's address (hostUri) is the laptop.
 * - In the APK: the address baked in at build time (app.json extra.defaultHost), editable in the app.
 */
export function defaultHost() {
  const uri = Constants.expoConfig?.hostUri || "";
  return uri.split(":")[0] || Constants.expoConfig?.extra?.defaultHost || "192.168.1.2";
}

/** Downloads the current event config from the laptop. */
export async function fetchConfig(host) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`http://${host}:5173/mobile-deployment.json?t=${Date.now()}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function makeChain(host, dep) {
  const network = ethers.Network.from(dep.chainId);
  const provider = new ethers.JsonRpcProvider(`http://${host}:8545`, network, { staticNetwork: network, pollingInterval: 1500 });
  const wallets = dep.demoKeys.map((k) => new ethers.Wallet(k, provider));
  const contract = (signer = provider) => new ethers.Contract(dep.fairTickets, dep.abi, signer);
  return { host, dep, provider, wallets, contract, aadhaarUrl: `http://${host}:5173/aadhaar.html` };
}

/** Synthetic demo proof (all-zero): accepted only for synthetic accounts listed at deployment. */
export function syntheticProof(name) {
  const nullifier = BigInt(ethers.keccak256(ethers.toUtf8Bytes(`test-aadhaar:${name.trim().toLowerCase()}`)));
  return { nullifier, timestamp: BigInt(Math.floor(Date.now() / 1000)), revealArray: [0n, 0n, 0n, 0n], groth16Proof: Array(8).fill(0n) };
}

/** What a scalper bot would send: a made-up proof. */
export function fakeProof() {
  const r = () => BigInt(ethers.hexlify(ethers.randomBytes(31)));
  return { nullifier: r(), timestamp: BigInt(Math.floor(Date.now() / 1000)), revealArray: [0n, 0n, 0n, 0n], groth16Proof: Array.from({ length: 8 }, r) };
}

// Rotating gate QR, compact v2 format (see app/src/gateQr.js): "FT2.<ticketId>.<unixSeconds>.<base64 sig>".
// The gate recovers the holder from the signature, so the QR stays small and easy for webcams to read.
export const ROTATE_SECONDS = 30;
export async function makeGatePayload(signer, contractAddress, ticketId) {
  const ts = Math.floor(Date.now() / 1000);
  const sig = await signer.signMessage(`FairTickets2|${contractAddress.toLowerCase()}|${ticketId}|${ts}`);
  return `FT2.${Number(ticketId)}.${ts}.${ethers.encodeBase64(sig)}`;
}

export function errorText(e) {
  if (e?.revert?.name) return e.revert.name;
  const m = e?.reason || e?.shortMessage || e?.message || String(e);
  return String(m).replace(/^execution reverted: /, "").replace(/[\s\S]*reverted with reason string '([^']*)'[\s\S]*/, "$1").slice(0, 160);
}

/** Everything the fan app needs, for one fan. */
export async function loadFanState(chain, me) {
  const ft = chain.contract();
  const [eventName, phase, facePrice, publicSeats, regCloses, claimDeadline, winnerCount, nextWaitlistIndex, nextTokenId, entrants, refund, block] =
    await Promise.all([
      ft.eventName(), ft.phase(), ft.facePrice(), ft.publicSeats(), ft.registrationClosesAt(), ft.claimDeadline(),
      ft.winnerCount(), ft.nextWaitlistIndex(), ft.nextTokenId(), ft.getEntrants(), ft.pendingRefunds(me), chain.provider.getBlock("latest"),
    ]);
  const seats = [...Array(Number(publicSeats)).keys()];
  const [labels, offers] = await Promise.all([
    Promise.all(seats.map((s) => ft.seatLabel(s))),
    Promise.all(seats.map((s) => ft.offers(s))),
  ]);
  const ids = [...Array(Math.max(0, Number(nextTokenId) - 1)).keys()].map((i) => i + 1);
  const tickets = await Promise.all(ids.map(async (id) => {
    const c = await ft.checkTicket(id);
    return { id, status: Number(c.status), holder: c.holder, seat: Number(c.seat), label: c.label };
  }));
  const list = [...entrants];
  const position = list.indexOf(me);
  const myOfferIdx = offers.findIndex((o) => o.active && o.fan === me);
  return {
    eventName, phase: Number(phase), facePrice, regCloses: Number(regCloses), claimDeadline: Number(claimDeadline),
    winnerCount: Number(winnerCount), nextWaitlistIndex: Number(nextWaitlistIndex), entrantsCount: list.length,
    chainTime: block.timestamp, registered: position >= 0, position, labels, refund,
    myTicket: tickets.find((t) => t.holder === me && t.status !== 3) || null,
    myOffer: myOfferIdx >= 0 ? { seat: myOfferIdx, deadline: Number(offers[myOfferIdx].deadline) } : null,
  };
}

export const eth = (wei) => `${ethers.formatEther(wei)} ETH`;
export const fmtLeft = (secs) => {
  if (secs <= 0) return "passed";
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
};
