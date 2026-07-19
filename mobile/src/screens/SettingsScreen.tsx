import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Switch, Alert, Modal, LayoutAnimation, Platform, UIManager, TextInput } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { T } from "../theme";
import { Api, demoMode } from "../api";
import { replayOnboarding } from "../onboarding";
import { SCALES, currentScale, setFontScale, onFontScale } from "../fontscale";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const FAQ: { q: string; a: string }[] = [
  { q: "포인트는 어떻게 받나요?", a: "걷기, 간단한 미션, 혜택 참여로 포인트가 쌓여요. ‘내 보상’에서 확인하고 3,000원부터 모바일 쿠폰으로 바꿀 수 있어요." },
  { q: "‘확인 중’은 무슨 뜻인가요?", a: "적립이 제휴사 확인을 기다리는 상태예요. 보통 며칠 안에 ‘사용 가능’으로 바뀌고, 취소·반품되면 회수될 수 있어요." },
  { q: "정말 안전한가요? 비용이 드나요?", a: "이용료는 없어요. 비용은 광고주가 부담합니다. 위치 정보는 수집하지 않고, 이름·연락처는 상담을 신청하고 동의했을 때만 전달돼요." },
  { q: "광고를 꼭 봐야 하나요?", a: "아니요. 답변은 광고와 무관하게 완결돼요. 필요할 때만 ‘광고·제휴’ 표시와 함께 혜택을 보여드려요." },
  { q: "쿠폰은 어떻게 쓰나요?", a: "‘내 보상’에서 교환하면 쿠폰번호가 나와요. 편의점·온라인에서 사용할 수 있어요." },
];

// 철회 가능한 선택 동의(필수 동의는 서비스 이용에 필요하여 토글 대상 아님).
const OPTIONAL: { purpose: string; title: string; desc: string }[] = [
  { purpose: "location", title: "위치(동네) 사용", desc: "동네 날씨 등 ‘오늘의 이야기’를 더 맞춤으로 건네드려요. 정밀 위치가 아니라 동네만 사용합니다." },
  { purpose: "third_party", title: "개인정보 제3자 제공", desc: "렌탈 등 상담 신청 시 이름·연락처·주소를 제휴사에 전달하는 데 동의합니다. 끄면 상담 신청이 제한됩니다." },
  { purpose: "personalized_ads", title: "맞춤 혜택 추천", desc: "대화 맥락에 맞는 혜택·미션을 추천받습니다. 끄면 일반 안내만 제공됩니다." },
  { purpose: "marketing", title: "혜택·이벤트 알림", desc: "새로운 혜택·이벤트 소식을 받습니다." },
];

