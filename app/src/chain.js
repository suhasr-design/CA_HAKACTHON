import { ethers } from "ethers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import deployment from "./deployment.json";

export { deployment };

// Hardhat's well-known public test mnemonic. DEMO ONLY: these keys are public and hold
// only local test ETH. Never use them on a real network.
const MNEMONIC = "test test test test test test test test test test test junk";

export const NAMES = [
  "Organiser", "Asha", "Bilal", "Chetan", "Divya", "Esha", "Farhan", "Gauri", "Harsh",
  "Isha", "Jai", "Kavya", "Lokesh", "Meera", "Nikhil", "Omkar", "Priya", "Rahul", "Sneha", "Scalper",
];
export const SCALPER = 19;
export const isSyntheticAccount = (i) => (deployment.syntheticAccounts || []).includes(i);

export const PHASES = ["Setup", "Registration", "Drawing", "Shuffling", "Sale"];
export const STATUS = ["Not found", "Valid", "Being returned", "Replaced"];

export const provider = new ethers.JsonRpcProvider(deployment.rpcUrl, ethers.Network.from(deployment.chainId), {
  staticNetwork: ethers.Network.from(deployment.chainId),
  pollingInterval: 1000,
});

const root = ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, "m/44'/60'/0'/0");
const wallets = NAMES.map((_, i) => root.deriveChild(i).connect(provider));

export const wallet = (i) => wallets[i];
export const addressOf = (i) => wallets[i].address;
export const indexOf = (addr) => wallets.findIndex((w) => w.address.toLowerCase() === String(addr).toLowerCase());

// Labelled synthetic crowd (keys from Hardhat's public test mnemonic, local test ETH only).
export const CROWD = (deployment.crowd || []).map((c) => ({ ...c, lower: c.address.toLowerCase() }));
const crowdByAddr = new Map(CROWD.map((c) => [c.lower, c]));
export const crowdWallet = (c) => new ethers.Wallet(c.key, provider);
export const isCrowd = (addr) => crowdByAddr.has(String(addr).toLowerCase());
export const EVENT = deployment.event || {};

export const nameOf = (addr) => {
  const i = indexOf(addr);
  if (i >= 0) return NAMES[i];
  const c = crowdByAddr.get(String(addr).toLowerCase());
  return c ? c.name : short(addr);
};
export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export const fairTickets = (signerOrProvider = provider) =>
  new ethers.Contract(deployment.fairTickets, deployment.abi.fairTickets, signerOrProvider);
export const vrf = (signer) => new ethers.Contract(deployment.vrfCoordinator, deployment.abi.vrf, signer);

export const inventoryTree = () => StandardMerkleTree.load(deployment.inventory);

/** Arguments for revealSeats (same format as scripts/lib/inventory.js). */
export function revealArgs(indexes) {
  const tree = inventoryTree();
  const idx = [], labels = [], salts = [], proofs = [];
  for (const [i, v] of tree.entries()) {
    if (!indexes.includes(Number(v[0]))) continue;
    idx.push(v[0]); labels.push(v[1]); salts.push(v[3]); proofs.push(tree.getProof(i));
  }
  return [idx, labels, salts, proofs];
}

/** Category counts from the committed seat file (public, sponsor, hold). */
export function inventorySeats() {
  const tree = inventoryTree();
  return [...tree.entries()].map(([, v]) => ({ index: Number(v[0]), label: v[1], category: v[2] }));
}

/**
 * Synthetic proof for the demo crowd: all-zero groth16Proof. The DemoAadhaarRouter accepts it
 * ONLY for synthetic accounts listed at deployment. Same identity => same nullifier.
 */
