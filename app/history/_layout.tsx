import { colors } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { Pressable } from "react-native";

export default function HistoryLayout() {
  const router = useRouter();

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
      <Stack.Screen
        name="index"
        options={{
          title: "Scan History",
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              hitSlop={8}
              style={{ marginLeft: 4 }}
            >
              <Ionicons
                name="chevron-back"
                size={20}
                color={colors.accent_light[400]}
              />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen name="[id]" options={{ title: "Scan Detail" }} />
    </Stack>
  );
}
