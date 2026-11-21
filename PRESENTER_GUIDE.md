# Fair Tickets: presenter guide

For the team presenting the live demo. Switch on **Presenter notes** in the app's top bar: every section then shows "What it shows" and "Say" boxes.

## Before going on stage

1. Run `npm run chain`, `npm run deploy:local`, `npm run app` and `npm run mobile` (see README). Laptop and phones on the same Wi-Fi.
2. **Fans are on Android phones only.** Open the Fair Tickets app in Expo Go on one phone as **Asha** (real ZK fan). If you have a second phone, open it as the **Scalper** or as a waitlisted fan for the buyback demo.
3. Laptop browser windows: `localhost:5173/#organiser`, `#gate`, `#check`.
4. Save a test Aadhaar QR image on Asha's phone beforehand, and check that the first proof works on the venue Wi-Fi.

---

## Screen by screen

### Home
- **Shows:** the live event read from the blockchain (registrations, seats, live tickets, waitlist), the six mechanisms as a flow, and the four apps.
- **Say:** "Today’s ticketing breaks in three places: the sale, resale and the gate. We fixed each one with a mechanism that runs on a blockchain, so nobody has to trust the platform."

### Fan app (Android phone)
Show the phone to the judges, or mirror its screen. Tap **Verify with Anon Aadhaar** to open the official widget inside the app. On the gate laptop, **Start camera** scans the rotating QR off the phone.

| Part | What it shows | What to say |
|---|---|---|
| Verify (Asha) | Anon Aadhaar Login widget → zero-knowledge proof from a test QR → Register | "She proves she’s a real, unique person. The contract learns only an anonymous nullifier: no name, no Aadhaar number. The official Anon Aadhaar verifier checks the proof on-chain." |
| Verify (Scalper, account 19) | "Try registering with a forged proof" → red toast "Invalid Anon Aadhaar proof" | "Bots can create a thousand wallets but can’t forge UIDAI’s signature. Rejected on-chain." |
| In the draw | Waiting card | "Signing up early gives no advantage. Speed is worthless in a lottery." |
| Winner | Confetti, seat, "Pay face value and claim" | "The contract only accepts exactly face value." |
| Waitlist | Big #position and a progress bar | "The order came from the same random draw. It can’t be bought." |
| Ticket | Concert-style ticket; QR re-signed every 30 s with a countdown ring | "The QR is signed by her private key and changes every 30 seconds. A screenshot is dead within a minute." |
| Try selling to a scalper | Red toast "NonTransferable" | "There is no transfer function. The ticket can’t leave her wallet." |
| Sell back → Offer | Seller’s ticket shows "being returned"; the waitlisted fan sees "A seat is available" with a deadline | "The seller never picks the buyer or the price. The seat goes to the next verified fan, at face value." |
| Refund | "Withdraw refund" | "The seller gets the face value back automatically." |

### Organiser dashboard
| Part | What it shows | What to say |
|---|---|---|
| Stat tiles | Verified people (real ZK vs synthetic), seats, live tickets, waitlist, proceeds | "We label synthetic demo data on screen." |
| Next step | The single action the contract allows right now | "The organiser can’t skip or reorder steps. The contract enforces the sequence." |
| Seat list commitment | Merkle root locked before the sale, plus declared categories | "This 32-byte fingerprint commits to every seat. No hidden seats for resale sites." |
| Live seat map | Each seat: open, ticket, returning, offered, declared hold | "Every seat is accounted for, live from the chain." |
| Lottery board + "Verify the draw independently" | Shuffled list; winners, then waitlist; ZK or synthetic badges | "We recompute the shuffle from the public registration list and the VRF seed: exact match. Anyone can audit it." |

### Gate scanner
| Part | What it shows | What to say |
|---|---|---|
| Before doors open | Download the ticket list from the chain, then **Switch network OFF** | "Stadium networks fail. Our gate works offline." |
| Phones at the gate | Live QR ✓ · Screenshot ✕ expired · Forged copy ✕ signature · Fake ticket ✕ not on list · Live QR again ✕ already used | Name each check as it happens: fresh timestamp, holder’s signature, on the valid list, not used before. |
| Big result panel | Green ENTER or red REJECT with the reason and a sound | n/a |

