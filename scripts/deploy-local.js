// Deploys the full demo to a local Hardhat node and writes app/src/deployment.json.
// Usage:  npx hardhat node            (terminal 1)
//         npx hardhat run scripts/deploy-local.js --network localhost   (terminal 2)
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const { buildInventory } = require("./lib/inventory");

const CONFIG = {
  eventName: "Coldplay · Bengaluru · Demo Night",
  facePrice: ethers.parseEther("0.05"),
  offerWindow: 2 * 60 * 60,        // 2 hours to accept a waitlist offer
  claimWindow: 24 * 60 * 60,       // 24 hours for winners to pay
  nullifierSeed: 20260118n,        // unique per event -> nullifiers can't be linked across events
  seats: { publicSeats: 8, sponsorSeats: 2, holdSeats: 2 },
  registrationMinutes: 30,
  buybackDays: 7,
};

// UIDAI *test* public-key hash used by Anon Aadhaar test mode (from @anon-aadhaar/core constants).
const TEST_PUBKEY_HASH = 15134874015316324267425466444584014077184337590635665158241104437045239495873n;
// Demo accounts 2..18 form the synthetic crowd. Account 1 (Asha) and 19 (Scalper) are NOT
// synthetic: Asha must register with a real zero-knowledge proof; the Scalper has none.
const SYNTHETIC_ACCOUNTS = [...Array(17).keys()].map((i) => i + 2);

async function main() {
  const signers = await ethers.getSigners();
  const [organiser] = signers;
  console.log("Organiser:", organiser.address);

  // Official Anon Aadhaar contracts with the test public key, behind the demo router.
  const groth16 = await (await ethers.getContractFactory("Verifier")).deploy();
  const anon = await (await ethers.getContractFactory("AnonAadhaar")).deploy(await groth16.getAddress(), TEST_PUBKEY_HASH);
  const syntheticFans = SYNTHETIC_ACCOUNTS.map((i) => signers[i].address);
  const aadhaar = await (await ethers.getContractFactory("DemoAadhaarRouter")).deploy(await anon.getAddress(), syntheticFans);
  const vrf = await (await ethers.getContractFactory("MockVRFCoordinator")).deploy();
  const ft = await (await ethers.getContractFactory("FairTickets")).deploy(
    CONFIG.eventName, CONFIG.facePrice, CONFIG.offerWindow, CONFIG.claimWindow,
    await aadhaar.getAddress(), CONFIG.nullifierSeed, await vrf.getAddress(),
    { keyHash: ethers.ZeroHash, subId: 1n, requestConfirmations: 3, callbackGasLimit: 500000, nativePayment: false }
  );
  await ft.waitForDeployment();

  const inv = buildInventory(CONFIG.seats);
  await (await ft.commitInventory(inv.root, CONFIG.seats.publicSeats, CONFIG.seats.sponsorSeats, CONFIG.seats.holdSeats)).wait();

  const now = (await ethers.provider.getBlock("latest")).timestamp;
  await (await ft.openRegistration(now + CONFIG.registrationMinutes * 60, now + CONFIG.buybackDays * 86400)).wait();

  const artifact = (name) => require(`../artifacts/contracts/${name}`).abi;
  const out = {
    network: "localhost",
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:8545",
    fairTickets: await ft.getAddress(),
    vrfCoordinator: await vrf.getAddress(),
    aadhaarRouter: await aadhaar.getAddress(),
    anonAadhaar: await anon.getAddress(),
    anonAadhaarPubkeyHash: TEST_PUBKEY_HASH.toString(),
    syntheticAccounts: SYNTHETIC_ACCOUNTS,
    nullifierSeed: CONFIG.nullifierSeed.toString(),
    abi: {
      fairTickets: artifact("FairTickets.sol/FairTickets.json"),
      vrf: artifact("mocks/MockVRFCoordinator.sol/MockVRFCoordinator.json"),
      router: artifact("demo/DemoAadhaarRouter.sol/DemoAadhaarRouter.json"),
    },
    // The organiser's seat file. It includes salts, so in production it stays private
    // until seats are revealed at sale time.
    inventory: inv.tree.dump(),
  };
  const dest = path.join(__dirname, "..", "app", "src", "deployment.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));

  // Config for the Android fan app. Demo keys are Hardhat's PUBLIC test accounts (local test
  // ETH only). Precomputing them avoids slow mnemonic derivation on the phone.
  const MNEMONIC = "test test test test test test test test test test test junk";
  const root = ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, "m/44'/60'/0'/0");
  const mobileOut = {
    chainId: out.chainId,
    fairTickets: out.fairTickets,
    nullifierSeed: out.nullifierSeed,
    syntheticAccounts: SYNTHETIC_ACCOUNTS,
    demoKeys: [...Array(20).keys()].map((i) => root.deriveChild(i).privateKey),
    abi: out.abi.fairTickets,
  };
  // Served by the website at http://<laptop>:5173/mobile-deployment.json; the Android app downloads it.
  const mobileDest = path.join(__dirname, "..", "app", "public", "mobile-deployment.json");
  fs.mkdirSync(path.dirname(mobileDest), { recursive: true });
  fs.writeFileSync(mobileDest, JSON.stringify(mobileOut, null, 2));
  console.log("Wrote", mobileDest);

  console.log("FairTickets:", out.fairTickets);
  console.log("Inventory root:", inv.root);
  console.log("Wrote", dest);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
