import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { T } from "../theme";
import { Api, OfferCard as Offer } from "../api";
import OfferCard from "../components/OfferCard";

export default function OfferListScreen({ type, title, sub }: { type: "shopping" | "mission"; title: string; sub: string }) {
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { offers } = await Api.offers(type);
      setOffers(offers);
    } catch {
      setOffers([]);
    }
  }, [type]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: T.bg }}
      contentContainerStyle={{ padding: 18 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Text style={s.h}>{title}</Text>
      <Text style={s.sub}>{sub}</Text>
      {offers === null ? (
        <ActivityIndicator color={T.brand} style={{ marginTop: 30 }} />
      ) : offers.length === 0 ? (
        <Text style={{ color: T.muted, marginTop: 20 }}>지금은 조건을 만족하는 혜택이 없어요.</Text>
      ) : (
        offers.map((o) => <OfferCard key={o.offerSnapshotId} offer={o} onConverted={load} />)
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  h: { fontSize: 24, fontWeight: "800", color: T.ink },
  sub: { color: T.muted, marginTop: 4, marginBottom: 16, fontSize: 15 },
});
