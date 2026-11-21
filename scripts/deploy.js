// Deploys Fair Tickets (with Fan Pass) to Quai Orchard Cyprus-1, following the organisers' reference project
// (Yaswitha-Kurra/Quai-Network-Contract-Deploy-Example): quais provider, quais.Wallet, IPFS metadata hash,
// quais.ContractFactory(abi, bytecode, wallet, ipfsHash).
//
// SAFE BY DEFAULT: without DEPLOY_CONFIRM=yes it only runs the preflight and broadcasts NOTHING.
//   Preflight:  npx hardhat run scripts/deploy.js --network cyprus1
//   Deploy:     $env:DEPLOY_CONFIRM="yes"; npx hardhat run scripts/deploy.js --network cyprus1
//
// IPFS: @quai/hardhat-deploy-metadata uploads each contract's metadata to a hard-coded server
// (https://ipfs.qu.ai/api/v0). When that server is down it returns "" and quais refuses to deploy
// ("IPFSHash is not set"), which also breaks the reference repo. The hash it returns is simply the
// metadata CID that solc already embedded in the bytecode, so this script:
//   1. tries the official upload once;
//   2. if IPFS is unavailable, uses the SAME CID computed locally (and checked against the bytecode),
//      saves the metadata JSON in metadata/, and records "metadataPinned": false;
//   3. scripts/pin-metadata.js publishes those files to IPFS later; the CIDs will match exactly.
// Set IPFS=skip to go straight to step 2.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const quais = require("quais");
const Hash = require("ipfs-only-hash");
const bs58mod = require("bs58");
const hre = require("hardhat");
const { deployMetadata } = hre;
const { buildInventory } = require("./lib/inventory");
const { UIDAI_KEY_HASHES, TEST_KEY_HASH } = require("./lib/aadhaarKeys");
const { FANPASS_SEED } = require("./lib/fanpass");

const bs58 = bs58mod.default || bs58mod;
const EXPECTED_CHAIN_ID = 15000n;
const AADHAAR_MODE = (process.env.AADHAAR_MODE || "real").toLowerCase() === "test" ? "test" : "real";
const KEY_HASHES = AADHAAR_MODE === "real" ? UIDAI_KEY_HASHES : [TEST_KEY_HASH];
const EVENT = {
  name: "Coldplay · Bengaluru · Demo Night",
  facePrice: 10n ** 16n,          // 0.01 QUAI
  offerWindow: 10 * 60,
  claimWindow: 30 * 60,
  nullifierSeed: 20260118n,
  seats: { publicSeats: 8, sponsorSeats: 2, holdSeats: 2 },
  assistedCap: 5,
  registrationMinutes: 120,
  buybackDays: 7,
};

// Fully qualified artifact names, in deployment order.
const C = {
  Verifier: "@anon-aadhaar/contracts/src/Verifier.sol:Verifier",
  AnonAadhaarMultiKey: "contracts/anon/AnonAadhaarMultiKey.sol:AnonAadhaarMultiKey",
  PoseidonT3: "poseidon-solidity/PoseidonT3.sol:PoseidonT3",
  SemaphoreVerifier: "@semaphore-protocol/contracts/base/SemaphoreVerifier.sol:SemaphoreVerifier",
  Semaphore: "@semaphore-protocol/contracts/Semaphore.sol:Semaphore",
  FanPass: "contracts/FanPass.sol:FanPass",
  FairTicketsCommitReveal: "contracts/FairTicketsCommitReveal.sol:FairTicketsCommitReveal",
};

