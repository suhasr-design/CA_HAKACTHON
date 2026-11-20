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
if (js.includes(MARK)) {
  console.log("anon-aadhaar patch: already applied");
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
