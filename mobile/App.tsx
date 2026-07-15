import React, { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { T } from "./src/theme";
import { onDemoMode } from "./src/api";
import AIScreen from "./src/screens/AIScreen";
import ShopScreen from "./src/screens/ShopScreen";
import MissionScreen from "./src/screens/MissionScreen";
import WalkScreen from "./src/screens/WalkScreen";
import RewardScreen from "./src/screens/RewardScreen";

const Tab = createBottomTabNavigator();

const ICON: Record<string, string> = { AI: "💬", 혜택: "🛍️", 미션: "🎯", 걷기: "👟", 내보상: "💰" };

function DemoBanner() {
  const [demo, setDemo] = useState(false);
  useEffect(() => onDemoMode(setDemo), []);
  if (!demo) return null;
  return (
    <SafeAreaView edges={["top"]} style={{ backgroundColor: T.accent }}>
      <Text style={{ color: "#fff", textAlign: "center", paddingVertical: 6, fontSize: 12.5, fontWeight: "700" }}>
        데모 모드 · 서버 없이 체험 중 (실제 보상·저장 없음)
      </Text>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <DemoBanner />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerStyle: { backgroundColor: T.bg, shadowColor: "transparent", elevation: 0, borderBottomWidth: 0 },
            headerTitleStyle: { fontSize: 20, fontWeight: "800", color: T.ink },
            headerShadowVisible: false,
            sceneContainerStyle: { backgroundColor: T.bg },
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
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
