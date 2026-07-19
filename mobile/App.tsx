import React, { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { T } from "./src/theme";
import { onDemoMode } from "./src/api";
import { hasClientLLM } from "./src/llm";
import { bindOnboarding, initOnboarding, completeOnboarding } from "./src/onboarding";
import { initFontScale } from "./src/fontscale";
import Onboarding from "./src/screens/Onboarding";
import AIScreen from "./src/screens/AIScreen";
import ShopScreen from "./src/screens/ShopScreen";
import MissionScreen from "./src/screens/MissionScreen";
import WalkScreen from "./src/screens/WalkScreen";
import RewardScreen from "./src/screens/RewardScreen";
import SettingsScreen from "./src/screens/SettingsScreen";

const Tab = createBottomTabNavigator();

const ICON: Record<string, string> = { AI: "💬", 혜택: "🛍️", 미션: "🎯", 걷기: "👟", 내보상: "💰", 설정: "⚙️" };

function DemoBanner() {
  const [demo, setDemo] = useState(false);
  useEffect(() => onDemoMode(setDemo), []);
  if (!demo) return null;
  // 실제 AI(클라이언트 키)가 연결됐는지 표시 — 정해진 답('도돌이표')인지 진짜 대화인지 구분.
  const realAI = hasClientLLM;
  return (
    <SafeAreaView edges={["top"]} style={{ backgroundColor: realAI ? T.brand : T.accent }}>
      <Text style={{ color: "#fff", textAlign: "center", paddingVertical: 6, fontSize: 12.5, fontWeight: "700" }}>
        {realAI ? "데모 모드 · 실제 AI 대화 연결됨 ✓" : "데모 모드 · 예시 답변 (실제 AI 미연결)"}
      </Text>
    </SafeAreaView>
  );
}

export default function App() {
  const [onboarding, setOnboarding] = useState(false);
  useEffect(() => {
    bindOnboarding(setOnboarding);
    initOnboarding();
    initFontScale();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Onboarding visible={onboarding} onDone={() => completeOnboarding()} />
      <DemoBanner />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerStyle: { backgroundColor: T.bg, shadowColor: "transparent", elevation: 0, borderBottomWidth: 0 },
            headerTitleStyle: { fontSize: 20, fontWeight: "800", color: T.ink },
            headerShadowVisible: false,
            sceneStyle: { backgroundColor: T.bg },
            tabBarActiveTintColor: T.brand,
            tabBarInactiveTintColor: T.muted,
            tabBarLabelStyle: { fontSize: 12, fontWeight: "700" },
            tabBarStyle: { height: 66, paddingBottom: 9, paddingTop: 7, backgroundColor: T.card, borderTopColor: T.line },
            tabBarIcon: ({ color }) => (
              <Text style={{ fontSize: 22, color }}>{ICON[route.name] ?? "•"}</Text>
            ),
          })}
        >
          <Tab.Screen name="AI" component={AIScreen} options={{ title: "AI 도움" }} />
          <Tab.Screen name="혜택" component={ShopScreen} />
          <Tab.Screen name="미션" component={MissionScreen} />
          <Tab.Screen name="걷기" component={WalkScreen} />
          <Tab.Screen name="내보상" component={RewardScreen} options={{ title: "내 보상" }} />
          <Tab.Screen name="설정" component={SettingsScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