/** The metadata CID solc embedded in the bytecode (what the plugin would return), computed locally. */
async function localMetadataCid(fqn) {
  const art = await hre.artifacts.readArtifact(fqn);
  const build = await hre.artifacts.getBuildInfo(fqn);
  const metadata = build.output.contracts[art.sourceName][art.contractName].metadata;
  const cid = await Hash.of(metadata);
  const multihash = Buffer.from(bs58.decode(cid)).toString("hex");
  if (!art.deployedBytecode.toLowerCase().includes(multihash)) throw new Error(`STOP: metadata CID for ${art.contractName} not found in its bytecode.`);
  const out = path.join(hre.config.paths.root, "metadata", `${art.contractName}_metadata.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, metadata); // exact bytes, so the CID matches when pinned later
  return cid;
}

/** Fill in linked library addresses (Semaphore uses the PoseidonT3 library). */
function link(art, libs) {
  let bytecode = art.bytecode;
  for (const [file, names] of Object.entries(art.linkReferences || {})) {
    for (const [name, refs] of Object.entries(names)) {
      const addr = libs[`${file}:${name}`];
      if (!addr) throw new Error(`Missing library ${file}:${name}`);
      for (const { start, length } of refs) {
        const at = 2 + start * 2;
        bytecode = bytecode.slice(0, at) + addr.toLowerCase().replace(/^0x/, "").padStart(length * 2, "0") + bytecode.slice(at + length * 2);
      }
    }
  }
  return bytecode;
}

async function main() {
  if (hre.network.name !== "cyprus1") throw new Error("Run with --network cyprus1 (and set RPC_URL, CYPRUS1_PK, CHAIN_ID in .env).");

  // ------------------------------------------------------------ preflight (read-only)
  // RPC_URL already ends in /cyprus1, so pathing stays off (with it on, quais hangs on getNetwork).
  const provider = new quais.JsonRpcProvider(hre.network.config.url, undefined, { usePathing: false });
  const wallet = new quais.Wallet(hre.network.config.accounts[0], provider);
  const net = await provider.getNetwork();
  const balance = await provider.getBalance(wallet.address);
  const nonce = await provider.getTransactionCount(wallet.address);
  console.log("Network RPC   :", hre.network.config.url);
  console.log("Chain ID      :", net.chainId.toString());
  console.log("Deployer      :", wallet.address, `(${nonce} txs sent so far)`);
  console.log("Balance       :", quais.formatQuai(balance), "QUAI");
  console.log(`Aadhaar mode  : ${AADHAAR_MODE.toUpperCase()} (${KEY_HASHES.length} UIDAI key hash${KEY_HASHES.length > 1 ? "es" : ""})`);
  if (net.chainId !== EXPECTED_CHAIN_ID) throw new Error(`STOP: chain ID ${net.chainId} is not Orchard Cyprus-1 (15000).`);
  if (balance === 0n) throw new Error(`STOP: deployer has no testnet QUAI (${wallet.address}).`);

  console.log("\nMetadata CIDs (computed locally from the bytecode; identical to what the IPFS plugin returns):");
  const cids = {};
  for (const [name, fqn] of Object.entries(C)) { cids[name] = await localMetadataCid(fqn); console.log(`  ${name.padEnd(24)} ${cids[name]}`); }

  console.log("\nPlan (7 contracts + 5 setup transactions):");
  console.log("  Verifier → AnonAadhaarMultiKey → PoseidonT3 → SemaphoreVerifier → Semaphore (linked) → FanPass → FairTicketsCommitReveal");
  console.log("  then commitInventory, setAssistedCap, setFanPass(pass-only), commitSeed, openRegistration.");
  console.log("Admin powers of the deployer (organiser): commit inventory/seed once, set the ID-desk quota and Fan Pass");
  console.log("registry before the sale, open registration, reveal the seed, withdraw proceeds, anchor gate logs, register");
  console.log("people at the capped ID desk. It CANNOT change rules, prices, the draw result or transfer tickets.");
  if (process.env.DEPLOY_CONFIRM !== "yes") {
    console.log("\nPreflight OK. Nothing was broadcast. Set DEPLOY_CONFIRM=yes to deploy.");
    return;
  }

  // ------------------------------------------------------------ IPFS: try the official upload once
  let pinned = false;
  if (process.env.IPFS !== "skip") {
    console.log("\nTrying the official IPFS upload (ipfs.qu.ai)…");
    try {
      const h = await deployMetadata.pushMetadataToIPFS(C.Verifier);
      pinned = h === cids.Verifier;
    } catch {}
    if (pinned) for (const [name, fqn] of Object.entries(C)) if (name !== "Verifier") pinned = (await deployMetadata.pushMetadataToIPFS(fqn).catch(() => "")) === cids[name] && pinned;
    console.log(pinned ? "IPFS upload OK." : "IPFS unavailable: deploying with the locally computed CIDs; publish later with scripts/pin-metadata.js");
  }

  // ------------------------------------------------------------ deploy
  const record = {
    network: "Quai Orchard Cyprus-1", chainId: 15000, rpc: hre.network.config.url, deployer: wallet.address,
    deployedAt: new Date().toISOString(), metadataPinned: pinned, contracts: {}, setupTxs: {},
  };
  const explorer = (a) => `https://orchard.quaiscan.io/address/${a}`;
  const libs = {};

  async function deploy(name, args = []) {
    const art = await hre.artifacts.readArtifact(C[name]);
    const factory = new quais.ContractFactory(art.abi, link(art, libs), wallet, cids[name]);
    const c = await factory.deploy(...args);
    const txHash = c.deploymentTransaction().hash;
    console.log(`${name}: broadcast ${txHash}`);
    await c.waitForDeployment();
    const address = await c.getAddress();
    console.log(`${name}: deployed at ${address}`);
    record.contracts[name] = { address, txHash, ipfsHash: cids[name], abiPath: `artifacts/${art.sourceName}/${art.contractName}.json`, explorer: explorer(address) };
    return new quais.Contract(address, art.abi, wallet);
  }
  async function send(label, txPromise) {
    const tx = await txPromise;
    console.log(`${label}: ${tx.hash}`);
    await tx.wait();
    record.setupTxs[label] = tx.hash;
  }

  const verifier = await deploy("Verifier");
  const anon = await deploy("AnonAadhaarMultiKey", [await verifier.getAddress(), KEY_HASHES]);
  const poseidon = await deploy("PoseidonT3");
  libs["poseidon-solidity/PoseidonT3.sol:PoseidonT3"] = await poseidon.getAddress();
  const semVerifier = await deploy("SemaphoreVerifier");
  const semaphore = await deploy("Semaphore", [await semVerifier.getAddress()]);
  const fanPass = await deploy("FanPass", [await semaphore.getAddress(), await anon.getAddress(), FANPASS_SEED]);
  const ft = await deploy("FairTicketsCommitReveal", [
    EVENT.name, EVENT.facePrice, EVENT.offerWindow, EVENT.claimWindow, await anon.getAddress(), EVENT.nullifierSeed,
  ]);

  const inv = buildInventory(EVENT.seats);
  await send("commitInventory", ft.commitInventory(inv.root, EVENT.seats.publicSeats, EVENT.seats.sponsorSeats, EVENT.seats.holdSeats));
  await send("setAssistedCap", ft.setAssistedCap(EVENT.assistedCap));
  await send("setFanPass", ft.setFanPass(await fanPass.getAddress(), true));
  const secret = "0x" + crypto.randomBytes(32).toString("hex");
  const commitment = quais.keccak256(quais.AbiCoder.defaultAbiCoder().encode(["bytes32"], [secret]));
  await send("commitSeed", ft.commitSeed(commitment));
  const now = Math.floor(Date.now() / 1000);
  await send("openRegistration", ft.openRegistration(now + EVENT.registrationMinutes * 60, now + EVENT.buybackDays * 86400));

  record.aadhaar = { mode: AADHAAR_MODE, acceptedKeyHashes: KEY_HASHES.map(String) };
  record.fanPass = { seed: FANPASS_SEED.toString(), groupId: (await fanPass.groupId()).toString(), passScope: (await ft.passScope()).toString() };
  record.event = { ...EVENT, facePrice: EVENT.facePrice.toString(), nullifierSeed: EVENT.nullifierSeed.toString(), inventoryRoot: inv.root, seedCommitment: commitment };

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "orchard.json"), JSON.stringify(record, null, 2));
  // Organiser-only: the seed secret (needed for revealSeed) and the salted seat list. Git-ignored.
  fs.writeFileSync(path.join(dir, "orchard-secrets.json"), JSON.stringify({ seedSecret: secret, inventory: inv.tree.dump() }, null, 2));
  console.log("\nSaved deployments/orchard.json (public record) and deployments/orchard-secrets.json (keep private).");
  if (!pinned) console.log("Metadata not on IPFS yet: run  node scripts/pin-metadata.js  when ipfs.qu.ai is back.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
