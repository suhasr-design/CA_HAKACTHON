// Fan Pass helpers shared by deploy scripts, tests and the laptop services.
const path = require("path");
const { ethers } = require("ethers");

// Fixed registry seed: one Fan Pass per Aadhaar for this registry (separate from every event's seed).
const FANPASS_SEED = BigInt(ethers.id("Fair Tickets · Fan Pass · v1")) % (1n << 128n);
const TREE_DEPTH = 20; // proofs always use depth 20 (≈1M fans) so phones need one 5.5 MB artifact pair
const POSEIDON = "poseidon-solidity/PoseidonT3.sol:PoseidonT3";
const ARTIFACTS = {
  wasm: path.join(__dirname, "..", "..", "app", "public", "semaphore", `semaphore-${TREE_DEPTH}.wasm`),
  zkey: path.join(__dirname, "..", "..", "app", "public", "semaphore", `semaphore-${TREE_DEPTH}.zkey`),
};

/** Deploys PoseidonT3 + SemaphoreVerifier + Semaphore (official v4) + FanPass. `hhEthers` = hardhat's ethers. */
async function deployFanPass(hhEthers, anonAadhaarAddress, seed = FANPASS_SEED) {
  const poseidon = await (await hhEthers.getContractFactory(POSEIDON)).deploy();
  const verifier = await (await hhEthers.getContractFactory("SemaphoreVerifier")).deploy();
  const Semaphore = await hhEthers.getContractFactory("Semaphore", { libraries: { [POSEIDON]: await poseidon.getAddress() } });
  const semaphore = await Semaphore.deploy(await verifier.getAddress());
  const fanPass = await (await hhEthers.getContractFactory("FanPass")).deploy(await semaphore.getAddress(), anonAadhaarAddress, seed);
  await fanPass.waitForDeployment();
  return { poseidon, verifier, semaphore, fanPass };
}

/** Proof object from @semaphore-protocol/proof -> the Solidity struct. */
const toStruct = (p) => ({
  merkleTreeDepth: BigInt(p.merkleTreeDepth), merkleTreeRoot: BigInt(p.merkleTreeRoot), nullifier: BigInt(p.nullifier),
  message: BigInt(p.message), scope: BigInt(p.scope), points: p.points.map(BigInt),
});

module.exports = { FANPASS_SEED, TREE_DEPTH, ARTIFACTS, deployFanPass, toStruct };
