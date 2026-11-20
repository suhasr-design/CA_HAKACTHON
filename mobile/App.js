import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Animated, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";
import QRCode from "react-native-qrcode-svg";
import Svg, { Circle } from "react-native-svg";
import {
  NAMES, ROTATE_SECONDS, SCALPER, defaultHost, errorText, eth, fakeProof, fetchConfig, fmtLeft, isSynthetic,
  loadFanState, makeChain, makeGatePayload, short, syntheticProof,
} from "./src/chain";

const C = {
  bg: "#0C0A1D", card: "#17133A", card2: "#1E1948", line: "#2C2660", ink: "#F2EFFF", muted: "#A7A0D2",
  accent: "#8B6CFF", pink: "#FF6B9A", good: "#2BD4A4", bad: "#FF5C6C", amber: "#FFB547",
};

export default function App() {
  const [host, setHost] = useState(defaultHost());
  const [dep, setDep] = useState(null);
  const [connErr, setConnErr] = useState("");
  const [who, setWho] = useState(null);

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

  if (!dep || who === null) {
    return <Picker host={host} setHost={setHost} dep={dep} connErr={connErr} retry={() => connect(host)} onPick={setWho} />;
  }
  return <FanApp host={host} dep={dep} who={who} setWho={setWho} />;
}

