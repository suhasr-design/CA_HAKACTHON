// Read-only: checks the Orchard deployment recorded in deployments/orchard.json is wired up correctly.
//   node scripts/orchard-verify.js
const path = require("path");
const quais = require("quais");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const rec = require(path.join(__dirname, "..", "deployments", "orchard.json"));
const abi = (p) => require(path.join(__dirname, "..", p)).abi;

(async () => {
  const provider = new quais.JsonRpcProvider(process.env.RPC_URL, undefined, { usePathing: false });
  const c = (n) => new quais.Contract(rec.contracts[n].address, abi(rec.contracts[n].abiPath), provider);
  const ft = c("FairTicketsCommitReveal"), fp = c("FanPass"), anon = c("AnonAadhaarMultiKey");
  for (const [n, x] of Object.entries(rec.contracts)) {
    const code = await provider.getCode(x.address);
    console.log(`${n.padEnd(24)} ${x.address}  code ${((code.length - 2) / 2).toLocaleString()} bytes`);
  }
  const phase = Number(await ft.phase());
  console.log("\nevent name        :", await ft.eventName());
  console.log("phase             :", ["Setup", "Registration", "Drawing", "Shuffling", "Sale"][phase]);
  console.log("registration until:", new Date(Number(await ft.registrationClosesAt()) * 1000).toISOString());
  console.log("seats public/sp/hold:", `${await ft.publicSeats()}/${await ft.sponsorSeats()}/${await ft.holdSeats()}`);
  console.log("ID-desk quota     :", (await ft.assistedCap()).toString());
  console.log("Fan Pass linked   :", (await ft.fanPass()) === rec.contracts.FanPass.address, "· pass-only:", await ft.passOnly());
  console.log("Fan Pass members  :", (await fp.members()).toString(), "· group", (await fp.groupId()).toString());
  console.log("UIDAI keys        :", (await anon.acceptedKeyHashes()).length);
  console.log("deployer balance  :", quais.formatQuai(await provider.getBalance(rec.deployer)), "QUAI");
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
