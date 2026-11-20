// Deploys Fair Tickets to Quai Orchard Cyprus-1, following the organisers' reference project
// (Yaswitha-Kurra/Quai-Network-Contract-Deploy-Example): quais provider with pathing, quais.Wallet,
// IPFS metadata via @quai/hardhat-deploy-metadata, quais.ContractFactory.
//
// SAFE BY DEFAULT: without DEPLOY_CONFIRM=yes it only runs the preflight (network, chain ID,
// balance, plan) and broadcasts NOTHING.
//
//   Preflight:  npx hardhat run scripts/deploy.js --network cyprus1
//   Deploy:     set DEPLOY_CONFIRM=yes, then run the same command  (PowerShell: $env:DEPLOY_CONFIRM="yes")
//
// Contracts deployed:
//   1. Verifier       official Anon Aadhaar Groth16 verifier
//   2. AnonAadhaar    official Anon Aadhaar contract, UIDAI TEST public-key hash
//   3. FairTicketsCommitReveal   the event (commit-reveal randomness: Chainlink VRF isn't on Quai)
// Then: commit the seat inventory, commit the randomness seed, open registration.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const quais = require("quais");
const hre = require("hardhat");
const { deployMetadata } = hre;
const { buildInventory } = require("./lib/inventory");

const EXPECTED_CHAIN_ID = 15000n;
const TEST_PUBKEY_HASH = "15134874015316324267425466444584014077184337590635665158241104437045239495873"; // @anon-aadhaar/core
const EVENT = {
  name: "Coldplay · Bengaluru · Demo Night",
  facePrice: 10n ** 16n,          // 0.01 QUAI
  offerWindow: 10 * 60,           // 10 minutes to accept a waitlist offer
  claimWindow: 30 * 60,           // 30 minutes for winners to pay
  nullifierSeed: 20260118n,
  seats: { publicSeats: 8, sponsorSeats: 2, holdSeats: 2 },
  registrationMinutes: 120,
  buybackDays: 7,
};

const artifact = (file, name) => require(path.join(__dirname, "..", "artifacts", file, `${name}.json`));

async function main() {
  if (hre.network.name !== "cyprus1") throw new Error("Run with --network cyprus1 (and set RPC_URL, CYPRUS1_PK, CHAIN_ID in .env).");

  // ------------------------------------------------------------ preflight (read-only)
  // RPC_URL already ends in /cyprus1, so pathing must be off (with it on, quais hangs on getNetwork).
  const provider = new quais.JsonRpcProvider(hre.network.config.url, undefined, { usePathing: false });
  const wallet = new quais.Wallet(hre.network.config.accounts[0], provider);
  const net = await provider.getNetwork();
  const balance = await provider.getBalance(wallet.address);
  console.log("Network RPC   :", hre.network.config.url);
  console.log("Chain ID      :", net.chainId.toString());
  console.log("Deployer      :", wallet.address);
  console.log("Balance       :", quais.formatQuai(balance), "QUAI");
  if (net.chainId !== EXPECTED_CHAIN_ID) throw new Error(`STOP: chain ID ${net.chainId} is not Orchard Cyprus-1 (15000).`);
  if (balance === 0n) throw new Error(`STOP: deployer has no testnet QUAI. Ask the organisers / Quai Discord to send Orchard QUAI to ${wallet.address} (orchard.faucet.quai.network is offline).`);

  console.log("\nPlan: deploy Verifier, AnonAadhaar (UIDAI test key), FairTicketsCommitReveal; then commitInventory, commitSeed, openRegistration.");
  console.log("Admin powers of the deployer (organiser): commit inventory/seed once, open registration, reveal the seed,");
  console.log("withdraw proceeds, anchor gate logs. It CANNOT change rules, prices, the draw result or transfer tickets.");
  if (process.env.DEPLOY_CONFIRM !== "yes") {
    console.log("\nPreflight OK. Nothing was broadcast. Set DEPLOY_CONFIRM=yes to deploy.");
    return;
  }

  // ------------------------------------------------------------ deploy
  const record = { network: "Quai Orchard Cyprus-1", chainId: 15000, rpc: hre.network.config.url, deployer: wallet.address, deployedAt: new Date().toISOString(), contracts: {}, setupTxs: {} };
  const explorer = (a) => `https://orchard.quaiscan.io/address/${a}`;

  async function deploy(file, name, args = []) {
    const json = artifact(file, name);
    const ipfsHash = await deployMetadata.pushMetadataToIPFS(name);
    const factory = new quais.ContractFactory(json.abi, json.bytecode, wallet, ipfsHash);
    const c = await factory.deploy(...args);
    const txHash = c.deploymentTransaction().hash;
    console.log(`${name}: broadcast ${txHash}`);
    await c.waitForDeployment();
    const address = await c.getAddress();
    console.log(`${name}: deployed at ${address}`);
    record.contracts[name] = { address, txHash, ipfsHash, abiPath: `artifacts/${file}/${name}.json`, explorer: explorer(address) };
    return new quais.Contract(address, json.abi, wallet);
  }

  const verifier = await deploy("@anon-aadhaar/contracts/src/Verifier.sol", "Verifier");
  const anon = await deploy("@anon-aadhaar/contracts/src/AnonAadhaar.sol", "AnonAadhaar", [await verifier.getAddress(), TEST_PUBKEY_HASH]);
  const ft = await deploy("contracts/FairTicketsCommitReveal.sol", "FairTicketsCommitReveal", [
    EVENT.name, EVENT.facePrice, EVENT.offerWindow, EVENT.claimWindow, await anon.getAddress(), EVENT.nullifierSeed,
  ]);

  async function send(label, txPromise) {
    const tx = await txPromise;
    console.log(`${label}: ${tx.hash}`);
    await tx.wait();
    record.setupTxs[label] = tx.hash;
  }

  const inv = buildInventory(EVENT.seats);
  await send("commitInventory", ft.commitInventory(inv.root, EVENT.seats.publicSeats, EVENT.seats.sponsorSeats, EVENT.seats.holdSeats));

  const secret = "0x" + crypto.randomBytes(32).toString("hex");
  const commitment = quais.keccak256(quais.AbiCoder.defaultAbiCoder().encode(["bytes32"], [secret]));
  await send("commitSeed", ft.commitSeed(commitment));

  const now = Math.floor(Date.now() / 1000);
  await send("openRegistration", ft.openRegistration(now + EVENT.registrationMinutes * 60, now + EVENT.buybackDays * 86400));

  record.event = { ...EVENT, facePrice: EVENT.facePrice.toString(), nullifierSeed: EVENT.nullifierSeed.toString(), inventoryRoot: inv.root, seedCommitment: commitment };

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "orchard.json"), JSON.stringify(record, null, 2));
  // Organiser-only data: the seed secret (needed for revealSeed) and the salted seat list. Git-ignored.
  fs.writeFileSync(path.join(dir, "orchard-secrets.json"), JSON.stringify({ seedSecret: secret, inventory: inv.tree.dump() }, null, 2));
  console.log("\nSaved deployments/orchard.json (public record) and deployments/orchard-secrets.json (keep private).");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
