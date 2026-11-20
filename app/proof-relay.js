// Tiny in-memory relay (Vite dev-server middleware) for "prove on the laptop".
// The phone's Aadhaar page asks for a proof bound to its wallet; the laptop page generates it in
// the laptop browser and posts back ONLY the zero-knowledge proof. The Aadhaar QR never reaches
// this server: it stays inside the laptop browser tab.
//
//   POST /api/proof-request   {signal, seed}        phone: "I need a proof for this wallet"
//   GET  /api/proof-requests                         laptop: list waiting phones
//   POST /api/proof/<signal>  {proof message}        laptop: deliver the proof
//   GET  /api/proof/<signal>                         phone: poll for it (404 until ready)
const requests = new Map(); // signal -> { signal, seed, at }
const proofs = new Map();   // signal -> proof message
const TTL = 30 * 60 * 1000;

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 100000) reject(new Error("too large")); });
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

export default function proofRelay() {
  return {
    name: "fair-tickets-proof-relay",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith("/api/proof")) return next();
        const now = Date.now();
        for (const [k, v] of requests) if (now - v.at > TTL) requests.delete(k);
        try {
          const url = new URL(req.url, "http://x");
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
              // Shape check only; the smart contract does the real verification.
              if (p.type !== "proof" || !/^\d+$/.test(p.nullifier) || !/^\d+$/.test(p.timestamp) || !isUintList(p.revealArray, 4) || !isUintList(p.groth16Proof, 8))
                return send(res, 400, { error: "bad proof" });
              proofs.set(key, { type: "proof", nullifier: p.nullifier, timestamp: p.timestamp, revealArray: p.revealArray, groth16Proof: p.groth16Proof });
              requests.delete(key);
              return send(res, 200, { ok: true });
            }
          }
          return send(res, 404, { error: "not found" });
        } catch (e) {
          return send(res, 400, { error: String(e.message || e) });
        }
      });
    },
  };
}
