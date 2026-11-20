import { ethers } from "ethers";
import Constants from "expo-constants";
import deployment from "./deployment.json";

export { deployment };

export const NAMES = [
  "Organiser", "Asha", "Bilal", "Chetan", "Divya", "Esha", "Farhan", "Gauri", "Harsh",
  "Isha", "Jai", "Kavya", "Lokesh", "Meera", "Nikhil", "Omkar", "Priya", "Rahul", "Sneha", "Scalper",
];
export const SCALPER = 19;
export const isSynthetic = (i) => deployment.syntheticAccounts.includes(i);
export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

/**
 * The laptop running the blockchain and the web server. In Expo Go, the dev server's address
 * (hostUri, e.g. "192.168.1.20:8081") is the laptop, so we reuse its IP.
 */
export function defaultHost() {
  const uri = Constants.expoConfig?.hostUri || "";
  return uri.split(":")[0] || "192.168.1.2";
}

export function makeChain(host) {
  const network = ethers.Network.from(deployment.chainId);
  const provider = new ethers.JsonRpcProvider(`http://${host}:8545`, network, { staticNetwork: network, pollingInterval: 1500 });
  const wallets = deployment.demoKeys.map((k) => new ethers.Wallet(k, provider));
  const contract = (signer = provider) => new ethers.Contract(deployment.fairTickets, deployment.abi, signer);
  return { host, provider, wallets, contract, aadhaarUrl: `http://${host}:5173/aadhaar.html` };
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

// Rotating gate QR: identical format to the web gate scanner (app/src/gateQr.js).
export const ROTATE_SECONDS = 30;
export async function makeGatePayload(signer, ticketId) {
  const c = deployment.fairTickets;
  const h = signer.address;
  const ts = Math.floor(Date.now() / 1000);
  const s = await signer.signMessage(`FairTickets|${c.toLowerCase()}|${ticketId}|${h.toLowerCase()}|${ts}`);
  return JSON.stringify({ v: 1, c, t: Number(ticketId), h, ts, s });
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
