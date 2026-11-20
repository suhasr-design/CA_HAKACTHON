require("@nomicfoundation/hardhat-toolbox");

// For Polygon Amoy, set these environment variables (never commit real keys):
//   AMOY_RPC_URL, DEPLOYER_PRIVATE_KEY
const { AMOY_RPC_URL, DEPLOYER_PRIVATE_KEY } = process.env;

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    ...(AMOY_RPC_URL && DEPLOYER_PRIVATE_KEY
      ? { amoy: { url: AMOY_RPC_URL, accounts: [DEPLOYER_PRIVATE_KEY], chainId: 80002 } }
      : {}),
  },
};
