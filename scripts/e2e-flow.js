// End-to-end check of a realistic event on the local chain + the laptop services (website must be running).
//   npx hardhat run scripts/e2e-flow.js --network localhost
// Registers the synthetic crowd, closes registration, draws, shuffles, reveals all seats, lets the winners
// claim, then exercises gate sync and the gas-sponsor anti-drain rule. Leaves the event in the Sale phase.
const path = require("path");
const { ethers, network } = require("hardhat");
const { mockAadhaarProof } = require("./lib/mockProof");
const { loadTree, revealArgs } = require("./lib/inventory");

const API = process.env.API || "http://127.0.0.1:5173";
const post = (p, body) => fetch(API + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }));
const check = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("  ✓", msg); };

async function main() {
  const dep = require(path.join(__dirname, "..", "app", "src", "deployment.json"));
  const [org] = await ethers.getSigners();
  const ft = new ethers.Contract(dep.fairTickets, dep.abi.fairTickets, org);
  const vrf = new ethers.Contract(dep.vrfCoordinator, dep.abi.vrf, org);
  const crowd = dep.crowd.map((c) => new ethers.Wallet(c.key, ethers.provider));
  const seats = Number(await ft.publicSeats());
  console.log(`Event: ${await ft.eventName()} · ${seats} seats · crowd ${crowd.length}`);

  // 1. Crowd registers (synthetic proofs accepted only for listed crowd wallets).
  const zero = Array(8).fill(0n);
  for (let k = 0; k < crowd.length; k += 20) {
    await Promise.all(crowd.slice(k, k + 20).map(async (w, i) => {
      const n = BigInt(ethers.id(`crowd:${k + i}`));
      await (await ft.connect(w).register(n, 0, [0, 0, 0, 0], zero)).wait();
    }));
  }
  check(Number((await ft.getEntrants()).length) === crowd.length, `${crowd.length} crowd fans registered`);

  // A bot: random wallet, forged proof -> rejected.
  const bot = ethers.Wallet.createRandom().connect(ethers.provider);
  await (await org.sendTransaction({ to: bot.address, value: ethers.parseEther("1") })).wait();
  const forged = mockAadhaarProof("bot", { valid: false });
  let botOk = true;
  try { await (await ft.connect(bot).register(forged.nullifier, forged.timestamp, forged.revealArray, forged.groth16Proof)).wait(); } catch { botOk = false; }
  check(!botOk, "bot with a forged proof is rejected on-chain");

  // Assisted desk.
  await (await ft.assistedRegister(ethers.Wallet.createRandom().address, ethers.id("Passport|Z9876543"))).wait();
  check(Number(await ft.assistedCount()) === 1, "ID desk registration counted publicly (1 of quota)");

  // 2. Close registration, draw, shuffle.
  const closes = Number(await ft.registrationClosesAt());
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  await network.provider.send("evm_increaseTime", [closes - now + 60]);
  await network.provider.send("evm_mine", []);
  await (await ft.requestDraw()).wait();
  await (await vrf.fulfill(await ft.vrfRequestId())).wait();
  await (await ft.runShuffle(500)).wait();
  check(Number(await ft.phase()) === 4, "draw + shuffle done, sale open");
  const order = [...(await ft.getEntrants())];
  check(Number(await ft.positionOf(order[seats])) === seats, `person #${seats + 1} found at position ${seats} in O(1) → waitlist #1`);

  // 3. Reveal all seats, winners claim.
  const tree = loadTree(dep.inventory);
  await (await ft.revealSeats(...revealArgs(tree, [...Array(seats).keys()]))).wait();
  const price = await ft.facePrice();
  const byAddr = new Map(crowd.map((w) => [w.address, w]));
  const winners = order.slice(0, seats).filter((a) => byAddr.has(a));
  for (let k = 0; k < winners.length; k += 20) {
    await Promise.all(winners.slice(k, k + 20).map(async (a) => (await ft.connect(byAddr.get(a)).claimTicket(order.indexOf(a), { value: price })).wait()));
  }
  const live = await ft.getLiveTickets();
  check(live.ids.length === winners.length, `${winners.length} winners claimed tickets at face value`);
  const page = await ft.getLiveTicketsPage(1, 50);
  check(page.ids.length === 50, "gate can sync the ticket list in pages (50)");

  // 4. Gate sync: ticket 1 at Gate A, then Gate B must be refused.
  await post("/api/gate/reset", { contract: dep.fairTickets });
  const a = await post("/api/gate/scan", { contract: dep.fairTickets, ticket: 1, gate: "Gate A" });
  const b = await post("/api/gate/scan", { contract: dep.fairTickets, ticket: 1, gate: "Gate B" });
  check(a.json.ok && !b.json.ok && b.json.already.gate === "Gate A", "same ticket at Gate B is refused: already entered at Gate A");
  await post("/api/gate/reset", { contract: dep.fairTickets });

  // 5. Gas sponsor: no valid proof -> no gas (bots can't drain it).
  const s = await post("/api/sponsor", { address: bot.address, proof: { nullifier: "1", timestamp: "1", revealArray: ["0", "0", "0", "0"], groth16Proof: ["1", "2", "3", "4", "5", "6", "7", "8"] } });
  check(s.status === 403, "gas sponsor refuses a wallet without a valid Aadhaar proof");

  console.log("\nAll end-to-end checks passed.");
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
