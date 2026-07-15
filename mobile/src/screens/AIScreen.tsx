import React, { useCallback, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { T, won } from "../theme";
import { Api, OfferCard as Offer } from "../api";
import OfferCard from "../components/OfferCard";

type Msg =
  | { role: "user"; text: string }
  | { role: "loading" }
  | { role: "ai"; summary: string; sections: { title: string; body: string }[]; uncertainty: string; benefits: Offer[]; missions: Offer[]; answerSnapshotId: string };

const QUICK = [
  { emoji: "💰", label: "생활비를 줄이고 싶어요" },
  { emoji: "🧳", label: "여행·쇼핑 가격을 비교해요" },
  { emoji: "🚰", label: "정수기 렌탈을 알아봐요" },
  { emoji: "📍", label: "우리 동네 서비스를 찾아요" },
];

export default function AIScreen() {
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(0);
  const convId = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useFocusEffect(useCallback(() => { Api.wallet().then((w) => setAvailable(w.available)).catch(() => {}); }, []));

  const scrollToEnd = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);

  async function ask(q?: string) {
    const question = (q ?? text).trim();
    if (!question || busy) return;
    setText("");
    setMessages((m) => [...m, { role: "user", text: question }, { role: "loading" }]);
    setBusy(true);
    scrollToEnd();
    try {
      if (!convId.current) convId.current = (await Api.createConversation()).conversation_id;
      const r = await Api.ask(convId.current, question);
      setMessages((m) => [
        ...m.filter((x) => x.role !== "loading"),
        {
          role: "ai",
          summary: r.answer.summary,
          sections: r.answer.sections,
          uncertainty: r.answer.uncertainty.message,
          benefits: r.matched?.benefits ?? (r.commercial ? [r.commercial] : []),
          missions: r.matched?.missions ?? [],
          answerSnapshotId: r.answerSnapshotId,
        },
      ]);
    } catch {
      setMessages((m) => [...m.filter((x) => x.role !== "loading"), { role: "ai", summary: "잠시 후 다시 시도해주세요.", sections: [], uncertainty: "", benefits: [], missions: [], answerSnapshotId: "" }]);
    } finally {
      setBusy(false);
      scrollToEnd();
    }
  }

  const empty = messages.length === 0;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: T.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 18, paddingBottom: 8 }} keyboardShouldPersistTaps="handled" onContentSizeChange={scrollToEnd}>
        {empty ? (
          <View>
            <View style={s.headRow}>
              <View><Text style={s.hello}>안녕하세요</Text><Text style={s.h}>무엇을{"\n"}도와드릴까요?</Text></View>
              <View style={s.walletPill}><Text style={s.walletLabel}>사용 가능</Text><Text style={s.walletValue}>{won(available)}</Text></View>
            </View>
            <TouchableOpacity style={s.voiceBtn} activeOpacity={0.9} onPress={() => scrollToEnd()}>
              <Text style={s.voiceMic}>🎤</Text><Text style={s.voiceText}>눌러서 말하기</Text>
            </TouchableOpacity>
            <Text style={s.voiceHint}>궁금한 걸 편하게 물어보세요.{"\n"}관련된 혜택·미션도 함께 찾아드려요.</Text>
            <Text style={s.quickHead}>이런 걸 물어볼 수 있어요</Text>
            {QUICK.map((qq) => (
              <TouchableOpacity key={qq.label} style={s.quick} onPress={() => ask(qq.label)} activeOpacity={0.8}>
                <Text style={s.quickEmoji}>{qq.emoji}</Text><Text style={s.quickText}>{qq.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          messages.map((m, i) => <MessageView key={i} m={m} />)
        )}
      </ScrollView>

      {/* 입력창 — 항상 하단 고정 */}
      <View style={s.inputBar}>
        <View style={s.inputWrap}>
          <TextInput style={s.input} placeholder="메시지를 입력하세요" placeholderTextColor={T.muted} value={text} onChangeText={setText} onSubmitEditing={() => ask()} returnKeyType="send" multiline />
        </View>
        <TouchableOpacity style={[s.send, (!text.trim() || busy) && { opacity: 0.4 }]} onPress={() => ask()} disabled={!text.trim() || busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.sendText}>보내기</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageView({ m }: { m: Msg }) {
  if (m.role === "user") return <View style={s.userBubble}><Text style={s.userText}>{m.text}</Text></View>;
  if (m.role === "loading") return <View style={s.aiCard}><ActivityIndicator color={T.brand} /></View>;
  return (
    <View style={{ marginBottom: 4 }}>
      <View style={s.aiCard}>
        <View style={s.aiBadgeRow}><View style={s.aiBadge}><Text style={s.aiBadgeText}>AI</Text></View><Text style={s.aiBadgeLabel}>AI 답변</Text></View>
        <Text style={s.summary}>{m.summary}</Text>
        {m.sections.map((sec, j) => (
          <View key={j} style={{ marginTop: 8 }}>
            <Text style={s.secTitle}>{sec.title}</Text>
            <Text style={s.secBody}>{sec.body}</Text>
          </View>
        ))}
        {!!m.uncertainty && <View style={s.uncertain}><Text style={s.uncertainText}>⚠️ {m.uncertainty}</Text></View>}
      </View>

      {m.benefits.length > 0 && (
        <>
          <Text style={s.matchHead}>🛍️ 관련 혜택</Text>
          {m.benefits.map((o) => <OfferCard key={o.offerSnapshotId} offer={o} answerSnapshotId={m.answerSnapshotId} />)}
        </>
      )}
      {m.missions.length > 0 && (
        <>
          <Text style={s.matchHead}>🎯 함께 하면 좋은 미션</Text>
          {m.missions.map((o) => <OfferCard key={o.offerSnapshotId} offer={o} answerSnapshotId={m.answerSnapshotId} />)}
        </>
      )}
      {m.benefits.length === 0 && m.missions.length === 0 && !!m.summary && m.summary !== "잠시 후 다시 시도해주세요." && (
        <View style={s.noAd}><Text style={s.noAdText}>이 질문과 딱 맞는 광고·제휴 혜택이 없어 표시하지 않았어요. 답변은 광고와 무관하게 완결됩니다.</Text></View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 },
  hello: { color: T.muted, fontSize: 16, fontWeight: "700", marginBottom: 2 },
  h: { fontSize: 30, fontWeight: "900", color: T.ink, lineHeight: 38 },
  walletPill: { backgroundColor: T.brandSoft, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 10, alignItems: "center", marginTop: 4 },
  walletLabel: { color: T.brandDark, fontSize: 12, fontWeight: "700" },
  walletValue: { color: T.brand, fontSize: 18, fontWeight: "900", marginTop: 2 },
  voiceBtn: { alignSelf: "center", width: 168, height: 168, borderRadius: 84, backgroundColor: T.brand, justifyContent: "center", alignItems: "center", marginTop: 8, shadowColor: T.brand, shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  voiceMic: { fontSize: 42 },
  voiceText: { color: "#fff", fontWeight: "800", fontSize: 18, marginTop: 6 },
  voiceHint: { textAlign: "center", color: T.muted, marginTop: 16, fontSize: 15, lineHeight: 22 },
  quickHead: { color: T.muted, fontWeight: "800", fontSize: 15, marginTop: 22, marginBottom: 10 },
  quick: { flexDirection: "row", alignItems: "center", backgroundColor: T.card, borderRadius: 16, borderWidth: 1, borderColor: T.line, paddingVertical: 18, paddingHorizontal: 16, marginBottom: 10, gap: 12 },
  quickEmoji: { fontSize: 22 },
  quickText: { fontSize: 17, fontWeight: "700", color: T.ink },

  userBubble: { alignSelf: "flex-end", backgroundColor: T.brand, borderRadius: 20, borderBottomRightRadius: 6, paddingVertical: 13, paddingHorizontal: 16, maxWidth: "86%", marginBottom: 12 },
  userText: { color: "#fff", fontSize: 16.5, fontWeight: "700", lineHeight: 23 },
  aiCard: { alignSelf: "flex-start", backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 20, borderBottomLeftRadius: 6, padding: 16, marginBottom: 12, maxWidth: "94%" },
  aiBadgeRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  aiBadge: { backgroundColor: T.brandSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  aiBadgeText: { color: T.brand, fontWeight: "900", fontSize: 12 },
  aiBadgeLabel: { color: T.muted, fontWeight: "700" },
  summary: { fontSize: 18, fontWeight: "800", color: T.ink, lineHeight: 26 },
  secTitle: { fontWeight: "800", color: T.ink, marginBottom: 3, fontSize: 15.5 },
  secBody: { color: T.ink, fontSize: 15, lineHeight: 22 },
  uncertain: { backgroundColor: "#fbf6ea", borderWidth: 1, borderColor: "#eedec0", borderRadius: 12, padding: 12, marginTop: 10 },
  uncertainText: { color: "#7a5b1e", fontSize: 13.5, lineHeight: 20 },
  matchHead: { fontWeight: "800", color: T.ink, fontSize: 16, marginBottom: 8, marginTop: 2 },
  noAd: { backgroundColor: T.inset, borderRadius: 12, padding: 12, marginBottom: 12 },
  noAdText: { color: T.muted, fontSize: 13.5, lineHeight: 20 },

  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 14, paddingTop: 8, paddingBottom: Platform.OS === "ios" ? 24 : 12, backgroundColor: T.card, borderTopWidth: 1, borderTopColor: T.line },
  inputWrap: { flex: 1, backgroundColor: T.bg, borderRadius: 20, borderWidth: 1, borderColor: T.line, paddingHorizontal: 16, justifyContent: "center", minHeight: 48, maxHeight: 120 },
  input: { fontSize: 16.5, color: T.ink, paddingVertical: Platform.OS === "ios" ? 12 : 8 },
  send: { backgroundColor: T.brand, borderRadius: 20, paddingHorizontal: 18, height: 48, justifyContent: "center", alignItems: "center" },
  sendText: { color: "#fff", fontWeight: "800", fontSize: 16 },
});
