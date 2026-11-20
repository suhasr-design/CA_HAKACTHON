// Event details for a deployment. The organiser's "Create event" form (website) passes these as
// EVENT_JSON; otherwise these defaults are used. Only the name goes on-chain as text; the rest is
// published alongside the contract address in deployment.json.
const DEFAULT_EVENT = {
  title: "Coldplay: Music of the Spheres",
  venue: "DY Patil Stadium, Navi Mumbai",
  city: "",                  // optional; the venue usually includes the city
  startsAt: "2027-01-18T19:00:00+05:30",
  priceInr: 4500,            // shown to fans; the demo chain charges priceEth
  priceEth: "0.05",
  publicSeats: 100,
  sponsorSeats: 10,
  holdSeats: 5,
  assistedCap: 5,            // in-person ID desk quota (foreign fans, minors)
  registrationMinutes: 120,
  buybackDays: 7,
  crowd: 120,                // labelled synthetic fans, so demand > supply (the "101st person" case)
};

const FIRST = [
  "Aarav", "Ananya", "Vihaan", "Diya", "Arjun", "Saanvi", "Reyansh", "Myra", "Kabir", "Aadhya", "Ishaan", "Kiara",
  "Advik", "Anika", "Vivaan", "Navya", "Krishna", "Pari", "Rohan", "Tara", "Siddharth", "Meher", "Aditya", "Riya",
  "Karthik", "Lakshmi", "Manish", "Nandini", "Pranav", "Sneha", "Rahul", "Shreya", "Varun", "Pooja", "Yash", "Zoya",
  "Harish", "Bhavna", "Imran", "Fatima", "Joseph", "Mary", "Gurpreet", "Simran", "Tenzin", "Lhamo", "Arnav", "Ira",
];
const LAST = ["K", "S", "R", "M", "P", "N", "B", "D", "G", "T", "V", "J"];

/** Deterministic crowd names: "Aarav K.", "Ananya S.", ... */
const crowdName = (i) => `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}.`;

function loadEventConfig() {
  let override = {};
  if (process.env.EVENT_JSON) {
    try { override = JSON.parse(process.env.EVENT_JSON); } catch { throw new Error("EVENT_JSON is not valid JSON"); }
  }
  const e = { ...DEFAULT_EVENT, ...override };
  const int = (v, lo, hi, name) => {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${name} must be between ${lo} and ${hi}`);
    return n;
  };
  e.publicSeats = int(e.publicSeats, 1, 500, "publicSeats");
  e.sponsorSeats = int(e.sponsorSeats, 0, 200, "sponsorSeats");
  e.holdSeats = int(e.holdSeats, 0, 200, "holdSeats");
  e.assistedCap = int(e.assistedCap, 0, 1000, "assistedCap");
  e.registrationMinutes = int(e.registrationMinutes, 2, 60 * 24 * 14, "registrationMinutes");
  e.buybackDays = int(e.buybackDays, 1, 60, "buybackDays");
  e.crowd = int(e.crowd, 0, 300, "crowd");
  e.priceInr = int(e.priceInr, 0, 10000000, "priceInr");
  if (!/^\d+(\.\d+)?$/.test(String(e.priceEth))) throw new Error("priceEth must be a number");
  e.title = String(e.title || "").trim().slice(0, 60) || DEFAULT_EVENT.title;
  e.venue = String(e.venue || "").trim().slice(0, 80);
  e.city = String(e.city || "").trim().slice(0, 40);
  e.startsAt = String(e.startsAt || "").trim();
  // On-chain name: "Title · Venue · Date" (the apps split on "·").
  const when = e.startsAt ? new Date(e.startsAt) : null;
  const dateText = when && !isNaN(when) ? when.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "";
  e.onChainName = [e.title.replace(/·/g, "-"), e.venue.replace(/·/g, "-"), dateText].filter(Boolean).join(" · ");
  return e;
}

module.exports = { DEFAULT_EVENT, loadEventConfig, crowdName };
