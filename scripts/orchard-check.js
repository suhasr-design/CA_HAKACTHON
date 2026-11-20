// Read-only Orchard diagnostic. Never prints the private key. Broadcasts nothing.
//   node scripts/orchard-check.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const quais = require("quais");

const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label}: timed out after ${ms / 1000}s`)), ms))]);

(async () => {
  const { RPC_URL, CYPRUS1_PK, CHAIN_ID } = process.env;
  console.log("RPC_URL       :", RPC_URL || "(missing)");
  console.log("CHAIN_ID      :", CHAIN_ID || "(missing)");
  const pk = (CYPRUS1_PK || "").trim();
  const hex = pk.replace(/^0x/, "");
  console.log("Key format    :", /^[0-9a-fA-F]{64}$/.test(hex) ? "OK (64 hex chars)" : `NOT OK (length ${hex.length}, must be 64 hex chars; placeholder still there?)`);
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) process.exit(1);

  const offline = new quais.Wallet("0x" + hex);
  console.log("Address       :", offline.address);
  let zone = "?";
  try { zone = quais.getZoneForAddress(offline.address); } catch {}
  console.log("Zone          :", zone, zone === "0x00" ? "(Cyprus-1 ✓)" : "");
  try { console.log("Ledger        :", quais.isQiAddress(offline.address) ? "Qi ✗ (need a Quai address)" : "Quai ✓"); } catch {}

  for (const usePathing of [false, true]) {
    try {
      const provider = new quais.JsonRpcProvider(RPC_URL, undefined, { usePathing });
      const net = await withTimeout(provider.getNetwork(), 20000, "getNetwork");
      const bal = await withTimeout(provider.getBalance(offline.address), 20000, "getBalance");
      console.log(`usePathing=${usePathing}: chainId ${net.chainId}, balance ${quais.formatQuai(bal)} QUAI`);
      provider.destroy?.();
    } catch (e) {
      console.log(`usePathing=${usePathing}: FAILED - ${e.message}`);
    }
  }
  process.exit(0);
})();
