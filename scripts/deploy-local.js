// Deploys a full event to the local Hardhat node and writes app/src/deployment.json (website) and
// app/public/mobile-deployment.json (Android app).
// Usage:  npx hardhat node                                                  (terminal 1)
//         npx hardhat run scripts/deploy-local.js --network localhost        (terminal 2)
// Event details: scripts/lib/eventConfig.js defaults, or EVENT_JSON='{"title":..}' (the website's
// "Create event" form sets this). AADHAAR_MODE=test switches to Anon Aadhaar test QRs.
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const { buildInventory } = require("./lib/inventory");
const { loadEventConfig, crowdName } = require("./lib/eventConfig");
const { UIDAI_KEY_HASHES, TEST_KEY_HASH } = require("./lib/aadhaarKeys");

const AADHAAR_MODE = (process.env.AADHAAR_MODE || "real").toLowerCase() === "test" ? "test" : "real";
const MNEMONIC = "test test test test test test test test test test test junk"; // Hardhat's PUBLIC test mnemonic
// Named demo accounts 2..18 are synthetic. Account 1 (Asha) and 19 (Scalper) are not: Asha proves for
// real, the Scalper has no Aadhaar at all.
const NAMED_SYNTHETIC = [...Array(17).keys()].map((i) => i + 2);
const CROWD_START = 20; // crowd wallets are mnemonic accounts 20, 21, ...

async function main() {
  const ev = loadEventConfig();
  const [organiser] = await ethers.getSigners();
  const root = ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, "m/44'/60'/0'/0");
  const named = [...Array(20).keys()].map((i) => root.deriveChild(i));
  const crowd = [...Array(ev.crowd).keys()].map((i) => {
    const w = root.deriveChild(CROWD_START + i);
    return { name: crowdName(i), address: w.address, key: w.privateKey };
  });
  console.log(`Event: ${ev.onChainName}`);
  console.log(`Seats: ${ev.publicSeats} public + ${ev.sponsorSeats} sponsor + ${ev.holdSeats} hold · crowd ${ev.crowd} · assisted quota ${ev.assistedCap}`);

  // Anon Aadhaar: official Groth16 verifier checked against UIDAI's real keys (or the test key),
  // behind the demo router, which only adds the labelled synthetic accounts.
  const groth16 = await (await ethers.getContractFactory("Verifier")).deploy();
  const keyHashes = AADHAAR_MODE === "real" ? UIDAI_KEY_HASHES : [TEST_KEY_HASH];
  const anon = await (await ethers.getContractFactory("AnonAadhaarMultiKey")).deploy(await groth16.getAddress(), keyHashes);
  const syntheticAddresses = [...NAMED_SYNTHETIC.map((i) => named[i].address), ...crowd.map((c) => c.address)];
  const aadhaar = await (await ethers.getContractFactory("DemoAadhaarRouter")).deploy(await anon.getAddress(), syntheticAddresses);
  const vrf = await (await ethers.getContractFactory("MockVRFCoordinator")).deploy();
  const nullifierSeed = BigInt(ethers.keccak256(ethers.toUtf8Bytes(`${ev.onChainName}|${Date.now()}`))) % (1n << 128n);
  const ft = await (await ethers.getContractFactory("FairTickets")).deploy(
    ev.onChainName, ethers.parseEther(String(ev.priceEth)), 2 * 60 * 60, 24 * 60 * 60,
    await aadhaar.getAddress(), nullifierSeed, await vrf.getAddress(),
    { keyHash: ethers.ZeroHash, subId: 1n, requestConfirmations: 3, callbackGasLimit: 2_000_000, nativePayment: false }
  );
  await ft.waitForDeployment();
  console.log(`Anon Aadhaar mode: ${AADHAAR_MODE.toUpperCase()} (${keyHashes.length} accepted key${keyHashes.length > 1 ? "s" : ""})`);

  const inv = buildInventory({ publicSeats: ev.publicSeats, sponsorSeats: ev.sponsorSeats, holdSeats: ev.holdSeats });
  await (await ft.commitInventory(inv.root, ev.publicSeats, ev.sponsorSeats, ev.holdSeats)).wait();
  await (await ft.setAssistedCap(ev.assistedCap)).wait();
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  await (await ft.openRegistration(now + ev.registrationMinutes * 60, now + ev.buybackDays * 86400)).wait();

  // Fund the crowd (local test ETH) so each synthetic fan can register and pay from its own wallet.
  const price = ethers.parseEther(String(ev.priceEth));
  const topUp = price * 3n + ethers.parseEther("0.05");
  for (const c of crowd) await (await organiser.sendTransaction({ to: c.address, value: topUp })).wait();

  const artifact = (name) => require(`../artifacts/contracts/${name}`).abi;
  const event = {
    title: ev.title, venue: ev.venue, city: ev.city, startsAt: ev.startsAt, priceInr: ev.priceInr, priceEth: String(ev.priceEth),
    publicSeats: ev.publicSeats, sponsorSeats: ev.sponsorSeats, holdSeats: ev.holdSeats, assistedCap: ev.assistedCap,
  };
  const out = {
    network: "localhost",
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:8545",
    deployedAt: new Date().toISOString(),
    event,
    fairTickets: await ft.getAddress(),
    vrfCoordinator: await vrf.getAddress(),
    aadhaarRouter: await aadhaar.getAddress(),
    anonAadhaar: await anon.getAddress(),
    aadhaarMode: AADHAAR_MODE,
    anonAadhaarKeyHashes: keyHashes.map(String),
    syntheticAccounts: NAMED_SYNTHETIC,
    // Labelled synthetic crowd. Their keys come from Hardhat's PUBLIC test mnemonic: local test ETH only.
    crowd,
    nullifierSeed: nullifierSeed.toString(),
    abi: {
      fairTickets: artifact("FairTickets.sol/FairTickets.json"),
      vrf: artifact("mocks/MockVRFCoordinator.sol/MockVRFCoordinator.json"),
      router: artifact("demo/DemoAadhaarRouter.sol/DemoAadhaarRouter.json"),
    },
    // The organiser's seat file. It includes salts, so in production it stays private until seats
    // are revealed at sale time.
    inventory: inv.tree.dump(),
  };
  const dest = path.join(__dirname, "..", "app", "src", "deployment.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));

  // Android app config (fetched from the laptop at runtime, so new events never need a new APK).
  const mobileOut = {
    chainId: out.chainId,
    fairTickets: out.fairTickets,
    nullifierSeed: out.nullifierSeed,
    aadhaarMode: AADHAAR_MODE,
    event,
    syntheticAccounts: NAMED_SYNTHETIC,
    demoKeys: named.map((w) => w.privateKey), // PUBLIC Hardhat test keys, local test ETH only
    abi: out.abi.fairTickets,
  };
  const mobileDest = path.join(__dirname, "..", "app", "public", "mobile-deployment.json");
  fs.mkdirSync(path.dirname(mobileDest), { recursive: true });
  fs.writeFileSync(mobileDest, JSON.stringify(mobileOut, null, 2));

  console.log("FairTickets:", out.fairTickets);
  console.log("Inventory root:", inv.root);
  console.log("Wrote", dest, "and", mobileDest);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
