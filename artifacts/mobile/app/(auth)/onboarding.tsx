import React, { useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  FlatList,
  Image,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import colors from "@/constants/colors";

const { width } = Dimensions.get("window");

const LOGO = require("@/assets/images/logo.png");

const SLIDES = [
  {
    id: "1",
    icon: null, // slide 1 uses the big logo instead of an icon
    title: "PEER-TO-PEER GLOBAL\nBIBLE STUDY NETWORK",
    subtitle:
      "Connect with believers worldwide. Grow together, across every border, every nation.",
  },
  {
    id: "2",
    icon: "git-branch" as const,
    title: "Watch Your Tree Grow",
    subtitle:
      "Every study session, every prayer, every friendship adds fruit to your Living Tree — a picture of your spiritual journey.",
  },
  {
    id: "3",
    icon: "people" as const,
    title: "Find Your Study Partner",
    subtitle:
      "Smart matching connects you with a peer who shares your language, time zone, and spiritual season.",
  },
  {
    id: "4",
    icon: "radio" as const,
    title: "The Upper Room",
    subtitle:
      "Join live prayer rooms, post to the nation prayer wall, and intercede for the unreached peoples of the earth.",
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(0);
  const listRef = useRef<FlatList>(null);

  const isLast = current === SLIDES.length - 1;

  function goNext() {
    if (isLast) {
      router.replace("/(auth)/login");
    } else {
      const next = current + 1;
      listRef.current?.scrollToIndex({ index: next, animated: true });
      setCurrent(next);
    }
  }

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + (Platform.OS === "web" ? 20 : 0) },
      ]}
    >
      {/* Small logo watermark shown on slides 2–4 */}
      {current > 0 && (
        <View style={styles.headerLogo}>
          <Image source={LOGO} style={styles.headerLogoImg} />
        </View>
      )}

      <FlatList
        ref={listRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>
            {item.icon === null ? (
              /* Slide 1 — big official logo */
              <View style={styles.logoWrap}>
                <Image source={LOGO} style={styles.logoImg} />
              </View>
            ) : (
              /* Slides 2–4 — Ionicon in branded ring */
              <View style={styles.iconRing}>
                <Ionicons
                  name={item.icon}
                  size={52}
                  color={colors.accentGreen}
                />
              </View>
            )}
            <Text style={[styles.title, item.id === "1" && styles.titleHero]}>{item.title}</Text>
            {item.id === "1" && (
              <Text style={styles.poweredBy}>Powered by AMEN TECH</Text>
            )}
            <Text style={styles.subtitle}>{item.subtitle}</Text>
          </View>
        )}
      />

      {/* Dots */}
      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              {
                backgroundColor:
                  i === current ? colors.accentGreen : colors.navBorder,
              },
            ]}
          />
        ))}
      </View>

      {/* CTA */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 24 }]}>
        <TouchableOpacity
          style={styles.btn}
          onPress={goNext}
          activeOpacity={0.85}
        >
          <Text style={styles.btnText}>
            {isLast ? "Get Started" : "Continue"}
          </Text>
          <Ionicons name="arrow-forward" size={18} color={colors.cream} />
        </TouchableOpacity>

        {current === 0 && (
          <TouchableOpacity
            style={styles.discoverBtn}
            onPress={() => {
              const next = 1;
              listRef.current?.scrollToIndex({ index: next, animated: true });
              setCurrent(next);
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="compass-outline" size={16} color={colors.accentGreen} />
            <Text style={styles.discoverBtnText}>Discover More</Text>
          </TouchableOpacity>
        )}
        {current === 0 && (
          <TouchableOpacity
            onPress={() => router.replace("/(auth)/login")}
            style={styles.skipBtn}
          >
            <Text style={styles.skipText}>I already have an account</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.darkBg },
  headerLogo: {
    alignItems: "center",
    paddingBottom: 8,
  },
  headerLogoImg: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  slide: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 36,
    backgroundColor: colors.darkBg,
  },
  /* Slide 1 big logo */
  logoWrap: {
    marginBottom: 36,
    shadowColor: colors.accentGreen,
    shadowOpacity: 0.35,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  logoImg: {
    width: 140,
    height: 140,
    borderRadius: 32,
  },
  /* Slides 2–4 icon ring */
  iconRing: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "rgba(29,158,117,0.12)",
    borderWidth: 1.5,
    borderColor: "rgba(29,158,117,0.3)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 36,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: colors.cream,
    textAlign: "center",
    marginBottom: 16,
    lineHeight: 34,
    fontFamily: "Inter_700Bold",
  },
  titleHero: {
    fontSize: 22,
    letterSpacing: 0.8,
    color: "#F4EFE4",
    lineHeight: 30,
    marginBottom: 8,
  },
  poweredBy: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.accentGreen,
    textAlign: "center",
    letterSpacing: 1.5,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 20,
    textTransform: "uppercase",
  },
  subtitle: {
    fontSize: 15,
    color: colors.textMutedLight,
    textAlign: "center",
    lineHeight: 24,
    fontFamily: "Inter_400Regular",
  },
  discoverBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(29,158,117,0.35)",
    backgroundColor: "rgba(29,158,117,0.08)",
  },
  discoverBtnText: {
    color: colors.accentGreen,
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginBottom: 32,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  footer: { paddingHorizontal: 24, gap: 14 },
  btn: {
    backgroundColor: colors.accentGreen,
    borderRadius: 14,
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  btnText: {
    color: colors.cream,
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  skipBtn: { alignItems: "center", paddingVertical: 8 },
  skipText: {
    color: colors.lightGreen,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
});
