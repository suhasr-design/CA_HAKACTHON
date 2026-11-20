// Computes the Anon Aadhaar circuit pubkeyHash for every certificate bundled in @anon-aadhaar/react
// (test key, UIDAI 2021 key, UIDAI 2026 key). Same formula as the circuit: PoseidonLarge over the RSA
// modulus split into 17 x 121-bit words (pairs merged -> Poseidon of 9 inputs).
//   node scripts/aadhaar-key-hashes.js
const fs = require("fs");
const path = require("path");
const appNm = path.join(__dirname, "..", "app", "node_modules");
const forge = require(path.join(appNm, "node-forge"));
const { buildPoseidon } = require(path.join(appNm, "circomlibjs"));
const core = require(path.join(appNm, "@anon-aadhaar", "core"));

const src = fs.readFileSync(path.join(appNm, "@anon-aadhaar", "react", "src", "publicKeys.ts"), "utf8");
const certs = {};
for (const m of src.matchAll(/export const (\w+) = `(-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----)/g)) certs[m[1]] = m[2];

// Extra certificates (DER or PEM .cer files) passed on the command line, e.g. UIDAI's current key.
for (const file of process.argv.slice(2)) {
  const raw = fs.readFileSync(file);
  const text = raw.toString("latin1");
  certs[path.basename(file, path.extname(file))] = text.includes("BEGIN CERTIFICATE")
    ? text
    : forge.pki.certificateToPem(forge.pki.certificateFromAsn1(forge.asn1.fromDer(text)));
}

const split =(x, n, k) => { const mask = (1n << n) - 1n, out = []; for (let i = 0n; i < k; i++) { out.push(x & mask); x >>= n; } return out; };

(async () => {
  const poseidon = await buildPoseidon();
  const results = {};
  for (const [name, pem] of Object.entries(certs)) {
    const cert = forge.pki.certificateFromPem(pem);
    const n = BigInt("0x" + cert.publicKey.n.toString(16));
    const w = split(n, 121n, 17n);
    const merged = [];
    for (let i = 0; i < 17; i += 2) merged.push(i + 1 < 17 ? w[i] + (w[i + 1] << 121n) : w[i]);
    const h = poseidon.F.toString(poseidon(merged));
    results[name] = { hash: h, validTo: cert.validity.notAfter.toISOString().slice(0, 10) };
    console.log(`${name.padEnd(34)} valid until ${results[name].validTo}  hash ${h}`);
  }
  console.log("\nSDK testPublicKeyHash       :", core.testPublicKeyHash);
  console.log("SDK productionPublicKeyHash :", core.productionPublicKeyHash);
})();
