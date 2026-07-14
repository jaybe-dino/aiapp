import React from "react";
import OfferListScreen from "./OfferListScreen";

export default function ShopScreen() {
  return (
    <OfferListScreen
      title="혜택"
      sub="검수된 제휴 상품이에요. 총비용과 조건을 꼭 확인하세요."
      segments={[
        { key: "shopping", label: "쇼핑·예약" },
        { key: "rental", label: "렌탈" },
      ]}
    />
  );
}
