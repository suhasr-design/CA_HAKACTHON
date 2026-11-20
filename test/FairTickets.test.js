const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { buildInventory, revealArgs } = require("../scripts/lib/inventory");
const { mockAadhaarProof } = require("../scripts/lib/mockProof");

const PRICE = ethers.parseEther("0.01");
const OFFER_WINDOW = 2 * 60 * 60;
const CLAIM_WINDOW = 24 * 60 * 60;
const Status = { NotFound: 0, Valid: 1, BeingReturned: 2, Replaced: 3 };

async function deployFixture() {
  const [organiser, ...fans] = await ethers.getSigners();
  const aadhaar = await (await ethers.getContractFactory("MockAnonAadhaar")).deploy();
  const vrf = await (await ethers.getContractFactory("MockVRFCoordinator")).deploy();
  const ft = await (await ethers.getContractFactory("FairTickets")).deploy(
    "Test Concert", PRICE, OFFER_WINDOW, CLAIM_WINDOW,
    await aadhaar.getAddress(), 12345n, await vrf.getAddress(),
    { keyHash: ethers.ZeroHash, subId: 1n, requestConfirmations: 3, callbackGasLimit: 500000, nativePayment: false }
  );
  const inv = buildInventory({ publicSeats: 3, sponsorSeats: 2, holdSeats: 1 });
  return { ft, vrf, organiser, fans, inv };
}

async function openFixture() {
  const ctx = await deployFixture();
  const { ft, inv } = ctx;
  await ft.commitInventory(inv.root, 3, 2, 1);
  const now = await time.latest();
  await ft.openRegistration(now + 3600, now + 30 * 86400);
  return ctx;
}

async function register(ft, fan, id) {
  const p = mockAadhaarProof(id);
  return ft.connect(fan).register(p.nullifier, p.timestamp, p.revealArray, p.groth16Proof);
}

// Six fans register, draw, shuffle and reveal all public seats -> Sale phase.
async function saleFixture() {
  const ctx = await openFixture();
  const { ft, vrf, fans, inv } = ctx;
  for (let i = 0; i < 6; i++) await register(ft, fans[i], `person-${i}`);
  await time.increase(3601);
  await ft.requestDraw();
  await vrf.fulfillWithSeed(await ft.vrfRequestId(), 42n);
  await ft.runShuffle(100);
  await ft.revealSeats(...revealArgs(inv.tree, [0, 1, 2]));
  const order = await ft.getEntrants();
  const byAddr = Object.fromEntries(fans.map((f) => [f.address, f]));
  const signers = order.map((a) => byAddr[a]);
  return { ...ctx, order, signers }; // signers[0..2] winners, [3..5] waitlist
}

