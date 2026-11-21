// Downloads the Semaphore v4 proving files for tree depth 20 (~5.5 MB) into app/public/semaphore/, so
// phones fetch them from the laptop over the venue Wi-Fi instead of the internet.
//   node scripts/fetch-semaphore-artifacts.js
const fs = require("fs");
const path = require("path");

const DEPTH = 20;
const BASE = "https://snark-artifacts.pse.dev/semaphore/latest";
const OUT = path.join(__dirname, "..", "app", "public", "semaphore");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const ext of ["wasm", "zkey"]) {
    const file = path.join(OUT, `semaphore-${DEPTH}.${ext}`);
    if (fs.existsSync(file) && fs.statSync(file).size > 100000) { console.log("have", path.basename(file)); continue; }
    const res = await fetch(`${BASE}/semaphore-${DEPTH}.${ext}`);
    if (!res.ok) throw new Error(`${ext}: HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log("saved", path.basename(file), (fs.statSync(file).size / 1048576).toFixed(2), "MB");
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