export default function SettingsScreen() {
  const [granted, setGranted] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [doc, setDoc] = useState<null | "terms" | "privacy">(null);
  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const [scale, setScale] = useState(currentScale());
  const [region, setRegion] = useState("");
  useEffect(() => onFontScale(setScale), []);

  const load = useCallback(async () => {
    try {
      const r = await Api.consents();
      const map: Record<string, boolean> = {};
      r.consents.forEach((c) => { map[c.purpose] = !!c.granted; });
      setGranted(map);
    } catch { /* noop */ }
    try { const m = await Api.me(); setRegion(m.region ?? ""); } catch { /* noop */ }
  }, []);

  async function saveRegion() {
    try { await Api.setRegion(region.trim() || null); Alert.alert("저장됨", "동네가 저장됐어요. ‘오늘의 이야기’에 반영돼요."); }
    catch { Alert.alert("오류", "잠시 후 다시 시도해주세요."); }
  }
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function toggle(purpose: string, next: boolean) {
    setBusy(purpose);
    setGranted((g) => ({ ...g, [purpose]: next })); // 낙관적 반영
    try { await Api.setConsent(purpose, next); }
    catch { setGranted((g) => ({ ...g, [purpose]: !next })); Alert.alert("오류", "잠시 후 다시 시도해주세요."); }
    finally { setBusy(null); }
  }

  function logout() {
    Alert.alert("로그아웃", "로그아웃하면 이 기기의 게스트 세션이 초기화돼요. 계속할까요?", [
      { text: "취소", style: "cancel" },
      { text: "로그아웃", style: "destructive", onPress: async () => {
        await Api.logout();
        Alert.alert("완료", "로그아웃했어요. 다음 화면 이동 시 새 세션으로 시작됩니다.");
      } },
    ]);
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.bg }} contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
      <Text style={s.h}>설정</Text>

      <Text style={s.sectionH}>AI 대화 글자 크기</Text>
      <View style={s.scaleRow}>
        {SCALES.map((sc) => (
          <TouchableOpacity key={sc.id} style={[s.scaleBtn, Math.abs(scale - sc.value) < 0.01 && s.scaleBtnOn]} onPress={() => setFontScale(sc.value)} activeOpacity={0.85}>
            <Text style={[s.scaleBtnText, Math.abs(scale - sc.value) < 0.01 && s.scaleBtnTextOn, { fontSize: 14 * sc.value }]}>{sc.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.sectionH}>내 동네</Text>
      <View style={s.card}>
        <View style={{ paddingVertical: 14 }}>
          <Text style={s.consentTitle}>동네 설정</Text>
          <Text style={s.consentDesc}>날씨 등 ‘오늘의 이야기’를 동네에 맞춰 드려요.</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <TextInput style={s.regionInput} placeholder="예: 서울 마포구" placeholderTextColor={T.muted} value={region} onChangeText={setRegion} />
            <TouchableOpacity style={s.regionSave} onPress={saveRegion} activeOpacity={0.85}><Text style={s.regionSaveText}>저장</Text></TouchableOpacity>
          </View>
        </View>
      </View>

      <Text style={s.sectionH}>개인정보·동의 관리</Text>
      <View style={s.card}>
        {OPTIONAL.map((c, i) => (
          <View key={c.purpose} style={[s.consentRow, i < OPTIONAL.length - 1 && s.rowDivider]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={s.consentTitle}>{c.title}</Text>
              <Text style={s.consentDesc}>{c.desc}</Text>
            </View>
            <Switch
              value={!!granted[c.purpose]}
              onValueChange={(v) => toggle(c.purpose, v)}
              disabled={busy === c.purpose}
              trackColor={{ true: T.brand, false: "#cfcabd" }}
              thumbColor="#fff"
            />
          </View>
        ))}
      </View>
      <Text style={s.hint}>동의는 언제든 켜고 끌 수 있어요. 끄면 즉시 반영됩니다.</Text>

      <Text style={s.sectionH}>도움말 · 자주 묻는 질문</Text>
      <View style={s.card}>
        {FAQ.map((f, i) => (
          <View key={i} style={i < FAQ.length - 1 ? s.rowDivider : undefined}>
            <TouchableOpacity style={s.faqQ} activeOpacity={0.7} onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setFaqOpen(faqOpen === i ? null : i); }}>
              <Text style={s.faqQText}>{f.q}</Text>
              <Text style={s.chev}>{faqOpen === i ? "∨" : "›"}</Text>
            </TouchableOpacity>
            {faqOpen === i && <Text style={s.faqA}>{f.a}</Text>}
          </View>
        ))}
      </View>
      <TouchableOpacity style={s.replay} onPress={replayOnboarding} activeOpacity={0.85}>
        <Text style={s.replayText}>📖 앱 소개 다시 보기</Text>
      </TouchableOpacity>

      <Text style={s.sectionH}>약관·정책</Text>
      <View style={s.card}>
        <TouchableOpacity style={[s.linkRow, s.rowDivider]} onPress={() => setDoc("terms")}><Text style={s.linkText}>이용약관</Text><Text style={s.chev}>›</Text></TouchableOpacity>
        <TouchableOpacity style={s.linkRow} onPress={() => setDoc("privacy")}><Text style={s.linkText}>개인정보처리방침</Text><Text style={s.chev}>›</Text></TouchableOpacity>
      </View>

      <Text style={s.sectionH}>계정</Text>
      <View style={s.card}>
        <TouchableOpacity style={s.linkRow} onPress={logout}><Text style={[s.linkText, { color: T.reversed }]}>로그아웃</Text><Text style={s.chev}>›</Text></TouchableOpacity>
      </View>

      <Text style={s.appInfo}>혜택AI · 버전 0.1.0{demoMode ? " · 데모 모드" : ""}</Text>

      <DocModal kind={doc} onClose={() => setDoc(null)} />
    </ScrollView>
  );
}