function FanApp({ host, dep, who, setWho }) {
  const chain = useMemo(() => makeChain(host, dep), [host, dep]);
  const [state, setState] = useState(null);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  const me = who !== null ? chain.wallets[who].address : null;

  const refresh = useCallback(async () => {
    if (who === null) return;
    try {
      setState(await loadFanState(chain, me));
      setErr("");
    } catch (e) {
      setErr(`Can't reach the blockchain at ${host}:8545. Same Wi-Fi as the laptop? (${errorText(e)})`);
    }
  }, [chain, me, who, host]);

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

  const ft = chain.contract(chain.wallets[who]);
  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={C.ink} />}>
        <View style={s.header}>
          <View style={s.row}>
            <Avatar name={NAMES[who]} />
            <View style={{ marginLeft: 10 }}>
              <Text style={s.h2}>{NAMES[who]}</Text>
              <Text style={s.tiny}>{short(me)}</Text>
            </View>
          </View>
          <Pressable onPress={() => { setWho(null); setState(null); }} style={s.chip}><Text style={s.chipT}>Switch</Text></Pressable>
        </View>

        {err ? <View style={s.errBox}><Text style={s.errT}>{err}</Text></View> : null}
        {!state && !err ? <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} /> : null}
        {state ? <Fan state={state} who={who} me={me} ft={ft} chain={chain} run={run} busy={busy} /> : null}

        <Text style={[s.tiny, { textAlign: "center", marginTop: 24 }]}>
          Demo · local test blockchain at {host} · test ETH · Anon Aadhaar test mode
        </Text>
      </ScrollView>
      {toast ? <Toast toast={toast} onClose={() => setToast(null)} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------- identity picker (demo)
function Picker({ host, setHost, dep, connErr, retry, onPick }) {
  const [h, setH] = useState(host);
  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.brand}><Text style={s.logo}>FT</Text></View>
        <Text style={s.h1}>Fair Tickets</Text>
        <Text style={s.muted}>Tickets for fans. Not for bots.</Text>
        <View style={[s.card, { marginTop: 20 }]}>
          <Text style={s.label}>LAPTOP ADDRESS (same Wi-Fi)</Text>
          <TextInput value={h} onChangeText={setH} onEndEditing={() => setHost(h.trim())} style={s.input} autoCapitalize="none" keyboardType="numbers-and-punctuation" />
          <Text style={s.tiny}>Blockchain on port 8545, website and Anon Aadhaar page on port 5173.</Text>
          {dep ? <Text style={[s.tiny, { color: C.good, marginTop: 8 }]}>✓ Connected · event contract {short(dep.fairTickets)}</Text>
            : connErr ? (
              <>
                <Text style={[s.tiny, { color: C.bad, marginTop: 8 }]}>{connErr}</Text>
                <Btn label="Retry" onPress={() => { setHost(h.trim()); retry(); }} />
              </>
            ) : <ActivityIndicator color={C.accent} style={{ marginTop: 8 }} />}
        </View>
        <Text style={[s.label, { marginTop: 18 }]}>DEMO: WHO IS USING THIS PHONE?</Text>
        {NAMES.map((n, i) => i === 0 ? null : (
          <Pressable key={i} disabled={!dep} onPress={() => onPick(i)} style={({ pressed }) => [s.pick, (pressed || !dep) && { opacity: 0.5 }]}>
            <Avatar name={n} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.pickT}>{n}</Text>
              <Text style={s.tiny}>
                {i === SCALPER ? "Scalper bot · no Aadhaar QR" : isSynthetic(dep, i) ? "Synthetic demo fan · quick join or real proof" : "Real fan · must prove with Anon Aadhaar"}
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
function Fan({ state, who, me, ft, chain, run, busy }) {
  const shuffled = state.phase === 4;
  const isWinner = shuffled && state.position >= 0 && state.position < state.winnerCount;
  const waitRank = shuffled && state.position >= state.winnerCount ? state.position - state.winnerCount + 1 : null;
  const step = state.myTicket ? 3 : shuffled && state.registered ? 2 : state.registered ? 1 : 0;
  const parts = state.eventName.split("·");

  return (
    <View>
      <View style={s.event}>
        <Text style={s.eventTop}>TONIGHT</Text>
        <Text style={s.eventT}>{parts[0].trim()}</Text>
        <Text style={s.eventS}>{parts.slice(1).join("·").trim()} · {eth(state.facePrice)}</Text>
      </View>

      <View style={s.steps}>
        {["Verify", "Draw", "Result", "Ticket"].map((label, i) => (
          <View key={label} style={s.stepItem}>
            <View style={[s.stepDot, i < step && { backgroundColor: C.good }, i === step && { backgroundColor: C.accent }]}>
              <Text style={s.stepN}>{i < step ? "✓" : i + 1}</Text>
            </View>
            <Text style={[s.tiny, i === step && { color: C.ink }]}>{label}</Text>
          </View>
        ))}
      </View>

      {!state.registered && state.phase === 1 && <Verify state={state} who={who} me={me} ft={ft} chain={chain} run={run} busy={busy} />}
      {!state.registered && state.phase !== 1 && <Card><Text style={s.muted}>Registration is closed for this event.</Text></Card>}

      {state.registered && !shuffled && (
        <Card center>
          <Pulse><Text style={s.emoji}>🎲</Text></Pulse>
          <Text style={s.h3}>You’re in the draw</Text>
          <Text style={[s.muted, s.c]}>{state.entrantsCount} verified people registered. Everyone has the same chance; signing up early gives no advantage.</Text>
          {state.phase === 1 && <Text style={[s.tiny, s.c]}>Registration closes in {fmtLeft(state.regCloses - state.chainTime)}</Text>}
        </Card>
      )}

      {isWinner && !state.myTicket && (
        <Card center tone="good">
          <Pulse><Text style={s.emoji}>🎉</Text></Pulse>
          <Text style={s.h3}>You won a seat!</Text>
          {!state.labels[state.position] ? <Text style={s.muted}>Waiting for the organiser to reveal seats…</Text>
            : state.chainTime > state.claimDeadline ? <Text style={{ color: C.bad }}>Your claim window has closed.</Text>
            : (
              <>
                <Text style={s.seat}>Seat {state.labels[state.position]}</Text>
                <Text style={[s.muted, s.c]}>Pay exactly face value within {fmtLeft(state.claimDeadline - state.chainTime)}.</Text>
                <Btn primary busy={busy} label={`Pay ${eth(state.facePrice)} and claim`}
                  onPress={() => run(`Seat ${state.labels[state.position]} claimed`, () => ft.claimTicket(state.position, { value: state.facePrice }))} />
              </>
            )}
        </Card>
      )}

      {waitRank && !state.myTicket && !state.myOffer && (
        <Card center>
          <Text style={s.label}>YOUR PLACE ON THE WAITLIST</Text>
          <Text style={s.huge}>#{waitRank}</Text>
          <Text style={[s.muted, s.c]}>
            {Math.max(0, state.position - state.nextWaitlistIndex) === 0 ? "You’re next in line." : `${state.position - state.nextWaitlistIndex} ahead of you.`} If a seat is returned, it’s offered to you here.
          </Text>
        </Card>
      )}

      {state.myOffer && (
        <Card center tone="amber">
          <Pulse><Text style={s.emoji}>🎫</Text></Pulse>
          <Text style={s.h3}>A seat is available for you</Text>
          <Text style={s.seat}>Seat {state.labels[state.myOffer.seat]}</Text>
          <Text style={[s.muted, s.c]}>Accept within {fmtLeft(state.myOffer.deadline - state.chainTime)} at face value, or it moves to the next fan.</Text>
          <Btn primary busy={busy} label={`Accept and pay ${eth(state.facePrice)}`}
            onPress={() => run(`Seat ${state.labels[state.myOffer.seat]} accepted`, () => ft.acceptOffer(state.myOffer.seat, { value: state.facePrice }))} />
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
function Verify({ state, who, me, ft, chain, run, busy }) {
  const [open, setOpen] = useState(false);
  const isBot = who === SCALPER;

  const onProof = async (p) => {
    setOpen(false);
    await run("Registered with a real ZK proof", () =>
      ft.register(BigInt(p.nullifier), BigInt(p.timestamp), p.revealArray.map(BigInt), p.groth16Proof.map(BigInt)));
  };

  return (
    <Card>
      <Text style={s.h3}>Prove you’re a real, unique person</Text>
      <Text style={s.muted}>Your phone makes a zero-knowledge proof from a test Aadhaar QR. The event learns that you’re a unique resident, not who you are.</Text>

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
  const returning = t.status === 2;

  useEffect(() => {
    let alive = true;
    const regen = async () => {
      const p = await makeGatePayload(chain.wallets[who], chain.dep.fairTickets, t.id);
      if (alive) { setPayload(p); setLeft(ROTATE_SECONDS); }
    };
    regen();
    const rot = setInterval(regen, ROTATE_SECONDS * 1000);
    const tick = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000);
    return () => { alive = false; clearInterval(rot); clearInterval(tick); };
  }, [who, t.id, chain]);

  return (
    <View style={{ marginTop: 14 }}>
      <View style={[s.ticket, returning && { opacity: 0.6 }]}>
        <View style={s.ticketTop}>
          <View>
            <Text style={s.ticketSmall}>ADMIT ONE · #{t.id}</Text>
            <Text style={s.ticketEvent}>{state.eventName.split("·")[0].trim()}</Text>
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
            <View style={s.qrBox}>{payload ? <QRCode value={payload} size={190} color="#16132E" backgroundColor="#FFFFFF" /> : <ActivityIndicator />}</View>
            <View style={{ alignItems: "center", marginTop: 12 }}>
              <Ring left={left} total={ROTATE_SECONDS} />
              <Text style={s.ticketNote}>New code every {ROTATE_SECONDS}s, signed by your key. Screenshots expire.</Text>
            </View>
          </View>
        )}
        <Text style={s.ticketFoot}>Bound to {short(me)} · non-transferable</Text>
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
  const border = tone === "good" ? "#2BD4A466" : tone === "amber" ? "#FFB54766" : C.line;
  return <View style={[s.card, { borderColor: border }, center && { alignItems: "center" }]}>{children}</View>;
}

function Btn({ label, onPress, primary, danger, warn, busy }) {
  return (
    <Pressable disabled={busy} onPress={onPress}
      style={({ pressed }) => [s.btn, primary && s.btnP, danger && s.btnD, warn && s.btnW, (pressed || busy) && { opacity: 0.6 }]}>
      <Text style={[s.btnT, danger && { color: "#FF9AA4" }, warn && { color: C.amber }]}>{busy ? "Working…" : label}</Text>
    </Pressable>
  );
}

const AVATAR = ["#7C5CFF", "#FF6B9A", "#2BD4A4", "#FFB547", "#4CC9F0", "#F72585", "#B5E48C", "#FF8C42"];
function Avatar({ name }) {
  const bg = AVATAR[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR.length];
  return <View style={[s.avatar, { backgroundColor: bg }]}><Text style={s.avatarT}>{name === "Scalper" ? "🤖" : name[0]}</Text></View>;
}

function Ring({ left, total }) {
  const size = 58, r = 24, c = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="#8B6CFF33" strokeWidth={5} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.accent} strokeWidth={5} fill="none" strokeLinecap="round"
          strokeDasharray={`${c}`} strokeDashoffset={c * (1 - left / total)} rotation={-90} origin={`${size / 2}, ${size / 2}`} />
      </Svg>
      <Text style={{ color: "#16132E", fontWeight: "700" }}>{left}s</Text>
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
  input: { color: C.ink, backgroundColor: C.card2, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 16, marginBottom: 6 },
  card: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 18, padding: 16, marginTop: 14 },
  chip: { borderColor: C.line, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  chipT: { color: C.ink, fontSize: 13 },
  pick: { flexDirection: "row", alignItems: "center", backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 8 },
  pickT: { color: C.ink, fontSize: 16, fontWeight: "600" },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  avatarT: { color: "#120F2A", fontWeight: "800", fontSize: 16 },
  event: { backgroundColor: C.pink, borderRadius: 20, padding: 18, overflow: "hidden" },
  eventTop: { color: "#160F33", fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  eventT: { color: "#160F33", fontSize: 30, fontWeight: "800" },
  eventS: { color: "#160F33cc", fontSize: 13 },
  steps: { flexDirection: "row", justifyContent: "space-between", marginTop: 16, paddingHorizontal: 6 },
  stepItem: { alignItems: "center", flex: 1 },
  stepDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.line, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  stepN: { color: C.ink, fontWeight: "700", fontSize: 12 },
  emoji: { fontSize: 46 },
  seat: { color: C.ink, fontSize: 26, fontWeight: "800", marginVertical: 8, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 12, backgroundColor: "#ffffff12" },
  huge: { color: C.accent, fontSize: 64, fontWeight: "800", marginVertical: 4 },
  btn: { marginTop: 10, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, alignItems: "center", backgroundColor: C.card2, borderWidth: 1, borderColor: C.line, alignSelf: "stretch" },
  btnP: { backgroundColor: C.accent, borderColor: C.accent },
  btnD: { backgroundColor: "#FF5C6C18", borderColor: "#FF5C6C88" },
  btnW: { borderColor: C.amber },
  btnT: { color: C.ink, fontWeight: "700", fontSize: 15 },
  botBox: { backgroundColor: "#FF5C6C18", borderColor: "#FF5C6C55", borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 10 },
  errBox: { backgroundColor: "#FF5C6C22", borderColor: C.bad, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  errT: { color: "#FFC2C8", fontSize: 13 },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, paddingTop: 44, borderBottomColor: C.line, borderBottomWidth: 1 },
  ticket: { backgroundColor: "#F7F3FF", borderRadius: 22, overflow: "hidden" },
  ticketTop: { backgroundColor: C.accent, padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  ticketSmall: { color: "#ffffffcc", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  ticketEvent: { color: "#fff", fontSize: 22, fontWeight: "800" },
  ticketSeat: { color: "#fff", fontSize: 30, fontWeight: "800" },
  perf: { borderTopWidth: 2, borderStyle: "dashed", borderColor: "#8B6CFF66", marginHorizontal: 14 },
  qrRow: { alignItems: "center", padding: 18 },
  qrBox: { backgroundColor: "#fff", padding: 10, borderRadius: 12 },
  ticketNote: { color: "#5B5680", fontSize: 12, textAlign: "center", marginTop: 6, maxWidth: 240 },
  ticketFoot: { color: "#5B5680", fontSize: 12, paddingHorizontal: 16, paddingBottom: 14 },
  returning: { color: "#160F33", fontWeight: "700", padding: 24, textAlign: "center" },
  toast: { position: "absolute", left: 16, right: 16, bottom: 28, backgroundColor: C.card2, borderWidth: 1, borderRadius: 14, padding: 14 },
  toastT: { fontWeight: "700", fontSize: 15 },
  toastB: { color: C.muted, fontSize: 13, marginTop: 4 },
});
