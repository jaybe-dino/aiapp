import React from "react";
import OfferListScreen from "./OfferListScreen";

export default function MissionScreen() {
  return (
    <OfferListScreen
      title="미션"
      sub="설문·가입 등 행동을 완료하면 보상을 받아요. 소요시간과 개인정보 전달을 먼저 확인하세요."
      segments={[{ key: "mission", label: "미션" }]}
    />
  );
}
