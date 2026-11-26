import React, { useCallback, useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { SegmentedControl } from "@/components/ui";
import PrayerHome from "@/components/more/PrayerHome";
import DiscoverHome from "@/components/more/DiscoverHome";
import AboutP2PLibrary from "@/components/introVideo/AboutP2PLibrary";
import { markPrayerSeen } from "@/hooks/usePrayerBadge";
import { withScreenBoundary } from "@/components/ScreenErrorBoundary";

// The More tab: Prayer first, then Discover (community, families, church, missions…), then About P2P (the 11
// introduction films — owner 2026-11-26: "show About P2P full screen like our screen tabs"), each a full screen.
// Links into any of them use ?section=prayer|discover|about (lib/moreRoutes.ts). Showing Prayer clears the More tab's
// prayer badge.

export type MoreSection = "prayer" | "discover" | "about";
let lastSection: MoreSection = "prayer";

function MoreTab() {
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ section?: string; play?: string; preview?: string }>();
  const [section, setSection] = useState<MoreSection>(lastSection);

  useEffect(() => {
    if (params.section === "prayer" || params.section === "discover" || params.section === "about") setSection(params.section);
  }, [params.section]);
  useEffect(() => { lastSection = section; }, [section]);
  useFocusEffect(useCallback(() => { if (section === "prayer") markPrayerSeen(profile?.id); }, [section, profile?.id]));

  const { t } = useTranslation();
  const toggle = (
    <View style={styles.switchWrap}>
      <SegmentedControl<MoreSection>
        accessibilityLabel="More: Prayer, Discover or About P2P"
        value={section}
        onChange={setSection}
        options={[
          { value: "prayer", label: "Prayer", icon: "wifi-outline" },
          { value: "discover", label: "Discover", icon: "compass-outline" },
          { value: "about", label: t("introVideos.aboutP2P", "About P2P"), icon: "play-circle-outline" },
        ]}
      />
    </View>
  );
  if (section === "about") return <AboutP2PLibrary key="about" embedded topSlot={toggle} play={params.play} preview={params.preview === "1"} />;
  return section === "prayer" ? <PrayerHome key="prayer" topSlot={toggle} /> : <DiscoverHome key="discover" topSlot={toggle} />;
}

const styles = StyleSheet.create({
  switchWrap: { paddingHorizontal: 20, paddingTop: 12 },
});

// One tab's error stays in that tab (components/ScreenErrorBoundary.tsx).
export default withScreenBoundary(MoreTab, "tabs/more");
