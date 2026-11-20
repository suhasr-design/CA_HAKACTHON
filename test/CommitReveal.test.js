const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time, mine } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { buildInventory, revealArgs } = require("../scripts/lib/inventory");
const { mockAadhaarProof } = require("../scripts/lib/mockProof");

const PRICE = ethers.parseEther("0.01");
const SECRET = ethers.id("organiser-secret-for-tests");
const COMMIT = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [SECRET]));

// Commit-reveal randomness (the Quai Orchard version, where Chainlink VRF isn't available).
describe("FairTicketsCommitReveal (Quai Orchard randomness)", () => {
  async function deploy() {
    const [organiser, a, b, c, stranger] = await ethers.getSigners();
    const aadhaar = await (await ethers.getContractFactory("MockAnonAadhaar")).deploy();
    const ft = await (await ethers.getContractFactory("FairTicketsCommitReveal")).deploy(
      "Test Concert", PRICE, 3600, 3600, await aadhaar.getAddress(), 42n
    );
    const inv = buildInventory({ publicSeats: 2 });
    await ft.commitInventory(inv.root, 2, 0, 0);
    return { ft, organiser, fans: [a, b, c], stranger, inv };
  }

  async function registeredAndClosed() {
    const ctx = await deploy();
    const { ft, fans } = ctx;
    await ft.commitSeed(COMMIT);
    const now = await time.latest();
    await ft.openRegistration(now + 600, now + 86400);
    for (let i = 0; i < fans.length; i++) {
      const p = mockAadhaarProof(`fan-${i}`);
      await ft.connect(fans[i]).register(p.nullifier, p.timestamp, p.revealArray, p.groth16Proof);
    }
    await time.increase(601);
    return ctx;
  }

  it("requires the seed commitment before registration opens", async () => {
    const { ft } = await loadFixture(deploy);
    const now = await time.latest();
    await expect(ft.openRegistration(now + 600, now + 86400)).to.be.revertedWith("Commit the seed first");
    await ft.commitSeed(COMMIT);
    await ft.openRegistration(now + 600, now + 86400);
    expect(await ft.phase()).to.equal(1n);
  });

  it("only the organiser commits, and only once", async () => {
    const { ft, stranger } = await loadFixture(deploy);
    await expect(ft.connect(stranger).commitSeed(COMMIT)).to.be.revertedWithCustomError(ft, "OwnableUnauthorizedAccount");
    await ft.commitSeed(COMMIT);
    await expect(ft.commitSeed(COMMIT)).to.be.revertedWith("Already committed");
  });

  it("can't draw while registration is open", async () => {
    const { ft } = await loadFixture(deploy);
    await ft.commitSeed(COMMIT);
    const now = await time.latest();
    await ft.openRegistration(now + 600, now + 86400);
    await expect(ft.requestDraw()).to.be.revertedWith("Registration still open");
  });

  it("reveal must wait for the future draw block and match the commitment", async () => {
    const { ft } = await loadFixture(registeredAndClosed);
    await ft.requestDraw();
    await expect(ft.revealSeed(SECRET)).to.be.revertedWith("Draw block not mined yet");
    await mine(1);
    await expect(ft.revealSeed(ethers.id("wrong"))).to.be.revertedWith("Secret does not match commitment");
    await expect(ft.revealSeed(SECRET)).to.emit(ft, "SeedRevealed");
    expect(await ft.phase()).to.equal(3n); // Shuffling
  });

  it("seed = keccak(secret, blockhash(drawBlock)) and the shuffle completes", async () => {
    const { ft } = await loadFixture(registeredAndClosed);
    await ft.requestDraw();
    await mine(1);
    await ft.revealSeed(SECRET);
    const drawBlock = await ft.drawBlock();
    const block = await ethers.provider.getBlock(Number(drawBlock));
    const expected = BigInt(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [SECRET, block.hash])));
    expect(await ft.randomSeed()).to.equal(expected);
    await ft.runShuffle(10);
    expect(await ft.phase()).to.equal(4n); // Sale
  });

  it("positionOf is O(1) and matches the shuffled list; pages return the same data", async () => {
    const { ft, fans, stranger, inv } = await loadFixture(registeredAndClosed);
    expect(await ft.positionOf(fans[0].address)).to.equal(ethers.MaxUint256); // not drawn yet
    await ft.requestDraw();
    await mine(1);
    await ft.revealSeed(SECRET);
    await ft.runShuffle(1); // partial shuffle: only slot 0 is final
    const firstSlot = await ft.entrantAt(0);
    expect(await ft.positionOf(firstSlot)).to.equal(0n);
    await ft.runShuffle(10);
    const order = [...(await ft.getEntrants())];
    for (const f of fans) expect(await ft.positionOf(f.address)).to.equal(BigInt(order.indexOf(f.address)));
    expect(await ft.positionOf(stranger.address)).to.equal(ethers.MaxUint256);
    expect([...(await ft.getEntrantsPage(1, 5))]).to.deep.equal(order.slice(1));
    expect([...(await ft.getEntrantsPage(9, 5))]).to.deep.equal([]);
    // winners claim; paged live tickets match the full list
    await ft.revealSeats(...revealArgs(inv.tree, [0, 1]));
    for (let p = 0; p < 2; p++) await ft.connect(fans.find((f) => f.address === order[p])).claimTicket(p, { value: PRICE });
    const all = await ft.getLiveTickets();
    const page = await ft.getLiveTicketsPage(0, 100);
    expect(page.ids.map(String)).to.deep.equal(all.ids.map(String));
    expect((await ft.getLiveTicketsPage(2, 1)).ids.map(String)).to.deep.equal(["2"]);
  });

  it("assisted desk: capped, organiser-only, one registration per document", async () => {
    const { ft, fans, stranger } = await loadFixture(deploy);
    await ft.setAssistedCap(1);
    await ft.commitSeed(COMMIT);
    const now = await time.latest();
    await ft.openRegistration(now + 600, now + 86400);
    await expect(ft.setAssistedCap(5)).to.be.revertedWithCustomError(ft, "WrongPhase"); // quota fixed once open
    const doc = ethers.id("passport:X1234567");
    await expect(ft.connect(stranger).assistedRegister(fans[0].address, doc)).to.be.revertedWithCustomError(ft, "OwnableUnauthorizedAccount");
    await expect(ft.assistedRegister(fans[0].address, doc)).to.emit(ft, "AssistedRegistered").withArgs(fans[0].address, doc);
    expect(await ft.isRegistered(fans[0].address)).to.equal(true);
    expect(await ft.assistedCount()).to.equal(1n);
    await expect(ft.assistedRegister(fans[1].address, ethers.id("passport:other"))).to.be.revertedWith("Assisted quota full");
  });

  it("assisted desk rejects the same document twice", async () => {
    const { ft, fans } = await loadFixture(deploy);
    await ft.setAssistedCap(5);
    await ft.commitSeed(COMMIT);
    const now = await time.latest();
    await ft.openRegistration(now + 600, now + 86400);
    const doc = ethers.id("passport:X1234567");
    await ft.assistedRegister(fans[0].address, doc);
    await expect(ft.assistedRegister(fans[1].address, doc)).to.be.revertedWith("This person is already registered");
  });

  it("only the organiser reveals; anyone can force a fallback draw if they don't", async () => {
    const { ft, stranger } = await loadFixture(registeredAndClosed);
    await ft.requestDraw();
    await mine(1);
    await expect(ft.connect(stranger).revealSeed(SECRET)).to.be.revertedWithCustomError(ft, "OwnableUnauthorizedAccount");
    await expect(ft.connect(stranger).fallbackDraw()).to.be.revertedWith("Organiser can still reveal");
    await mine(201);
    await expect(ft.revealSeed(SECRET)).to.be.revertedWith("Reveal window passed");
    await expect(ft.connect(stranger).fallbackDraw()).to.emit(ft, "FallbackDraw");
    expect(await ft.phase()).to.equal(3n);
  });
});
