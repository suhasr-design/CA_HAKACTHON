// Measures gas per step for bulk participation (mock Aadhaar verifier; real Groth16 check added separately).
//   npx hardhat run scripts/gas-scale.js
const { ethers } = require("hardhat");
const { buildInventory } = require("./lib/inventory");
const { mockAadhaarProof } = require("./lib/mockProof");

async function main() {
  const N = Number(process.env.FANS || 300);
  const signers = await ethers.getSigners();
  const [org] = signers;
  const aadhaar = await (await ethers.getContractFactory("MockAnonAadhaar")).deploy();
  const ft = await (await ethers.getContractFactory("FairTicketsCommitReveal")).deploy("Scale", 1n, 3600, 3600, await aadhaar.getAddress(), 1n);
  const inv = buildInventory({ publicSeats: 50 });
  await ft.commitInventory(inv.root, 50, 0, 0);
  const secret = ethers.id("s");
  await ft.commitSeed(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [secret])));
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  await ft.openRegistration(now + 36000, now + 86400 * 7);

  const regGas = [];
  for (let i = 0; i < N; i++) {
    const w = ethers.Wallet.createRandom().connect(ethers.provider);
    await org.sendTransaction({ to: w.address, value: ethers.parseEther("1") });
    const p = mockAadhaarProof(`fan-${i}`);
    const r = await (await ft.connect(w).register(p.nullifier, p.timestamp, p.revealArray, p.groth16Proof)).wait();
    if (i === 0 || i === N - 1) regGas.push(Number(r.gasUsed));
  }
  await ethers.provider.send("evm_increaseTime", [36001]);
  await ethers.provider.send("evm_mine", []);
  await (await ft.requestDraw()).wait();
  await ethers.provider.send("evm_mine", []);
  await (await ft.revealSeed(secret)).wait();
  const batch = 100;
  const s = await (await ft.runShuffle(batch)).wait();
  console.log(JSON.stringify({
    fans: N,
    registerGasFirst: regGas[0], registerGasLast: regGas[1],
    shuffleGasPerFan: Math.round(Number(s.gasUsed) / batch),
  }));
}
main().catch((e) => { console.error(e); process.exit(1); });
