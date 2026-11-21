// End-to-end test of the Fan Pass services (website must be running), WITHOUT using anyone's real Aadhaar:
// it temporarily points the laptop services at a throwaway event + Fan Pass registry that use a stand-in
// Aadhaar verifier, runs real Semaphore proofs through every endpoint, then restores the real event files.
//   npx hardhat run scripts/e2e-fanpass.js --network localhost
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const { mockAadhaarProof } = require("./lib/mockProof");
const { buildInventory } = require("./lib/inventory");
const { ARTIFACTS, TREE_DEPTH, deployFanPass } = require("./lib/fanpass");
const { Identity, Group, generateProof } = require(path.join(__dirname, "..", "app", "node_modules", "@semaphore-protocol", "core"));

const API = process.env.API || "http://127.0.0.1:5173";
const DEP = path.join(__dirname, "..", "app", "src", "deployment.json");
const MOB = path.join(__dirname, "..", "app", "public", "mobile-deployment.json");
const call = async (p, body) => {
  const r = await fetch(API + p, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const ok = (c, m) => { if (!c) throw new Error("FAIL: " + m); console.log("  ✓", m); };
const plain = (p) => JSON.parse(JSON.stringify(p, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

async function main() {
  const backup = { dep: fs.readFileSync(DEP, "utf8"), mob: fs.readFileSync(MOB, "utf8") };
  try {
    const real = JSON.parse(backup.dep);
    const mock = await (await ethers.getContractFactory("MockAnonAadhaar")).deploy();
    const { fanPass } = await deployFanPass(ethers, await mock.getAddress(), 99n);
    const vrf = await (await ethers.getContractFactory("MockVRFCoordinator")).deploy();
    const ft = await (await ethers.getContractFactory("FairTickets")).deploy("E2E · Test", ethers.parseEther("0.05"), 3600, 3600, await mock.getAddress(), 7n, await vrf.getAddress(),
      { keyHash: ethers.ZeroHash, subId: 1n, requestConfirmations: 3, callbackGasLimit: 500000, nativePayment: false });
    await (await ft.commitInventory(buildInventory({ publicSeats: 2 }).root, 2, 0, 0)).wait();
    await (await ft.setFanPass(await fanPass.getAddress(), true)).wait();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await (await ft.openRegistration(now + 3600, now + 86400)).wait();
    const passScope = (await ft.passScope()).toString();
    const tmp = { ...real, fairTickets: await ft.getAddress(), fanPass: { fanPass: await fanPass.getAddress(), seed: "99", passScope, treeDepth: TREE_DEPTH, abi: real.fanPass.abi } };
    fs.writeFileSync(DEP, JSON.stringify(tmp, null, 2));
    console.log("Temporary event", tmp.fairTickets);

    // Phone: a Fan Pass identity (secret stays here) -> kiosk pairing code.
    const id = new Identity();
    const c = id.commitment.toString();
    const r1 = await call("/api/fanpass/request", { commitment: c });
    ok(r1.status === 200 && /^[A-Z0-9]{6}$/.test(r1.json.code), `phone gets a pairing code (${r1.json.code})`);
    const r2 = await call(`/api/fanpass/request/${r1.json.code}`);
    ok(r2.json.commitment === c && r2.json.seed === "99", "kiosk looks the code up and gets the pass ID + seed");
    // Kiosk: Aadhaar proof bound to the commitment -> relayer enrols.
    const a = mockAadhaarProof("e2e-person");
    const proof = { nullifier: a.nullifier.toString(), timestamp: a.timestamp.toString(), revealArray: a.revealArray.map(String), groth16Proof: a.groth16Proof.map(String) };
    const r3 = await call("/api/fanpass/enroll", { commitment: c, proof });
    ok(r3.status === 200 && r3.json.ok, "kiosk enrols the pass (relayer paid gas)");
    ok((await call(`/api/fanpass/status?commitment=${c}`)).json.member === true, "phone sees its pass as active");
    const r4 = await call("/api/fanpass/enroll", { commitment: new Identity().commitment.toString(), proof });
    ok(r4.status === 400 && /newer Aadhaar QR/.test(r4.json.error), "same Aadhaar can't get a second pass with the same QR");

    // Phone: join the event in seconds with a Semaphore proof.
    const tree = (await call("/api/fanpass/tree")).json;
    const g = new Group(tree.leaves.map(BigInt));
    const fan = ethers.Wallet.createRandom();
    const t0 = Date.now();
    const sp = await generateProof(id, g, BigInt(fan.address), BigInt(passScope), TREE_DEPTH, ARTIFACTS);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const r5 = await call("/api/pass-register", { fan: fan.address, proof: plain(sp) });
    ok(r5.status === 200 && r5.json.ok, `phone registers with its Fan Pass (proof made in ${secs}s); relayer paid gas`);
    ok(r5.json.funded && (await ethers.provider.getBalance(fan.address)) > 0n, `new wallet got ${r5.json.funded} test ETH for the ticket (once per person)`);
    ok(await ft.isRegistered(fan.address), "registered on-chain");
    const fan2 = ethers.Wallet.createRandom();
    const sp2 = await generateProof(id, g, BigInt(fan2.address), BigInt(passScope), TREE_DEPTH, ARTIFACTS);
    const r6 = await call("/api/pass-register", { fan: fan2.address, proof: plain(sp2) });
    ok(r6.status === 400 && /already registered/.test(r6.json.error), "same person, second wallet: refused");

    // Help desk ownership check.
    const dpf = await generateProof(id, new Group([id.commitment]), BigInt(fan.address), BigInt(passScope), TREE_DEPTH, ARTIFACTS);
    await call(`/api/desk-proof/${fan.address}`, plain(dpf));
    const got = (await call(`/api/desk-proof/${fan.address}`)).json;
    ok((await call("/api/desk-verify", { proof: got, commitment: c })).json.ok === true, "help desk: phone proves it holds the pass of the person at the desk");
    ok((await call("/api/desk-verify", { proof: got, commitment: new Identity().commitment.toString() })).json.ok === false, "help desk: someone else's pass doesn't match");
    console.log("\nAll Fan Pass service checks passed.");
  } finally {
    fs.writeFileSync(DEP, backup.dep);
    fs.writeFileSync(MOB, backup.mob);
    console.log("Restored the real event files.");
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); }); // snarkjs workers keep node alive
