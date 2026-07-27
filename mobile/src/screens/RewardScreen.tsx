import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, RefreshControl } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { T, won } from "../theme";
import { Api } from "../api";
import { onFontScale } from "../fontscale";

interface Reward { reward_transaction_id: string; title: string; source: string; state: string; state_label: string; amount: number; }
const SRC: Record<string, string> = { shopping_cps: "쇼핑 적립", offerwall_cpa: "미션 보상", cashwalk_ad: "걷기 보상", rental_cpa: "렌탈 보상", chat_ad: "대화 연장 보상", sponsor_chat: "대화 미션 보상" };

export default function RewardScreen() {
  const [wallet, setWallet] = useState({ available: 0, pending: 0, used: 0 });
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [fs, setFs] = useState(1);
  useEffect(() => onFontScale(setFs), []); // 글자 크기 설정을 이 화면에도 반영(시니어 접근성)

  const load = useCallback(async () => {
    try { const [w, r] = await Promise.all([Api.wallet(), Api.rewards()]); setWallet(w); setRewards(r.rewards); } catch { /* noop */ }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // 현재 상품 카탈로그는 3,000원 쿠폰 1종. 상품과 금액을 일치시켜 교환한다(불일치 방지).
  const COUPON_AMOUNT = 3000;
  async function exchange() {
    if (wallet.available < COUPON_AMOUNT) { Alert.alert("교환 불가", `${won(COUPON_AMOUNT)} 쿠폰 교환에는 최소 ${won(COUPON_AMOUNT)}이 필요해요.`); return; }
    const amount = COUPON_AMOUNT;
    Alert.alert("쿠폰 교환", `${won(amount)}을 모바일 쿠폰으로 교환할까요?`, [
      { text: "취소", style: "cancel" },
      { text: "교환", onPress: async () => {
        try {
          const r = await Api.payout(amount);
          if (r.status === "paid") Alert.alert("교환 완료", `쿠폰번호 ${r.coupon_code}`);
          else if (r.status === "unknown") Alert.alert("확인 중", "잔액은 보호됩니다.");
          else Alert.alert("교환 실패", "잔액이 복구됐어요.");
          load();
        } catch (e: any) { Alert.alert("오류", e?.title ?? ""); }
      } },
    ]);
  }

  async function showTimeline(id: string) {
    try {
      const d = await Api.rewardDetail(id);
      const lines = d.timeline.map((t) => `• ${t.reason} (${new Date(t.created_at).toLocaleString("ko-KR")})`).join("\n");
      Alert.alert(`${d.title} · ${d.state_label}`, `${won(d.amount)}\n\n[타임라인]\n${lines}`);
    } catch { /* noop */ }
  }

  function pill(state: string) {
    if (state === "available") return { bg: T.brandSoft, c: T.brand, t: "사용 가능" };
    if (state === "reversed") return { bg: "#fbe9e6", c: T.reversed, t: "취소됨" };
    if (state === "paid") return { bg: T.inset, c: T.muted, t: "사용 완료" };
    return { bg: "#faf1e6", c: T.accent, t: "확인 중" };
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.bg }} contentContainerStyle={{ padding: 18, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Text style={[s.h, { fontSize: 26 * fs }]}>내 보상</Text>

      <View style={s.card}>
        <Text style={[s.availLabel, { fontSize: 14 * fs }]}>사용 가능</Text>
        <Text style={[s.avail, { fontSize: 38 * fs }]}>{won(wallet.available)}</Text>
        <View style={s.row}><Pill {...pill("pending")} fs={fs} /><Text style={[s.v, { fontSize: 15 * fs }]}>{won(wallet.pending)}</Text></View>
        <View style={s.row}><Pill {...pill("paid")} fs={fs} /><Text style={[s.v, { fontSize: 15 * fs }]}>{won(wallet.used)}</Text></View>
        <TouchableOpacity style={[s.exchange, wallet.available < 3000 && { opacity: 0.5 }]} onPress={exchange} disabled={wallet.available < 3000} activeOpacity={0.85}>
          <Text style={[s.exchangeText, { fontSize: 17 * fs }]}>3,000원 쿠폰으로 교환하기</Text>
        </TouchableOpacity>
        <View style={s.disclose}><Text style={[s.discloseText, { fontSize: 13 * fs, lineHeight: 19 * fs }]}>확인 중 금액은 아직 사용할 수 없어요. 광고주 확인이 끝나면 ‘사용 가능’으로 바뀝니다.</Text></View>
      </View>

      <Text style={[s.sectionH, { fontSize: 19 * fs }]}>거래 내역</Text>
      {rewards.length === 0 ? (
        <View style={s.card}><Text style={{ color: T.muted }}>아직 거래가 없어요. AI 도움·혜택·미션·걷기로 보상을 모아보세요.</Text></View>
      ) : (
        rewards.map((r) => {
          const p = pill(r.state);
          // G1: '확인 중'이면 언제 쓸 수 있는지 예상 시점을 알려줘 불안을 줄인다.
          const eta = r.state !== "available" && r.state !== "paid" && r.state !== "reversed"
            ? (r.source === "cashwalk_ad" ? "걷기 보상은 보통 바로 사용 가능해요." : "보통 1~2일 후 ‘사용 가능’으로 바뀌어요.")
            : null;
          return (
            <View key={r.reward_transaction_id} style={s.card}>
              <View style={s.row}><Text style={[s.title, { fontSize: 16 * fs }]}>{r.title}</Text><Pill {...p} fs={fs} /></View>
              <View style={s.row}><Text style={[s.k, { fontSize: 15 * fs }]}>{(SRC[r.source] ?? r.source) === r.title ? "" : SRC[r.source] ?? r.source}</Text><Text style={[s.v, { fontSize: 15 * fs }]}>{won(r.amount)}</Text></View>
              {eta && <Text style={[s.eta, { fontSize: 13 * fs, lineHeight: 19 * fs }]}>⏳ {eta}</Text>}
              <TouchableOpacity style={s.ghost} onPress={() => showTimeline(r.reward_transaction_id)}><Text style={[s.ghostText, { fontSize: 15 * fs }]}>진행 상태 보기</Text></TouchableOpacity>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

function Pill({ bg, c, t, fs = 1 }: { bg: string; c: string; t: string; fs?: number }) {
  return <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 }}><Text style={{ color: c, fontWeight: "800", fontSize: 13 * fs }}>{t}</Text></View>;
}

const s = StyleSheet.create({
  h: { fontSize: 26, fontWeight: "900", color: T.ink, marginBottom: 14 },
  card: { backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: T.radiusCard, padding: 18, marginBottom: 14 },
  availLabel: { textAlign: "center", color: T.muted, fontWeight: "700" },
  avail: { textAlign: "center", fontSize: 38, fontWeight: "900", color: T.brand, marginTop: 4, marginBottom: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  title: { fontWeight: "800", color: T.ink, fontSize: 16 },
  k: { color: T.muted, fontSize: 15 },
  v: { fontWeight: "800", color: T.ink, fontSize: 15 },
  exchange: { backgroundColor: T.brand, borderRadius: T.radiusBtn, paddingVertical: 16, alignItems: "center", marginTop: 12 },
  exchangeText: { color: "#fff", fontWeight: "800", fontSize: 17 },
  disclose: { backgroundColor: T.inset, borderRadius: 12, padding: 12, marginTop: 10 },
  discloseText: { color: T.muted, fontSize: 13, lineHeight: 19 },
  sectionH: { fontSize: 19, fontWeight: "800", color: T.ink, marginBottom: 10 },
  ghost: { backgroundColor: T.brandSoft, borderRadius: 12, paddingVertical: 13, alignItems: "center", marginTop: 8 },
  ghostText: { color: T.brand, fontWeight: "800" },
  eta: { color: T.accent, fontSize: 13, marginTop: 2, marginBottom: 2 },
});
