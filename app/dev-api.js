// Laptop-side services for the local demo (Vite dev-server middleware). In production these would be
// small venue/organiser services; here they run next to the website.
//
// 1. Proof relay ("prove on the laptop"). The QR never reaches this server, only the ZK proof.
//      POST /api/proof-request {signal, seed} · GET /api/proof-requests · POST|GET /api/proof/<wallet>
// 2. Gate sync over the venue LAN: every gate checks-and-marks a ticket here, atomically, so one ticket
//    can't enter at Gate A and Gate B. Gates fall back to their own list if the LAN drops.
//      POST /api/gate/scan {contract, ticket, gate}  -> {ok} | {ok:false, already:{gate, at}}
//      GET  /api/gate/scans?contract=..               -> all entries
//      POST /api/gate/reset {contract}
// 3. Gas sponsorship, anti-drain: a new fan wallet gets test ETH ONLY with a valid Anon Aadhaar proof
//    for that wallet, and only once per person (nullifier). Bots without Aadhaar get nothing.
//      POST /api/sponsor {address, proof}
// 4. Create event (organiser, laptop only): redeploys a new event with the given details.
//      POST /api/events {title, venue, startsAt, priceInr, priceEth, publicSeats, ...}
import fs from "fs";
import os from "os";
import crypto from "crypto";
import path from "path";
import { spawn } from "child_process";
import { ethers } from "ethers";
import { Group, verifyProof as verifySemaphoreProof } from "@semaphore-protocol/core";

const ROOT = path.resolve(__dirname, "..");
const DEPLOYMENT = path.join(ROOT, "app", "src", "deployment.json");
// Hardhat's PUBLIC test account #0 (the local organiser). Local test ETH only.
const LOCAL_ORGANISER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const requests = new Map(); // wallet -> { signal, seed, at }
const proofs = new Map();   // wallet -> proof message
const scans = new Map();    // contract -> Map(ticket -> { gate, at })
const sponsored = new Map(); // contract -> Set(nullifier | address)
const passRequests = new Map(); // pairing code -> { commitment, at }   (kiosk enrolment)
const deskProofs = new Map();   // wallet -> single-member Semaphore proof (help-desk ownership check)
const passFunded = new Set();   // event:semaphoreNullifier -> already given test ETH
let deploying = false;
const TTL = 30 * 60 * 1000;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
const isField = (s) => /^\d{1,78}$/.test(String(s));

const chainOf = (dep) => {
  const provider = new ethers.JsonRpcProvider(dep.rpcUrl, dep.chainId, { staticNetwork: true });
  const relayer = new ethers.Wallet(LOCAL_ORGANISER_KEY, provider);
  return { provider, relayer, fanPass: new ethers.Contract(dep.fanPass.fanPass, dep.fanPass.abi, relayer), ft: new ethers.Contract(dep.fairTickets, dep.abi.fairTickets, relayer) };
};

/** Fan Pass tree as phones must rebuild it: commitments in insertion order; replaced ones are removed. */
async function passTree(fanPass) {
  const [enrolled, replaced] = await Promise.all([
    fanPass.queryFilter(fanPass.filters.Enrolled(), 0, "latest"),
    fanPass.queryFilter(fanPass.filters.Replaced(), 0, "latest"),
  ]);
  const leaves = enrolled.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index).map((e) => e.args.commitment.toString());
  const removedSet = new Set(replaced.map((e) => e.args.oldCommitment.toString()));
  const removed = leaves.map((c, i) => (removedSet.has(c) ? i : -1)).filter((i) => i >= 0);
  return { leaves, removed };
}
const buildGroup = ({ leaves, removed }) => {
  const g = new Group(leaves);
  for (const i of removed) g.removeMember(i);
  return g;
};
const reason = (e) => String(e?.reason || e?.shortMessage || e?.message || e).replace(/^execution reverted: /, "").replace(/.*reverted with reason string '([^']*)'.*/s, "$1").slice(0, 160);

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 200000) reject(new Error("too large")); });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(e); } });
  });
