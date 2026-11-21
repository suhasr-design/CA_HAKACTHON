import { ethers } from "ethers";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

// ---------------------------------------------------------------- the fan's own wallet
// Generated on the phone and kept in the OS secure storage (Android Keystore-backed). Never leaves the
// phone. A fan who loses the phone recovers entry at the venue help desk by re-proving with Aadhaar.
const KEY_NAME = "fairtickets.walletKey.v1";
export async function loadOrCreateOwnKey() {
  let k = await SecureStore.getItemAsync(KEY_NAME);
  if (!k) {
    k = ethers.hexlify(ethers.randomBytes(32)); // fast: no mnemonic derivation on the phone
    await SecureStore.setItemAsync(KEY_NAME, k, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  }
  return k;
}

// ---------------------------------------------------------------- Fan Pass
// The Fan Pass secret (Semaphore identity) lives in secure storage. Only its commitment and
// zero-knowledge proofs ever leave the phone. The fan can back it up (a 64-character code) and restore
// it on a new phone.
const PASS_SECRET = "fairtickets.passSecret.v1";
const PASS_COMMITMENT = "fairtickets.passCommitment.v1";
const secureOpts = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export async function loadOrCreatePassSecret() {
  let s = await SecureStore.getItemAsync(PASS_SECRET);
  if (!s) {
    s = ethers.hexlify(ethers.randomBytes(32)).slice(2);
    await SecureStore.setItemAsync(PASS_SECRET, s, secureOpts);
  }
  return s;
}
export async function restorePassSecret(code) {
  const s = String(code).trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(s)) throw new Error("A Fan Pass backup code is 64 characters (0-9, a-f).");
  await SecureStore.setItemAsync(PASS_SECRET, s, secureOpts);
  await SecureStore.deleteItemAsync(PASS_COMMITMENT);
  return s;
}
export const savePassCommitment = (c) => SecureStore.setItemAsync(PASS_COMMITMENT, String(c), secureOpts);
export const loadPassCommitment = () => SecureStore.getItemAsync(PASS_COMMITMENT);
export async function passStatus(host, commitment) {
  const r = await fetch(`http://${host}:5173/api/fanpass/status?commitment=${commitment}`);
  return r.ok ? r.json() : { member: false };
}
/** A made-up Fan Pass proof (what a bot would send). */
export function fakePassProof(wallet, scope) {
  const r = () => BigInt(ethers.hexlify(ethers.randomBytes(31)));
  return { merkleTreeDepth: 20n, merkleTreeRoot: r(), nullifier: r(), message: BigInt(wallet), scope: BigInt(scope), points: Array.from({ length: 8 }, r) };
}

/** Ask the laptop's sponsor for gas. It only pays out for a valid Aadhaar proof, once per person. */
export async function requestSponsor(host, address, proof) {
  const res = await fetch(`http://${host}:5173/api/sponsor`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, proof: { nullifier: String(proof.nullifier), timestamp: String(proof.timestamp), revealArray: proof.revealArray.map(String), groth16Proof: proof.groth16Proof.map(String) } }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `sponsor HTTP ${res.status}`);
  return j;
}

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

