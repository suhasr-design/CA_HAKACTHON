# Fair Tickets: The Chip Architects

The Big Hack 2.0 · Track 02 (Cybersecurity and Blockchain) · Problem B2: Fair tickets.

A blockchain ticketing system in which every ticket belongs to one verified human. Bots, scalpers and fake tickets have nothing to exploit.

## Mechanisms

| # | Mechanism | Where |
|---|---|---|
| 1 | Inventory commitment (Merkle root of every seat, locked before the sale) | `commitInventory`, `revealSeats` |
| 2 | One human, one entry (**real Anon Aadhaar zero-knowledge proof, test mode** + nullifier) | `register` → official `AnonAadhaar` verifier |
| 3 | Verifiable lottery (Chainlink VRF v2.5 seed + on-chain Fisher–Yates shuffle) | `requestDraw`, `rawFulfillRandomWords`, `runShuffle` |
| 4 | Non-transferable tickets | `_update` override |
| 5 | Face-value buyback + waitlist | `sellBack`, `acceptOffer`, `expireOffer`, `releaseUnclaimed` |
| 6 | Rotating signed QR + offline gate | `app/src/gateQr.js`, Gate screen |
| 7 | Public ticket check | `checkTicket`, Check screen |

## Project layout

```
contracts/FairTickets.sol            main contract (one per event)
contracts/anon/AnonAadhaarDeps.sol   compiles the official Anon Aadhaar Verifier + AnonAadhaar contracts
contracts/demo/DemoAadhaarRouter.sol demo only: real proofs -> real verifier; listed synthetic accounts -> instant join
contracts/mocks/                     MockVRFCoordinator (local VRF), MockAnonAadhaar (unit tests only)
test/                                23 tests
scripts/deploy-local.js              deploys everything, writes app/src/deployment.json
scripts/demo-fastforward.js          rehearsal: synthetic crowd + draw + claims -> Sale phase
scripts/check-bot.js                 proves forged proofs are rejected on the live chain
scripts/simulate-bots.js             bot simulation (synthetic data)
app/                                 website: Home, Organiser, Gate, Check (+ aadhaar.html bridge for the phone)
mobile/                              Android fan app (Expo / React Native)
PRESENTER_GUIDE.md                   what each screen shows and what to say
```

## Two front ends

| Who | App | Where |
|---|---|---|
| **Fans** | **Android app** (`mobile/`, Expo / React Native): verify, lottery, rotating QR ticket, sell back, waitlist offers | On the fan's phone |
| Organiser, venue staff, public | Website (`app/`): Home, Organiser, Gate scanner, Check a ticket | Laptop browser |

## Run it

You need Node.js 20 or later, plus **internet access for real Anon Aadhaar proofs**: the phone downloads the circuit files and UIDAI's test certificate. The phone and the laptop must be on the **same Wi-Fi**.

```
npm install
npm --prefix app install
npm --prefix mobile install
npm run chain           # terminal 1: local blockchain on 0.0.0.0:8545 (keep running)
npm run deploy:local    # terminal 2: fresh event; writes app/ and mobile/ config (re-run to reset)
npm run app             # terminal 3: website on http://localhost:5173 (also on your LAN IP)
npm run mobile          # terminal 4: Expo dev server, shows a QR code
```

On the Android phone:
1. Install **Expo Go** from the Play Store.
2. Scan the QR code shown by `npm run mobile`. The Fair Tickets app opens.
3. Pick who is using the phone (for example Asha). The app finds the laptop's address automatically; you can edit it on the first screen.

If Windows asks, allow **Node.js** on **Private networks**. The phone needs ports 8545 (blockchain), 5173 (Anon Aadhaar page) and 8081 (Expo).

Website windows: `#organiser`, `#gate`, `#check`, for example `http://localhost:5173/#gate`. Switch on **Presenter notes** in the top bar to show what each section means and what to say.

The gate scanner's **Start camera** button can scan the rotating QR straight off the phone's screen.

Later, an installable APK can be built with `npx eas-cli@latest build -p android --profile preview` (needs a free Expo account). Plain-HTTP traffic to the laptop must then be allowed in the build config.

## Demo accounts

| Account | Role |
|---|---|
| 0 Organiser | Runs the sale |
| 1 Asha | **Real-proof fan**: can only register with a real Anon Aadhaar test proof |
| 2–18 | Synthetic crowd: can quick-join (labelled "synthetic") or use a real test proof |
| 19 Scalper | Bot: has no Aadhaar QR; its forged proof is rejected on-chain |

## Real Anon Aadhaar test mode

To register Asha with a real proof:

1. Get a **test** Aadhaar QR from https://documentation.anon-aadhaar.pse.dev/docs/generate-qr and save the image on the phone. This is test data, never a real Aadhaar.
2. In the Android app as Asha, tap **Verify with Anon Aadhaar**. The app opens the official Anon Aadhaar widget (`app/aadhaar.html`, served from the laptop) in a built-in browser view.
3. Tap **Login** and choose the QR image. The phone generates a Groth16 proof; the first one can take a minute while the circuit files download.
4. The proof is handed back to the app, which sends the registration. The official `AnonAadhaar` contract, deployed with UIDAI's test public-key hash, verifies it on-chain.

The proof is bound to the wallet (the signal) and the event (the nullifier seed). A proof made for another account is detected and must be regenerated. Generate proofs before going on stage, in case the venue Wi-Fi is slow.

## Tests and checks

```
npm test               # 23 passing
npm run check:bot      # forged and unlisted proofs -> "Invalid Anon Aadhaar proof"
npm run simulate       # bot share: first-come queue vs Fair Tickets lottery (synthetic model)
```

## What is real and what is simulated

| Real | Simulated |
|---|---|
| All smart-contract logic, on a real EVM | Chainlink VRF: a local mock coordinator. The contract uses the real VRF v2.5 callback |
| Official Anon Aadhaar verifier contracts and browser prover (test key) | Test Aadhaar QR codes (official test data, not real identities) |
| Merkle seat proofs, shuffle, buyback, non-transferability | Synthetic crowd accounts 2–18, which are labelled on screen |
| Signed rotating QR codes, offline gate checks | Payments in test ETH; the bot simulation is a model |

Demo accounts use Hardhat's public test mnemonic. Never use those keys on a real network. Production deploys `FairTickets` directly against the official `AnonAadhaar` verifier with UIDAI's production key, without the demo router.