export function syntheticProof(testIdentity) {
  const nullifier = BigInt(ethers.keccak256(ethers.toUtf8Bytes(`test-aadhaar:${testIdentity.trim().toLowerCase()}`)));
  return {
    nullifier,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    revealArray: [0n, 0n, 0n, 0n],
    groth16Proof: [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
  };
}

/** What a bot sends: a made-up proof. The real verifier rejects it. */
export function fakeProof() {
  const r = () => BigInt(ethers.hexlify(ethers.randomBytes(31)));
  return {
    nullifier: r(),
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    revealArray: [0n, 0n, 0n, 0n],
    groth16Proof: Array.from({ length: 8 }, r),
  };
}

/** Local chain only: move the blockchain clock forward. */
export async function fastForward(seconds) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

/** Readable error text from an ethers error, including custom errors. */
export function errorText(e) {
  if (e?.revert?.name) return `${e.revert.name}${e.revert.args?.length ? `(${e.revert.args.join(", ")})` : ""}`;
  const m = e?.reason || e?.shortMessage || e?.message || String(e);
  return m.replace(/^execution reverted: /, "").replace(/^Error: VM Exception.*reverted with reason string '(.*)'$/, "$1");
}

// How each wallet registered: "zk" (real Anon Aadhaar proof) or "synthetic". Cached per tx.
const regKindCache = new Map();
async function registrationKinds(ft) {
  const events = await ft.queryFilter(ft.filters.Registered(), 0, "latest");
  const out = {};
  const order = [];
  await Promise.all(
    events.map(async (e) => {
      const fan = e.args.fan;
      order.push({ fan, block: e.blockNumber, index: e.index });
      if (!regKindCache.has(e.transactionHash)) {
        const tx = await provider.getTransaction(e.transactionHash);
        const parsed = ft.interface.parseTransaction({ data: tx.data });
        if (parsed.name === "assistedRegister") regKindCache.set(e.transactionHash, "assisted");
        else if (parsed.name === "registerWithPass") regKindCache.set(e.transactionHash, "pass");
        else regKindCache.set(e.transactionHash, parsed.args.groth16Proof.every((x) => x === 0n) ? "synthetic" : "zk");
      }
      out[fan] = regKindCache.get(e.transactionHash);
    })
  );
  order.sort((a, b) => a.block - b.block || a.index - b.index);
  return { kinds: out, registrationOrder: order.map((o) => o.fan) };
}

/** Reads everything the screens need. Fine for demo-sized events. */
export async function loadState() {
  const ft = fairTickets();
  const [
    eventName, phase, facePrice, publicSeats, sponsorSeats, holdSeats, inventoryRoot,
    regCloses, claimDeadline, buybackDeadline, randomSeed, shuffledUpTo, nextTokenId,
    nextWaitlistIndex, winnerCount, organiserBalance, entrants, block, regs, assistedCap, assistedCount,
  ] = await Promise.all([
    ft.eventName(), ft.phase(), ft.facePrice(), ft.publicSeats(), ft.sponsorSeats(), ft.holdSeats(),
    ft.inventoryRoot(), ft.registrationClosesAt(), ft.claimDeadline(), ft.buybackDeadline(),
    ft.randomSeed(), ft.shuffledUpTo(), ft.nextTokenId(), ft.nextWaitlistIndex(), ft.winnerCount(),
    ft.organiserBalance(), ft.getEntrants(), provider.getBlock("latest"), registrationKinds(ft),
    ft.assistedCap(), ft.assistedCount(),
  ]);

  const seatIdx = [...Array(Number(publicSeats)).keys()];
  const [offers, seatIssued, seatLabels] = await Promise.all([
    Promise.all(seatIdx.map((s) => ft.offers(s))),
    Promise.all(seatIdx.map((s) => ft.seatIssued(s))),
    Promise.all(seatIdx.map((s) => ft.seatLabel(s))),
  ]);

  const tokenIds = [...Array(Math.max(0, Number(nextTokenId) - 1)).keys()].map((i) => i + 1);
  const tickets = await Promise.all(
    tokenIds.map(async (id) => {
      const c = await ft.checkTicket(id);
      return { id, status: Number(c.status), holder: c.holder, seat: Number(c.seat), label: c.label };
    })
  );

  return {
    eventName, phase: Number(phase), facePrice, publicSeats: Number(publicSeats),
    sponsorSeats: Number(sponsorSeats), holdSeats: Number(holdSeats), inventoryRoot,
    regCloses: Number(regCloses), claimDeadline: Number(claimDeadline), buybackDeadline: Number(buybackDeadline),
    randomSeed, shuffledUpTo: Number(shuffledUpTo), nextWaitlistIndex: Number(nextWaitlistIndex),
    winnerCount: Number(winnerCount), organiserBalance, entrants: [...entrants], chainTime: block.timestamp,
    blockNumber: block.number,
    regKinds: regs.kinds, registrationOrder: regs.registrationOrder,
    assistedCap: Number(assistedCap), assistedCount: Number(assistedCount),
    offers: offers.map((o, seat) => ({ seat, fan: o.fan, deadline: Number(o.deadline), seller: o.seller, tokenId: Number(o.tokenId), active: o.active })),
    seatIssued, seatLabels, tickets,
  };
}

/** Rebuilds the draw off-chain from the registration order and the VRF seed. */
export function verifyDraw(seed, registrationOrder, onChainOrder) {
  const list = [...registrationOrder];
  const coder = ethers.AbiCoder.defaultAbiCoder();
  for (let i = 0; i < list.length - 1; i++) {
    const r = BigInt(ethers.keccak256(coder.encode(["uint256", "uint256"], [seed, i])));
    const j = i + Number(r % BigInt(list.length - i));
    [list[i], list[j]] = [list[j], list[i]];
  }
  const match = list.length === onChainOrder.length && list.every((a, i) => a === onChainOrder[i]);
  return { match, recomputed: list };
}

export const fmtTime = (unix) => (unix ? new Date(unix * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
export const fmtLeft = (secs) => {
  if (secs <= 0) return "passed";
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
};
export const eth = (wei) => `${ethers.formatEther(wei)} ETH`;
