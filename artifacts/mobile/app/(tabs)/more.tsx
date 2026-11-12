import React, { useCallback, useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { SegmentedControl } from "@/components/ui";
import PrayerHome from "@/components/more/PrayerHome";
import DiscoverHome from "@/components/more/DiscoverHome";
import { markPrayerSeen } from "@/hooks/usePrayerBadge";
import { withScreenBoundary } from "@/components/ScreenErrorBoundary";

// The More tab: Prayer first, then Discover (community, families, church, missions…), each the
// full screen it was as its own tab. Links into either use ?section=prayer|discover
// (lib/moreRoutes.ts). Showing Prayer clears the More tab's prayer badge.

export type MoreSection = "prayer" | "discover";
let lastSection: MoreSection = "prayer";

function MoreTab() {
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = useState<MoreSection>(lastSection);

  useEffect(() => {
    if (params.section === "prayer" || params.section === "discover") setSection(params.section);
  }, [params.section]);
  useEffect(() => { lastSection = section; }, [section]);
  useFocusEffect(useCallback(() => { if (section === "prayer") markPrayerSeen(profile?.id); }, [section, profile?.id]));

  const toggle = (
    <View style={styles.switchWrap}>
      <SegmentedControl<MoreSection>
        accessibilityLabel="More: Prayer or Discover"
        value={section}
        onChange={setSection}
        options={[{ value: "prayer", label: "Prayer", icon: "wifi-outline" }, { value: "discover", label: "Discover", icon: "compass-outline" }]}
      />
    </View>
  );
  return section === "prayer" ? <PrayerHome key="prayer" topSlot={toggle} /> : <DiscoverHome key="discover" topSlot={toggle} />;
}

const styles = StyleSheet.create({ switchWrap: { paddingHorizontal: 20, paddingTop: 12 } });

// One tab's error stays in that tab (components/ScreenErrorBoundary.tsx).
export default withScreenBoundary(MoreTab, "tabs/more");
