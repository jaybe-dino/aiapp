import React from "react";
import { StatusBar } from "expo-status-bar";
import { Text } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { T } from "./src/theme";
import AIScreen from "./src/screens/AIScreen";
import ShopScreen from "./src/screens/ShopScreen";
import MissionScreen from "./src/screens/MissionScreen";
import WalkScreen from "./src/screens/WalkScreen";
import RewardScreen from "./src/screens/RewardScreen";

const Tab = createBottomTabNavigator();

const ICON: Record<string, string> = { AI: "💬", 혜택: "🛍️", 미션: "🎯", 걷기: "👟", 내보상: "💰" };

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerStyle: { backgroundColor: T.card },
            headerTitleStyle: { fontSize: 20, fontWeight: "800", color: T.ink },
            tabBarActiveTintColor: T.brand,
            tabBarInactiveTintColor: T.muted,
            tabBarLabelStyle: { fontSize: 12, fontWeight: "700" },
            tabBarStyle: { height: 64, paddingBottom: 8, paddingTop: 6 },
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
