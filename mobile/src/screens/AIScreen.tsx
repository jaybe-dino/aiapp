import React, { useCallback, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { T, won } from "../theme";
import { Api, OfferCard as Offer } from "../api";
import OfferCard from "../components/OfferCard";

interface Turn { question: string; summary: string; sections: { title: string; body: string }[]; uncertainty: string; commercial: Offer | null; answerSnapshotId: string; }

const QUICK = [
  { emoji: "💰", label: "생활비를 줄이고 싶어요" },
  { emoji: "🧳", label: "여행·쇼핑 가격을 비교해요" },
  { emoji: "🚰", label: "정수기 렌탈을 알아봐요" },
  { emoji: "📍", label: "우리 동네 서비스를 찾아요" },
];

export default function AIScreen() {
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(0);
  const convId = useRef<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  useFocusEffect(useCallback(() => { Api.wallet().then((w) => setAvailable(w.available)).catch(() => {}); }, []));

  async function ask(q?: string) {
    const question = (q ?? text).trim();
    if (!question || busy) return;
    setText("");
    setBusy(true);
    try {
      if (!convId.current) convId.current = (await Api.createConversation()).conversation_id;
      const r = await Api.ask(convId.current, question);
      setTurns((prev) => [{ question, summary: r.answer.summary, sections: r.answer.sections, uncertainty: r.answer.uncertainty.message, commercial: r.commercial, answerSnapshotId: r.answerSnapshotId }, ...prev]);
    } catch {
      setTurns((prev) => [{ question, summary: "잠시 후 다시 시도해주세요.", sections: [], uncertainty: "", commercial: null, answerSnapshotId: "" }, ...prev]);
    } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: T.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={s.headRow}>
          <View>
            <Text style={s.hello}>안녕하세요</Text>
            <Text style={s.h}>무엇을{"\n"}도와드릴까요?</Text>
          </View>
          <View style={s.walletPill}>
            <Text style={s.walletLabel}>사용 가능</Text>
            <Text style={s.walletValue}>{won(available)}</Text>
          </View>
        </View>

        <TouchableOpacity style={s.voiceBtn} activeOpacity={0.9} onPress={() => inputRef.current?.focus()}>
          <Text style={s.voiceMic}>🎤</Text>
          <Text style={s.voiceText}>눌러서 말하기</Text>
        </TouchableOpacity>
        <Text style={s.voiceHint}>천천히 말씀하셔도 돼요.{"\n"}말씀을 글로 확인한 뒤 진행합니다.</Text>

        <View style={s.inputWrap}>
          <Text style={s.pencil}>✎</Text>
          <TextInput ref={inputRef} style={s.input} placeholder="직접 입력해서 물어보기" placeholderTextColor={T.muted} value={text} onChangeText={setText} onSubmitEditing={() => ask()} returnKeyType="send" />
          {busy ? <ActivityIndicator color={T.brand} style={{ marginRight: 6 }} /> : (
            <TouchableOpacity style={s.send} onPress={() => ask()}><Text style={s.sendText}>보내기</Text></TouchableOpacity>
          )}
        </View>

        <Text style={s.quickHead}>이런 걸 물어볼 수 있어요</Text>
        {QUICK.map((qq) => (
          <TouchableOpacity key={qq.label} style={s.quick} onPress={() => ask(qq.label)} activeOpacity={0.8}>
            <Text style={s.quickEmoji}>{qq.emoji}</Text>
            <Text style={s.quickText}>{qq.label}</Text>
          </TouchableOpacity>
        ))}

        {turns.map((t, i) => (
          <View key={i} style={{ marginTop: i === 0 ? 22 : 8 }}>
            <View style={s.userBubble}><Text style={s.userText}>{t.question}</Text></View>
            <View style={s.answerCard}>
              <View style={s.aiBadgeRow}><View style={s.aiBadge}><Text style={s.aiBadgeText}>AI</Text></View><Text style={s.aiBadgeLabel}>AI 답변</Text></View>
              <Text style={s.summary}>{t.summary}</Text>
              {t.sections.map((sec, j) => (
                <View key={j} style={{ marginVertical: 7 }}>
                  <Text style={s.secTitle}>{sec.title}</Text>
                  <Text style={s.secBody}>{sec.body}</Text>
                </View>
              ))}
              {!!t.uncertainty && <View style={s.uncertain}><Text style={s.uncertainText}>⚠️ {t.uncertainty}</Text></View>}
            </View>
            {t.commercial ? (
              <OfferCard offer={t.commercial} answerSnapshotId={t.answerSnapshotId} />
            ) : (
              <View style={s.noAd}><Text style={s.noAdText}>이 질문과 관련해 조건을 만족하는 광고·제휴 혜택이 없어 표시하지 않았어요. (답변은 광고와 무관하게 완결됩니다.)</Text></View>
            )}
          </View>
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 },
  hello: { color: T.muted, fontSize: 16, fontWeight: "700", marginBottom: 2 },
  h: { fontSize: 30, fontWeight: "900", color: T.ink, lineHeight: 38 },
  walletPill: { backgroundColor: T.brandSoft, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 10, alignItems: "center", marginTop: 4 },
  walletLabel: { color: T.brandDark, fontSize: 12, fontWeight: "700" },
  walletValue: { color: T.brand, fontSize: 18, fontWeight: "900", marginTop: 2 },
  voiceBtn: { alignSelf: "center", width: 176, height: 176, borderRadius: 88, backgroundColor: T.brand, justifyContent: "center", alignItems: "center", marginTop: 8, shadowColor: T.brand, shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  voiceMic: { fontSize: 44 },
  voiceText: { color: "#fff", fontWeight: "800", fontSize: 19, marginTop: 6 },
  voiceHint: { textAlign: "center", color: T.muted, marginTop: 16, fontSize: 15, lineHeight: 22 },
  inputWrap: { flexDirection: "row", alignItems: "center", backgroundColor: T.card, borderRadius: 16, borderWidth: 1, borderColor: T.line, paddingHorizontal: 14, marginTop: 22, minHeight: 56 },
  pencil: { color: T.muted, fontSize: 18, marginRight: 8 },
  input: { flex: 1, fontSize: 16.5, color: T.ink, paddingVertical: 14 },
  send: { backgroundColor: T.brand, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  sendText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  quickHead: { color: T.muted, fontWeight: "800", fontSize: 15, marginTop: 22, marginBottom: 10 },
  quick: { flexDirection: "row", alignItems: "center", backgroundColor: T.card, borderRadius: 16, borderWidth: 1, borderColor: T.line, paddingVertical: 18, paddingHorizontal: 16, marginBottom: 10, gap: 12 },
  quickEmoji: { fontSize: 22 },
  quickText: { fontSize: 17, fontWeight: "700", color: T.ink },
  userBubble: { alignSelf: "flex-end", backgroundColor: T.brand, borderRadius: 20, borderBottomRightRadius: 6, paddingVertical: 13, paddingHorizontal: 16, maxWidth: "88%", marginBottom: 12 },
  userText: { color: "#fff", fontSize: 16.5, fontWeight: "700", lineHeight: 23 },
  answerCard: { backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: T.radiusCard, padding: 18, marginBottom: 12 },
  aiBadgeRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  aiBadge: { backgroundColor: T.brandSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  aiBadgeText: { color: T.brand, fontWeight: "900", fontSize: 12 },
  aiBadgeLabel: { color: T.muted, fontWeight: "700" },
  summary: { fontSize: 19, fontWeight: "800", color: T.ink, marginBottom: 6, lineHeight: 27 },
  secTitle: { fontWeight: "800", color: T.ink, marginBottom: 3, fontSize: 16 },
  secBody: { color: T.ink, fontSize: 15, lineHeight: 22 },
  uncertain: { backgroundColor: "#fbf6ea", borderWidth: 1, borderColor: "#eedec0", borderRadius: 12, padding: 12, marginTop: 10 },
  uncertainText: { color: "#7a5b1e" },
  noAd: { backgroundColor: T.inset, borderRadius: 12, padding: 12, marginBottom: 12 },
  noAdText: { color: T.muted, fontSize: 13.5, lineHeight: 20 },
});