describe("FairTickets", () => {
  describe("1. Inventory commitment", () => {
    it("locks the inventory once", async () => {
      const { ft, inv } = await loadFixture(deployFixture);
      await ft.commitInventory(inv.root, 3, 2, 1);
      expect(await ft.inventoryRoot()).to.equal(inv.root);
      await expect(ft.commitInventory(inv.root, 3, 2, 1)).to.be.revertedWith("Already committed");
    });

    it("accepts real seats and rejects a seat that is not in the committed list", async () => {
      const { ft, inv } = await loadFixture(openFixture);
      await ft.revealSeats(...revealArgs(inv.tree, [0]));
      expect(await ft.seatLabel(0)).to.equal("A-01");
      const [idx, , salts, proofs] = revealArgs(inv.tree, [1]);
      await expect(ft.revealSeats(idx, ["FAKE-99"], salts, proofs)).to.be.revertedWith("Seat not in committed inventory");
    });

    it("rejects revealing sponsor or hold seats as public", async () => {
      const { ft, inv } = await loadFixture(openFixture);
      await expect(ft.revealSeats(...revealArgs(inv.tree, [3]))).to.be.revertedWith("Not a public seat");
    });
  });

  describe("2. One human, one entry", () => {
    it("registers a verified person", async () => {
      const { ft, fans } = await loadFixture(openFixture);
      await expect(register(ft, fans[0], "asha")).to.emit(ft, "Registered");
      expect(await ft.entrantsCount()).to.equal(1n);
    });

    it("blocks the same person registering from a second wallet (same nullifier)", async () => {
      const { ft, fans } = await loadFixture(openFixture);
      await register(ft, fans[0], "asha");
      await expect(register(ft, fans[1], "asha")).to.be.revertedWith("This person is already registered");
    });

    it("blocks one wallet registering twice", async () => {
      const { ft, fans } = await loadFixture(openFixture);
      await register(ft, fans[0], "asha");
      await expect(register(ft, fans[0], "bilal")).to.be.revertedWith("Wallet already registered");
    });

    it("rejects an invalid proof (mock verifier)", async () => {
      const { ft, fans } = await loadFixture(openFixture);
      const p = mockAadhaarProof("bot", { valid: false });
      await expect(ft.connect(fans[0]).register(p.nullifier, p.timestamp, p.revealArray, p.groth16Proof))
        .to.be.revertedWith("Invalid Anon Aadhaar proof");
    });

    it("rejects registration after the window closes", async () => {
      const { ft, fans } = await loadFixture(openFixture);
      await time.increase(3601);
      await expect(register(ft, fans[0], "late")).to.be.revertedWith("Registration closed");
    });
  });

  describe("3. Verifiable lottery", () => {
    it("cannot draw while registration is open", async () => {
      const { ft } = await loadFixture(openFixture);
      await expect(ft.requestDraw()).to.be.revertedWith("Registration still open");
    });

    it("only the VRF coordinator can deliver randomness", async () => {
      const { ft, fans } = await loadFixture(openFixture);
      await register(ft, fans[0], "a");
      await time.increase(3601);
      await ft.requestDraw();
      await expect(ft.connect(fans[0]).rawFulfillRandomWords(1, [7n])).to.be.revertedWith("Only VRF coordinator");
    });

    it("shuffle is reproducible by anyone from the frozen list and the seed", async () => {
      const { ft, vrf, fans } = await loadFixture(openFixture);
      for (let i = 0; i < 6; i++) await register(ft, fans[i], `p${i}`);
      const frozen = [...(await ft.getEntrants())];
      await time.increase(3601);
      await ft.requestDraw();
      await vrf.fulfillWithSeed(await ft.vrfRequestId(), 999n);
      await ft.runShuffle(2); // batched
      await ft.runShuffle(100);
      expect(await ft.phase()).to.equal(4n); // Sale

      // Independent off-chain re-run of the same Fisher–Yates shuffle.
      const seed = await ft.randomSeed();
      const list = [...frozen];
      const coder = ethers.AbiCoder.defaultAbiCoder();
      for (let i = 0; i < list.length - 1; i++) {
        const r = BigInt(ethers.keccak256(coder.encode(["uint256", "uint256"], [seed, i])));
        const j = i + Number(r % BigInt(list.length - i));
        [list[i], list[j]] = [list[j], list[i]];
      }
      expect([...(await ft.getEntrants())]).to.deep.equal(list);
    });
  });

  describe("4. Claiming and non-transferable tickets", () => {
    it("a winner claims at face value; others cannot", async () => {
      const { ft, signers } = await loadFixture(saleFixture);
      await expect(ft.connect(signers[3]).claimTicket(3)).to.be.revertedWith("Not a winning position");
      await expect(ft.connect(signers[1]).claimTicket(0)).to.be.revertedWith("Not your position");
      await expect(ft.connect(signers[0]).claimTicket(0, { value: PRICE * 2n })).to.be.revertedWith("Pay exactly face value");
      await ft.connect(signers[0]).claimTicket(0, { value: PRICE });
      expect(await ft.ownerOf(1)).to.equal(signers[0].address);
      expect(await ft.ticketStatus(1)).to.equal(Status.Valid);
    });

    it("tickets cannot be transferred", async () => {
      const { ft, signers } = await loadFixture(saleFixture);
      await ft.connect(signers[0]).claimTicket(0, { value: PRICE });
      await expect(ft.connect(signers[0]).transferFrom(signers[0].address, signers[5].address, 1))
        .to.be.revertedWithCustomError(ft, "NonTransferable");
    });
  });

  describe("5. Buyback and waitlist", () => {
    it("sell-back offers the seat to waitlist #1; accepting burns the old ticket and refunds the seller", async () => {
      const { ft, signers } = await loadFixture(saleFixture);
      await ft.connect(signers[0]).claimTicket(0, { value: PRICE });
      await expect(ft.connect(signers[0]).sellBack(1)).to.emit(ft, "SeatOffered");
      expect((await ft.offers(0)).fan).to.equal(signers[3].address);
      expect(await ft.ticketStatus(1)).to.equal(Status.BeingReturned);

      await expect(ft.connect(signers[4]).acceptOffer(0, { value: PRICE })).to.be.revertedWith("Not your offer");
      await ft.connect(signers[3]).acceptOffer(0, { value: PRICE });

      expect(await ft.ticketStatus(1)).to.equal(Status.Replaced);
      expect(await ft.ownerOf(2)).to.equal(signers[3].address);
      expect(await ft.seatToken(0)).to.equal(2n);
      expect(await ft.pendingRefunds(signers[0].address)).to.equal(PRICE);
      await expect(ft.connect(signers[0]).withdrawRefund()).to.changeEtherBalance(signers[0], PRICE);
    });

    it("an expired offer moves to the next fan", async () => {
      const { ft, signers } = await loadFixture(saleFixture);
      await ft.connect(signers[0]).claimTicket(0, { value: PRICE });
      await ft.connect(signers[0]).sellBack(1);
      await expect(ft.expireOffer(0)).to.be.revertedWith("Offer still active");
      await time.increase(OFFER_WINDOW + 1);
      await expect(ft.connect(signers[3]).acceptOffer(0, { value: PRICE })).to.be.revertedWith("Offer expired");
      await ft.expireOffer(0);
      expect((await ft.offers(0)).fan).to.equal(signers[4].address);
    });

    it("if the waitlist runs out, the seller keeps the ticket", async () => {
      const { ft, signers } = await loadFixture(saleFixture);
      await ft.connect(signers[0]).claimTicket(0, { value: PRICE });
      await ft.connect(signers[0]).sellBack(1);
      for (let k = 0; k < 3; k++) {
        await time.increase(OFFER_WINDOW + 1);
        await ft.expireOffer(0);
      }
      expect((await ft.offers(0)).active).to.equal(false);
      expect(await ft.ticketStatus(1)).to.equal(Status.Valid);
      expect(await ft.ownerOf(1)).to.equal(signers[0].address);
    });

    it("unclaimed winning seats go to the waitlist after the claim window", async () => {
      const { ft, signers } = await loadFixture(saleFixture);
      await expect(ft.releaseUnclaimed(1)).to.be.revertedWith("Claim window still open");
      await time.increase(CLAIM_WINDOW + 1);
      await ft.releaseUnclaimed(1);
      expect((await ft.offers(1)).fan).to.equal(signers[3].address);
      await ft.connect(signers[3]).acceptOffer(1, { value: PRICE });
      expect(await ft.ownerOf(1)).to.equal(signers[3].address);
      expect(await ft.organiserBalance()).to.equal(PRICE);
    });

    it("buyback closes at the deadline", async () => {
      const { ft, signers } = await loadFixture(saleFixture);
      await ft.connect(signers[0]).claimTicket(0, { value: PRICE });
      await time.increase(31 * 86400);
      await expect(ft.connect(signers[0]).sellBack(1)).to.be.revertedWith("Buyback closed");
    });
  });

  describe("6. Public ticket check", () => {
    it("reports fake, valid and replaced tickets", async () => {
      const { ft, signers } = await loadFixture(saleFixture);
      expect((await ft.checkTicket(77)).status).to.equal(Status.NotFound);
      await ft.connect(signers[0]).claimTicket(0, { value: PRICE });
      const c = await ft.checkTicket(1);
      expect(c.status).to.equal(Status.Valid);
      expect(c.holder).to.equal(signers[0].address);
      expect(c.label).to.equal("A-01");
      const live = await ft.getLiveTickets();
      expect(live.ids.length).to.equal(1);
    });
  });
});
