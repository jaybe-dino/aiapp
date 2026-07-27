import React, { useState } from "react";
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from "react-native";
import { T, won } from "../theme";
import { Api, OfferCard as Offer } from "../api";

// 렌탈 설치 상담 신청 폼. 제3자 제공 고지 + 동의 후 리드 제출.
export default function RentalLeadModal({ offer, visible, onClose, onDone }: { offer: Offer; visible: boolean; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [time, setTime] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim() || !phone.trim() || !address.trim()) { Alert.alert("확인", "이름·연락처·설치 주소를 입력해주세요."); return; }
    if (!agree) { Alert.alert("동의 필요", "개인정보 제3자 제공에 동의해야 상담을 신청할 수 있어요."); return; }
    setBusy(true);
    try {
      await Api.setConsent("third_party", true);
      const res = await Api.submitLead(offer.offerSnapshotId, { name: name.trim(), phone: phone.trim(), address: address.trim(), preferred_time: time.trim() || undefined });
      // 데모: 설치 확정 전환을 시뮬레이션해 '확인 중' 보상이 잡히도록
      await Api.simulateConversion("sup_rental", "rental_cpa", res.click_id, offer.totalCost || 0).catch(() => {});
      Alert.alert("상담 신청 완료", `${offer.advertiserName}에서 설치 상담을 위해 연락드릴 예정이에요. ‘내 보상’에서 진행 상태를 확인할 수 있어요.`);
      onDone();
    } catch (e: any) {
      Alert.alert("오류", e?.title ?? "신청에 실패했어요.");
    } finally { setBusy(false); }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.bg}>
        <View style={s.sheet}>
          <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <Text style={s.title}>설치 상담 신청</Text>
            <Text style={s.sub}>{offer.title} · {offer.advertiserName}</Text>

            <Field label="이름" value={name} onChange={setName} placeholder="성함" />
            <Field label="연락처" value={phone} onChange={setPhone} placeholder="010-0000-0000" keyboardType="phone-pad" />
            <Field label="설치 주소" value={address} onChange={setAddress} placeholder="설치할 주소" />
            <Field label="희망 상담 시간 (선택)" value={time} onChange={setTime} placeholder="예: 평일 오후" />

            <View style={s.disclose}>
              <Text style={s.discloseH}>개인정보 제3자 제공 안내</Text>
              <Text style={s.discloseT}>· 제공받는 자: {offer.advertiserName}{"\n"}· 제공 항목: {offer.dataSharing}{"\n"}· 목적: 렌탈 설치 상담·계약{"\n"}· 보유·이용기간: 상담 종료 후 파기(관련 법령 예외){"\n"}· 월 {won(offer.monthlyFee)} · 약정 {offer.contractMonths}개월 · 의무 {offer.mandatoryMonths}개월 · 자동결제 있음</Text>
            </View>

            <TouchableOpacity style={s.checkRow} onPress={() => setAgree((v) => !v)} activeOpacity={0.7}>
              <View style={[s.check, agree && s.checkOn]}>{agree && <Text style={s.checkMark}>✓</Text>}</View>
              <Text style={s.checkLabel}>위 개인정보 제3자 제공에 동의합니다 (필수)</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[s.submit, (!agree || busy) && { opacity: 0.5 }]} onPress={submit} disabled={busy} activeOpacity={0.85}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>상담 신청하기</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={s.cancel} onPress={onClose}><Text style={s.cancelText}>닫기</Text></TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, value, onChange, placeholder, keyboardType }: { label: string; value: string; onChange: (t: string) => void; placeholder: string; keyboardType?: any }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput style={s.input} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={T.muted} keyboardType={keyboardType} />
    </View>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: T.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "92%" },
  title: { fontSize: 22, fontWeight: "900", color: T.ink },
  sub: { color: T.muted, marginTop: 4, marginBottom: 16, fontSize: 15 },
  label: { color: T.muted, fontWeight: "700", marginBottom: 6, fontSize: 14 },
  input: { backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16.5, color: T.ink },
  disclose: { backgroundColor: T.accentSoft, borderWidth: 1, borderColor: T.accentLine, borderRadius: 14, padding: 14, marginTop: 6, marginBottom: 14 },
  discloseH: { fontWeight: "800", color: "#7a5b1e", marginBottom: 6 },
  discloseT: { color: "#7a5b1e", fontSize: 13.5, lineHeight: 21 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  check: { width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: T.line, justifyContent: "center", alignItems: "center", backgroundColor: T.card },
  checkOn: { backgroundColor: T.brand, borderColor: T.brand },
  checkMark: { color: "#fff", fontWeight: "900" },
  checkLabel: { flex: 1, color: T.ink, fontWeight: "700", fontSize: 15 },
  submit: { backgroundColor: T.brand, borderRadius: 16, paddingVertical: 16, alignItems: "center" },
  submitText: { color: "#fff", fontWeight: "800", fontSize: 17 },
  cancel: { paddingVertical: 14, alignItems: "center", marginTop: 4 },
  cancelText: { color: T.muted, fontWeight: "700" },
});
