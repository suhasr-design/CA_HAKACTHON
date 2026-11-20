require("@nomicfoundation/hardhat-toolbox");
require("@quai/hardhat-deploy-metadata");
require("dotenv").config({ path: "./.env" });

// Quai Orchard (Cyprus-1) settings follow the organisers' reference project
// (Yaswitha-Kurra/Quai-Network-Contract-Deploy-Example): Solidity 0.8.20, London EVM, IPFS metadata.
// .env (git-ignored, never committed):  RPC_URL, CYPRUS1_PK, CHAIN_ID=15000
const { RPC_URL, CYPRUS1_PK, CHAIN_ID } = process.env;

const compiler = {
  version: "0.8.20",
  settings: {
    // runs 200 (reference uses 1000) keeps FairTickets under the 24 KB contract size limit.
    optimizer: { enabled: true, runs: 200 },
    metadata: { bytecodeHash: "ipfs", useLiteralContent: true },
    evmVersion: "london",
  },
};

module.exports = {
  // Tests and the local demo use the in-process Hardhat network; Orchard is opt-in with --network cyprus1.
  defaultNetwork: "hardhat",
  solidity: { compilers: [compiler] },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    ...(RPC_URL && CYPRUS1_PK
      ? { cyprus1: { url: RPC_URL, accounts: [CYPRUS1_PK], chainId: Number(CHAIN_ID || 15000) } }
      : {}),
  },
  paths: { sources: "./contracts", cache: "./cache", artifacts: "./artifacts" },
  mocha: { timeout: 40000 },
};
