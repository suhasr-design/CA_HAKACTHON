# Fair Tickets: The Chip Architects

Anti-scalping ticketing on **Quai**: one verified human, one entry, a lottery anyone can verify, and tickets that resell only at face value, with zero personal data stored.

Team: Suhas R (Designer) · Shashikumar N R (Strategist) · Srujan C (Researcher) · Sudarshan S R (Flaw Identifier)

## The problem
High-demand sales (IPL matches, concerts) are won by bots and fast clickers, then resold at many times face value. Today's fixes (captchas, KYC, OTPs) collect personal data and still leak tickets to scalpers.

## How it works
1. **One human, one entry.** A fan proves they are a unique real person with their offline **Aadhaar QR**, using a zero-knowledge proof (Anon Aadhaar, real UIDAI keys). No name, number or photo is revealed or stored. Each person gets an anonymous per-event nullifier, so a second entry is rejected.
2. **Fan Pass.** The heavy Aadhaar proof (584 MB circuit, about 80 s) runs **once**, at a kiosk, and adds an anonymous commitment to a Semaphore group. After that, joining any event takes a light **Semaphore proof on the phone (5.5 MB, about 1–7 s)**. Scopes differ per event, so events can't link fans. Each proof is bound to the fan's wallet, so a copied proof is useless.
3. **Verifiable lottery.** Registration runs over a time window, so there's no stampede. The organiser commits a secret before registration, and it's mixed with a future block hash. An on-chain Fisher–Yates shuffle orders all entrants, and anyone can recompute it. Positions 1..N win; everyone else gets a **numbered waitlist** place. If the organiser never reveals, anyone can trigger a fallback draw.
4. **Face value forever.** Tickets are non-transferable. A holder can only sell back to the contract at face value. The seat goes to the next waitlisted fan, and the seller gets a refund.
5. **Secure gate.** The fan's app scans the gate's code, which **rotates every 20 s**, and signs it. Screenshots and replayed QRs fail, and a ticket can't enter twice across gates.
6. **Inclusive and simple.** Gas is sponsored, so fans never touch crypto. An **ID desk** with a capped on-chain quota serves fans without a smartphone. A lost pass can be restored, or re-enrolled with a newer Aadhaar QR.
7. **Committed seat map.** A Merkle root of every seat is locked before the sale, so seats can't be swapped after the draw.

## Live on Quai Orchard (Cyprus-1, chain 15000)
Deployed with the `quais` SDK, 7 contracts plus 5 setup transactions, for about 0.02 test QUAI. Full record: [`deployments/orchard.json`](deployments/orchard.json).

