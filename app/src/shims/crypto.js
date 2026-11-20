// Browser stand-in for Node's "crypto". Only reached by Node-only code paths in node-forge
// (guarded by isNodejs) and an unused @zk-email helper; the browser uses WebCrypto instead.
export function createHash() {
  throw new Error("Node crypto.createHash is not available in the browser");
}
export default { createHash };
