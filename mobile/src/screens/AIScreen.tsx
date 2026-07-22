import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Animated, Easing,
  KeyboardAvoidingView, Platform, LayoutAnimation, UIManager, Linking, Keyboard,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback } from "react";
import { T, won } from "../theme";
import { Api, OfferCard as Offer, NeedLevel, RewardNudge, SafetyNotice, Proactive, ChatStatus } from "../api";
import { onFontScale } from "../fontscale";
import OfferCard from "../components/OfferCard";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
const ease = () => LayoutAnimation.configureNext(LayoutAnimation.create(220, "easeInEaseOut", "opacity"));

type Msg =
  | { role: "user"; text: string }
  | { role: "loading" }
  | { role: "gate"; question: string; chat: ChatStatus } // 무료 대화 소진 → 광고 보고 이어가기
  | {
      role: "ai"; summary: string; sections: { title: string; body: string }[]; uncertainty: string;
      needLevel: NeedLevel; benefits: Offer[]; missions: Offer[]; rewardNudge: RewardNudge; answerSnapshotId: string;
      safety?: SafetyNotice | null; // 사기·건강·금융 등 안전 안내
      followUps?: string[]; // 이어서 물어볼 후속 질문
      retry?: string; // 실패 시 재시도할 질문
      fallback?: boolean; // 실제 AI가 아닌 '예시' 답변인지 — 정직하게 표시
    };

const QUICK = [
  { emoji: "💰", label: "생활비 아끼는 법" },
  { emoji: "🛡️", label: "이거 사기인가요?" },
  { emoji: "🧳", label: "여행 싸게 가기" },
];

