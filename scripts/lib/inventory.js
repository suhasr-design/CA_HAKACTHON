// Builds the seat inventory and its Merkle tree (OpenZeppelin StandardMerkleTree format,
// which matches the leaf check in FairTickets.revealSeats).
const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");
const { ethers } = require("ethers");

const LEAF_TYPES = ["uint256", "string", "string", "bytes32"];

function seatLabel(i, prefix) {
  const row = String.fromCharCode(65 + Math.floor(i / 20)); // A, B, C ...
  return `${prefix}${row}-${String((i % 20) + 1).padStart(2, "0")}`;
}

/**
 * Public seats take indexes 0..publicSeats-1, then sponsor seats, then holds.
 * Each seat gets a random salt so the root reveals nothing before the sale.
 */
function buildInventory({ publicSeats, sponsorSeats = 0, holdSeats = 0 }) {
  const values = [];
  let idx = 0;
  const add = (count, category, prefix) => {
    for (let i = 0; i < count; i++) {
      values.push([idx++, seatLabel(i, prefix), category, ethers.hexlify(ethers.randomBytes(32))]);
    }
  };
  add(publicSeats, "public", "");
  add(sponsorSeats, "sponsor", "S");
  add(holdSeats, "hold", "H");
  const tree = StandardMerkleTree.of(values, LEAF_TYPES);
  return { tree, values, root: tree.root, counts: { publicSeats, sponsorSeats, holdSeats } };
}

/** Arguments for FairTickets.revealSeats for the given public seat indexes. */
function revealArgs(tree, indexes) {
  const idx = [], labels = [], salts = [], proofs = [];
  for (const [i, v] of tree.entries()) {
    if (!indexes.includes(Number(v[0]))) continue;
    idx.push(v[0]);
    labels.push(v[1]);
    salts.push(v[3]);
    proofs.push(tree.getProof(i));
  }
  return [idx, labels, salts, proofs];
}

function loadTree(json) {
  return StandardMerkleTree.load(json);
}

module.exports = { buildInventory, revealArgs, loadTree, LEAF_TYPES };