| Contract | Address |
|---|---|
| FairTicketsCommitReveal (event) | [`0x00656AdF0C007CD7B6e0d089727d26806D1Caebf`](https://orchard.quaiscan.io/address/0x00656AdF0C007CD7B6e0d089727d26806D1Caebf) |
| FanPass | [`0x006D6d94bD5c7FEbC8c822D57eE343f60C8DE1A7`](https://orchard.quaiscan.io/address/0x006D6d94bD5c7FEbC8c822D57eE343f60C8DE1A7) |
| Semaphore | [`0x005f6fC400bc674b0c9CE73f5F9214f3070cB522`](https://orchard.quaiscan.io/address/0x005f6fC400bc674b0c9CE73f5F9214f3070cB522) |
| SemaphoreVerifier | [`0x00289e8aAf663f1CCE1F2B0BFD833A6d19cfc306`](https://orchard.quaiscan.io/address/0x00289e8aAf663f1CCE1F2B0BFD833A6d19cfc306) |
| PoseidonT3 | [`0x0044c69f92e34e76491527e69A526191ae8ffc8a`](https://orchard.quaiscan.io/address/0x0044c69f92e34e76491527e69A526191ae8ffc8a) |
| AnonAadhaarMultiKey (3 UIDAI keys) | [`0x0014275f33B2Ac452D9eC554D436150b87018B99`](https://orchard.quaiscan.io/address/0x0014275f33B2Ac452D9eC554D436150b87018B99) |
| Anon Aadhaar Groth16 Verifier | [`0x000e5c237942D6756007b045E19134B2AA75bc1F`](https://orchard.quaiscan.io/address/0x000e5c237942D6756007b045E19134B2AA75bc1F) |

The organisers' reference deploy flow uploads metadata to `ipfs.qu.ai`, which was returning 504 errors. `scripts/deploy.js` uses the metadata CID that solc embeds in the bytecode instead, checked locally, and `scripts/pin-metadata.js` uploads the files once the server is back. Check the live wiring (read-only) with `node scripts/orchard-verify.js`.

## Results
- **42 contract tests passing**, plus end-to-end runs (`scripts/e2e-flow.js`, `scripts/e2e-fanpass.js`). Every attack we tested was rejected: forged proofs, double entry, fake or replayed gate QRs, transfers, cross-gate reuse, and bots draining sponsored gas.
- **Bot simulation** (`npm run simulate`; a synthetic model with 500 seats, 1,000 fans, a scalper with 2,000 accounts plus 25 borrowed Aadhaars): bot share is **76.9% in a first-come queue vs 2.5% with Fair Tickets**, and real fans who got a ticket rise from 58 to 488 per 1,000.

## Project layout
```
contracts/FairTicketsBase.sol          all event rules: registration, shuffle, claim, buyback, waitlist, ID desk
contracts/FairTicketsCommitReveal.sol  randomness: organiser commit-reveal + future block hash (used on Quai)
contracts/FairTickets.sol              randomness: Chainlink VRF v2.5 variant
contracts/FanPass.sol                  lifetime anonymous Fan Pass (Semaphore group, Anon Aadhaar enrolment)
contracts/anon/AnonAadhaarMultiKey.sol checks Aadhaar proofs against a fixed list of real UIDAI keys
test/                                  42 tests
scripts/deploy.js                      Quai Orchard deploy (dry run unless DEPLOY_CONFIRM=yes)
scripts/deploy-local.js                local demo deploy; writes app/ and mobile/ config
scripts/prove-aadhaar.cjs              laptop/kiosk Aadhaar prover (single-threaded, ~80 s)
app/                                   website: Home, Organiser, Gate, Check, kiosk, ID desk
mobile/                                Android fan app (Expo): Fan Pass, book, ticket, scan gate code, sell back
PRESENTER_GUIDE.md                     demo walkthrough and what to say
```

## Run the demo locally
Requirements: Node.js 20+. The phone and laptop must be on the same Wi-Fi.
```
npm install
npm --prefix app install
npm --prefix mobile install
node scripts/fetch-semaphore-artifacts.js       # once: Fan Pass proving files (~5.5 MB)
node scripts/fetch-anon-aadhaar-artifacts.js    # once: Aadhaar proving files for the kiosk (~600 MB)
npm run chain           # terminal 1: local blockchain on 0.0.0.0:8545
npm run deploy:local    # terminal 2: fresh event (the website's Refresh button also resets it)
npm run app             # terminal 3: website on http://localhost:5173 (also on your LAN IP)
```
Fan app: install the Android APK built with `npx eas-cli@latest build -p android --profile preview`, or run `npm run mobile` with Expo Go. Enter the laptop's Wi-Fi address on the app's first screen. If Windows asks, allow Node.js on the network. The phone needs ports 8545 and 5173.

Website screens: `#organiser`, `#gate`, `#check`; kiosk: `/kiosk.html`.

## What is real and what is simulated
| Real | Simulated or demo |
|---|---|
| All contract logic; deployed on Quai Orchard | The live demo runs on a local chain (Hardhat) so it can be reset on stage |
| Anon Aadhaar verification with real UIDAI public keys | Synthetic crowd accounts, labelled on screen |
| Semaphore Fan Pass, Merkle seats, shuffle, buyback, waitlist | Payments in test ETH / test QUAI |
| Rotating gate codes, cross-gate duplicate checks | The bot simulation is a model, not a real sale |

Not done yet: a security audit, explorer source verification, and pinning metadata to Quai IPFS (waiting for `ipfs.qu.ai` to come back).

Privacy: the Aadhaar QR is processed only on the kiosk or the fan's device. Only anonymous commitments and nullifiers go on-chain. Demo accounts use Hardhat's public test mnemonic; never use those keys on a real network.
