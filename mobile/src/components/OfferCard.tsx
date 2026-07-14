import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import { T, won } from "../theme";
import { Api, OfferCard as Offer } from "../api";

export default function OfferCard({ offer, answerSnapshotId, onConverted }: { offer: Offer; answerSnapshotId?: string | null; onConverted?: () => void }) {
  const [busy, setBusy] = useState(false);

  function goExternal() {
    Alert.alert(
      `${offer.advertiserName}로 이동`,
      `개인정보 전달: ${offer.dataSharing}\n비식별 클릭 ID만 전달됩니다.\n계속할까요?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "이동",
          onPress: async () => {
            setBusy(true);
            try {
              const { click_id } = await Api.createClick(offer.offerSnapshotId, answerSnapshotId);
              // 데모: 실제 외부 이동 대신 전환 시뮬레이션(확인 중 → 사용 가능 흐름 시연)
              const supplier = offer.category === "survey" ? "sup_offerwall" : "sup_linkprice";
              const source = offer.category === "survey" ? "offerwall_cpa" : "shopping_cps";
              await Api.simulateConversion(supplier, source, click_id, offer.totalCost || 10000);
              Alert.alert("전환 접수됨", "‘내 보상’에서 확인 중 상태로 확인하세요.");
              onConverted?.();
            } catch (e: any) {
              Alert.alert("오류", e?.title ?? "이동 링크 생성 실패");
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }

  return (
    <View style={s.card}>
      <View style={s.adLabel}><Text style={s.adLabelText}>광고·제휴 혜택</Text></View>
      <Text style={s.title}>{offer.title}</Text>
      <Text style={s.reason}>{offer.advertiserName} · {offer.recommendationReason}</Text>
      <Row k="총비용" v={won(offer.totalCost)} />
      <Row k="확정 시 최대 보상" v={won(offer.expectedReward)} vColor={T.available} />
      <Row k="보상 확정" v={offer.approvalWindow} />
      <Row k="취소·반품" v={offer.cancelTerms} small />
      <Row k="자동결제" v={offer.autoRenewal ? "있음 ⚠️" : "없음"} />
      <Row k="개인정보 전달" v={offer.dataSharing} />
      <TouchableOpacity style={s.btn} onPress={goExternal} disabled={busy}>
        {busy ? <ActivityIndicator color={T.brand} /> : <Text style={s.btnText}>제휴처에서 조건 확인하기</Text>}
      </TouchableOpacity>
    </View>
  );
}

function Row({ k, v, vColor, small }: { k: string; v: string; vColor?: string; small?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={s.k}>{k}</Text>
      <Text style={[s.v, vColor ? { color: vColor } : null, small ? { fontWeight: "400" } : null]}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: T.card, borderWidth: 1, borderColor: T.adLine, borderRadius: 16, padding: 18, marginBottom: 14 },
  adLabel: { alignSelf: "flex-start", backgroundColor: T.adBg, borderColor: T.adLine, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, marginBottom: 10 },
  adLabelText: { color: T.adInk, fontWeight: "800", fontSize: 12 },
  title: { fontSize: 19, fontWeight: "800", color: T.ink, marginBottom: 4 },
  reason: { color: T.muted, marginBottom: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, gap: 12 },
  k: { color: T.muted, fontSize: 15 },
  v: { fontWeight: "700", color: T.ink, fontSize: 15, flexShrink: 1, textAlign: "right" },
  btn: { marginTop: 12, borderWidth: 1.5, borderColor: T.brand, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  btnText: { color: T.brand, fontWeight: "700", fontSize: 16 },
});
