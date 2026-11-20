// Anon Aadhaar circuit public-key hashes (Poseidon of the RSA modulus), computed and cross-checked
// with scripts/aadhaar-key-hashes.js. The 2021 and test values match @anon-aadhaar/core constants.
//
// UIDAI keys that sign Aadhaar Secure QRs (newest first):
//   uidai_offline_publickey_2026.cer      valid to 2029-02-03  (current; SHA-256 E0:30:4B:9E:...:F2:77:DF)
//   uidai_offline_publickey_17022026.cer  valid to 2026-02-16
//   uidai_offline_publickey_26022021.cer  valid to 2024-02-27
const UIDAI_KEY_HASHES = [
  19770349258225098911243612275321727303641256718510179842211794623059325011884n,
  7217153585153042436745665065617781483037900263075488870028184365042423808319n,
  18063425702624337643644061197836918910810808173893535653269228433734128853484n,
];

// Anon Aadhaar TEST key: anyone can generate test QRs with it, so it is NOT Sybil-resistant.
const TEST_KEY_HASH = 15134874015316324267425466444584014077184337590635665158241104437045239495873n;

module.exports = { UIDAI_KEY_HASHES, TEST_KEY_HASH };
