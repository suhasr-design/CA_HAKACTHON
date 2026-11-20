const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mockAadhaarProof } = require("../scripts/lib/mockProof");

// From @anon-aadhaar/core constants (test signing key used by test-mode QR codes).
const TEST_PUBKEY_HASH = 15134874015316324267425466444584014077184337590635665158241104437045239495873n;

describe("Real Anon Aadhaar verifier + demo router", () => {
  async function deploy() {
    const [, synthetic, stranger] = await ethers.getSigners();
    const verifier = await (await ethers.getContractFactory("Verifier")).deploy();
    const anon = await (await ethers.getContractFactory("AnonAadhaar")).deploy(await verifier.getAddress(), TEST_PUBKEY_HASH);
    const router = await (await ethers.getContractFactory("DemoAadhaarRouter")).deploy(await anon.getAddress(), [synthetic.address]);
    return { anon, router, synthetic, stranger };
  }
  const signalOf = (a) => BigInt(a);

  it("deploys the official verifier with the test public key", async () => {
    const { anon } = await deploy();
    expect(await anon.storedPublicKeyHash()).to.equal(TEST_PUBKEY_HASH);
  });

  it("rejects a fake proof at the real verifier", async () => {
    const { anon } = await deploy();
    const fake = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n];
    let ok;
    try { ok = await anon.verifyAnonAadhaarProof(1, 2, 3, 4, [0, 0, 0, 0], fake); } catch { ok = false; }
    expect(ok).to.equal(false);
  });

  it("accepts a synthetic proof only for listed demo accounts", async () => {
    const { router, synthetic, stranger } = await deploy();
    const p = mockAadhaarProof("x");
    expect(await router.verifyAnonAadhaarProof(1, p.nullifier, p.timestamp, signalOf(synthetic.address), p.revealArray, p.groth16Proof)).to.equal(true);
    expect(await router.verifyAnonAadhaarProof(1, p.nullifier, p.timestamp, signalOf(stranger.address), p.revealArray, p.groth16Proof)).to.equal(false);
  });

  it("forwards non-synthetic proofs to the real verifier", async () => {
    const { router, synthetic } = await deploy();
    const fake = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n];
    let ok;
    try { ok = await router.verifyAnonAadhaarProof(1, 2, 3, signalOf(synthetic.address), [0, 0, 0, 0], fake); } catch { ok = false; }
    expect(ok).to.equal(false);
  });
});
