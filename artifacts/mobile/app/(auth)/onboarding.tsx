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
  Modal,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import i18next from "i18next";
import colors from "@/constants/colors";

const { width } = Dimensions.get("window");

const LOGO = require("@/assets/images/logo.png");

const LANGUAGES = [
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "pt", label: "Português", flag: "🇧🇷" },
  { code: "zh", label: "中文", flag: "🇨🇳" },
  { code: "ar", label: "العربية", flag: "🇸🇦" },
  { code: "hi", label: "हिन्दी", flag: "🇮🇳" },
  { code: "sw", label: "Kiswahili", flag: "🇰🇪" },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [current, setCurrent] = useState(0);
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [selectedLang, setSelectedLang] = useState(
    LANGUAGES.find((l) => l.code === (i18next.language?.slice(0, 2) ?? "en")) ?? LANGUAGES[0]
  );
  const listRef = useRef<FlatList>(null);

  const isLast = current === 3;

  const SLIDES = [
    {
      id: "1",
      icon: null as null,
      title: t("onboarding.slide1Title"),
      subtitle: t("onboarding.slide1Sub"),
    },
    {
      id: "2",
      icon: "git-branch" as const,
      title: t("onboarding.slide2Title"),
      subtitle: t("onboarding.slide2Sub"),
    },
    {
      id: "3",
      icon: "people" as const,
      title: t("onboarding.slide3Title"),
      subtitle: t("onboarding.slide3Sub"),
    },
    {
      id: "4",
      icon: "radio" as const,
      title: t("onboarding.slide4Title"),
      subtitle: t("onboarding.slide4Sub"),
    },
  ];

  async function selectLanguage(lang: typeof LANGUAGES[0]) {
    setSelectedLang(lang);
    setLangPickerOpen(false);
    try {
      await AsyncStorage.setItem("@p2p/appLanguage", lang.code);
      await i18next.changeLanguage(lang.code);
    } catch {}
  }

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
      {/* Language picker button — always visible */}
      <View style={styles.langRow}>
        {current > 0 && (
          <View style={styles.headerLogo}>
            <Image source={LOGO} style={styles.headerLogoImg} />
          </View>
        )}
        <TouchableOpacity
          style={styles.langBtn}
          onPress={() => setLangPickerOpen(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.langBtnFlag}>{selectedLang.flag}</Text>
          <Text style={styles.langBtnLabel}>{selectedLang.label}</Text>
          <Ionicons name="chevron-down" size={12} color={colors.accentGreen} />
        </TouchableOpacity>
      </View>

      <FlatList
        ref={listRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        style={{ backgroundColor: colors.darkBg }}
        contentContainerStyle={{ backgroundColor: colors.darkBg }}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>
            {item.icon === null ? (
              <View style={styles.logoWrap}>
                <Image source={LOGO} style={styles.logoImg} />
              </View>
            ) : (
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
              <Text style={styles.poweredBy}>{t("onboarding.poweredBy")}</Text>
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
              { backgroundColor: i === current ? colors.accentGreen : colors.navBorder },
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
            {isLast ? t("onboarding.getStarted") : t("onboarding.continue")}
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
            <Text style={styles.discoverBtnText}>{t("onboarding.discoverMore")}</Text>
          </TouchableOpacity>
        )}
        {current === 0 && (
          <TouchableOpacity
            onPress={() => router.replace("/(auth)/login")}
            style={styles.skipBtn}
          >
            <Text style={styles.skipText}>{t("onboarding.alreadyHaveAccount")}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Language picker sheet */}
      <Modal
        visible={langPickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setLangPickerOpen(false)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setLangPickerOpen(false)}
        >
          <View
            style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{t("onboarding.selectLanguage")}</Text>
              <TouchableOpacity onPress={() => setLangPickerOpen(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={colors.textMutedLight} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {LANGUAGES.map((lang) => (
                <TouchableOpacity
                  key={lang.code}
                  style={[
                    styles.langOption,
                    selectedLang.code === lang.code && styles.langOptionActive,
                  ]}
                  onPress={() => selectLanguage(lang)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.langOptionFlag}>{lang.flag}</Text>
                  <Text style={[
                    styles.langOptionLabel,
                    selectedLang.code === lang.code && styles.langOptionLabelActive,
                  ]}>
                    {lang.label}
                  </Text>
                  {selectedLang.code === lang.code && (
                    <Ionicons name="checkmark" size={18} color={colors.accentGreen} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.darkBg },
  langRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 4,
    minHeight: 48,
  },
  headerLogo: { alignItems: "center" },
  headerLogoImg: { width: 40, height: 40, borderRadius: 8 },
  langBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(29,158,117,0.12)",
    borderWidth: 1,
    borderColor: "rgba(29,158,117,0.3)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: "auto",
  },
  langBtnFlag: { fontSize: 15 },
  langBtnLabel: { fontSize: 13, color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },
  slide: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 36,
    backgroundColor: colors.darkBg,
  },
  logoWrap: {
    marginBottom: 36,
    shadowColor: colors.accentGreen,
    shadowOpacity: 0.35,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  logoImg: { width: 140, height: 140, borderRadius: 32 },
  iconRing: {
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: "rgba(29,158,117,0.12)",
    borderWidth: 1.5, borderColor: "rgba(29,158,117,0.3)",
    alignItems: "center", justifyContent: "center",
    marginBottom: 36,
  },
  title: {
    fontSize: 26, fontWeight: "700", color: colors.cream,
    textAlign: "center", marginBottom: 16, lineHeight: 34,
    fontFamily: "Inter_700Bold",
  },
  titleHero: {
    fontSize: 22, letterSpacing: 0.8, color: "#FFFFFF",
    lineHeight: 30, marginBottom: 8,
  },
  poweredBy: {
    fontSize: 11, fontWeight: "600", color: colors.accentGreen,
    textAlign: "center", letterSpacing: 1.5,
    fontFamily: "Inter_600SemiBold", marginBottom: 20,
    textTransform: "uppercase",
  },
  subtitle: {
    fontSize: 15, color: colors.textMutedLight,
    textAlign: "center", lineHeight: 24,
    fontFamily: "Inter_400Regular",
  },
  discoverBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: "rgba(29,158,117,0.35)",
    backgroundColor: "rgba(29,158,117,0.08)",
  },
  discoverBtnText: {
    color: colors.accentGreen, fontSize: 15, fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  dots: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 32 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  footer: { paddingHorizontal: 24, gap: 14 },
  btn: {
    backgroundColor: colors.accentGreen, borderRadius: 14, height: 54,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  btnText: {
    color: colors.cream, fontSize: 16, fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  skipBtn: { alignItems: "center", paddingVertical: 8 },
  skipText: { color: colors.lightGreen, fontSize: 14, fontFamily: "Inter_400Regular" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.darkBg,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: "75%",
    borderTopWidth: 1, borderTopColor: "rgba(29,158,117,0.2)",
  },
  sheetHeader: {
    flexDirection: "row", alignItems: "center",
    marginBottom: 16,
  },
  sheetTitle: {
    flex: 1, fontSize: 17, fontWeight: "700", color: colors.cream,
    fontFamily: "Inter_700Bold",
  },
  closeBtn: { padding: 4 },
  langOption: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 14, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.07)",
  },
  langOptionActive: { },
  langOptionFlag: { fontSize: 22, width: 32, textAlign: "center" },
  langOptionLabel: {
    flex: 1, fontSize: 15, color: colors.textMutedLight,
    fontFamily: "Inter_400Regular",
  },
  langOptionLabelActive: { color: colors.accentGreen, fontFamily: "Inter_600SemiBold" },
});
