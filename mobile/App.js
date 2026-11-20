import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Animated, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";
import QRCode from "react-native-qrcode-svg";
import Svg, { Circle } from "react-native-svg";
import {
  NAMES, ROTATE_SECONDS, SCALPER, defaultHost, errorText, eth, fakeProof, fetchConfig, fmtLeft, inr, isSynthetic,
  loadFanState, loadOrCreateOwnKey, makeChain, makeGatePayload, requestSponsor, short, syntheticProof,
} from "./src/chain";

// Bright theme, same palette as the website.
const C = {
  bg: "#F5F7FB", card: "#FFFFFF", well: "#EEF2F8", line: "#DFE5EF", ink: "#18213A", muted: "#5D6781",
  accent: "#3D5AFE", accentSoft: "#EBEFFF", pink: "#F2557A", good: "#0E9F6E", goodSoft: "#E6F8F1",
  bad: "#E0364A", badSoft: "#FFEDEF", amber: "#A86200", amberSoft: "#FFF6E3",
};
const nameFor = (who) => (who === "me" ? "You" : NAMES[who]);

export default function App() {
  const [host, setHost] = useState(defaultHost());
  const [dep, setDep] = useState(null);
  const [connErr, setConnErr] = useState("");
  const [who, setWho] = useState(null);
  const [ownKey, setOwnKey] = useState(null);

  useEffect(() => { loadOrCreateOwnKey().then(setOwnKey).catch(() => setOwnKey(null)); }, []);

  // Load the event config from the laptop whenever the address changes (or on retry).
  const connect = useCallback(async (h) => {
    setDep(null);
    setConnErr("");
    try {
      setDep(await fetchConfig(h));
    } catch (e) {
      setConnErr(`Can't reach the laptop at ${h}. Check it's on the same Wi-Fi and the website is running. (${errorText(e)})`);
    }
  }, []);
  useEffect(() => { connect(host); }, [host, connect]);

  // If the organiser creates a new event, pick it up automatically.
  useEffect(() => {
    if (!dep) return;
    const t = setInterval(async () => {
      try { const d = await fetchConfig(host); if (d.fairTickets !== dep.fairTickets) setDep(d); } catch {}
    }, 10000);
    return () => clearInterval(t);
  }, [dep, host]);

  if (!dep || who === null) {
    return <Picker host={host} setHost={setHost} dep={dep} connErr={connErr} retry={() => connect(host)} onPick={setWho} ownKey={ownKey} />;
  }
  return <FanApp key={dep.fairTickets} host={host} dep={dep} who={who} setWho={setWho} ownKey={ownKey} />;
}

