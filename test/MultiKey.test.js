const { expect } = require("chai");
const { ethers } = require("hardhat");
const { UIDAI_KEY_HASHES, TEST_KEY_HASH } = require("../scripts/lib/aadhaarKeys");

// Real-Aadhaar mode: proofs from QRs signed by ANY of UIDAI's real keys are accepted; the
// public test key (anyone can make test QRs) is not.
describe("AnonAadhaarMultiKey (real UIDAI keys)", () => {
  async function deploy() {
    const mock = await (await ethers.getContractFactory("MockGroth16Verifier")).deploy();
    const multi = await (await ethers.getContractFactory("AnonAadhaarMultiKey")).deploy(await mock.getAddress(), UIDAI_KEY_HASHES);
    return { multi };
  }
  const proofSignedBy = (keyHash, extra = 0n) => [keyHash, extra, 0n, 0n, 0n, 0n, 0n, 0n];
  const verify = (multi, proof) => multi.verifyAnonAadhaarProof(1n, 2n, 3n, 4n, [0n, 0n, 0n, 0n], proof);

  it("stores the UIDAI keys, fixed at deployment", async () => {
    const { multi } = await deploy();
    expect((await multi.acceptedKeyHashes()).map(String)).to.deep.equal(UIDAI_KEY_HASHES.map(String));
  });

  it("accepts a proof from each real UIDAI key (2026 current, Feb-2026, 2021)", async () => {
    const { multi } = await deploy();
    for (const k of UIDAI_KEY_HASHES) expect(await verify(multi, proofSignedBy(k))).to.equal(true);
  });

  it("rejects the public TEST key and unknown keys", async () => {
    const { multi } = await deploy();
    expect(await verify(multi, proofSignedBy(TEST_KEY_HASH))).to.equal(false);
    expect(await verify(multi, proofSignedBy(12345n))).to.equal(false);
  });

  it("treats a verifier revert as invalid instead of failing", async () => {
    const { multi } = await deploy();
    expect(await verify(multi, proofSignedBy(UIDAI_KEY_HASHES[0], 0xbadn))).to.equal(false);
  });

  it("refuses an empty key list", async () => {
    const mock = await (await ethers.getContractFactory("MockGroth16Verifier")).deploy();
    await expect((await ethers.getContractFactory("AnonAadhaarMultiKey")).deploy(await mock.getAddress(), [])).to.be.revertedWith("1-8 key hashes");
  });
});
