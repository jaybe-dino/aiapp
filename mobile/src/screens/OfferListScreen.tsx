import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator, TouchableOpacity } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { T } from "../theme";
import { Api, OfferCard as Offer } from "../api";
import OfferCard from "../components/OfferCard";

type Seg = { key: "shopping" | "mission" | "rental"; label: string };

export default function OfferListScreen({ title, sub, segments }: { title: string; sub: string; segments: Seg[] }) {
  const [seg, setSeg] = useState<Seg["key"]>(segments[0]!.key);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (which: Seg["key"]) => {
    setOffers(null);
    try {
      const { offers } = await Api.offers(which);
      setOffers(offers);
    } catch {
      setOffers([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(seg); }, [load, seg]));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: T.bg }}
      contentContainerStyle={{ padding: 18, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(seg); setRefreshing(false); }} />}
    >
      <Text style={s.h}>{title}</Text>
      <Text style={s.sub}>{sub}</Text>

      {segments.length > 1 && (
        <View style={s.segbar}>
          {segments.map((sg) => (
            <TouchableOpacity key={sg.key} style={[s.seg, seg === sg.key && s.segActive]} onPress={() => { setSeg(sg.key); load(sg.key); }} activeOpacity={0.8}>
              <Text style={[s.segText, seg === sg.key && s.segTextActive]}>{sg.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {seg === "rental" && (
        <View style={s.notice}>
          <Text style={s.noticeText}>렌탈은 매달 요금이 나가는 정기결제 상품이에요. 월 요금·약정·의무기간을 꼭 확인하세요.</Text>
        </View>
      )}

      {offers === null ? (
        <ActivityIndicator color={T.brand} style={{ marginTop: 30 }} />
      ) : offers.length === 0 ? (
        <Text style={{ color: T.muted, marginTop: 20 }}>지금은 조건을 만족하는 혜택이 없어요.</Text>
      ) : (
        offers.map((o) => <OfferCard key={o.offerSnapshotId} offer={o} onConverted={() => load(seg)} />)
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  h: { fontSize: 26, fontWeight: "900", color: T.ink },
  sub: { color: T.muted, marginTop: 4, marginBottom: 16, fontSize: 15, lineHeight: 21 },
  segbar: { flexDirection: "row", backgroundColor: T.inset, borderRadius: 14, padding: 4, marginBottom: 16 },
  seg: { flex: 1, paddingVertical: 11, borderRadius: 11, alignItems: "center" },
  segActive: { backgroundColor: T.card, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segText: { color: T.muted, fontWeight: "700", fontSize: 15.5 },
  segTextActive: { color: T.brand, fontWeight: "800" },
  notice: { backgroundColor: "#faf1e6", borderRadius: 12, padding: 13, marginBottom: 14, borderWidth: 1, borderColor: T.accentLine },
  noticeText: { color: "#7a5b1e", fontSize: 13.5, lineHeight: 20 },
});
