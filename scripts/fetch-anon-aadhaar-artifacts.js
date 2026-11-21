// Downloads the official Anon Aadhaar v2 proving files (~600 MB) for the laptop prover into .zk/.
// Run once on the kiosk/organiser laptop, BEFORE the event (good Wi-Fi):
//   node scripts/fetch-anon-aadhaar-artifacts.js
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

const BASE = "https://anon-aadhaar-artifacts.s3.eu-central-1.amazonaws.com/v2.0.0";
const OUT = path.join(__dirname, "..", ".zk", "anon-aadhaar-v2");
const FILES = ["aadhaar-verifier.wasm", "vkey.json", "circuit_final.zkey"];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of FILES) {
    const dest = path.join(OUT, f);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) { console.log("have", f); continue; }
    console.log("downloading", f, "…");
    const res = await fetch(`${BASE}/${f}`);
    if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest + ".part"));
    fs.renameSync(dest + ".part", dest);
    console.log("saved", f, (fs.statSync(dest).size / 1048576).toFixed(1), "MB");
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