export default function AIScreen() {
  const nav = useNavigation<any>();
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [fs, setFs] = useState(1);
  const [pro, setPro] = useState<Proactive | null>(null);
  const [chat, setChat] = useState<ChatStatus | null>(null);
  const [adBusy, setAdBusy] = useState(false);
  const convId = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => onFontScale(setFs), []);
  // 앱이 먼저 건네는 '오늘의 이야기' — 대화 없을 때 홈에서 안부를 전한다.
  useFocusEffect(useCallback(() => {
    Api.proactive().then(setPro).catch(() => {});
    Api.chatStatus().then(setChat).catch(() => {});
  }, []));

  // 새 대화 시작 — 대화가 있을 때만 헤더에 '새 대화' 버튼 노출(이어가기/새로 시작 구분).
  const newChat = useCallback(() => {
    ease();
    setMessages([]);
    convId.current = null; // 다음 질문에서 새 대화 생성 → 이전 맥락과 분리
    Api.proactive().then(setPro).catch(() => {});
  }, []);
  useEffect(() => {
    nav.setOptions({
      headerRight: () =>
        messages.length > 0 ? (
          <TouchableOpacity onPress={newChat} activeOpacity={0.8} style={{ paddingHorizontal: 6, paddingVertical: 4 }}>
            <Text style={{ color: T.brand, fontWeight: "800", fontSize: 15 }}>＋ 새 대화</Text>
          </TouchableOpacity>
        ) : null,
    });
  }, [messages.length, newChat, nav]);

  const scrollToEnd = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 70);

  async function ask(q?: string) {
    const question = (q ?? text).trim();
    if (!question || busy) return;
    setText("");
    Keyboard.dismiss(); // 보내면 키패드를 닫아 답변을 편히 읽게(시니어 가독성)
    ease();
    setMessages((m) => [...m, { role: "user", text: question }, { role: "loading" }]);
    setBusy(true);
    scrollToEnd();
    try {
      if (!convId.current) convId.current = (await Api.createConversation()).conversation_id;
      const r = await Api.ask(convId.current, question);
      ease();
      // 무료 대화 소진 → 답변 대신 '광고 보고 이어가기' 카드. 방금 질문은 광고 후 자동 전송.
      if (r.gated || !r.answer) {
        setMessages((m) => [
          ...m.filter((x) => x.role !== "loading"),
          { role: "gate", question, chat: r.chat ?? { used: 0, allowance: 0, remaining: 0, locked: true, adReward: 20, perUnlock: 5 } },
        ]);
        return;
      }
      if (r.chat) setChat(r.chat);
      const ans = r.answer; // 로컬 const로 바인딩해야 클로저 안에서 null-narrowing 유지
      setMessages((m) => [
        ...m.filter((x) => x.role !== "loading"),
        {
          role: "ai",
          summary: ans.summary,
          sections: ans.sections,
          uncertainty: ans.uncertainty.message,
          needLevel: r.needLevel ?? (r.matched?.benefits.length ? "ready" : "none"),
          benefits: r.matched?.benefits ?? (r.commercial ? [r.commercial] : []),
          missions: r.matched?.missions ?? [],
          rewardNudge: r.rewardNudge ?? null,
          answerSnapshotId: r.answerSnapshotId,
          safety: r.safetyNotice ?? null,
          followUps: r.followUps ?? [],
          fallback: r.fallback ?? false,
        },
      ]);
    } catch {
      ease();
      setMessages((m) => [...m.filter((x) => x.role !== "loading"), { role: "ai", summary: "연결이 잠시 불안정해요.", sections: [], uncertainty: "", needLevel: "none", benefits: [], missions: [], rewardNudge: null, answerSnapshotId: "", retry: question }]);
    } finally {
      setBusy(false);
      scrollToEnd();
    }
  }

  // 광고 시청(데모: 짧은 대기) → 대화 개방 + 포인트 → 방금 질문 자동 전송.
  async function watchAdAndContinue(question: string) {
    if (adBusy) return;
    setAdBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 1400)); // 광고 재생 대체(실 SDK 연동 지점)
      const res = await Api.watchChatAd();
      setChat(res.status);
      ease();
      setMessages((m) => m.filter((x) => x.role !== "gate"));
      await ask(question);
    } catch {
      /* noop */
    } finally {
      setAdBusy(false);
    }
  }

  const goTab = (name: string) => nav.navigate(name);
  const empty = messages.length === 0;
  const lowChat = chat && !chat.locked && chat.remaining <= 2 && chat.remaining > 0;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: T.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 18, paddingBottom: 10 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onContentSizeChange={scrollToEnd} showsVerticalScrollIndicator={false}>
        {empty ? (
          <View>
            {pro ? (
              <View style={s.proCard}>
                <View style={s.proHead}>
                  <Text style={s.proTitle}>오늘의 이야기</Text>
                  {pro.weather && <Text style={s.proWeather}>☀️ {pro.weather.label} {pro.weather.tempC}°</Text>}
                </View>
                <Text style={s.proMsg}>{pro.message}</Text>
                <TouchableOpacity style={s.proTopic} activeOpacity={0.85} onPress={() => ask(pro.topic)}>
                  <Text style={s.proTopicText}>💬 {pro.topic}</Text>
                </TouchableOpacity>
                {pro.action && (
                  <TouchableOpacity style={s.proAction} activeOpacity={0.85} onPress={() => goTab(pro.action!.tab)}>
                    <Text style={s.proActionText}>{pro.action.label} ›</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <View style={{ marginBottom: 22, marginTop: 8 }}>
                <Text style={[s.hello, { fontSize: 16 * fs }]}>안녕하세요 👋</Text>
                <Text style={[s.h, { fontSize: 32 * fs, lineHeight: 40 * fs }]}>무엇이든{"\n"}편하게 물어보세요</Text>
              </View>
            )}
            <View style={s.chipWrap}>
              {QUICK.map((qq) => (
                <TouchableOpacity key={qq.label} style={s.chip} onPress={() => ask(qq.label)} activeOpacity={0.85}>
                  <Text style={s.chipEmoji}>{qq.emoji}</Text><Text style={[s.chipText, { fontSize: 16 * fs }]}>{qq.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          messages.map((m, i) => <MessageView key={i} m={m} goTab={goTab} onRetry={ask} fs={fs} onWatchAd={watchAdAndContinue} adBusy={adBusy} />)
        )}
      </ScrollView>

      {lowChat && (
        <View style={s.remainBar}>
          <Text style={[s.remainText, { fontSize: 13 * fs }]}>무료 대화 {chat!.remaining}회 남았어요 · 이후엔 광고 보고 이어가기</Text>
        </View>
      )}

      <View style={s.inputBar}>
        <View style={s.inputWrap}>
          <TextInput ref={inputRef} style={s.input} placeholder="메시지를 입력하세요" placeholderTextColor={T.muted} value={text} onChangeText={setText} onSubmitEditing={() => ask()} returnKeyType="send" multiline />
        </View>
        <TouchableOpacity style={[s.send, (!text.trim() || busy) && { opacity: 0.35 }]} onPress={() => ask()} disabled={!text.trim() || busy} activeOpacity={0.85}>
          <Text style={s.sendIcon}>↑</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageView({ m, goTab, onRetry, fs, onWatchAd, adBusy }: { m: Msg; goTab: (n: string) => void; onRetry: (q: string) => void; fs: number; onWatchAd: (q: string) => void; adBusy: boolean }) {
  if (m.role === "user") return <View style={s.userBubble}><Text style={[s.userText, { fontSize: 16.5 * fs, lineHeight: 23 * fs }]}>{m.text}</Text></View>;
  if (m.role === "loading") return (
    <View style={s.aiCard}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <TypingDots />
        <Text style={[s.thinking, { fontSize: 13.5 * fs }]}>생각하고 있어요…</Text>
      </View>
    </View>
  );
  // 광고 보고 대화 이어가기 — 수익화 미션을 대화에 자연스럽게 녹인 카드.
  if (m.role === "gate") return (
    <View style={s.gate}>
      <Text style={[s.gateTitle, { fontSize: 17 * fs, lineHeight: 24 * fs }]}>무료 대화를 다 쓰셨어요</Text>
      <Text style={[s.gateBody, { fontSize: 14.5 * fs, lineHeight: 21 * fs }]}>
        짧은 광고를 보면 대화 {m.chat.perUnlock}회를 더 할 수 있고, 포인트 {m.chat.adReward}P도 함께 드려요.
      </Text>
      <TouchableOpacity style={[s.gateBtn, adBusy && { opacity: 0.6 }]} onPress={() => onWatchAd(m.question)} disabled={adBusy} activeOpacity={0.85}>
        <Text style={[s.gateBtnText, { fontSize: 16 * fs }]}>{adBusy ? "광고 보는 중…" : `🎬 광고 보고 이어가기 (+${m.chat.adReward}P)`}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => goTab("걷기")} activeOpacity={0.8}>
        <Text style={[s.gateAlt, { fontSize: 13.5 * fs }]}>또는 걸어서 포인트 모으기 ›</Text>
      </TouchableOpacity>
    </View>
  );

  const failed = !!m.retry;
  return (
    <View style={{ marginBottom: 6 }}>
      <View style={s.aiCard}>
        <View style={s.aiBadgeRow}>
          <View style={s.aiBadge}><Text style={s.aiBadgeText}>AI</Text></View>
          <Text style={s.aiBadgeLabel}>도우미</Text>
          {/* 실제 AI가 아니라 예시 답변이면 정직하게 표시 — '도돌이표' 오해 방지 */}
          {m.fallback && !failed && (
            <View style={s.exTag}><Text style={s.exTagText}>예시 답변</Text></View>
          )}
        </View>
        <Text style={[s.summary, { fontSize: 18 * fs, lineHeight: 26 * fs }]}>{m.summary}</Text>
        {m.sections.map((sec, j) => (
          <View key={j} style={{ marginTop: 10 }}>
            <Text style={[s.secTitle, { fontSize: 15.5 * fs }]}>{sec.title}</Text>
            <Text style={[s.secBody, { fontSize: 15 * fs, lineHeight: 22 * fs }]}>{sec.body}</Text>
          </View>
        ))}
        {!!m.uncertainty && <Text style={s.uncertainNote}>ⓘ {m.uncertainty}</Text>}
        {failed && (
          <TouchableOpacity style={s.retryBtn} onPress={() => onRetry(m.retry!)} activeOpacity={0.85}>
            <Text style={s.retryText}>↻ 다시 시도</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 안전 안내 — 사기·위기·건강·금융. 답변 바로 아래 눈에 띄게. */}
      {m.safety && <SafetyCard notice={m.safety} />}

      {/* ready: 전체 카드 즉시 노출 */}
      {m.needLevel === "ready" && m.benefits.map((o) => <OfferCard key={o.offerSnapshotId} offer={o} answerSnapshotId={m.answerSnapshotId} />)}
      {/* exploring: 부드러운 제안(탭하면 펼침) */}
      {m.needLevel === "exploring" && m.benefits.length > 0 && <SoftSuggestion benefit={m.benefits[0]!} answerSnapshotId={m.answerSnapshotId} />}
      {/* 미션은 ready에서만 곁들임 */}
      {m.needLevel === "ready" && m.missions.map((o) => <OfferCard key={o.offerSnapshotId} offer={o} answerSnapshotId={m.answerSnapshotId} />)}

      {/* 리워드 넛지 — 대화 맥락에 맞을 때 걷기/미션으로 연결 */}
      {m.rewardNudge && <NudgeChip kind={m.rewardNudge} onPress={() => goTab(m.rewardNudge === "walk" ? "걷기" : "미션")} />}

      {!failed && m.needLevel === "none" && !m.rewardNudge && !m.safety && (
        <View style={s.noAd}><Text style={s.noAdText}>지금은 안내에 집중했어요. 필요한 순간에만 혜택을 연결해 드려요.</Text></View>
      )}

      {/* 후속 질문 유도 — 탭하면 이어서 물어봄 */}
      {!failed && !!m.followUps?.length && (
        <View style={s.followWrap}>
          <Text style={s.followHead}>이어서 물어보기</Text>
          {m.followUps.slice(0, 2).map((q, k) => (
            <TouchableOpacity key={k} style={s.followChip} activeOpacity={0.85} onPress={() => onRetry(q)}>
              <Text style={[s.followText, { fontSize: 15 * fs }]}>{q}</Text><Text style={s.followArrow}>›</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// 확장형 부드러운 제안 — exploring 단계. 포인트를 앞세우고, 탭하면 카드가 펼쳐진다.
function SoftSuggestion({ benefit, answerSnapshotId }: { benefit: Offer; answerSnapshotId?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <TouchableOpacity style={s.soft} activeOpacity={0.9} onPress={() => { ease(); setOpen((v) => !v); }}>
        <Text style={s.softEmoji}>💡</Text>
        <View style={{ flex: 1 }}>
          <View style={s.softTitleRow}>
            <Text style={s.softTitle}>관련해서 도움받을 수 있어요</Text>
            <View style={s.softAdBadge}><Text style={s.softAdBadgeText}>광고·제휴</Text></View>
          </View>
          <Text style={s.softSub}>{benefit.title} · 확정 시 최대 {won(benefit.expectedReward)}</Text>
        </View>
        <Text style={s.softToggle}>{open ? "접기" : "보기"}</Text>
      </TouchableOpacity>
      {open && <OfferCard offer={benefit} answerSnapshotId={answerSnapshotId} />}
    </View>
  );
}

// 안전 안내 카드. critical(사기·위기)은 강한 색, warn/info는 차분한 색. 상담 번호는 탭하면 전화.
function SafetyCard({ notice }: { notice: SafetyNotice }) {
  const critical = notice.level === "critical";
  return (
    <View style={[s.safety, critical ? s.safetyCritical : s.safetyWarn]}>
      <Text style={[s.safetyTitle, critical && { color: "#a01818" }]}>{critical ? "🛑 " : "ℹ️ "}{notice.title}</Text>
      <Text style={s.safetyBody}>{notice.body}</Text>
      {!!notice.resources?.length && (
        <View style={s.safetyRes}>
          {notice.resources.map((r) => (
            <TouchableOpacity key={r.value} style={s.resBtn} onPress={() => Linking.openURL(`tel:${r.value.replace(/[^0-9]/g, "")}`)} activeOpacity={0.85}>
              <Text style={s.resLabel}>{r.label}</Text><Text style={s.resValue}>📞 {r.value}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function NudgeChip({ kind, onPress }: { kind: "walk" | "mission"; onPress: () => void }) {
  const walk = kind === "walk";
  return (
    <TouchableOpacity style={s.nudge} activeOpacity={0.9} onPress={onPress}>
      <Text style={s.nudgeEmoji}>{walk ? "👟" : "🎯"}</Text>
      <Text style={s.nudgeText}>{walk ? "지금 걸으면 포인트가 쌓여요" : "짧은 미션으로 포인트 모으기"}</Text>
      <Text style={s.nudgeGo}>바로가기 ›</Text>
    </TouchableOpacity>
  );
}

function TypingDots() {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(() => {
    const anims = dots.map((d, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 160),
        Animated.timing(d, { toValue: 1, duration: 320, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(d, { toValue: 0, duration: 320, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]))
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, []);
  return (
    <View style={{ flexDirection: "row", gap: 6, alignItems: "center", paddingVertical: 2 }}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: T.brand, opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }), transform: [{ translateY: d.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  proCard: { backgroundColor: T.brand, borderRadius: 22, padding: 18, marginBottom: 22, shadowColor: T.brand, shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
  proHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  proTitle: { color: "rgba(255,255,255,0.9)", fontWeight: "800", fontSize: 13 },
  proWeather: { color: "#fff", fontWeight: "800", fontSize: 13 },
  proMsg: { color: "#fff", fontSize: 17, fontWeight: "700", lineHeight: 25, marginBottom: 14 },
  proTopic: { backgroundColor: "rgba(255,255,255,0.16)", borderRadius: 14, paddingVertical: 13, paddingHorizontal: 14 },
  proTopicText: { color: "#fff", fontWeight: "800", fontSize: 15.5, lineHeight: 22 },
  proAction: { marginTop: 10, alignSelf: "flex-start", backgroundColor: "#fff", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 15 },
  proActionText: { color: T.brandDark, fontWeight: "900", fontSize: 14.5 },
  hello: { color: T.muted, fontSize: 16, fontWeight: "700", marginBottom: 4 },
  h: { fontSize: 32, fontWeight: "900", color: T.ink, lineHeight: 40 },
  walletPill: { backgroundColor: T.brandSoft, borderRadius: 18, paddingHorizontal: 15, paddingVertical: 9, alignItems: "center", marginTop: 4 },
  walletLabel: { color: T.brandDark, fontSize: 11.5, fontWeight: "800" },
  walletValue: { color: T.brand, fontSize: 17, fontWeight: "900", marginTop: 2 },
  lead: { color: T.muted, fontSize: 14.5, lineHeight: 21, marginBottom: 18 },

  talk: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: T.brand, borderRadius: 20, padding: 16, shadowColor: T.brand, shadowOpacity: 0.28, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
  talkMic: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(255,255,255,0.18)", justifyContent: "center", alignItems: "center" },
  talkTitle: { color: "#fff", fontWeight: "900", fontSize: 18 },
  talkSub: { color: "rgba(255,255,255,0.82)", fontSize: 13, marginTop: 2 },
  talkArrow: { color: "#fff", fontSize: 26, fontWeight: "300" },

  quickHead: { color: T.muted, fontWeight: "800", fontSize: 14.5, marginTop: 24, marginBottom: 12 },
  chipWrap: { gap: 10 },
  chip: { flexDirection: "row", alignItems: "center", backgroundColor: T.card, borderRadius: 16, borderWidth: 1, borderColor: T.line, paddingVertical: 16, paddingHorizontal: 16, gap: 13 },
  chipEmoji: { fontSize: 20 },
  chipText: { fontSize: 16, fontWeight: "700", color: T.ink },

  userBubble: { alignSelf: "flex-end", backgroundColor: T.brand, borderRadius: 22, borderBottomRightRadius: 7, paddingVertical: 13, paddingHorizontal: 17, maxWidth: "85%", marginBottom: 14, shadowColor: T.brand, shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  userText: { color: "#fff", fontSize: 16.5, fontWeight: "700", lineHeight: 23 },
  aiCard: { alignSelf: "flex-start", backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 22, borderBottomLeftRadius: 7, padding: 17, marginBottom: 12, maxWidth: "95%", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  aiBadgeRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 9 },
  aiBadge: { backgroundColor: T.brand, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  aiBadgeText: { color: "#fff", fontWeight: "900", fontSize: 11.5 },
  aiBadgeLabel: { color: T.muted, fontWeight: "800", fontSize: 13 },
  thinking: { color: T.muted, fontWeight: "700", fontSize: 13.5 },
  exTag: { backgroundColor: T.inset, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 2 },
  exTagText: { color: T.muted, fontWeight: "800", fontSize: 11 },
  summary: { fontSize: 18, fontWeight: "800", color: T.ink, lineHeight: 26 },
  secTitle: { fontWeight: "800", color: T.ink, marginBottom: 3, fontSize: 15.5 },
  secBody: { color: T.ink, fontSize: 15, lineHeight: 22 },
  uncertainNote: { color: T.muted, fontSize: 12.5, lineHeight: 18, marginTop: 12 },
  retryBtn: { marginTop: 12, alignSelf: "flex-start", backgroundColor: T.brandSoft, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  retryText: { color: T.brand, fontWeight: "800", fontSize: 15 },
  safety: { borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 12 },
  safetyCritical: { backgroundColor: "#fdecea", borderColor: "#f3c4bd" },
  safetyWarn: { backgroundColor: "#fbf6ea", borderColor: "#eedec0" },
  safetyTitle: { fontSize: 16.5, fontWeight: "900", color: "#7a5b1e", marginBottom: 6, lineHeight: 23 },
  safetyBody: { fontSize: 15, color: T.ink, lineHeight: 22 },
  safetyRes: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  resBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#e7d9c0", paddingHorizontal: 13, paddingVertical: 10 },
  resLabel: { color: T.muted, fontWeight: "700", fontSize: 13.5 },
  resValue: { color: "#a01818", fontWeight: "900", fontSize: 15 },

  soft: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: T.brandSoft, borderRadius: 18, borderWidth: 1, borderColor: "#cfe4da", paddingVertical: 14, paddingHorizontal: 15, marginBottom: 12 },
  softEmoji: { fontSize: 20 },
  softTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  softAdBadge: { backgroundColor: T.adLabelBg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  softAdBadgeText: { color: "#fff", fontWeight: "800", fontSize: 10 },
  softTitle: { fontWeight: "800", color: T.brandDark, fontSize: 15 },
  softSub: { color: T.brand, fontSize: 13.5, marginTop: 2, fontWeight: "600" },
  softToggle: { color: "#fff", backgroundColor: T.brand, overflow: "hidden", borderRadius: 12, paddingHorizontal: 13, paddingVertical: 7, fontWeight: "800", fontSize: 13.5 },

  nudge: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: T.accentSoft, borderRadius: 16, borderWidth: 1, borderColor: T.accentLine, paddingVertical: 13, paddingHorizontal: 15, marginBottom: 12 },
  nudgeEmoji: { fontSize: 19 },
  nudgeText: { flex: 1, color: "#8a5626", fontWeight: "800", fontSize: 14.5 },
  nudgeGo: { color: T.accent, fontWeight: "800", fontSize: 13.5 },

  noAd: { backgroundColor: T.inset, borderRadius: 13, padding: 13, marginBottom: 12 },
  noAdText: { color: T.muted, fontSize: 13, lineHeight: 19 },
  followWrap: { marginBottom: 12, marginTop: 2 },
  followHead: { color: T.muted, fontWeight: "800", fontSize: 13, marginBottom: 8 },
  followChip: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 15, marginBottom: 8 },
  followText: { color: T.brandDark, fontWeight: "700", fontSize: 15, flex: 1 },
  followArrow: { color: T.muted, fontWeight: "300", fontSize: 20 },

  gate: { backgroundColor: T.accentSoft, borderRadius: 20, borderWidth: 1, borderColor: T.accentLine, padding: 18, marginBottom: 12, alignItems: "center" },
  gateTitle: { color: "#8a5626", fontWeight: "900", fontSize: 17, marginBottom: 6, textAlign: "center" },
  gateBody: { color: "#8a5626", fontSize: 14.5, lineHeight: 21, textAlign: "center", marginBottom: 14 },
  gateBtn: { backgroundColor: T.accent, borderRadius: 16, paddingVertical: 15, paddingHorizontal: 22, alignSelf: "stretch", alignItems: "center" },
  gateBtnText: { color: "#fff", fontWeight: "900", fontSize: 16 },
  gateAlt: { color: "#a9743a", fontWeight: "700", fontSize: 13.5, marginTop: 12 },
  remainBar: { alignItems: "center", paddingVertical: 6, backgroundColor: T.accentSoft, borderTopWidth: 1, borderTopColor: T.accentLine },
  remainText: { color: "#8a5626", fontWeight: "700", fontSize: 13 },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 9, paddingHorizontal: 14, paddingTop: 9, paddingBottom: Platform.OS === "ios" ? 26 : 12, backgroundColor: T.card, borderTopWidth: 1, borderTopColor: T.line },
  inputWrap: { flex: 1, backgroundColor: T.bg, borderRadius: 22, borderWidth: 1, borderColor: T.line, paddingHorizontal: 17, justifyContent: "center", minHeight: 50, maxHeight: 130 },
  input: { fontSize: 16.5, color: T.ink, paddingVertical: Platform.OS === "ios" ? 13 : 8 },
  send: { backgroundColor: T.brand, borderRadius: 25, width: 50, height: 50, justifyContent: "center", alignItems: "center" },
  sendIcon: { color: "#fff", fontWeight: "900", fontSize: 22, lineHeight: 24 },
});
