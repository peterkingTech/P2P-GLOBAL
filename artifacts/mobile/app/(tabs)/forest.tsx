import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useData, ForestNode } from "@/contexts/DataContext";
import { getStageFromPoints } from "@/constants/stages";
import colors from "@/constants/colors";

const ROLE_COLORS: Record<string, string> = {
  super_admin: colors.brightYellow,
  moderator: colors.brightYellow,
  regional_admin: colors.accentGreen,
  church_leader: colors.accentGreen,
  peer_guide: colors.lightGreen,
  student: colors.borderBeige,
};

function NodeCard({
  node,
  depth = 0,
}: {
  node: ForestNode;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = node.children.length > 0;
  const roleColor = ROLE_COLORS[node.role] ?? colors.borderBeige;

  return (
    <View style={[styles.nodeWrapper, { marginLeft: depth * 20 }]}>
      <View style={styles.nodeRow}>
        {hasChildren && (
          <TouchableOpacity onPress={() => setExpanded((e) => !e)} style={styles.expandBtn}>
            <Ionicons
              name={expanded ? "chevron-down" : "chevron-forward"}
              size={14}
              color={colors.textMuted}
            />
          </TouchableOpacity>
        )}
        {!hasChildren && <View style={{ width: 24 }} />}

        <View style={[styles.nodeCard, depth === 0 && styles.rootNode]}>
          <View style={[styles.avatarCircle, { borderColor: roleColor }]}>
            <Text style={styles.avatarInitial}>
              {node.name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.nodeName, depth === 0 && styles.rootNodeName]}>
              {node.name} {depth === 0 ? "(You)" : ""}
            </Text>
            <View style={styles.nodeMeta}>
              <View style={[styles.rolePill, { backgroundColor: `${roleColor}22` }]}>
                <Text style={[styles.roleText, { color: roleColor }]}>{node.role}</Text>
              </View>
              {node.country && (
                <Text style={styles.nodeCountry}>{node.country}</Text>
              )}
            </View>
          </View>
          <View style={styles.levelPill}>
            <Text style={styles.levelText}>Lv{node.growthLevel}</Text>
          </View>
        </View>
      </View>

      {expanded && hasChildren && (
        <View style={styles.children}>
          <View style={styles.branchLine} />
          <View style={{ flex: 1 }}>
            {node.children.map((child) => (
              <NodeCard key={child.id} node={child} depth={depth + 1} />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

export default function ForestTab() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { forestNodes, forestStats, isLoading } = useData();

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const totalNodes = forestNodes.reduce((acc, n) => acc + 1 + countDescendants(n), 0);

  function countDescendants(node: ForestNode): number {
    return node.children.reduce((a, c) => a + 1 + countDescendants(c), 0);
  }

  const stageIndex = getStageFromPoints(profile?.growthLevel ?? 0);
  const isForestBuilder = stageIndex === 4;
  const isForestOfNations = stageIndex >= 5;
  const countriesCount = forestStats.countriesReached.length;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={[styles.header, { paddingTop: 20 }]}>
        <Text style={styles.headerTitle}>My Forest</Text>
        <Text style={styles.headerSub}>Your discipleship network</Text>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{totalNodes}</Text>
            <Text style={styles.statLabel}>Connected</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{forestStats.totalDisciples}</Text>
            <Text style={styles.statLabel}>Disciples</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{countriesCount}</Text>
            <Text style={styles.statLabel}>Countries</Text>
          </View>
        </View>

        {(isForestBuilder || isForestOfNations) && (
          <View style={[styles.stageBanner, isForestOfNations && styles.stageBannerNations]}>
            <Text style={styles.stageBannerEmoji}>{isForestOfNations ? "🌍" : "🌲"}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.stageBannerTitle}>
                {isForestOfNations ? "Forest of Nations" : "Forest Builder"}
              </Text>
              <Text style={styles.stageBannerText}>
                {isForestOfNations
                  ? `Your disciples are now active in ${countriesCount} nation${countriesCount === 1 ? "" : "s"} — generations shelter and multiply one another.`
                  : "You've raised a disciple who is now discipling others — you are no longer only growing, you are helping others take root."}
              </Text>
            </View>
          </View>
        )}
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accentGreen} />
        </View>
      ) : forestNodes.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="git-branch-outline" size={48} color={colors.borderBeige} />
          <Text style={styles.emptyTitle}>Your forest is waiting</Text>
          <Text style={styles.emptyText}>Connect with a study partner to plant your first branch.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + 100 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {forestNodes.map((node) => (
            <NodeCard key={node.id} node={node} depth={0} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderBeige,
  },
  headerTitle: { fontSize: 22, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 13, color: colors.textMuted, marginTop: 2, marginBottom: 16, fontFamily: "Inter_400Regular" },
  statsRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 14,
  },
  statBox: { flex: 1, alignItems: "center" },
  statNum: { fontSize: 16, fontWeight: "700", color: colors.primaryGreen, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  statDivider: { width: 1, height: 32, backgroundColor: colors.borderBeige },
  stageBanner: {
    flexDirection: "row", gap: 10, alignItems: "center",
    backgroundColor: "rgba(29,158,117,0.08)",
    borderRadius: 14, borderWidth: 1, borderColor: "rgba(29,158,117,0.25)",
    padding: 12, marginTop: 12,
  },
  stageBannerNations: {
    backgroundColor: "rgba(201,180,138,0.12)",
    borderColor: "rgba(201,180,138,0.35)",
  },
  stageBannerEmoji: { fontSize: 26 },
  stageBannerTitle: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 2 },
  stageBannerText: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_400Regular", lineHeight: 18 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  emptyText: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  list: { paddingHorizontal: 16, paddingTop: 20 },
  nodeWrapper: { marginBottom: 8 },
  nodeRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  expandBtn: {
    width: 24, height: 24,
    alignItems: "center", justifyContent: "center",
  },
  nodeCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 12, flexDirection: "row", gap: 10, alignItems: "center",
  },
  rootNode: {
    borderColor: colors.accentGreen,
    backgroundColor: "rgba(29,158,117,0.06)",
  },
  avatarCircle: {
    width: 38, height: 38, borderRadius: 19,
    borderWidth: 2,
    backgroundColor: colors.cardBeige,
    alignItems: "center", justifyContent: "center",
  },
  avatarInitial: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  nodeName: { fontSize: 13, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  rootNodeName: { color: colors.primaryGreen },
  nodeMeta: { flexDirection: "row", gap: 8, marginTop: 4, alignItems: "center" },
  rolePill: { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  roleText: { fontSize: 10, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  nodeCountry: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  levelPill: {
    backgroundColor: colors.cardBeige,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  levelText: { fontSize: 11, fontWeight: "700", color: colors.textMid, fontFamily: "Inter_700Bold" },
  children: { flexDirection: "row", marginTop: 4 },
  branchLine: { width: 2, backgroundColor: colors.borderBeige, marginLeft: 28, marginRight: 8, borderRadius: 1 },
});
