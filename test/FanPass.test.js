const path = require("path");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { buildInventory } = require("../scripts/lib/inventory");
const { mockAadhaarProof } = require("../scripts/lib/mockProof");
const { ARTIFACTS, TREE_DEPTH, deployFanPass, toStruct } = require("../scripts/lib/fanpass");

// Real Semaphore v4 identities and zero-knowledge proofs (the official library and circuit).
const { Identity, Group, generateProof } = require(path.join(__dirname, "..", "app", "node_modules", "@semaphore-protocol", "core"));

const COMMIT = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [ethers.id("s")]));

describe("Fan Pass (prove Aadhaar once, join events with a light Semaphore proof)", function () {
  this.timeout(180000);

  async function setup() {
    const [organiser, fanA, fanB, relayer] = await ethers.getSigners();
    const aadhaar = await (await ethers.getContractFactory("MockAnonAadhaar")).deploy();
    const { fanPass, semaphore } = await deployFanPass(ethers, await aadhaar.getAddress());
    const ft = await (await ethers.getContractFactory("FairTicketsCommitReveal")).deploy("Pass Event", 1n, 3600, 3600, await aadhaar.getAddress(), 7n);
    const inv = buildInventory({ publicSeats: 2 });
    await ft.commitInventory(inv.root, 2, 0, 0);
    await ft.setFanPass(await fanPass.getAddress(), true);
    await ft.commitSeed(COMMIT);
    const now = await time.latest();
    await ft.openRegistration(now + 3600, now + 86400);
    return { organiser, fanA, fanB, relayer, aadhaar, fanPass, semaphore, ft };
  }

  const enroll = (fanPass, id, aadhaarId, ts, siblings = []) => {
    const p = mockAadhaarProof(aadhaarId);
    return fanPass.enroll(id.commitment, p.nullifier, ts ?? p.timestamp, p.revealArray, p.groth16Proof, siblings);
  };
  const prove = async (fanPass, id, members, wallet, scope) =>
    toStruct(await generateProof(id, new Group(members), BigInt(wallet), scope, TREE_DEPTH, ARTIFACTS));

  it("enrols once per Aadhaar; anyone (a kiosk) can submit; a forged Aadhaar proof fails", async () => {
    const { fanPass, relayer } = await setup();
    const id = new Identity();
    await expect(enroll(fanPass.connect(relayer), id, "asha")).to.emit(fanPass, "Enrolled");
    expect(await fanPass.isMember(id.commitment)).to.equal(true);
    const bad = mockAadhaarProof("bot", { valid: false });
    await expect(fanPass.enroll(new Identity().commitment, bad.nullifier, bad.timestamp, bad.revealArray, bad.groth16Proof, [])).to.be.revertedWith("Invalid Anon Aadhaar proof");
  });

  it("a real Semaphore proof registers the fan's wallet; the same person can't enter twice", async () => {
    const { fanPass, ft, fanA, fanB, relayer } = await setup();
    const id = new Identity();
    await enroll(fanPass, id, "asha");
    const scope = await ft.passScope();
    const proofA = await prove(fanPass, id, [id.commitment], fanA.address, scope);
    // A relayer pays the gas; the entry still goes to fanA (the proof's message).
    await ft.connect(relayer).registerWithPass(fanA.address, proofA);
    expect(await ft.isRegistered(fanA.address)).to.equal(true);
    // Same person, second wallet -> same per-event nullifier -> rejected.
    const proofB = await prove(fanPass, id, [id.commitment], fanB.address, scope);
    await expect(ft.registerWithPass(fanB.address, proofB)).to.be.revertedWith("This person is already registered");
  });

  it("a proof can't be redirected to another wallet, and passes only work for their event", async () => {
    const { fanPass, ft, fanA, fanB } = await setup();
    const id = new Identity();
    await enroll(fanPass, id, "asha");
    const proof = await prove(fanPass, id, [id.commitment], fanA.address, await ft.passScope());
    await expect(ft.registerWithPass(fanB.address, proof)).to.be.revertedWith("Invalid Fan Pass proof");
    const otherEvent = await prove(fanPass, id, [id.commitment], fanA.address, 12345n);
    await expect(ft.registerWithPass(fanA.address, otherEvent)).to.be.revertedWith("Invalid Fan Pass proof");
  });

  it("someone without a Fan Pass can't register, and pass-only events close the direct Aadhaar route", async () => {
    const { fanPass, ft, fanA } = await setup();
    const member = new Identity();
    await enroll(fanPass, member, "asha");
    const outsider = new Identity();
    await expect(prove(fanPass, outsider, [member.commitment], fanA.address, await ft.passScope())).to.be.rejected; // not in the group
    const p = mockAadhaarProof("asha");
    const nonZero = [...p.groth16Proof]; nonZero[0] = 1n;
    await expect(ft.connect(fanA).register(p.nullifier, p.timestamp, p.revealArray, nonZero)).to.be.revertedWith("Use your Fan Pass");
  });

  it("lost phone: re-enrolling with a newer QR retires the old pass; replaying the old proof fails", async () => {
    const { fanPass, ft, fanA } = await setup();
    const oldId = new Identity();
    await enroll(fanPass, oldId, "asha", 1000n);
    const newId = new Identity();
    await expect(enroll(fanPass, newId, "asha", 1000n, [])).to.be.revertedWith("Use a newer Aadhaar QR");
    const siblings = new Group([oldId.commitment]).generateMerkleProof(0).siblings;
    await expect(enroll(fanPass, newId, "asha", 2000n, siblings)).to.emit(fanPass, "Replaced");
    expect(await fanPass.isMember(oldId.commitment)).to.equal(false);
    expect(await fanPass.members()).to.equal(1n);
    await expect(enroll(fanPass, oldId, "asha", 1500n)).to.be.revertedWith("Use a newer Aadhaar QR");
    // The new pass works (tree: old leaf removed = 0, new leaf).
    const g = new Group([oldId.commitment, newId.commitment]); g.removeMember(0);
    const proof = toStruct(await generateProof(newId, g, BigInt(fanA.address), await ft.passScope(), TREE_DEPTH, ARTIFACTS));
    await ft.registerWithPass(fanA.address, proof);
    expect(await ft.isRegistered(fanA.address)).to.equal(true);
  });
});
