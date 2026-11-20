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
import path from "path";
import { spawn } from "child_process";
import { ethers } from "ethers";

const ROOT = path.resolve(__dirname, "..");
const DEPLOYMENT = path.join(ROOT, "app", "src", "deployment.json");
// Hardhat's PUBLIC test account #0 (the local organiser). Local test ETH only.
const LOCAL_ORGANISER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const requests = new Map(); // wallet -> { signal, seed, at }
const proofs = new Map();   // wallet -> proof message
const scans = new Map();    // contract -> Map(ticket -> { gate, at })
const sponsored = new Map(); // contract -> Set(nullifier | address)
let deploying = false;
const TTL = 30 * 60 * 1000;

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
const isLocal = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
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
      const out = await new Promise((resolve, reject) => {
        const npx = process.platform === "win32" ? "npx.cmd" : "npx";
        const child = spawn(npx, ["hardhat", "run", "scripts/deploy-local.js", "--network", "localhost"], {
          cwd: ROOT, env: { ...process.env, EVENT_JSON: JSON.stringify(ev) }, shell: process.platform === "win32",
        });
        let log = "";
        child.stdout.on("data", (d) => { log += d; });
        child.stderr.on("data", (d) => { log += d; });
        child.on("close", (code) => (code === 0 ? resolve(log) : reject(new Error(log.trim().split("\n").slice(-3).join(" ") || `exit ${code}`))));
      });
      return send(res, 200, { ok: true, log: out.trim().split("\n").slice(0, 4) });
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
