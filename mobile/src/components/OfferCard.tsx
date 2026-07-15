import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import { T, won } from "../theme";
import { Api, OfferCard as Offer } from "../api";
import RentalLeadModal from "./RentalLeadModal";

function supplierFor(cat: string): { supplier: string; source: string } {
  if (cat === "survey") return { supplier: "sup_offerwall", source: "offerwall_cpa" };
  if (cat === "rental") return { supplier: "sup_rental", source: "rental_cpa" };
  return { supplier: "sup_linkprice", source: "shopping_cps" };
}

export default function OfferCard({ offer, answerSnapshotId, onConverted }: { offer: Offer; answerSnapshotId?: string | null; onConverted?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const rental = offer.isRental;

  async function clickAndConvert() {
    const { click_id } = await Api.createClick(offer.offerSnapshotId, answerSnapshotId);
    const { supplier, source } = supplierFor(offer.category);
    await Api.simulateConversion(supplier, source, click_id, offer.totalCost || 10000);
    Alert.alert("접수됨", rental ? "설치 상담이 접수됐어요. ‘내 보상’에서 확인 중 상태를 볼 수 있어요." : "‘내 보상’에서 확인 중 상태를 확인하세요.");
    onConverted?.();
  }

  function goExternal() {
    const warn = rental
      ? `이 상품은 정기결제(자동결제)와 의무약정 ${offer.mandatoryMonths ?? ""}개월이 있어요.\n`
      : "";
    Alert.alert(
      `${offer.advertiserName}로 이동`,
      `${warn}개인정보 전달: ${offer.dataSharing}\n비식별 클릭 ID만 전달됩니다.\n계속할까요?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: rental ? "상담 신청하기" : "이동",
          onPress: async () => {
            setBusy(true);
            try {
              await clickAndConvert();
            } catch (e: any) {
              if (e?.code === "CONSENT_REQUIRED") {
                setBusy(false);
                Alert.alert("개인정보 제3자 제공 동의", e?.detail ?? "동의가 필요합니다.", [
                  { text: "취소", style: "cancel" },
                  {
                    text: "동의하고 계속",
                    onPress: async () => {
                      setBusy(true);
                      try { await Api.setConsent("third_party", true); await clickAndConvert(); }
                      catch (e2: any) { Alert.alert("오류", e2?.title ?? ""); }
                      finally { setBusy(false); }
                    },
                  },
                ]);
                return;
              }
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
      <View style={s.topRow}>
        <View style={s.adLabel}><Text style={s.adLabelText}>광고·제휴</Text></View>
        <Text style={s.advertiser}>{offer.advertiserName}</Text>
        <View style={{ flex: 1 }} />
        <Text style={s.catTag}>{rental ? "렌탈 제휴" : offer.category === "survey" ? "미션 제휴" : "쇼핑 제휴"}</Text>
      </View>

      <Text style={s.title}>{rental ? "🚰 " : ""}{offer.title}</Text>
      <Text style={s.reason}>{offer.recommendationReason}</Text>

      <View style={s.inset}>
        {rental ? (
          <>
            <View style={s.row}><Text style={s.k}>월 렌탈료</Text><Text style={[s.v, s.big, { color: T.accent }]}>{won(offer.monthlyFee)}<Text style={s.per}> /월</Text></Text></View>
            <View style={s.divider} />
            <View style={s.row}><Text style={s.k}>약정 기간</Text><Text style={s.v}>{offer.contractMonths}개월</Text></View>
            <View style={s.row}><Text style={s.k}>의무 사용</Text><Text style={s.v}>{offer.mandatoryMonths}개월</Text></View>
            <View style={s.row}><Text style={s.k}>총 예상 비용</Text><Text style={s.v}>{won(offer.totalCost)}</Text></View>
            <View style={s.row}><Text style={s.k}>설치 확정 시 보상</Text><Text style={[s.v, { color: T.accent }]}>최대 {won(offer.expectedReward)}</Text></View>
          </>
        ) : (
          <>
            <View style={s.row}><Text style={s.k}>총비용</Text><Text style={[s.v, s.big]}>{won(offer.totalCost)}</Text></View>
            <View style={s.divider} />
            <View style={s.row}><Text style={s.k}>확정 시 최대 보상</Text><Text style={[s.v, { color: T.accent }]}>{won(offer.expectedReward)}</Text></View>
            <View style={s.row}><Text style={s.k}>확정 시점</Text><Text style={s.v}>{offer.approvalWindow}</Text></View>
          </>
        )}
      </View>

      <View style={s.chips}>
        {offer.autoRenewal
          ? <Chip warn text={rental ? `자동결제·의무약정 ${offer.mandatoryMonths}개월` : "자동결제 있음"} />
          : <Chip text="자동결제 없음" />}
        <Chip text={rental ? "언제든 상담 취소 가능" : "취소·환불 가능"} />
        <Chip warn={offer.dataSharing !== "없음"} text={offer.dataSharing === "없음" ? "연락처 미전달" : "연락처 전달"} />
      </View>

      <TouchableOpacity style={s.btn} onPress={rental ? () => setLeadOpen(true) : goExternal} disabled={busy} activeOpacity={0.85}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>{rental ? "설치 상담 신청하기" : "제휴처에서 조건을 확인합니다"}</Text>}
      </TouchableOpacity>

      {rental && (
        <RentalLeadModal offer={offer} visible={leadOpen} onClose={() => setLeadOpen(false)} onDone={() => { setLeadOpen(false); onConverted?.(); }} />
      )}
    </View>
  );
}

function Chip({ text, warn }: { text: string; warn?: boolean }) {
  return (
    <View style={[s.chip, warn ? s.chipWarn : s.chipOk]}>
      <Text style={[s.chipText, warn ? { color: T.accent } : { color: T.brand }]}>{warn ? "⚠︎ " : "✓ "}{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: T.accentSoft, borderWidth: 1, borderColor: T.accentLine, borderRadius: T.radiusCard, padding: 18, marginBottom: 14 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  adLabel: { backgroundColor: T.adLabelBg, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  adLabelText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  advertiser: { fontWeight: "800", color: T.ink, fontSize: 15 },
  catTag: { color: T.muted, fontWeight: "700", fontSize: 13 },
  title: { fontSize: 19, fontWeight: "800", color: T.ink, marginBottom: 4 },
  reason: { color: T.muted, marginBottom: 12, fontSize: 14 },
  inset: { backgroundColor: T.card, borderRadius: 14, padding: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, gap: 12 },
  divider: { height: 1, backgroundColor: T.line, marginVertical: 2 },
  k: { color: T.muted, fontSize: 15 },
  v: { fontWeight: "800", color: T.ink, fontSize: 15, flexShrink: 1, textAlign: "right" },
  big: { fontSize: 21 },
  per: { fontSize: 13, fontWeight: "600", color: T.muted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  chip: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  chipOk: { backgroundColor: T.brandSoft },
  chipWarn: { backgroundColor: "#f9ede0" },
  chipText: { fontWeight: "700", fontSize: 13 },
  btn: { marginTop: 14, backgroundColor: T.brand, borderRadius: T.radiusBtn, paddingVertical: 16, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 16.5 },
});