const TERMS = `제1조(목적) 본 약관은 혜택AI(이하 "서비스")의 이용 조건과 절차, 회사와 이용자의 권리·의무를 규정합니다.
제2조(서비스) 서비스는 AI 대화 안내와 함께, 이용자의 필요가 있을 때 검수된 제휴 혜택·미션·렌탈·걷기 리워드를 연결합니다. 답변은 광고와 무관하게 완결됩니다.
제3조(리워드) 적립 보상은 제휴사의 유효 전환 확인 후 '사용 가능'으로 확정되며, 취소·반품 시 회수될 수 있습니다.
제4조(유의) 가격·조건 등 변동 정보는 진행 전 원문에서 다시 확인해야 합니다.
※ 본 문안은 데모용 예시이며, 실제 서비스 출시 전 법률 검토를 거쳐 확정됩니다.`;

const PRIVACY = `1. 수집 항목: 기기 식별자, 대화 내용, 걸음수(위치는 수집하지 않습니다).
   렌탈 등 상담 신청 시에만 이름·연락처·주소를 수집하며, 제3자 제공 동의가 있을 때만 제휴사에 전달합니다.
2. 이용 목적: 서비스 제공, 리워드 정산, 맞춤 혜택 추천(동의 시).
3. 보관·파기: 상담 정보는 상담 종료 후 파기합니다. 연락처·주소는 암호화하여 저장합니다.
4. 이용자 권리: 동의는 설정에서 언제든 철회할 수 있고, 열람·삭제를 요청할 수 있습니다.
5. 제3자 제공: 렌탈 상담 등 이용자가 신청한 경우에 한해, 동의한 항목만 해당 제휴사에 제공합니다.
※ 본 문안은 데모용 예시이며, 실제 출시 전 개인정보 영향평가·법률 검토를 거쳐 확정됩니다.`;

function DocModal({ kind, onClose }: { kind: null | "terms" | "privacy"; onClose: () => void }) {
  const open = kind !== null;
  const title = kind === "terms" ? "이용약관" : "개인정보처리방침";
  const body = kind === "terms" ? TERMS : PRIVACY;
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.modalBg}>
        <View style={s.modalCard}>
          <View style={s.modalHead}><Text style={s.modalTitle}>{title}</Text><TouchableOpacity onPress={onClose}><Text style={s.modalClose}>닫기</Text></TouchableOpacity></View>
          <ScrollView style={{ maxHeight: 460 }}><Text style={s.modalBody}>{body}</Text></ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  h: { fontSize: 26, fontWeight: "900", color: T.ink, marginBottom: 8 },
  sectionH: { color: T.muted, fontWeight: "800", fontSize: 14, marginTop: 22, marginBottom: 8 },
  scaleRow: { flexDirection: "row", gap: 10 },
  scaleBtn: { flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  scaleBtnOn: { backgroundColor: T.brandSoft, borderColor: T.brand },
  scaleBtnText: { fontWeight: "800", color: T.ink },
  scaleBtnTextOn: { color: T.brand },
  regionInput: { flex: 1, borderWidth: 1, borderColor: T.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15.5, color: T.ink, backgroundColor: T.bg },
  regionSave: { backgroundColor: T.brand, borderRadius: 12, paddingHorizontal: 18, justifyContent: "center" },
  regionSaveText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  card: { backgroundColor: T.card, borderRadius: 18, borderWidth: 1, borderColor: T.line, paddingHorizontal: 16 },
  consentRow: { flexDirection: "row", alignItems: "center", paddingVertical: 15 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: T.line },
  consentTitle: { fontSize: 16, fontWeight: "800", color: T.ink, marginBottom: 3 },
  consentDesc: { fontSize: 13, color: T.muted, lineHeight: 19 },
  hint: { color: T.muted, fontSize: 13, marginTop: 8, paddingHorizontal: 4 },
  linkRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 17 },
  linkText: { fontSize: 16, fontWeight: "700", color: T.ink },
  chev: { fontSize: 22, color: T.muted, fontWeight: "300" },
  faqQ: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 16, gap: 12 },
  faqQText: { flex: 1, fontSize: 15.5, fontWeight: "700", color: T.ink },
  faqA: { fontSize: 14.5, color: T.muted, lineHeight: 22, paddingBottom: 16, paddingRight: 8 },
  replay: { marginTop: 10, alignSelf: "flex-start", backgroundColor: T.brandSoft, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 11 },
  replayText: { color: T.brand, fontWeight: "800", fontSize: 15 },
  appInfo: { textAlign: "center", color: T.muted, fontSize: 13, marginTop: 28 },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: T.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 34 },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  modalTitle: { fontSize: 19, fontWeight: "900", color: T.ink },
  modalClose: { fontSize: 15, fontWeight: "800", color: T.brand },
  modalBody: { fontSize: 14.5, lineHeight: 23, color: T.ink },
});