const send = (res, code, obj) => {
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(obj));
};
const isAddr = (s) => /^0x[0-9a-fA-F]{40}$/.test(s || "");
const isUintList = (a, n) => Array.isArray(a) && a.length === n && a.every((x) => /^\d+$/.test(String(x)));
const isProof = (p) => p && /^\d+$/.test(String(p.nullifier)) && /^\d+$/.test(String(p.timestamp)) && isUintList(p.revealArray, 4) && isUintList(p.groth16Proof, 8);
// "Local" = this laptop, whether the page was opened as localhost or via its Wi-Fi address.
const ownAddresses = () => new Set(["127.0.0.1", "::1", ...Object.values(os.networkInterfaces()).flat().map((i) => i.address)]);
const isLocal = (req) => ownAddresses().has(String(req.socket.remoteAddress).replace(/^::ffff:/, ""));

/** Runs scripts/deploy-local.js with the given event details. */
const deployEvent = (ev) => new Promise((resolve, reject) => {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const child = spawn(npx, ["hardhat", "run", "scripts/deploy-local.js", "--network", "localhost"], {
    cwd: ROOT, env: { ...process.env, EVENT_JSON: JSON.stringify(ev) }, shell: process.platform === "win32",
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  child.on("close", (code) => (code === 0 ? resolve(log) : reject(new Error(log.trim().split("\n").slice(-3).join(" ") || `exit ${code}`))));
});

// Laptop prover jobs: the kiosk / help-desk browser sends the decoded QR number to THIS laptop's prover
// (a separate Node process, single-threaded so it fits in memory). The QR stays on this machine, is
// passed over stdin, and is dropped as soon as the proof is made. One proof at a time.
const jobs = new Map(); // id -> { status, stage, startedAt, result, error }
let proving = false;
const queue = [];
function startNextJob() {
  if (proving || !queue.length) return;
  const { id, payload } = queue.shift();
  const job = jobs.get(id);
  proving = true;
  job.status = "running";
  job.startedAt = Date.now();
  const child = spawn(process.execPath, ["--max-old-space-size=3072", path.join(ROOT, "scripts", "prove-aadhaar.cjs")], { cwd: ROOT });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { const m = String(d).match(/STAGE (\w+)/g); if (m) job.stage = m[m.length - 1].slice(6); });
  child.on("close", () => {
    try { const r = JSON.parse(out); if (r.ok) { job.status = "done"; job.result = r.proof; } else { job.status = "error"; job.error = r.error; } }
    catch { job.status = "error"; job.error = "The prover stopped unexpectedly (low memory?). Close other apps and try again."; }
    job.seconds = Math.round((Date.now() - job.startedAt) / 1000);
    proving = false;
    startNextJob();
  });
  child.stdin.end(JSON.stringify(payload));
}

/** Forget every in-flight request of the previous run (Fan Passes themselves live on-chain and are kept). */
const clearSession = () => { requests.clear(); proofs.clear(); scans.clear(); sponsored.clear(); passRequests.clear(); deskProofs.clear(); passFunded.clear(); };
const loadDeployment = () => JSON.parse(fs.readFileSync(DEPLOYMENT, "utf8"));

async function handle(req, res, url) {
  const now = Date.now();
  for (const [k, v] of requests) if (now - v.at > TTL) requests.delete(k);

  // ---------------------------------------------------------------- 1. proof relay
  if (req.method === "POST" && url.pathname === "/api/proof-request") {
    const { signal, seed } = await readJson(req);
    if (!isAddr(signal) || !/^\d+$/.test(String(seed))) return send(res, 400, { error: "bad request" });
    requests.set(signal.toLowerCase(), { signal, seed: String(seed), at: now });
    proofs.delete(signal.toLowerCase());
    return send(res, 200, { ok: true });
  }
  if (req.method === "GET" && url.pathname === "/api/proof-requests") {
    return send(res, 200, [...requests.values()].filter((r) => !proofs.has(r.signal.toLowerCase())));
  }
  const m = url.pathname.match(/^\/api\/proof\/(0x[0-9a-fA-F]{40})$/);
  if (m) {
    const key = m[1].toLowerCase();
    if (req.method === "GET") return proofs.has(key) ? send(res, 200, proofs.get(key)) : send(res, 404, { pending: requests.has(key) });
    if (req.method === "POST") {
      const p = await readJson(req);
      if (p.type !== "proof" || !isProof(p)) return send(res, 400, { error: "bad proof" }); // the contract does the real check
      proofs.set(key, { type: "proof", nullifier: String(p.nullifier), timestamp: String(p.timestamp), revealArray: p.revealArray.map(String), groth16Proof: p.groth16Proof.map(String) });
      requests.delete(key);
      return send(res, 200, { ok: true });
    }
  }

  // ---------------------------------------------------------------- 1b. Fan Pass
  // Phone asks for a kiosk enrolment: gets a short pairing code to read out at the kiosk.
  if (req.method === "POST" && url.pathname === "/api/fanpass/request") {
    const { commitment } = await readJson(req);
    if (!isField(commitment)) return send(res, 400, { error: "bad commitment" });
    for (const [k, v] of passRequests) if (now - v.at > TTL || v.commitment === String(commitment)) passRequests.delete(k);
    let code = newCode();
    while (passRequests.has(code)) code = newCode();
    passRequests.set(code, { commitment: String(commitment), at: now });
    return send(res, 200, { code });
  }
  const pr = url.pathname.match(/^\/api\/fanpass\/request\/([A-Z0-9]{6})$/);
  if (pr && req.method === "GET") {
    const r = passRequests.get(pr[1].toUpperCase());
    if (!r) return send(res, 404, { error: "Unknown or expired code. Ask the fan to tap “Get my Fan Pass at a kiosk” again." });
    const dep = loadDeployment();
    return send(res, 200, { commitment: r.commitment, seed: dep.fanPass.seed });
  }
  // Kiosk (or phone) submits the Anon Aadhaar proof; the relayer pays the gas.
  if (req.method === "POST" && url.pathname === "/api/fanpass/enroll") {
    const { commitment, proof } = await readJson(req);
    if (!isField(commitment) || !isProof(proof)) return send(res, 400, { error: "bad enrolment" });
    const dep = loadDeployment();
    const { fanPass } = chainOf(dep);
    // Replacing a lost pass? Removing the old leaf needs its Merkle siblings.
    let siblings = [];
    const old = (await fanPass.passOfAadhaar(BigInt(proof.nullifier))).toString();
    if (old !== "0") {
      const tree = await passTree(fanPass);
      const g = buildGroup(tree);
      siblings = g.generateMerkleProof(tree.leaves.indexOf(old)).siblings.map(String);
    }
    const args = [BigInt(commitment), BigInt(proof.nullifier), BigInt(proof.timestamp), proof.revealArray.map(BigInt), proof.groth16Proof.map(BigInt), siblings.map(BigInt)];
    try {
      await fanPass.enroll.staticCall(...args);
    } catch (e) {
      return send(res, 400, { error: reason(e) });
    }
    const tx = await fanPass.enroll(...args);
    await tx.wait();
    for (const [k, v] of passRequests) if (v.commitment === String(commitment)) passRequests.delete(k);
    return send(res, 200, { ok: true, replaced: old !== "0", tx: tx.hash, members: Number(await fanPass.members()) });
  }
  if (req.method === "GET" && url.pathname === "/api/fanpass/status") {
    const c = url.searchParams.get("commitment");
    if (!isField(c)) return send(res, 400, { error: "bad commitment" });
    const { fanPass } = chainOf(loadDeployment());
    return send(res, 200, { member: await fanPass.isMember(BigInt(c)), members: Number(await fanPass.members()) });
  }
  if (req.method === "GET" && url.pathname === "/api/fanpass/tree") {
    const { fanPass } = chainOf(loadDeployment());
    return send(res, 200, await passTree(fanPass));
  }
  // Phone registers for the event with a Fan Pass proof; the relayer pays the gas and, once per person,
  // tops the wallet up with test ETH for the ticket (stand-in for a UPI payment).
  if (req.method === "POST" && url.pathname === "/api/pass-register") {
    const { fan, proof } = await readJson(req);
    if (!isAddr(fan) || !proof || !isUintList(proof.points, 8) || !isField(proof.nullifier) || !isField(proof.merkleTreeRoot)) return send(res, 400, { error: "bad request" });
    const dep = loadDeployment();
    const { ft, provider, relayer } = chainOf(dep);
    const p = { merkleTreeDepth: BigInt(proof.merkleTreeDepth), merkleTreeRoot: BigInt(proof.merkleTreeRoot), nullifier: BigInt(proof.nullifier), message: BigInt(proof.message), scope: BigInt(proof.scope), points: proof.points.map(BigInt) };
    try {
      await ft.registerWithPass.staticCall(fan, p);
    } catch (e) {
      return send(res, 400, { error: reason(e) });
    }
    const tx = await ft.registerWithPass(fan, p);
    await tx.wait();
    const key = `${dep.fairTickets}:${proof.nullifier}`;
    let funded = null;
    const price = await ft.facePrice();
    if (!passFunded.has(key) && (await provider.getBalance(fan)) < price + ethers.parseEther("0.01")) {
      passFunded.add(key);
      const amount = price + ethers.parseEther("0.02");
      await (await relayer.sendTransaction({ to: fan, value: amount })).wait();
      funded = ethers.formatEther(amount);
    }
    return send(res, 200, { ok: true, tx: tx.hash, funded });
  }
  // Help desk ownership check: the phone proves its Fan Pass identity in a ONE-member group {commitment of
  // the person who just re-proved Aadhaar at the desk}, for this event. Checked off-chain by the desk.
  const dp = url.pathname.match(/^\/api\/desk-proof\/(0x[0-9a-fA-F]{40})$/);
  if (dp) {
    const key = dp[1].toLowerCase();
    if (req.method === "POST") { deskProofs.set(key, await readJson(req)); return send(res, 200, { ok: true }); }
    if (req.method === "GET") return deskProofs.has(key) ? send(res, 200, deskProofs.get(key)) : send(res, 404, { pending: true });
    if (req.method === "DELETE") { deskProofs.delete(key); return send(res, 200, { ok: true }); }
  }
  if (req.method === "POST" && url.pathname === "/api/desk-verify") {
    // Verifies a desk proof off-chain (the browser can't load node snarkjs as easily).
    const { proof, commitment } = await readJson(req);
    if (!proof || !isField(commitment)) return send(res, 400, { error: "bad request" });
    const g = new Group([BigInt(commitment)]);
    const ok = String(proof.merkleTreeRoot) === g.root.toString() && (await verifySemaphoreProof(proof).catch(() => false));
    return send(res, 200, { ok });
  }

  // ---------------------------------------------------------------- 2. gate sync
  if (url.pathname === "/api/gate/scan" && req.method === "POST") {
    const { contract, ticket, gate } = await readJson(req);
    if (!isAddr(contract) || !/^\d+$/.test(String(ticket)) || !gate) return send(res, 400, { error: "bad scan" });
    const book = scans.get(contract.toLowerCase()) || new Map();
    scans.set(contract.toLowerCase(), book);
    const prev = book.get(String(ticket));
    if (prev) return send(res, 200, { ok: false, already: prev });
    const entry = { gate: String(gate).slice(0, 20), at: Math.floor(now / 1000) };
    book.set(String(ticket), entry); // check-and-mark in one step: two gates can't both win
    return send(res, 200, { ok: true, entry });
  }
  if (url.pathname === "/api/gate/scans" && req.method === "GET") {
    const book = scans.get(String(url.searchParams.get("contract") || "").toLowerCase()) || new Map();
    return send(res, 200, Object.fromEntries(book));
  }
  if (url.pathname === "/api/gate/reset" && req.method === "POST") {
    const { contract } = await readJson(req);
    if (isAddr(contract)) scans.delete(contract.toLowerCase());
    return send(res, 200, { ok: true });
  }

  // ---------------------------------------------------------------- 3. gas sponsorship (anti-drain)
  if (url.pathname === "/api/sponsor" && req.method === "POST") {
    const { address, proof } = await readJson(req);
    if (!isAddr(address) || !isProof(proof)) return send(res, 400, { error: "Send your wallet address and Anon Aadhaar proof." });
    const dep = loadDeployment();
    const provider = new ethers.JsonRpcProvider(dep.rpcUrl, dep.chainId, { staticNetwork: true });
    const router = new ethers.Contract(dep.aadhaarRouter, dep.abi.router, provider);
    const valid = await router.verifyAnonAadhaarProof(
      BigInt(dep.nullifierSeed), BigInt(proof.nullifier), BigInt(proof.timestamp), BigInt(address),
      proof.revealArray.map(BigInt), proof.groth16Proof.map(BigInt)
    ).catch(() => false);
    if (!valid) return send(res, 403, { error: "No valid Aadhaar proof for this wallet: no gas. (This is what stops bots draining sponsored gas.)" });
    const book = sponsored.get(dep.fairTickets) || new Set();
    sponsored.set(dep.fairTickets, book);
    if (book.has(String(proof.nullifier)) || book.has(address.toLowerCase())) return send(res, 409, { error: "This person was already sponsored once for this event." });
    const price = ethers.parseEther(String(dep.event?.priceEth || "0.05"));
    const amount = price + ethers.parseEther("0.02"); // gas + stand-in for the fan's UPI payment
    book.add(String(proof.nullifier));
    book.add(address.toLowerCase());
    const organiser = new ethers.Wallet(LOCAL_ORGANISER_KEY, provider);
    const tx = await organiser.sendTransaction({ to: address, value: amount });
    await tx.wait();
    return send(res, 200, { ok: true, amount: ethers.formatEther(amount), tx: tx.hash });
  }

  // ---------------------------------------------------------------- 4. create event (laptop only)
  if (url.pathname === "/api/events" && req.method === "POST") {
    if (!isLocal(req)) return send(res, 403, { error: "Create events from the organiser laptop." });
    if (deploying) return send(res, 409, { error: "Already creating an event; wait for it to finish." });
    const ev = await readJson(req);
    deploying = true;
    try {
      const out = await deployEvent(ev);
      clearSession();
      return send(res, 200, { ok: true, log: out.trim().split("\n").slice(0, 4) });
    } catch (e) {
      return send(res, 400, { error: String(e.message || e) });
    } finally {
      deploying = false;
    }
  }
  // ---------------------------------------------------------------- 4b. laptop prover (kiosk / help desk)
  if (url.pathname === "/api/laptop-prove" && req.method === "POST") {
    if (!isLocal(req)) return send(res, 403, { error: "The laptop prover only accepts QRs from this laptop’s own kiosk page." });
    const { qrData, signal, seed } = await readJson(req);
    if (!/^\d{100,}$/.test(String(qrData || "").trim())) return send(res, 400, { error: "That isn’t an Aadhaar Secure QR (expected a long number)." });
    if (!isField(signal) && !isAddr(signal)) return send(res, 400, { error: "bad signal" });
    if (!isField(seed)) return send(res, 400, { error: "bad seed" });
    const id = crypto.randomUUID();
    jobs.set(id, { status: "queued", stage: "queued", createdAt: now });
    for (const [k, j] of jobs) if (now - j.createdAt > TTL) jobs.delete(k);
    const mode = loadDeployment().aadhaarMode === "test" ? "test" : "real";
    queue.push({ id, payload: { qrData: String(qrData).trim(), signal: isAddr(signal) ? BigInt(signal).toString() : String(signal), seed: String(seed), mode } });
    startNextJob();
    return send(res, 200, { id, ahead: queue.length - 1 + (proving ? 1 : 0) });
  }
  const jm = url.pathname.match(/^\/api\/laptop-prove\/([0-9a-f-]{36})$/);
  if (jm && req.method === "GET") {
    const j = jobs.get(jm[1]);
    if (!j) return send(res, 404, { error: "unknown job" });
    const out = { status: j.status, stage: j.stage, elapsed: j.startedAt ? Math.round((Date.now() - j.startedAt) / 1000) : 0, seconds: j.seconds, error: j.error };
    if (j.status === "done") { out.proof = j.result; jobs.delete(jm[1]); } // hand over once, then forget
    return send(res, 200, out);
  }

  // ---------------------------------------------------------------- 5. restart the demo (laptop only)
  // Same event details, brand-new contract: registration open again, no entrants, tickets or gate scans.
  if (url.pathname === "/api/reset" && req.method === "POST") {
    if (!isLocal(req)) return send(res, 403, { error: "Restart the demo from the organiser laptop." });
    if (deploying) return send(res, 409, { error: "Already restarting; wait a few seconds." });
    const dep = loadDeployment();
    const ev = { ...(dep.event || {}), crowd: (dep.crowd || []).length, registrationMinutes: 120 };
    deploying = true;
    try {
      await deployEvent(ev);
      clearSession();
      return send(res, 200, { ok: true, event: ev.title });
    } catch (e) {
      return send(res, 400, { error: String(e.message || e) });
    } finally {
      deploying = false;
    }
  }
  return send(res, 404, { error: "not found" });
}

export default function devApi() {
  return {
    name: "fair-tickets-dev-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith("/api/")) return next();
        try {
          await handle(req, res, new URL(req.url, "http://x"));
        } catch (e) {
          send(res, 500, { error: String(e.message || e) });
        }
      });
    },
  };
}
