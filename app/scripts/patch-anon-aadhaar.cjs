// @anon-aadhaar/react 2.4.3 (last release Dec 2024) only knows UIDAI's 2021 and Feb-2026 signing
// certificates, both expired. Secure QRs issued now are signed with uidai_offline_publickey_2026.cer
// (valid to 2029-02-03), so without this patch every real, current Aadhaar QR is rejected as
// "invalid signature". This adds that certificate to the list the SDK checks.
//
// Source: https://backend.uidai.gov.in/get/files/media/document/2026-07/uidai_offline_publickey_2026.cer
// SHA-256: E0:30:4B:9E:61:EE:36:40:EC:DD:AE:2D:B4:B6:17:F2:E2:67:8F:57:DB:C2:82:6C:2F:86:AC:5C:04:F2:77:DF
//
// Idempotent; runs on `npm install` (postinstall).
const fs = require("fs");
const path = require("path");

const target = path.join(__dirname, "..", "node_modules", "@anon-aadhaar", "react", "dist", "index.js");
const pem = fs.readFileSync(path.join(__dirname, "..", "certs", "uidai_offline_publickey_2026.pem"), "utf8").trim();
const MARK = "/* fair-tickets: uidai 2026 key */";

let js = fs.readFileSync(target, "utf8");
let changed = false;

// Patch 2: verify the RSA signature with node-forge (pure JS) instead of window.crypto.subtle.
// crypto.subtle only exists in secure contexts (https or localhost). The Android app opens this
// page over http://<laptop-ip>:5173, where subtle is undefined, so EVERY real QR failed with
// "QR code invalid" even when UIDAI's signature was genuine.
const MARK2 = "/* fair-tickets: forge rsa verify */";
const subtleStart = "  const binaryDerString = window.atob(pemContents);";
const subtleEnd = "  return { isSignatureValid, certificate };\n};";
if (!js.includes(MARK2)) {
  const a = js.indexOf(subtleStart);
  const b = js.indexOf(subtleEnd, a);
  if (a < 0 || b < 0) {
    console.error("anon-aadhaar patch 2: SDK code changed; not applied.");
    process.exit(1);
  }
  const forgeVerify = `  ${MARK2}
  let isSignatureValid = false;
  try {
    const md = import_node_forge.md.sha256.create();
    md.update(import_node_forge.util.binary.raw.encode(new Uint8Array(signedData)));
    isSignatureValid = publicKey.verify(md.digest().bytes(), import_node_forge.util.binary.raw.encode(new Uint8Array(signature)));
  } catch (e) {
    isSignatureValid = false;
  }
  void pemContents;
`;
  js = js.slice(0, a) + forgeVerify + js.slice(b);
  changed = true;
  console.log("anon-aadhaar patch: signature check now works over http (node-forge)");
}

if (js.includes(MARK)) {
  if (changed) {
    fs.writeFileSync(target, js);
    fs.rmSync(path.join(__dirname, "..", "node_modules", ".vite"), { recursive: true, force: true });
  } else console.log("anon-aadhaar patch: already applied");
  process.exit(0);
}

const anchor = "var verifySignature = async (qrData, useTestAadhaar) => {";
const call = `      verifyRSASha256WithSubtle(
        uidai_offline_publickey_17022026,
        signature,
        signedData
      )
    ]);`;
if (!js.includes(anchor) || !js.includes(call)) {
  console.error("anon-aadhaar patch: SDK code changed; patch not applied. Check @anon-aadhaar/react version.");
  process.exit(1);
}

js = js.replace(anchor, `${MARK}\nvar uidai_offline_publickey_2026 = \`${pem}\`;\n${anchor}`);
js = js.replace(call, `      verifyRSASha256WithSubtle(
        uidai_offline_publickey_17022026,
        signature,
        signedData
      ),
      verifyRSASha256WithSubtle(
        uidai_offline_publickey_2026,
        signature,
        signedData
      )
    ]);`);
fs.writeFileSync(target, js);
fs.rmSync(path.join(__dirname, "..", "node_modules", ".vite"), { recursive: true, force: true }); // drop Vite's prebundled copy
console.log("anon-aadhaar patch: added UIDAI 2026 certificate");