function FanApp({ host, dep, who, setWho, ownKey }) {
  const chain = useMemo(() => makeChain(host, dep, ownKey), [host, dep, ownKey]);
  const [state, setState] = useState(null);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const signer = chain.signerOf(who);
  const me = signer.address;

  const refresh = useCallback(async () => {
    try {
      setState(await loadFanState(chain, me));
      setErr("");
    } catch (e) {
      setErr(`Can't reach the blockchain at ${host}:8545. Same Wi-Fi as the laptop? (${errorText(e)})`);
    }
  }, [chain, me, host]);

  useEffect(() => {
    setState(null);
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const show = (ok, title, body) => {
    setToast({ ok, title, body, id: Date.now() });
    setTimeout(() => setToast((t) => (t && Date.now() - t.id > 3000 ? null : t)), ok ? 3200 : 5200);
  };

  const run = async (label, fn) => {
    setBusy(true);
    try {
      const tx = await fn();
      if (tx?.wait) await tx.wait();
      show(true, label);
      await refresh();
      return true;
    } catch (e) {
      show(false, `${label}: rejected`, errorText(e));
      await refresh();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const ft = chain.contract(signer);
  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={C.accent} />}>
        <View style={s.header}>
          <View style={s.row}>
            <Avatar name={who === "me" ? "Me" : NAMES[who]} />
            <View style={{ marginLeft: 10 }}>
              <Text style={s.h2}>{who === "me" ? "You · this phone’s wallet" : NAMES[who]}</Text>
              <Text style={s.tiny}>{short(me)}</Text>
            </View>
          </View>
          <Pressable onPress={() => { setWho(null); setState(null); }} style={s.chip}><Text style={s.chipT}>Switch</Text></Pressable>
        </View>

        {err ? <View style={s.errBox}><Text style={s.errT}>{err}</Text></View> : null}
        {!state && !err ? <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} /> : null}
        {state ? <Fan state={state} who={who} me={me} ft={ft} chain={chain} run={run} busy={busy} show={show} /> : null}

        <Text style={[s.tiny, { textAlign: "center", marginTop: 24 }]}>
          Demo · local test blockchain at {host} · test ETH · Anon Aadhaar {dep.aadhaarMode === "test" ? "test mode" : "real (UIDAI)"}
        </Text>
        <Text style={[s.tiny, { textAlign: "center", marginTop: 4 }]}>Official event contract {short(dep.fairTickets)} · check it on the organiser’s website</Text>
      </ScrollView>
      {toast ? <Toast toast={toast} onClose={() => setToast(null)} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------- start: whose phone is this?
function Picker({ host, setHost, dep, connErr, retry, onPick, ownKey }) {
  const [h, setH] = useState(host);
  const ev = dep?.event || {};
  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.brand}><Text style={s.logo}>FT</Text></View>
        <Text style={s.h1}>Fair Tickets</Text>
        <Text style={s.muted}>Tickets for fans. Not for bots.</Text>
        <View style={[s.card, { marginTop: 20 }]}>
          <Text style={s.label}>LAPTOP ADDRESS (same Wi-Fi)</Text>
          <TextInput value={h} onChangeText={setH} onEndEditing={() => setHost(h.trim())} style={s.input} autoCapitalize="none" keyboardType="numbers-and-punctuation" />
          <Text style={s.tiny}>Blockchain on port 8545, website and Anon Aadhaar page on port 5173.</Text>
          {dep ? <Text style={[s.tiny, { color: C.good, marginTop: 8 }]}>✓ Connected · {ev.title || "event"} · contract {short(dep.fairTickets)}</Text>
            : connErr ? (
              <>
                <Text style={[s.tiny, { color: C.bad, marginTop: 8 }]}>{connErr}</Text>
                <Btn label="Retry" onPress={() => { setHost(h.trim()); retry(); }} />
              </>
            ) : <ActivityIndicator color={C.accent} style={{ marginTop: 8 }} />}
        </View>

        <Text style={[s.label, { marginTop: 18 }]}>REAL FAN</Text>
        <Pressable disabled={!dep || !ownKey} onPress={() => onPick("me")} style={({ pressed }) => [s.pick, s.pickMe, (pressed || !dep || !ownKey) && { opacity: 0.5 }]}>
          <Avatar name="Me" />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.pickT}>Use my own wallet</Text>
            <Text style={s.tiny}>Created on this phone, kept in secure storage. Prove with your real Aadhaar.</Text>
          </View>
          <Text style={s.muted}>›</Text>
        </Pressable>

        <Text style={[s.label, { marginTop: 18 }]}>DEMO IDENTITIES (LABELLED)</Text>
        {NAMES.map((n, i) => i === 0 ? null : (
          <Pressable key={i} disabled={!dep} onPress={() => onPick(i)} style={({ pressed }) => [s.pick, (pressed || !dep) && { opacity: 0.5 }]}>
            <Avatar name={n} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.pickT}>{n}</Text>
              <Text style={s.tiny}>
                {i === SCALPER ? "Scalper bot · no Aadhaar QR" : isSynthetic(dep, i) ? "Synthetic demo fan · quick join or real proof" : "Demo fan · must prove with Anon Aadhaar"}
              </Text>
            </View>
            <Text style={s.muted}>›</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------- main fan flow
function Fan({ state, who, me, ft, chain, run, busy, show }) {
  const shuffled = state.phase === 4;
  const isWinner = shuffled && state.position >= 0 && state.position < state.winnerCount;
  const waitRank = shuffled && state.position >= state.winnerCount ? state.position - state.winnerCount + 1 : null;
  const step = state.myTicket ? 3 : shuffled && state.registered ? 2 : state.registered ? 1 : 0;
  const ev = chain.dep.event || {};
  const parts = state.eventName.split("·");
  const when = ev.startsAt ? new Date(ev.startsAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "";

  return (
    <View>
      <View style={s.event}>
        <Text style={s.eventTop}>FAIR LOTTERY · {state.publicSeats} SEATS</Text>
        <Text style={s.eventT}>{ev.title || parts[0].trim()}</Text>
        <Text style={s.eventS}>{ev.venue || parts.slice(1).join("·").trim()}</Text>
        <Text style={s.eventS}>{[when, inr(ev.priceInr), eth(state.facePrice)].filter(Boolean).join(" · ")}</Text>
      </View>

      <View style={s.steps}>
        {["Verify", "Draw", "Result", "Ticket"].map((label, i) => (
          <View key={label} style={s.stepItem}>
            <View style={[s.stepDot, i < step && { backgroundColor: C.good }, i === step && { backgroundColor: C.accent }]}>
              <Text style={[s.stepN, i <= step && { color: "#fff" }]}>{i < step ? "✓" : i + 1}</Text>
            </View>
            <Text style={[s.tiny, i === step && { color: C.ink, fontWeight: "700" }]}>{label}</Text>
          </View>
        ))}
      </View>

      {!state.registered && state.phase === 1 && <Verify state={state} who={who} me={me} ft={ft} chain={chain} run={run} busy={busy} show={show} />}
      {!state.registered && state.phase !== 1 && <Card><Text style={s.muted}>Registration is closed for this event.</Text></Card>}

      {state.registered && !shuffled && (
        <Card center>
          <Pulse><Text style={s.emoji}>🎲</Text></Pulse>
          <Text style={s.h3}>You’re in the draw</Text>
          <Text style={[s.muted, s.c]}>
            {state.entrantsCount} verified people for {state.publicSeats} seats. Everyone has the same chance; signing up early gives no advantage.
            {state.entrantsCount > state.publicSeats ? ` Your chance: ${((state.publicSeats / state.entrantsCount) * 100).toFixed(0)}%. If you’re not in the first ${state.publicSeats}, you’re on the waitlist in a fair order.` : ""}
          </Text>
          {state.phase === 1 && <Text style={[s.tiny, s.c]}>Registration closes in {fmtLeft(state.regCloses - state.chainTime)}</Text>}
        </Card>
      )}

      {isWinner && !state.myTicket && (
        <Card center tone="good">
          <Pulse><Text style={s.emoji}>🎉</Text></Pulse>
          <Text style={s.h3}>You won a seat!</Text>
          <Text style={[s.tiny, s.c]}>Drawn #{state.position + 1} of {state.entrantsCount} · first {state.winnerCount} win</Text>
          {!state.myLabel ? <Text style={s.muted}>Waiting for the organiser to reveal seats…</Text>
            : state.chainTime > state.claimDeadline ? <Text style={{ color: C.bad }}>Your claim window has closed.</Text>
            : (
              <>
                <Text style={s.seat}>Seat {state.myLabel}</Text>
                <Text style={[s.muted, s.c]}>Pay exactly face value within {fmtLeft(state.claimDeadline - state.chainTime)}.</Text>
                <Btn primary busy={busy} label={`Pay ${eth(state.facePrice)} and claim`}
                  onPress={() => run(`Seat ${state.myLabel} claimed`, () => ft.claimTicket(state.position, { value: state.facePrice }))} />
              </>
            )}
        </Card>
      )}

      {waitRank && !state.myTicket && !state.myOffer && (
        <Card center>
          <Text style={s.label}>YOUR PLACE ON THE WAITLIST</Text>
          <Text style={s.huge}>#{waitRank}</Text>
          <Text style={[s.tiny, s.c]}>Drawn #{state.position + 1} of {state.entrantsCount}; seats went to #1–{state.winnerCount}.</Text>
          <Text style={[s.muted, s.c, { marginTop: 6 }]}>
            {Math.max(0, state.position - state.nextWaitlistIndex) === 0 ? "You’re next in line." : `${state.position - state.nextWaitlistIndex} ahead of you.`} The first returned or unclaimed seat is offered to you here, at face value.
          </Text>
        </Card>
      )}

      {state.myOffer && (
        <Card center tone="amber">
          <Pulse><Text style={s.emoji}>🎫</Text></Pulse>
          <Text style={s.h3}>A seat is available for you</Text>
          <Text style={s.seat}>Seat {state.myOffer.label}</Text>
          <Text style={[s.muted, s.c]}>Accept within {fmtLeft(state.myOffer.deadline - state.chainTime)} at face value, or it moves to the next fan.</Text>
          <Btn primary busy={busy} label={`Accept and pay ${eth(state.facePrice)}`}
            onPress={() => run(`Seat ${state.myOffer.label} accepted`, () => ft.acceptOffer(state.myOffer.seat, { value: state.facePrice }))} />
        </Card>
      )}

      {state.myTicket && <Ticket state={state} who={who} me={me} ft={ft} chain={chain} run={run} busy={busy} />}

      {state.refund > 0n && (
        <Card center tone="good">
          <Text style={s.h3}>💸 Refund ready</Text>
          <Text style={[s.muted, s.c]}>The next fan took your seat. Your face-value refund is waiting.</Text>
          <Btn primary busy={busy} label={`Withdraw ${eth(state.refund)}`} onPress={() => run("Refund withdrawn", () => ft.withdrawRefund())} />
        </Card>
      )}
    </View>
  );
}

// ---------------------------------------------------------------- step 1: verify
function Verify({ state, who, me, ft, chain, run, busy, show }) {
  const [open, setOpen] = useState(false);
  const isBot = who === SCALPER;

  const onProof = async (p) => {
    setOpen(false);
    // A brand-new wallet has no gas: the laptop's sponsor pays it, but ONLY for a valid Aadhaar proof
    // bound to this wallet, once per person. Bots without Aadhaar get nothing.
    if (state.balance < state.facePrice + 10n ** 16n) {
      try {
        const r = await requestSponsor(chain.host, me, p);
        show(true, `Gas sponsored (${r.amount} test ETH)`, "Released only because your Aadhaar proof is valid.");
      } catch (e) {
        show(false, "Gas sponsor refused", errorText(e));
        return;
      }
    }
    await run("Registered with a real ZK proof", () =>
      ft.register(BigInt(p.nullifier), BigInt(p.timestamp), p.revealArray.map(BigInt), p.groth16Proof.map(BigInt)));
  };

  return (
    <Card>
      <Text style={s.h3}>Prove you’re a real, unique person</Text>
      <Text style={s.muted}>Your phone makes a zero-knowledge proof from your Aadhaar Secure QR (mAadhaar app or e-Aadhaar PDF). The event learns that you’re a unique, UIDAI-verified person, never who you are.</Text>

      {!isBot && <Btn primary busy={busy} label="🪪  Verify with Anon Aadhaar" onPress={() => setOpen(true)} />}

      {isSynthetic(chain.dep, who) && (
        <Btn busy={busy} label="Quick join (synthetic demo fan)" onPress={() => run("Joined as a synthetic demo fan", () => {
          const p = syntheticProof(NAMES[who]);
          return ft.register(p.nullifier, p.timestamp, p.revealArray, p.groth16Proof);
        })} />
      )}

      {isBot && (
        <>
          <View style={s.botBox}><Text style={s.ink}>🤖 Scalper bot: thousands of wallets, but no UIDAI-signed Aadhaar QR.</Text></View>
          <Btn danger busy={busy} label="Try registering with a forged proof" onPress={() => run("Bot registration", () => {
            const p = fakeProof();
            return ft.register(p.nullifier, p.timestamp, p.revealArray, p.groth16Proof);
          })} />
        </>
      )}

      {who === "me" && (
        <View style={s.addrBox}>
          <Text style={s.tiny}>No Aadhaar (foreign visitor, minor)? Show this wallet address at the organiser’s ID desk:</Text>
          <Text selectable style={s.addr}>{me}</Text>
        </View>
      )}
      <Text style={[s.tiny, { marginTop: 10 }]}>Closes in {fmtLeft(state.regCloses - state.chainTime)}</Text>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={s.root}>
          <View style={s.modalHead}>
            <Text style={s.h2}>Anon Aadhaar</Text>
            <Pressable onPress={() => setOpen(false)} style={s.chip}><Text style={s.chipT}>Close</Text></Pressable>
          </View>
          <WebView
            source={{ uri: `${chain.aadhaarUrl}?signal=${me}&seed=${chain.dep.nullifierSeed}` }}
            onMessage={(e) => { try { const m = JSON.parse(e.nativeEvent.data); if (m.type === "proof") onProof(m); } catch {} }}
            javaScriptEnabled domStorageEnabled allowFileAccess mixedContentMode="always"
            startInLoadingState renderLoading={() => <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />}
            style={{ flex: 1, backgroundColor: C.bg }}
          />
        </View>
      </Modal>
    </Card>
  );
}

// ---------------------------------------------------------------- ticket
function Ticket({ state, who, me, ft, chain, run, busy }) {
  const t = state.myTicket;
  const [payload, setPayload] = useState("");
  const [left, setLeft] = useState(ROTATE_SECONDS);
  const [confirm, setConfirm] = useState(false);
  const [code, setCode] = useState("");
  const returning = t.status === 2;
  const gateCode = /^\d{4}$/.test(code) ? code : null;
  const signer = chain.signerOf(who);

  useEffect(() => {
    let alive = true;
    const regen = async () => {
      const p = await makeGatePayload(signer, chain.dep.fairTickets, t.id, gateCode);
      if (alive) { setPayload(p); setLeft(ROTATE_SECONDS); }
    };
    regen();
    if (gateCode) return () => { alive = false; };
    const rot = setInterval(regen, ROTATE_SECONDS * 1000);
    const tick = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000);
    return () => { alive = false; clearInterval(rot); clearInterval(tick); };
  }, [signer, t.id, chain, gateCode]);

  return (
    <View style={{ marginTop: 14 }}>
      <View style={[s.ticket, returning && { opacity: 0.6 }]}>
        <View style={s.ticketTop}>
          <View style={{ flex: 1 }}>
            <Text style={s.ticketSmall}>ADMIT ONE · #{t.id}</Text>
            <Text style={s.ticketEvent} numberOfLines={2}>{chain.dep.event?.title || state.eventName.split("·")[0].trim()}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.ticketSmall}>SEAT</Text>
            <Text style={s.ticketSeat}>{t.label}</Text>
          </View>
        </View>
        <View style={s.perf} />
        {returning ? (
          <Text style={s.returning}>Being returned: waiting for the next fan on the waitlist to accept.</Text>
        ) : (
          <View style={s.qrRow}>
            <Text style={s.label}>AT THE GATE: TYPE THE CODE ON ITS SCREEN</Text>
            <TextInput value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 4))} placeholder="4-digit gate code"
              keyboardType="number-pad" maxLength={4} style={s.codeInput} placeholderTextColor="#9AA3B8" />
            <View style={s.qrBox}>{payload ? <QRCode value={payload} size={230} ecl="L" quietZone={14} color="#000000" backgroundColor="#FFFFFF" /> : <ActivityIndicator />}</View>
            <View style={{ alignItems: "center", marginTop: 12 }}>
              {gateCode ? (
                <Text style={[s.ticketNote, { color: C.good, fontWeight: "700" }]}>✓ Signed for gate code {gateCode}. Only valid at that gate, right now.</Text>
              ) : (
                <>
                  <Ring left={left} total={ROTATE_SECONDS} />
                  <Text style={s.ticketNote}>Without a gate code this QR rotates every {ROTATE_SECONDS}s. Gates that ask for a code need it typed above.</Text>
                </>
              )}
            </View>
          </View>
        )}
        <Text style={s.ticketFoot}>Bound to {short(me)} · non-transferable · lost phone? the venue help desk re-checks your Aadhaar</Text>
      </View>

      {!returning && (
        <>
          {!confirm
            ? <Btn busy={busy} label="Can’t attend? Sell back at face value" onPress={() => setConfirm(true)} />
            : <Btn warn busy={busy} label={`Confirm: return for ${eth(state.facePrice)}`} onPress={() => { setConfirm(false); run(`Ticket #${t.id} returned`, () => ft.sellBack(t.id)); }} />}
          <Btn danger busy={busy} label="Try selling it to a scalper" onPress={() => run("Transfer to scalper", () => ft.transferFrom(me, chain.wallets[SCALPER].address, t.id))} />
        </>
      )}
    </View>
  );
}

// ---------------------------------------------------------------- small components
function Card({ children, center, tone }) {
  const border = tone === "good" ? "#A8E6CF" : tone === "amber" ? "#F0C36D" : C.line;
  const bg = tone === "good" ? C.goodSoft : tone === "amber" ? C.amberSoft : C.card;
  return <View style={[s.card, { borderColor: border, backgroundColor: bg }, center && { alignItems: "center" }]}>{children}</View>;
}

function Btn({ label, onPress, primary, danger, warn, busy }) {
  return (
    <Pressable disabled={busy} onPress={onPress}
      style={({ pressed }) => [s.btn, primary && s.btnP, danger && s.btnD, warn && s.btnW, (pressed || busy) && { opacity: 0.6 }]}>
      <Text style={[s.btnT, primary && { color: "#fff" }, danger && { color: C.bad }, warn && { color: C.amber }]}>{busy ? "Working…" : label}</Text>
    </Pressable>
  );
}

const AVATAR = ["#3D5AFE", "#E64980", "#0E9F6E", "#E8930C", "#1C9AD6", "#7B5CFF", "#2F9E44", "#F76707"];
function Avatar({ name }) {
  const bg = AVATAR[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR.length];
  return <View style={[s.avatar, { backgroundColor: bg }]}><Text style={s.avatarT}>{name === "Scalper" ? "🤖" : name === "Me" ? "★" : name[0]}</Text></View>;
}

function Ring({ left, total }) {
  const size = 58, r = 24, c = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="#E2E8F2" strokeWidth={5} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.accent} strokeWidth={5} fill="none" strokeLinecap="round"
          strokeDasharray={`${c}`} strokeDashoffset={c * (1 - left / total)} rotation={-90} origin={`${size / 2}, ${size / 2}`} />
      </Svg>
      <Text style={{ color: C.ink, fontWeight: "700" }}>{left}s</Text>
    </View>
  );
}