### Check a ticket
| Part | What it shows | What to say |
|---|---|---|
| Search (try #999) | "This ticket does not exist" | "A fake is exposed before anyone pays." |
| Search (a real ticket) | "Real ticket, but it can’t be sold to you" | "Even a real ticket can’t be sold to a stranger, so the WhatsApp resale market has nothing to sell." |
| Event facts | Official contract, seat-list fingerprint, declared counts | "Same numbers for everyone, readable by anyone." |

---

## 5-minute demo script

1. **(30 s) Home.** Show the problem and the six-step flow.
2. **(60 s) Fan · Asha:** click Register with the pre-generated real proof, and show the "ZK proof ✓" badge. Then **Scalper:** forged proof, rejected.
3. **(60 s) Organiser:** Add synthetic crowd → Close registration → Request draw → Deliver randomness → Run shuffle → Reveal seats → **Verify the draw**.
4. **(45 s) Fan:** a winner claims (confetti) and shows the rotating QR. Try selling to the scalper: rejected.
5. **(45 s) Buyback:** the winner sells back → the waitlisted fan accepts → **Check** the old ticket number: "no longer valid".
6. **(45 s) Gate:** download → network OFF → live ✓, screenshot ✕, forged ✕, fake ✕, second scan ✕.
7. **(15 s) Close** with the bot simulation: about 77% bot share in a first-come queue vs about 2.5% with Fair Tickets (synthetic model).

## Likely judge questions

- **"Why does this need a blockchain?"** The seat list, the draw and the ticket rules must be things the organiser can’t change. On the platform’s own server, fans would be back to "trust us".
- **"What stops someone borrowing relatives’ Aadhaar QRs?"** Each one is still one human and one entry, and tickets can’t be transferred. Our simulation shows a scalper with 25 borrowed identities gets about 2.5% of seats, against about 77% in a normal queue. Production could also re-prove the same nullifier at the gate.
- **"Is the Aadhaar part real?"** Yes. Real Aadhaar Secure QRs (mAadhaar / e-Aadhaar, including the new V5 format) are verified against **UIDAI’s real signing keys**, including the current 2026 key. We tested it end to end with a real QR: the proof is accepted on-chain, and the same proof for another wallet is rejected.
- **"What’s simulated?"** The local chain and test ETH (stand-in for UPI payment), Chainlink VRF on the local chain (on Quai we use commit-reveal), and the labelled synthetic crowd.
- **"Gas at stadium scale?"** ~370k gas per registration → ~130 per Quai block; the shuffle is batched and anyone can run it; position lookup is O(1); gates sync the ticket list in pages.

## “If there are 100 seats and I’m the 101st?”

> “Nobody is ‘101st’ by speed. Everyone who registers in the window gets the same chance. When registration closes, the list is frozen on-chain, *then* a random seed is produced, and the whole list is shuffled. Positions 1–100 win. Whoever lands at position 101 is **waitlist #1**: the first seat that’s returned or left unclaimed is offered to them automatically, at face value. Anyone can re-run the shuffle from public data and get the identical order.”

**Show it:** Home → the “101 people, 100 seats” card (live numbers). Organiser → Add synthetic crowd (137 for 100 seats) → draw → the lottery board shows winners 1–100 and Waitlist #1, #2…

## Earlier flaws and how they’re fixed now

| Flaw (from the review) | Fix in the build | Where to show it |
|---|---|---|
| **Relay attack** (scalper streams a live QR) | **Gate challenge code:** each gate shows a 4-digit code that changes every 20 s; the fan types it, the QR is signed for that code. A QR made earlier or elsewhere fails. | Gate → “Relayed / old QR” → REJECT |
| **Clock drift** | Same fix: the gate checks its **own** code, not the phone’s clock. | Gate code card |
| **Duplicate entry across gates** | **Gate sync** over the venue LAN: check-and-mark is atomic, so Gate B refuses a ticket used at Gate A. If the LAN drops, gates keep working locally and report conflicts on reconnect. | Two browser tabs: Gate A and Gate B |
| **Phone / wallet selling** | **Help-desk ID re-check:** a fresh Aadhaar proof must give the **same anonymous code (nullifier)** as at registration. A buyer can’t produce the seller’s Aadhaar. | Gate → Help desk |
| **Dead or lost phone** | Same help desk: the fan re-proves with Aadhaar and is admitted without the phone. | Gate → Help desk |
| **Key custody** | The fan’s wallet is **generated on the phone** and kept in Android’s secure storage (Keystore-backed). | App → “Use my own wallet” |
| **Aadhaar doesn’t cover everyone** (foreign fans, minors) | **Assisted ID desk:** staff check a passport in person; only a hash goes on-chain, under a **public quota fixed before the sale**; one registration per document. | Organiser → Assisted ID desk |
| **Bots draining sponsored gas** | The gas sponsor pays **only for a valid Aadhaar proof bound to that wallet, once per person**. | Bot gets “Gas sponsor refused” |
| **Fake apps** | App and website both show the official event contract; anyone can check any ticket on the public Check page. | Footer of the app, Check page |
| **“Polygon Layer-2” wording** | We now deploy on **Quai Network (Orchard testnet)**. Don’t say “Polygon Layer-2”. | — |
| **Crypto tax / fiat, chargebacks** | Prices shown in ₹; on-chain payment is final (no chargebacks). Production: UPI into an escrow contract. *Roadmap, not built.* | — |

**Be honest about what’s left:** a scalper who streams a live video call with the real holder could still relay a gate code in real time; the next layer is an NFC tap at the gate. Say it before they ask.

## Where else this works (area of use)

Concerts and festivals · IPL / cricket matches (multiple gates) · temple darshan slots (one devotee, one slot) · Tatkal-style quotas · hospital OPD tokens · college fests and exam seats. Anywhere demand exceeds supply and “one person, one fair chance” must be verifiable.

## Fan Pass: “prove you’re human once, then fair tickets for every event in two seconds”

**Why:** a real Anon Aadhaar proof needs a 584 MB proving key: ~55 s even on a flagship phone with snarkjs, and it stalls in an app WebView. Every existing approach either sees your identity (OTP, eKYC, DigiLocker, DigiYatra) or is generic identity without fair allocation (Self, zkPassport, World ID).

**How:**
1. **Once:** the fan proves their Aadhaar at a **kiosk** (box office, partner desk, the organiser laptop: `/kiosk.html`) or on the phone. The proof is bound to a **Fan Pass ID** generated and kept in the phone’s secure storage. The pass is added to an on-chain **Semaphore** group (Ethereum Foundation’s anonymous-membership protocol). One Aadhaar = one Fan Pass.
2. **Every event:** the phone proves “I hold a Fan Pass” with a **5.5 MB** proving file, in **seconds** (measured: ~1 s in Node, ~7 s in a browser including the download). The proof gives a code unique to that person **for that event only**: no double entry, and events can’t track fans across events.
3. **Lost phone:** restore with the backup code, or re-enrol at a kiosk with a **newer** Aadhaar QR: the old phone’s pass is retired on-chain (old proofs stop working within 5 minutes).
4. **Help desk:** a fresh Aadhaar proof finds *that person’s* pass, and the phone must prove it holds *that* pass and that it made *this* ticket’s entry. A tout’s buyer fails.

**Measured / tested:** 42 contract tests (5 with real Semaphore proofs), service end-to-end test (`scripts/e2e-fanpass.js`, 11 checks), browser proof verified.

## New demo flow (real booking)

1. **Organiser → Create an event:** real name, venue, date, ₹ price, 100 seats (+ sponsor/holds declared). ~30 s.
2. **Phone → Book a ticket → Get my Fan Pass → “at a kiosk”** → a 6-character code appears. **Laptop → Organiser → Open kiosk** → type the code → upload the Aadhaar Secure QR → “Fan Pass issued” (2–5 min the first time). The phone flips to “Fan Pass active” by itself.
3. **Phone → Join the draw:** registered in seconds; the relayer paid the gas and added test ETH for the ticket.
3. **Organiser → Add synthetic crowd (137)** → Close registration → Request draw → Deliver randomness → Run shuffle → Reveal seats → Synthetic winners pay.
4. **Phone:** won a seat (pay) or waitlist #N with “drawn #k of 138”.
5. **Gate (two tabs, Gate A and B):** download list → the phone types Gate A’s code → ENTER; the same ticket at Gate B → REJECT “already entered at Gate A”; “Relayed / old QR” → REJECT.
6. **Help desk:** enter the ticket number → fan re-proves → “same person who registered” → admit.
