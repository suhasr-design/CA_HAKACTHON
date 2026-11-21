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

// Semaphore v4 (Fan Pass) requires Solidity >=0.8.23: only its import tree is compiled with 0.8.23,
// with the same optimizer and the same "london" EVM target (no newer opcodes).
const semaphoreCompiler = { ...compiler, version: "0.8.23" };
const SEMAPHORE_FILES = [
  "contracts/fanpass/SemaphoreDeps.sol",
  ...["Semaphore.sol", "base/Constants.sol", "base/SemaphoreGroups.sol", "base/SemaphoreVerifier.sol", "base/SemaphoreVerifierKeyPts.sol",
    "interfaces/ISemaphore.sol", "interfaces/ISemaphoreGroups.sol", "interfaces/ISemaphoreVerifier.sol"].map((f) => `@semaphore-protocol/contracts/${f}`),
  "@zk-kit/lean-imt.sol/InternalLeanIMT.sol", "@zk-kit/lean-imt.sol/Constants.sol", "poseidon-solidity/PoseidonT3.sol",
];

module.exports = {
  // Tests and the local demo use the in-process Hardhat network; Orchard is opt-in with --network cyprus1.
  defaultNetwork: "hardhat",
  solidity: {
    compilers: [compiler],
    overrides: Object.fromEntries(SEMAPHORE_FILES.map((f) => [f, semaphoreCompiler])),
  },
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
