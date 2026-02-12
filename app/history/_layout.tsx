import { Stack } from "expo-router";
import { colors } from "@/constants/colors";

export default function HistoryLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary[900] },
        headerTintColor: colors.accent_light[400],
        headerTitleStyle: { fontWeight: "bold", fontFamily: "Inter-Bold" },
        contentStyle: { backgroundColor: colors.primary[950] },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Scan History" }} />
      <Stack.Screen name="[id]" options={{ title: "Scan Detail" }} />
    </Stack>
  );
}
