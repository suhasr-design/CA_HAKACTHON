// Laptop prover for Anon Aadhaar (runs as a child process of the website's dev server).
// Reads {qrData, signal, seed, mode} as JSON on STDIN (never on the command line, never logged),
// checks UIDAI's signature, makes the official Anon Aadhaar Groth16 proof with snarkjs, and prints
// {ok, proof:{nullifier,timestamp,revealArray,groth16Proof}} as JSON on STDOUT. Nothing is stored.
// Progress lines go to STDERR as "STAGE <name>".
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const appNm = path.join(ROOT, "app", "node_modules");
const core = require(path.join(appNm, "@anon-aadhaar", "core"));
const snarkjs = require(path.join(appNm, "snarkjs"));
const pako = require(path.join(appNm, "pako"));
const ART = path.join(ROOT, ".zk", "anon-aadhaar-v2");

const stage = (s) => process.stderr.write(`STAGE ${s}\n`);
const out = (o) => { process.stdout.write(JSON.stringify(o)); };

// UIDAI certificates: the SDK's (2021, Feb-2026, test) plus the current 2026 key we pinned.
function certificates(mode) {
  const src = fs.readFileSync(path.join(appNm, "@anon-aadhaar", "react", "src", "publicKeys.ts"), "utf8");
  const certs = {};
  for (const m of src.matchAll(/export const (\w+) = `(-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----)/g)) certs[m[1]] = m[2];
  certs.uidai_offline_publickey_2026 = fs.readFileSync(path.join(ROOT, "app", "certs", "uidai_offline_publickey_2026.pem"), "utf8");
  if (mode === "test") return { testCertificate: certs.testCertificate };
  delete certs.testCertificate;
  return certs;
}

(async () => {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const { qrData, signal, seed, mode } = JSON.parse(input);
  if (!/^\d+$/.test(String(qrData || "").trim())) return out({ ok: false, error: "This isn’t an Aadhaar Secure QR (expected a long number). Use the mAadhaar / e-Aadhaar QR." });
  if (!fs.existsSync(path.join(ART, "circuit_final.zkey"))) return out({ ok: false, error: "Proving files missing on this laptop: run node scripts/fetch-anon-aadhaar-artifacts.js" });

  stage("signature");
  let hex = BigInt(String(qrData).trim()).toString(16); if (hex.length % 2) hex = "0" + hex;
  let data;
  try { data = Buffer.from(pako.inflate(Buffer.from(hex, "hex"))); } catch { return out({ ok: false, error: "Couldn’t read the QR data. Try a sharper screenshot." }); }
  const sig = data.subarray(data.length - 256);
  const signed = data.subarray(0, data.length - 256);
  let cert = null;
  for (const pem of Object.values(certificates(mode))) {
    try { if (crypto.verify("sha256", signed, new crypto.X509Certificate(pem).publicKey, sig)) { cert = pem; break; } } catch {}
  }
  if (!cert) return out({ ok: false, error: mode === "test" ? "Not signed by the Anon Aadhaar TEST key." : "Not signed by UIDAI: this isn’t a genuine Aadhaar Secure QR." });

  stage("witness");
  const args = await core.generateArgs({ qrData: String(qrData).trim(), certificateFile: cert, nullifierSeed: BigInt(seed), signal: String(signal) });
  const circuitInput = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, v.value]));
  stage("proving");
  // PROVER_THREADS=multi uses all cores (faster, but copies the 584 MB key into every worker: needs
  // lots of free RAM). Default single-thread fits comfortably on a 6-8 GB laptop.
  const singleThread = process.env.PROVER_THREADS !== "multi";
  const { proof, publicSignals: s } = await snarkjs.groth16.fullProve(
    circuitInput, path.join(ART, "aadhaar-verifier.wasm"), path.join(ART, "circuit_final.zkey"), undefined, undefined, { singleThread });
  stage("verifying");
  const vk = JSON.parse(fs.readFileSync(path.join(ART, "vkey.json"), "utf8"));
  if (!(await snarkjs.groth16.verify(vk, s, proof))) return out({ ok: false, error: "Proof failed self-check." });
  out({ ok: true, proof: { nullifier: s[1], timestamp: s[2], revealArray: [s[3], s[4], s[5], s[6]], groth16Proof: core.packGroth16Proof(proof).map(String) } });
})().then(() => process.exit(0)).catch((e) => { out({ ok: false, error: String(e.message || e).split("\n")[0].slice(0, 200) }); process.exit(0); });