export function makeChain(host, dep, ownKey) {
  const network = ethers.Network.from(dep.chainId);
  const provider = new ethers.JsonRpcProvider(`http://${host}:8545`, network, { staticNetwork: network, pollingInterval: 1500 });
  const wallets = dep.demoKeys.map((k) => new ethers.Wallet(k, provider));
  const own = ownKey ? new ethers.Wallet(ownKey, provider) : null;
  const signerOf = (who) => (who === "me" ? own : wallets[who]);
  const contract = (signer = provider) => new ethers.Contract(dep.fairTickets, dep.abi, signer);
  return { host, dep, provider, wallets, own, signerOf, contract, aadhaarUrl: `http://${host}:5173/aadhaar.html`, passUrl: `http://${host}:5173/fanpass.html` };
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

// Gate QR (see app/src/gateQr.js). The gate recovers the holder from the signature.
//  With the gate's 4-digit code (default): v3 "FT3.<ticketId>.<code>.<base64 sig>", signed for THAT
//    code, so it can't be prepared earlier, screenshotted or relayed later, and the phone clock is unused.
//  Without a code: v2 "FT2.<ticketId>.<unixSeconds>.<base64 sig>", rotating every 30 s.
export const ROTATE_SECONDS = 30;
export async function makeGatePayload(signer, contractAddress, ticketId, gateCode) {
  const c = contractAddress.toLowerCase();
  if (gateCode) {
    const sig = await signer.signMessage(`FairTickets3|${c}|${ticketId}|${gateCode}`);
    return `FT3.${Number(ticketId)}.${gateCode}.${ethers.encodeBase64(sig)}`;
  }
  const ts = Math.floor(Date.now() / 1000);
  const sig = await signer.signMessage(`FairTickets2|${c}|${ticketId}|${ts}`);
  return `FT2.${Number(ticketId)}.${ts}.${ethers.encodeBase64(sig)}`;
}

export function errorText(e) {
  if (e?.revert?.name) return e.revert.name;
  const m = e?.reason || e?.shortMessage || e?.message || String(e);
  return String(m).replace(/^execution reverted: /, "").replace(/[\s\S]*reverted with reason string '([^']*)'[\s\S]*/, "$1").slice(0, 160);
}

/**
 * Everything the fan app needs, for one fan. Scales to large events: it reads this fan's own
 * position (O(1) on-chain), their own ticket and offer events, never the full seat or entrant lists.
 */
export async function loadFanState(chain, me) {
  const ft = chain.contract();
  const [eventName, phase, facePrice, publicSeats, regCloses, claimDeadline, winnerCount, nextWaitlistIndex, entrantsCount, registered, posRaw, refund, balance, block] =
    await Promise.all([
      ft.eventName(), ft.phase(), ft.facePrice(), ft.publicSeats(), ft.registrationClosesAt(), ft.claimDeadline(),
      ft.winnerCount(), ft.nextWaitlistIndex(), ft.entrantsCount(), ft.isRegistered(me), ft.positionOf(me), ft.pendingRefunds(me),
      chain.provider.getBalance(me), chain.provider.getBlock("latest"),
    ]);
  const position = posRaw === ethers.MaxUint256 ? -1 : Number(posRaw);

  // My ticket: the latest TicketIssued to me that hasn't been replaced.
  const issued = await ft.queryFilter(ft.filters.TicketIssued(null, me), 0, "latest");
  let myTicket = null;
  for (const e of issued.reverse()) {
    const id = Number(e.args.tokenId);
    const c = await ft.checkTicket(id);
    if (Number(c.status) !== 3 && c.holder === me) { myTicket = { id, status: Number(c.status), seat: Number(c.seat), label: c.label }; break; }
  }
  // My waitlist offer: seats ever offered to me that are still open for me.
  const offered = await ft.queryFilter(ft.filters.SeatOffered(null, me), 0, "latest");
  let myOffer = null;
  for (const seat of [...new Set(offered.map((e) => Number(e.args.seat)))]) {
    const o = await ft.offers(seat);
    if (o.active && o.fan === me) { myOffer = { seat, deadline: Number(o.deadline), label: await ft.seatLabel(seat) }; break; }
  }
  const winner = Number(phase) === 4 && position >= 0 && position < Number(winnerCount);
  const myLabel = winner ? await ft.seatLabel(position) : "";
  return {
    eventName, phase: Number(phase), facePrice, publicSeats: Number(publicSeats), regCloses: Number(regCloses), claimDeadline: Number(claimDeadline),
    winnerCount: Number(winnerCount), nextWaitlistIndex: Number(nextWaitlistIndex), entrantsCount: Number(entrantsCount),
    chainTime: block.timestamp, registered, position, myLabel, refund, balance, myTicket, myOffer,
  };
}

export const inr = (n) => (n ? `₹${Number(n).toLocaleString("en-IN")}` : "");

export const eth = (wei) => `${ethers.formatEther(wei)} ETH`;
export const fmtLeft = (secs) => {
  if (secs <= 0) return "passed";
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
};
