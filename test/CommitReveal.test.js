const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time, mine } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { buildInventory } = require("../scripts/lib/inventory");
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
    return { ft, organiser, fans: [a, b, c], stranger };
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
