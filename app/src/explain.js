// Presenter notes shown on screen when "Presenter notes" is switched on.
// shows = what the section shows; say = a line to say to the judges.
export const EXPLAIN = {
  "home-101": {
    shows: "Live answer to “if 101 people want 100 seats, who gets in?”: everyone in the window gets the same chance, the list is shuffled by a seed produced after it was frozen, positions 1–100 win and #101 is waitlist #1.",
    say: "Speed doesn’t matter, so bots gain nothing. Person 101 isn’t rejected: they’re first in line for the first returned seat, at face value, and anyone can recompute the order.",
  },
  "org-create": {
    shows: "The organiser enters the real event: name, venue, date, ₹ price and seat counts. A new contract is deployed with that seat list locked.",
    say: "Seat counts, sponsor seats and artist holds are declared up front and locked on-chain. Nothing can be hidden for touts later.",
  },
  "org-fanpass": {
    shows: "The Fan Pass registry: fans who proved their Aadhaar once. Each event only sees an anonymous, event-specific code from a ~5 MB proof the phone makes in seconds, instead of a 584 MB Aadhaar proof every time.",
    say: "Prove you’re human once, then fair tickets for every event in two seconds. Kiosks at box offices handle the heavy one-time step, the way SIM or DigiYatra enrolment works, but only a proof leaves the counter.",
  },
  "org-assisted": {
    shows: "In-person ID desk for fans without Aadhaar (foreign visitors, minors). Staff check a passport; only a hash goes on-chain. The quota is fixed before the sale and counted publicly.",
    say: "This closes the gap for people Aadhaar doesn’t cover, without opening a back door: the quota is public and the same document can’t register twice.",
  },
  "gate-code": {
    shows: "Each gate shows a code that changes every 20 seconds. The fan’s QR must be signed for that exact code, so it can’t be prepared earlier, screenshotted or relayed from far away in time.",
    say: "This fixes relay attacks and phone-clock problems: the gate trusts its own clock, not the phone’s.",
  },
  "gate-sync": {
    shows: "All gates check and mark tickets in one shared entry list over the venue LAN, so a ticket used at Gate A is rejected at Gate B. If the LAN drops, each gate keeps working from its own list.",
    say: "This fixes duplicate entry across gates, which offline-only scanners can’t catch.",
  },
  "gate-desk": {
    shows: "Help desk for a dead or lost phone, and random identity spot-checks. The fan re-proves with Aadhaar; the new proof must give the same anonymous code (nullifier) as at registration.",
    say: "Someone who bought a phone or wallet from a tout fails this check: they can’t produce the original owner’s Aadhaar.",
  },
  "home-hero": {
    shows: "The live event, read straight from the blockchain: how many people registered, seats, tickets issued and the waitlist.",
    say: "Every number on this page comes from the smart contract, not from our server, so anyone can check it.",
  },
  "home-flow": {
    shows: "A ticket’s journey: locked seat list, verified sign-up, public lottery, a non-transferable ticket, buyback and an offline gate.",
    say: "Today’s systems break at three points: the sale, resale and the gate. We put one mechanism at each break.",
  },
  "home-screens": {
    shows: "The four apps in the system and who uses each one.",
    say: "Fans, the organiser, venue staff and the public each see the same blockchain from their own side.",
  },
  "fan-verify": {
    shows: "Sign-up with Anon Aadhaar. The fan’s phone makes a zero-knowledge proof from a UIDAI-signed QR code. The contract learns only an anonymous nullifier.",
    say: "She proves she is a real, unique person without revealing her name or Aadhaar number. The same person always gets the same nullifier, so a second account is rejected.",
  },
  "fan-bot": {
    shows: "A scalper bot sends a made-up proof. The official Anon Aadhaar verifier contract rejects it on-chain.",
    say: "Bots can create wallets, but they can’t forge a UIDAI signature. No proof, no entry.",
  },
  "fan-draw": {
    shows: "The fan is in the draw. Registering early gives no advantage, because order doesn’t matter in a lottery.",
    say: "Speed is worthless here. That’s what kills the bot advantage of today’s queues.",
  },
  "fan-win": {
    shows: "The fan won. The seat was assigned by the on-chain shuffle, and they pay exactly face value to claim it.",
    say: "Nobody can charge more than face value; the contract won’t accept any other amount.",
  },
  "fan-waitlist": {
    shows: "The fan’s place on the waitlist. The order came from the same random draw and can’t be bought.",
    say: "If a winner can’t attend, the seat comes to the next person in line, never to a scalper.",
  },
  "fan-ticket": {
    shows: "The ticket, bound to this fan’s wallet. The QR is re-signed every 30 seconds by the fan’s private key.",
    say: "A screenshot expires in seconds, a forgery fails the signature check, and the ticket can’t be transferred. Watch the transfer fail.",
  },
  "fan-offer": {
    shows: "A returned seat is offered to this waitlisted fan with a deadline. If they don’t accept, it moves to the next fan.",
    say: "The seller never chooses the buyer or the price, so there’s nothing to scalp.",
  },
  "org-stats": {
    shows: "Live numbers from the contract, including how many entrants used a real zero-knowledge proof and how many are the synthetic demo crowd.",
    say: "We label synthetic data on screen, because honesty about the demo matters.",
  },
  "org-steps": {
    shows: "The sale runs as a fixed sequence enforced by the contract: registration, randomness, shuffle, seat reveal, claims, buyback.",
    say: "The organiser can’t skip steps or reorder them. The contract only allows the next valid step.",
  },
  "org-seatmap": {
    shows: "Every seat in the committed inventory and its live state. Sponsor and hold seats are declared up front.",
    say: "The seat list was locked as a Merkle root before the sale. No hidden seats can be sold to resale sites.",
  },
  "org-lottery": {
    shows: "The shuffled entrant list. The first N are winners; the rest are the waitlist, in order.",
    say: "Click verify: we recompute the shuffle from the public registration list and the VRF seed. It matches exactly, so anyone can audit the draw.",
  },
  "org-inventory": {
    shows: "The Merkle root of the full seat list and the declared counts per category.",
    say: "This 32-byte fingerprint commits to every seat. Change one seat and it no longer matches.",
  },
  "gate-download": {
    shows: "Before doors open, the scanner downloads the valid-ticket list from the blockchain. Then it can work with the network off.",
    say: "Stadium networks fail with 35,000 people. Our gate doesn’t need them.",
  },
  "gate-scan": {
    shows: "Each scan runs five checks offline: right event, fresh timestamp, valid signature, holder owns this ticket, not already used.",
    say: "Live QR passes. Screenshot: expired. Forgery: wrong signature. Fake: not on the list. Second scan: already used.",
  },
  "check-search": {
    shows: "Anyone can look up a ticket before paying a stranger. The page reads the blockchain directly.",
    say: "Even a real ticket shows ‘cannot be sold to you’. That ends the WhatsApp resale scam.",
  },
  "check-facts": {
    shows: "Public facts about the event: the official contract, the seat-list fingerprint and the declared seat counts.",
    say: "These numbers are the same for everyone and can’t be edited after the sale opens.",
  },
};
