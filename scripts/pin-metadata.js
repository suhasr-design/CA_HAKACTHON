// Publishes the contract metadata saved by scripts/deploy.js (metadata/*.json) to Quai's IPFS, once
// ipfs.qu.ai is reachable again. Each file's CID is checked against the one recorded at deployment.
//   node scripts/pin-metadata.js
const fs = require("fs");
const path = require("path");
const Hash = require("ipfs-only-hash");

const IPFS_URL = process.env.IPFS_URL || "https://ipfs.qu.ai/api/v0"; // same server as @quai/hardhat-deploy-metadata
const DIR = path.join(__dirname, "..", "metadata");
const RECORD = path.join(__dirname, "..", "deployments", "orchard.json");

(async () => {
  const { create } = await import("kubo-rpc-client");
  const client = create({ url: IPFS_URL });
  const record = fs.existsSync(RECORD) ? JSON.parse(fs.readFileSync(RECORD, "utf8")) : null;
  let all = true;
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith("_metadata.json"))) {
    const data = fs.readFileSync(path.join(DIR, f), "utf8");
    const want = await Hash.of(data);
    try {
      const { cid } = await client.add(data);
      await client.pin.add(cid);
      const ok = cid.toString() === want;
      all = all && ok;
      console.log(`${ok ? "✓" : "✕"} ${f} -> ${cid}${ok ? "" : ` (expected ${want})`}`);
    } catch (e) {
      all = false;
      console.log(`✕ ${f}: ${String(e.message || e).split("\n")[0].slice(0, 120)}`);
    }
  }
  if (record && all) {
    record.metadataPinned = true;
    record.metadataPinnedAt = new Date().toISOString();
    fs.writeFileSync(RECORD, JSON.stringify(record, null, 2));
    console.log("Updated deployments/orchard.json: metadataPinned = true");
  }
  process.exit(all ? 0 : 1);
})();
