// Read-only: checks Quai Orchard supports the bn254 precompiles the Anon Aadhaar Groth16 verifier
// needs (ecAdd 0x06, ecMul 0x07, ecPairing 0x08). Sends calls only, no transactions.
//   node scripts/orchard-precompiles.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const RPC = process.env.RPC_URL || "https://orchard.rpc.quai.network/cyprus1";
const pad = (n) => BigInt(n).toString(16).padStart(64, "0");
const G1 = pad(1) + pad(2); // generator of bn254 G1

async function call(method, to, data) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [{ to, data: "0x" + data }, "latest"] }),
  });
  return res.json();
}

const cases = [
  ["ecAdd(G,G)      0x06", 6, G1 + G1, (r) => r.length === 130],
  ["ecMul(G,2)      0x07", 7, G1 + pad(2), (r) => r.length === 130],
  ["ecPairing(empty) 0x08", 8, "", (r) => BigInt(r) === 1n],
];

(async () => {
  for (const [label, n, data, ok] of cases) {
    // Quai precompiles may live at the plain address or at a zone-prefixed one; try both RPC namespaces.
    const addrs = ["0x" + n.toString(16).padStart(40, "0")];
    let line = `${label}: `;
    let passed = false;
    for (const method of ["quai_call", "eth_call"]) {
      for (const to of addrs) {
        try {
          const j = await call(method, to, data);
          if (j.result && j.result !== "0x" && ok(j.result)) { line += `OK via ${method} (${j.result.slice(0, 20)}…)`; passed = true; break; }
          line += `[${method}: ${j.error ? j.error.message : j.result}] `;
        } catch (e) { line += `[${method}: ${e.message}] `; }
      }
      if (passed) break;
    }
    console.log(line);
  }
})();
