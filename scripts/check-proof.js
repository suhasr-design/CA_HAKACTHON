// Read-only: asks the deployed Anon Aadhaar contract whether a proof file is valid (no transaction).
//   $env:PROOF="path\to\proof.json"; npx hardhat run scripts/check-proof.js --network localhost
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

async function main() {
  const dep = require(path.join(__dirname, "..", "app", "src", "deployment.json"));
  const p = JSON.parse(fs.readFileSync(process.env.PROOF, "utf8"));
  const anon = await ethers.getContractAt("AnonAadhaarMultiKey", dep.anonAadhaar);
  console.log("accepted UIDAI keys on-chain:", (await anon.acceptedKeyHashes()).length);
  const ok = await anon.verifyAnonAadhaarProof(dep.nullifierSeed, p.nullifier, p.timestamp, BigInt(p.signal), p.revealArray, p.groth16Proof);
  console.log("on-chain AnonAadhaarMultiKey says proof valid:", ok);
  const wrongWallet = await anon.verifyAnonAadhaarProof(dep.nullifierSeed, p.nullifier, p.timestamp, 12345n, p.revealArray, p.groth16Proof);
  console.log("same proof for a different wallet:", wrongWallet, "(must be false)");
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
