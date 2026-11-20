// Synthetic Anon Aadhaar "proof" for demo crowd accounts and unit tests.
// The groth16Proof is all zeros: DemoAadhaarRouter accepts it ONLY for the synthetic
// accounts listed at deployment. Real fans use a real zero-knowledge proof instead.
// The nullifier comes from a test identity string, so the same "person" always gets the
// same nullifier, which is what blocks double registration.
const { ethers } = require("ethers");

function mockAadhaarProof(testIdentity, { valid = true } = {}) {
  const nullifier = BigInt(ethers.keccak256(ethers.toUtf8Bytes(`test-aadhaar:${testIdentity.trim().toLowerCase()}`)));
  const timestamp = BigInt(Math.floor(Date.now() / 1000));
  const revealArray = [0n, 0n, 0n, 0n];
  const groth16Proof = [0n, 0n, 0n, 0n, 0n, 0n, 0n, valid ? 0n : 0xdeadn];
  return { nullifier, timestamp, revealArray, groth16Proof };
}

module.exports = { mockAadhaarProof };