function Pulse({ children }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1.15, duration: 700, useNativeDriver: true }),
      Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [v]);
  return <Animated.View style={{ transform: [{ scale: v }] }}>{children}</Animated.View>;
}

function Toast({ toast, onClose }) {
  return (
    <Pressable onPress={onClose} style={[s.toast, { borderColor: toast.ok ? C.good : C.bad }]}>
      <Text style={[s.toastT, { color: toast.ok ? C.good : C.bad }]}>{toast.ok ? "✓ " : "✕ "}{toast.title}</Text>
      {toast.body ? <Text style={s.toastB}>{toast.body}</Text> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 18, paddingTop: 48, paddingBottom: 60 },
  row: { flexDirection: "row", alignItems: "center" },
  c: { textAlign: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  brand: { width: 56, height: 56, borderRadius: 16, backgroundColor: C.accent, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  logo: { color: "#fff", fontWeight: "800", fontSize: 20 },
  h1: { color: C.ink, fontSize: 32, fontWeight: "800" },
  h2: { color: C.ink, fontSize: 18, fontWeight: "700" },
  h3: { color: C.ink, fontSize: 20, fontWeight: "700", marginVertical: 6 },
  muted: { color: C.muted, fontSize: 14, lineHeight: 20 },
  ink: { color: C.ink, fontSize: 14 },
  tiny: { color: C.muted, fontSize: 12 },
  label: { color: C.good, fontSize: 11, fontWeight: "700", letterSpacing: 1.5, marginBottom: 6 },
  input: { color: C.ink, backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 16, marginBottom: 6 },
  card: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 18, padding: 16, marginTop: 14, elevation: 1 },
  chip: { borderColor: C.line, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: C.card },
  chipT: { color: C.ink, fontSize: 13 },
  pick: { flexDirection: "row", alignItems: "center", backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 8 },
  pickMe: { borderColor: C.accent, backgroundColor: C.accentSoft },
  pickT: { color: C.ink, fontSize: 16, fontWeight: "600" },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  avatarT: { color: "#fff", fontWeight: "800", fontSize: 16 },
  event: { backgroundColor: C.accent, borderRadius: 20, padding: 18, overflow: "hidden" },
  eventTop: { color: "#ffffffcc", fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  eventT: { color: "#fff", fontSize: 28, fontWeight: "800", marginTop: 2 },
  eventS: { color: "#ffffffdd", fontSize: 13, marginTop: 2 },
  steps: { flexDirection: "row", justifyContent: "space-between", marginTop: 16, paddingHorizontal: 6 },
  stepItem: { alignItems: "center", flex: 1 },
  stepDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#D5DCE8", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  stepN: { color: C.ink, fontWeight: "700", fontSize: 12 },
  emoji: { fontSize: 46 },
  seat: { color: C.accent, fontSize: 26, fontWeight: "800", marginVertical: 8, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 12, backgroundColor: C.accentSoft },
  huge: { color: C.accent, fontSize: 64, fontWeight: "800", marginVertical: 4 },
  btn: { marginTop: 10, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, alignItems: "center", backgroundColor: C.card, borderWidth: 1, borderColor: C.line, alignSelf: "stretch" },
  btnP: { backgroundColor: C.accent, borderColor: C.accent },
  btnD: { backgroundColor: C.badSoft, borderColor: "#F5B5BE" },
  btnW: { borderColor: C.amber, backgroundColor: C.amberSoft },
  btnT: { color: C.ink, fontWeight: "700", fontSize: 15 },
  botBox: { backgroundColor: C.badSoft, borderColor: "#F5B5BE", borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 10 },
  addrBox: { backgroundColor: C.well, borderRadius: 12, padding: 10, marginTop: 12 },
  addr: { color: C.ink, fontSize: 12, fontFamily: "monospace", marginTop: 4 },
  errBox: { backgroundColor: C.badSoft, borderColor: C.bad, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  errT: { color: "#A51D2D", fontSize: 13 },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, paddingTop: 44, borderBottomColor: C.line, borderBottomWidth: 1, backgroundColor: C.card },
  ticket: { backgroundColor: "#FFFFFF", borderRadius: 22, overflow: "hidden", borderWidth: 1, borderColor: C.line, elevation: 3 },
  ticketTop: { backgroundColor: C.accent, padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  ticketSmall: { color: "#ffffffcc", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  ticketEvent: { color: "#fff", fontSize: 20, fontWeight: "800" },
  ticketSeat: { color: "#fff", fontSize: 30, fontWeight: "800" },
  perf: { borderTopWidth: 2, borderStyle: "dashed", borderColor: "#C9D3FF", marginHorizontal: 14 },
  qrRow: { alignItems: "center", padding: 18 },
  codeInput: { color: C.ink, backgroundColor: C.well, borderColor: C.line, borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, fontSize: 26, fontWeight: "800", letterSpacing: 8, textAlign: "center", width: 220, marginBottom: 12 },
  qrBox: { backgroundColor: "#fff", padding: 10, borderRadius: 12, borderWidth: 1, borderColor: C.line },
  ticketNote: { color: C.muted, fontSize: 12, textAlign: "center", marginTop: 6, maxWidth: 260 },
  ticketFoot: { color: C.muted, fontSize: 12, paddingHorizontal: 16, paddingBottom: 14 },
  returning: { color: C.ink, fontWeight: "700", padding: 24, textAlign: "center" },
  toast: { position: "absolute", left: 16, right: 16, bottom: 28, backgroundColor: C.card, borderWidth: 1, borderRadius: 14, padding: 14, elevation: 6 },
  toastT: { fontWeight: "700", fontSize: 15 },
  toastB: { color: C.muted, fontSize: 13, marginTop: 4 },
});
