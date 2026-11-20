// Rehearsal helper: takes a freshly deployed local demo straight to the Sale phase.
// 12 fans register, the draw runs, seats are revealed, and every winner except the
// last one claims a ticket (so "release unclaimed" can be shown too).
// Usage: npx hardhat run scripts/demo-fastforward.js --network localhost
const { ethers, network } = require("hardhat");
const deployment = require("../app/src/deployment.json");
const { loadTree, revealArgs } = require("./lib/inventory");
const { mockAadhaarProof } = require("./lib/mockProof");

// Accounts 2..13 are synthetic demo fans (account 1, Asha, is kept for a live real-proof registration).
const NAMES = ["Organiser", "Asha", "Bilal", "Chetan", "Divya", "Esha", "Farhan", "Gauri", "Harsh", "Isha", "Jai", "Kavya", "Lokesh", "Meera"];

async function main() {
  const signers = await ethers.getSigners();
  const ft = await ethers.getContractAt("FairTickets", deployment.fairTickets);
  const vrf = await ethers.getContractAt("MockVRFCoordinator", deployment.vrfCoordinator);
  if ((await ft.phase()) !== 1n) throw new Error("Expected a fresh deployment in Registration phase. Re-run deploy-local.js first.");

  for (let i = 2; i < NAMES.length; i++) {
    const p = mockAadhaarProof(NAMES[i]);
    await (await ft.connect(signers[i]).register(p.nullifier, p.timestamp, p.revealArray, p.groth16Proof)).wait();
  }
  console.log(`Registered ${NAMES.length - 2} synthetic fans`);

  await network.provider.send("evm_increaseTime", [31 * 60]);
  await network.provider.send("evm_mine", []);
  await (await ft.requestDraw()).wait();
  await (await vrf.fulfill(await ft.vrfRequestId())).wait();
  await (await ft.runShuffle(100)).wait();
  console.log("Draw complete. Seed:", (await ft.randomSeed()).toString());

  const pub = Number(await ft.publicSeats());
  const tree = loadTree(deployment.inventory);
  await (await ft.revealSeats(...revealArgs(tree, [...Array(pub).keys()]))).wait();

  const order = await ft.getEntrants();
  const winners = Number(await ft.winnerCount());
  const price = await ft.facePrice();
  const bySigner = Object.fromEntries(signers.map((s) => [s.address, s]));
  for (let pos = 0; pos < winners - 1; pos++) {
    await (await ft.connect(bySigner[order[pos]]).claimTicket(pos, { value: price })).wait();
  }
  console.log(`${winners - 1} of ${winners} winners claimed. Waitlist: ${order.length - winners} fans.`);
  order.forEach((a, i) => {
    const idx = signers.findIndex((s) => s.address === a);
    console.log(`  ${String(i + 1).padStart(2)}. ${NAMES[idx].padEnd(8)} ${i < winners ? "winner" : `waitlist #${i - winners + 1}`}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
