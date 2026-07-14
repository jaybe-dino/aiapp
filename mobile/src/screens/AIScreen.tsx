import React, { useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { T } from "../theme";
import { Api, OfferCard as Offer } from "../api";
import OfferCard from "../components/OfferCard";

interface Turn { question: string; summary: string; sections: { title: string; body: string }[]; uncertainty: string; commercial: Offer | null; answerSnapshotId: string; }

const QUICK = ["다음 달 부산 여행 교통·숙박 비교해줘", "공기청정기 필터 싸게 사는 법", "이번 주 절약 팁 알려줘"];

export default function AIScreen() {
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const convId = useRef<string | null>(null);

  async function ask(q?: string) {
    const question = (q ?? text).trim();
    if (!question || busy) return;
    setText("");
    setBusy(true);
    try {
      if (!convId.current) convId.current = (await Api.createConversation()).conversation_id;
      const r = await Api.ask(convId.current, question);
      setTurns((prev) => [
        { question, summary: r.answer.summary, sections: r.answer.sections, uncertainty: r.answer.uncertainty.message, commercial: r.commercial, answerSnapshotId: r.answerSnapshotId },
        ...prev,
      ]);
    } catch {
      setTurns((prev) => [{ question, summary: "잠시 후 다시 시도해주세요.", sections: [], uncertainty: "", commercial: null, answerSnapshotId: "" }, ...prev]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: T.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: 18 }} keyboardShouldPersistTaps="handled">
        <Text style={s.h}>무엇을 도와드릴까요?</Text>
        <Text style={s.sub}>생활 질문을 편하게 적어주세요. 답변은 광고와 분리됩니다.</Text>

        <View style={s.quickWrap}>
          {QUICK.map((qq) => (
            <TouchableOpacity key={qq} style={s.quick} onPress={() => ask(qq)}>
              <Text style={s.quickText}>{qq}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.ask}>
          <TextInput style={s.input} placeholder="예: 부산 여행 어떻게 준비해요?" value={text} onChangeText={setText} onSubmitEditing={() => ask()} returnKeyType="send" />
          <TouchableOpacity style={s.send} onPress={() => ask()} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.sendText}>보내기</Text>}
          </TouchableOpacity>
        </View>

        {turns.map((t, i) => (
          <View key={i} style={s.answerCard}>
            <Text style={s.qLabel}>질문</Text>
            <Text style={s.q}>{t.question}</Text>
            <Text style={s.summary}>{t.summary}</Text>
            {t.sections.map((sec, j) => (
              <View key={j} style={{ marginVertical: 8 }}>
                <Text style={s.secTitle}>{sec.title}</Text>
                <Text style={s.secBody}>{sec.body}</Text>
              </View>
            ))}
            {!!t.uncertainty && (
              <View style={s.uncertain}><Text style={s.uncertainText}>⚠️ {t.uncertainty}</Text></View>
            )}
            {t.commercial ? (
              <View style={{ marginTop: 14 }}><OfferCard offer={t.commercial} answerSnapshotId={t.answerSnapshotId} /></View>
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
  h: { fontSize: 24, fontWeight: "800", color: T.ink },
  sub: { color: T.muted, marginTop: 4, marginBottom: 16, fontSize: 15 },
  quickWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  quick: { backgroundColor: "#eef2f8", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 },
  quickText: { color: T.ink, fontWeight: "600" },
  ask: { flexDirection: "row", gap: 10 },
  input: { flex: 1, backgroundColor: T.card, borderWidth: 1.5, borderColor: T.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, minHeight: 52 },
  send: { backgroundColor: T.brand, borderRadius: 12, paddingHorizontal: 20, justifyContent: "center", minHeight: 52 },
  sendText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  answerCard: { backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 16, padding: 18, marginTop: 14 },
  qLabel: { color: T.muted },
  q: { fontWeight: "700", color: T.ink, marginBottom: 10, fontSize: 15 },
  summary: { fontSize: 19, fontWeight: "800", color: T.ink, marginBottom: 8 },
  secTitle: { fontWeight: "800", color: T.ink, marginBottom: 3, fontSize: 16 },
  secBody: { color: T.ink, fontSize: 15, lineHeight: 22 },
  uncertain: { backgroundColor: "#fffdf3", borderWidth: 1, borderColor: "#f0e2a8", borderRadius: 12, padding: 12, marginTop: 10 },
  uncertainText: { color: "#6b5b00" },
  noAd: { backgroundColor: "#f7f9fc", borderRadius: 10, padding: 12, marginTop: 12 },
  noAdText: { color: T.muted, fontSize: 13.5, lineHeight: 20 },
});
