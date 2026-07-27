import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Pedometer } from "expo-sensors";
import { T, won } from "../theme";
import { Api, CashwalkStatus } from "../api";

export default function WalkScreen() {
  const [st, setSt] = useState<CashwalkStatus | null>(null);
  const [claiming, setClaiming] = useState<number | null>(null);
  const [pedometerOn, setPedometerOn] = useState(false);

  const load = useCallback(async () => {
    try { setSt(await Api.cashwalk()); } catch { /* noop */ }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    let sub: { remove: () => void } | undefined;
    (async () => {
      const ok = await Pedometer.isAvailableAsync().catch(() => false);
      if (!ok) return;
      setPedometerOn(true);
      const start = new Date(); start.setHours(0, 0, 0, 0);
      try {
        const past = await Pedometer.getStepCountAsync(start, new Date());
        if (past?.steps) await syncTo(past.steps);
      } catch { /* 시뮬레이터 미지원 */ }
      sub = Pedometer.watchStepCount((r) => { syncTo((st?.steps ?? 0) + r.steps); });
    })();
    return () => sub?.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function syncTo(steps: number) {
    try { setSt(await Api.syncSteps(Math.floor(steps))); } catch { /* noop */ }
  }
  async function demoWalk() { if (st) await syncTo(st.steps + 1000); }

  function claim(m: number) {
    setClaiming(m);
    Alert.alert("광고 시청", "잠시 광고를 본 뒤 보상을 받습니다.(데모)", [
      { text: "취소", style: "cancel", onPress: () => setClaiming(null) },
      {
        text: "광고 보기",
        onPress: () => setTimeout(async () => {
          try { await Api.claimMilestone(m, "imp_" + Date.now()); await load(); Alert.alert("보상 지급!", "‘내 보상’에서 확인하세요."); }
          catch (e: any) { Alert.alert("청구 실패", e?.title ?? ""); }
          finally { setClaiming(null); }
        }, 2000),
      },
    ]);
  }

  if (!st) return <View style={s.center}><ActivityIndicator color={T.brand} /></View>;

  const pct = Math.min(100, (st.steps / st.dailyCap) * 100);
  const totalMs = Math.floor(st.dailyCap / st.stepPerMilestone);
  const milestones = Array.from({ length: totalMs }, (_, i) => i + 1);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.bg }} contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
      <Text style={s.h}>걷기</Text>
      <Text style={s.sub}>걸을수록 마일스톤이 열려요. 광고를 보면 보상을 받습니다.</Text>

      <View style={s.card}>
        <Text style={s.steps}>{st.steps.toLocaleString("ko-KR")}</Text>
        <Text style={s.stepsLabel}>오늘 걸음 (상한 {st.dailyCap.toLocaleString("ko-KR")}보){pedometerOn ? " · 만보기 연동됨" : ""}</Text>
        <View style={s.progress}><View style={[s.progressFill, { width: `${pct}%` }]} /></View>
        <View style={s.row}><Text style={s.k}>오늘 받은 보상</Text><Text style={[s.v, { color: T.brand }]}>{won(st.earnedToday)}</Text></View>
        <View style={s.row}><Text style={s.k}>마일스톤당 보상</Text><Text style={s.v}>{won(st.rewardPerMilestone)} ({st.stepPerMilestone.toLocaleString("ko-KR")}보마다)</Text></View>
        <TouchableOpacity style={s.demoBtn} onPress={demoWalk} activeOpacity={0.85}><Text style={s.demoText}>+1,000보 (데모 걷기)</Text></TouchableOpacity>
      </View>

      <View style={s.card}>
        <Text style={s.cardH}>마일스톤</Text>
        <Text style={s.hint}>주황색은 광고 보고 받기 가능, 초록색은 받음.</Text>
        <View style={s.msWrap}>
          {milestones.map((m) => {
            const done = st.claimedMilestones.includes(m);
            const can = st.claimable.includes(m);
            return (
              <TouchableOpacity key={m} disabled={!can || claiming !== null} onPress={() => claim(m)} style={[s.ms, done ? s.msDone : can ? s.msCan : s.msLock]}>
                {claiming === m ? <ActivityIndicator size="small" color={T.accent} /> : <Text style={[s.msText, done ? { color: T.brand } : can ? { color: T.accent } : { color: "#b6b1a4" }]}>{m}</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={s.disclose}><Text style={s.discloseText}>보상 재원은 잠금화면·리워드 광고입니다. 걸음 자체가 아니라 ‘광고 시청’에 대해 지급돼요.</Text></View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: T.bg },
  h: { fontSize: 26, fontWeight: "900", color: T.ink },
  sub: { color: T.muted, marginTop: 4, marginBottom: 16, fontSize: 15 },
  card: { backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: T.radiusCard, padding: 18, marginBottom: 14 },
  cardH: { fontSize: 18, fontWeight: "800", color: T.ink, marginBottom: 4 },
  hint: { color: T.muted, marginBottom: 12 },
  steps: { fontSize: 52, fontWeight: "900", color: T.brand, textAlign: "center" },
  stepsLabel: { textAlign: "center", color: T.muted },
  progress: { height: 14, backgroundColor: T.inset, borderRadius: 999, overflow: "hidden", marginVertical: 12 },
  progressFill: { height: "100%", backgroundColor: T.brand, borderRadius: 999 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  k: { color: T.muted, fontSize: 15 },
  v: { fontWeight: "800", color: T.ink, fontSize: 15 },
  demoBtn: { marginTop: 12, backgroundColor: T.brandSoft, borderRadius: T.radiusBtn, paddingVertical: 15, alignItems: "center" },
  demoText: { color: T.brand, fontWeight: "800", fontSize: 16 },
  msWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  ms: { width: 44, height: 44, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  msLock: { backgroundColor: T.inset },
  msCan: { backgroundColor: T.accentSoft, borderWidth: 1.5, borderColor: T.accentLine },
  msDone: { backgroundColor: T.brandSoft },
  msText: { fontWeight: "800", fontSize: 13 },
  disclose: { backgroundColor: T.inset, borderRadius: 12, padding: 12, marginTop: 12 },
  discloseText: { color: T.muted, fontSize: 13 },
});
