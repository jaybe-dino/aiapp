import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from "react-native";
import { T } from "../theme";

// 50~70대 첫 사용자의 최대 장벽(신뢰·이해)을 3스텝으로 해소. 건너뛰기 허용.
const STEPS = [
  {
    emoji: "💬",
    title: "무엇이든 편하게\n물어보세요",
    body: "생활비, 여행, 쇼핑, 렌탈까지. 궁금한 걸 말하듯 물어보면 핵심부터 쉽게 정리해 드려요.",
    point: "답변은 광고와 상관없이 완결돼요.",
  },
  {
    emoji: "🎁",
    title: "필요할 때만\n혜택을 연결해요",
    body: "대화 속에 필요가 보일 때만 관련 혜택·미션을 보여드려요. 원치 않으면 안 봐도 됩니다. 광고는 늘 ‘광고·제휴’로 표시돼요.",
    point: "필요 없으면 답변만 받아도 괜찮아요.",
  },
  {
    emoji: "👛",
    title: "걷고 참여하면\n포인트가 쌓여요",
    body: "걷기·간단한 미션·혜택 참여로 포인트를 모아 모바일 쿠폰으로 바꿔요. 비용은 광고주가 부담하고, 위치 정보는 수집하지 않아요.",
    point: "내 이름·번호는 동의한 경우에만 전달돼요.",
  },
];

export default function Onboarding({ visible, onDone }: { visible: boolean; onDone: () => void }) {
  const [i, setI] = useState(0);
  const last = i === STEPS.length - 1;
  const step = STEPS[i]!;

  function next() { if (last) onDone(); else setI((v) => v + 1); }

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onDone}>
      <View style={s.wrap}>
        <TouchableOpacity style={s.skip} onPress={onDone} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={s.skipText}>건너뛰기</Text>
        </TouchableOpacity>

        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
          <View style={s.emojiCircle}><Text style={{ fontSize: 64 }}>{step.emoji}</Text></View>
          <Text style={s.title}>{step.title}</Text>
          <Text style={s.desc}>{step.body}</Text>
          <View style={s.pointBox}><Text style={s.pointText}>✓ {step.point}</Text></View>
        </ScrollView>

        <View style={s.dots}>
          {STEPS.map((_, k) => <View key={k} style={[s.dot, k === i && s.dotOn]} />)}
        </View>
        <TouchableOpacity style={s.cta} onPress={next} activeOpacity={0.9}>
          <Text style={s.ctaText}>{last ? "시작하기" : "다음"}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: T.bg, paddingHorizontal: 26, paddingTop: 64, paddingBottom: 40 },
  skip: { position: "absolute", top: 56, right: 22, zIndex: 2, padding: 6 },
  skipText: { color: T.muted, fontWeight: "700", fontSize: 15 },
  body: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingVertical: 20 },
  emojiCircle: { width: 132, height: 132, borderRadius: 66, backgroundColor: T.brandSoft, alignItems: "center", justifyContent: "center", marginBottom: 30 },
  title: { fontSize: 30, fontWeight: "900", color: T.ink, textAlign: "center", lineHeight: 40 },
  desc: { fontSize: 17, color: T.ink, textAlign: "center", lineHeight: 27, marginTop: 18 },
  pointBox: { backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, marginTop: 22 },
  pointText: { color: T.brand, fontWeight: "800", fontSize: 15, textAlign: "center" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 20 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: T.line },
  dotOn: { backgroundColor: T.brand, width: 24 },
  cta: { backgroundColor: T.brand, borderRadius: 18, paddingVertical: 18, alignItems: "center" },
  ctaText: { color: "#fff", fontWeight: "900", fontSize: 19 },
});
