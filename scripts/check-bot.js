// Sanity check: a forged proof from the Scalper (not a synthetic account) must be rejected by the
// real Anon Aadhaar verifier, and a synthetic proof from the Scalper must also be rejected.
const { ethers } = require("hardhat");
const deployment = require("../app/src/deployment.json");

async function main() {
  const signers = await ethers.getSigners();
  const ft = await ethers.getContractAt("FairTickets", deployment.fairTickets);
  const scalper = signers[19];
  const r = () => BigInt(ethers.hexlify(ethers.randomBytes(31)));
  const tries = {
    "forged proof": [r(), 1n, [0n, 0n, 0n, 0n], Array.from({ length: 8 }, r)],
    "synthetic proof (not on the list)": [r(), 1n, [0n, 0n, 0n, 0n], Array(8).fill(0n)],
  };
  for (const [name, args] of Object.entries(tries)) {
    try {
      await ft.connect(scalper).register.staticCall(...args);
      console.log(`${name}: ACCEPTED (unexpected!)`);
    } catch (e) {
      console.log(`${name}: rejected -> ${e.reason || e.shortMessage || e.message}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
