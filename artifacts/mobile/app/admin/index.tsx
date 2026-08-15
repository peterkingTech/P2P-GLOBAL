import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, FlatList } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { useData, AdminActivityEntry } from "@/contexts/DataContext";
import { authedFetch } from "@/lib/adminFetch";
import colors from "@/constants/colors";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin_supervisor: "Administrative Supervisor",
  admin_zone: "Zone Admin",
  admin_national: "National Admin",
  admin_content: "Content Admin",
  admin_translation: "Translation Admin",
  admin_moderation: "Moderation Admin",
  admin_verification: "Verification Admin",
  admin_help: "Help Request Admin",
  admin_username: "Username Admin",
  admin_finance: "Finance Admin",
  admin_marketing: "Marketing Admin",
  admin_church: "Church Portal Admin",
  peer_guide: "Peer Guide", church_leader: "Church Leader", regional_admin: "Regional Admin", moderator: "Moderator",
};

function DashboardHeader({ role, zone, country }: { role: string; zone?: string | null; country?: string | null }) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerRole}>{ROLE_LABELS[role] ?? role}</Text>
      {(zone || country) && (
        <Text style={styles.headerLocation}>{[zone, country].filter(Boolean).join(" · ")}</Text>
      )}
    </View>
  );
}

function StatsRow({ stats }: { stats: { label: string; value: string | number }[] }) {
  return (
    <View style={styles.statsRow}>
      {stats.map((s) => (
        <View key={s.label} style={styles.statCard}>
          <Text style={styles.statValue}>{s.value}</Text>
          <Text style={styles.statLabel}>{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

function SubmitReportButton() {
  const router = useRouter();
  return (
    <TouchableOpacity style={styles.reportBtn} onPress={() => router.push("/admin/submit-report" as any)}>
      <Ionicons name="document-text-outline" size={16} color="#fff" />
      <Text style={styles.reportBtnText}>Submit Report</Text>
    </TouchableOpacity>
  );
}

function QueueLinkCard({ label, sub, path, icon }: { label: string; sub: string; path: string; icon: keyof typeof Ionicons.glyphMap }) {
  const router = useRouter();
  return (
    <TouchableOpacity style={styles.queueCard} onPress={() => router.push(path as any)}>
      <View style={styles.queueIconWrap}><Ionicons name={icon} size={18} color={colors.accentGreen} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.queueLabel}>{label}</Text>
        <Text style={styles.queueSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

// Shared shape for roles whose real work already happens in an existing
// queue screen (Help Requests, Moderation, Verification, Usernames, Content,
// Translations) — the dashboard's job here is just orientation + stats +
// reporting, not re-implementing those screens.
function RoleQueueDashboard({ role, queueLabel, queueSub, queuePath, queueIcon }: {
  role: string; queueLabel: string; queueSub: string; queuePath: string; queueIcon: keyof typeof Ionicons.glyphMap;
}) {
  const { profile } = useAuth();
  const { adminStats, loadAdminStats } = useData();
  useEffect(() => { loadAdminStats(); }, [loadAdminStats]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <DashboardHeader role={role} zone={profile?.adminZone} country={profile?.adminCountry} />
      <QueueLinkCard label={queueLabel} sub={queueSub} path={queuePath} icon={queueIcon} />
      <Text style={styles.sectionTitle}>My Stats This Week</Text>
      {adminStats ? (
        <StatsRow stats={[
          { label: "Cases handled", value: adminStats.casesHandled },
          { label: "Avg rating", value: adminStats.avgFeedbackRating ?? "—" },
          { label: "Open cases", value: adminStats.openCases },
        ]} />
      ) : (
        <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 10 }} />
      )}
      <SubmitReportButton />
    </ScrollView>
  );
}

function FinanceAdminDashboard() {
  const { profile } = useAuth();
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <DashboardHeader role="admin_finance" />
      <View style={styles.noteCard}>
        <Text style={styles.noteText}>Financial data only. No user personal data is shown here.</Text>
      </View>
      <Text style={styles.sectionTitle}>Subscriptions & Revenue</Text>
      <View style={styles.emptyCard}>
        <Ionicons name="card-outline" size={28} color={colors.borderBeige} />
        <Text style={styles.emptyText}>No subscription or billing data is tracked yet — this app has no payments system built in.</Text>
      </View>
      <SubmitReportButton />
    </ScrollView>
  );
}

function MarketingAdminDashboard() {
  const [newThisWeek, setNewThisWeek] = useState<number | null>(null);
  const { supabase } = useAuth();

  useEffect(() => {
    (async () => {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase.from("p2p_profiles").select("id", { count: "exact", head: true }).gte("created_at", weekAgo);
      setNewThisWeek(count ?? 0);
    })();
  }, [supabase]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <DashboardHeader role="admin_marketing" />
      <Text style={styles.sectionTitle}>Growth</Text>
      <StatsRow stats={[{ label: "New users this week", value: newThisWeek ?? "…" }]} />
      <Text style={styles.sectionTitle}>Announcements</Text>
      <View style={styles.emptyCard}>
        <Ionicons name="megaphone-outline" size={28} color={colors.borderBeige} />
        <Text style={styles.emptyText}>Announcement composer isn't built yet — official announcements currently go out via the p2pglobal_announcement account directly.</Text>
      </View>
      <SubmitReportButton />
    </ScrollView>
  );
}

function ZoneOrNationalAdminDashboard({ role }: { role: "admin_zone" | "admin_national" }) {
  const { profile } = useAuth();
  const [subAdmins, setSubAdmins] = useState<{ id: string; fullName: string; role: string; adminIsActive: boolean; lastActiveAt: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await authedFetch("/admin/appointments/list");
        if (res.ok) {
          const all = await res.json();
          const filtered = role === "admin_zone"
            ? all.filter((a: any) => a.adminZone === profile?.adminZone && a.id !== profile?.id)
            : all.filter((a: any) => a.adminCountry === profile?.adminCountry && a.id !== profile?.id);
          setSubAdmins(filtered);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [role, profile?.adminZone, profile?.adminCountry, profile?.id]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <DashboardHeader role={role} zone={profile?.adminZone} country={profile?.adminCountry} />
      <Text style={styles.sectionTitle}>{role === "admin_zone" ? "My National Admins" : "Admins in My Country"} ({subAdmins.length})</Text>
      {loading ? <ActivityIndicator color={colors.accentGreen} /> : subAdmins.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="people-outline" size={28} color={colors.borderBeige} />
          <Text style={styles.emptyText}>No admins appointed under you yet.</Text>
        </View>
      ) : (
        subAdmins.map((a) => (
          <View key={a.id} style={styles.subAdminRow}>
            <Text style={styles.subAdminName}>{a.fullName}</Text>
            <Text style={[styles.subAdminStatus, !a.adminIsActive && { color: "#B91C1C" }]}>{a.adminIsActive ? "Active" : "Suspended"}</Text>
          </View>
        ))
      )}
      <SubmitReportButton />
    </ScrollView>
  );
}

function ChurchAdminDashboard() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <DashboardHeader role="admin_church" />
      <QueueLinkCard label="Church Portal Management" sub="All churches, verification queue, and platform stats" path="/admin/churches" icon="business" />
      <SubmitReportButton />
    </ScrollView>
  );
}

function SupervisorDashboard() {
  const [feed, setFeed] = useState<AdminActivityEntry[]>([]);
  const { getAdminActivityFeed } = useData();

  useEffect(() => { getAdminActivityFeed().then(setFeed); }, [getAdminActivityFeed]);

  return (
    <View style={styles.container}>
      <DashboardHeader role="admin_supervisor" />
      <View style={styles.observerBanner}>
        <Ionicons name="eye-outline" size={16} color={colors.textMid} />
        <Text style={styles.observerText}>Observer mode — you can see all admin activity but cannot take actions.</Text>
      </View>
      <FlatList
        data={feed}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        ListEmptyComponent={<Text style={styles.emptyText}>No activity logged yet.</Text>}
        renderItem={({ item }) => <ActivityFeedRow item={item} />}
      />
    </View>
  );
}

function ActivityFeedRow({ item }: { item: AdminActivityEntry }) {
  return (
    <View style={styles.feedItem}>
      <Text style={styles.feedTime}>{new Date(item.createdAt).toLocaleString()}</Text>
      <Text style={styles.feedAction}>{item.actionType.replace(/_/g, " ")}</Text>
      <Text style={styles.feedAdmin}>by {item.adminName} ({ROLE_LABELS[item.adminRole] ?? item.adminRole})</Text>
    </View>
  );
}

function SuperAdminDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<"activity" | "monitor" | "stats" | "management">("activity");
  const [feed, setFeed] = useState<AdminActivityEntry[]>([]);
  const [admins, setAdmins] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { getAdminActivityFeed, getAdminList } = useData();

  const load = useCallback(async () => {
    setLoading(true);
    const [f, a] = await Promise.all([getAdminActivityFeed(), getAdminList()]);
    setFeed(f);
    setAdmins(a);
    setLoading(false);
  }, [getAdminActivityFeed, getAdminList]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={styles.container}>
      <DashboardHeader role="super_admin" />
      <View style={styles.tabsRow}>
        {(["activity", "monitor", "stats", "management"] as const).map((tb) => (
          <TouchableOpacity key={tb} style={[styles.tabChip, tab === tb && styles.tabChipActive]} onPress={() => setTab(tb)}>
            <Text style={[styles.tabChipText, tab === tb && styles.tabChipTextActive]}>
              {tb === "activity" ? "Live Activity" : tb === "monitor" ? "Admin Monitor" : tb === "stats" ? "Platform Stats" : "Management"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? <ActivityIndicator color={colors.accentGreen} style={{ marginTop: 20 }} /> : (
        <>
          {tab === "activity" && (
            <FlatList
              data={feed}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 16, gap: 8 }}
              onRefresh={load}
              refreshing={false}
              ListEmptyComponent={<Text style={styles.emptyText}>No activity logged yet.</Text>}
              renderItem={({ item }) => <ActivityFeedRow item={item} />}
            />
          )}
          {tab === "monitor" && (
            <FlatList
              data={admins}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 16, gap: 8 }}
              ListEmptyComponent={<Text style={styles.emptyText}>No admins appointed yet.</Text>}
              renderItem={({ item }) => (
                <View style={styles.adminRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.subAdminName}>@{item.username ?? item.fullName} · {ROLE_LABELS[item.role] ?? item.role}</Text>
                    <Text style={styles.queueSub}>
                      {item.adminIsActive ? "Active" : "Suspended"}
                      {item.adminAppointedAt ? ` · Appointed ${new Date(item.adminAppointedAt).toLocaleDateString()}` : ""}
                    </Text>
                    <Text style={styles.queueSub}>This week: {item.casesThisWeek} cases · Rating: {item.avgRating ?? "—"}</Text>
                  </View>
                </View>
              )}
            />
          )}
          {tab === "stats" && (
            <ScrollView contentContainerStyle={styles.content}>
              <StatsRow stats={[
                { label: "Total Admins", value: admins.length },
                { label: "Active Admins", value: admins.filter((a) => a.adminIsActive).length },
                { label: "Actions (recent)", value: feed.length },
              ]} />
            </ScrollView>
          )}
          {tab === "management" && (
            <ScrollView contentContainerStyle={styles.content}>
              <TouchableOpacity style={styles.reportBtn} onPress={() => router.push("/admin/appoint-admin" as any)}>
                <Ionicons name="person-add-outline" size={16} color="#fff" />
                <Text style={styles.reportBtnText}>Add New Admin</Text>
              </TouchableOpacity>
              {admins.map((item) => (
                <View key={item.id} style={styles.adminRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.subAdminName}>@{item.username ?? item.fullName} · {ROLE_LABELS[item.role] ?? item.role}</Text>
                    <Text style={styles.queueSub}>
                      {item.adminIsActive ? "Active" : "Suspended"}
                      {item.adminAppointedAt ? ` · Appointed ${new Date(item.adminAppointedAt).toLocaleDateString()}` : ""}
                    </Text>
                    <Text style={styles.queueSub}>This week: {item.casesThisWeek} cases · Rating: {item.avgRating ?? "—"}</Text>
                  </View>
                  <TouchableOpacity onPress={async () => {
                    await authedFetch(`/admin/appointments/${item.id}/suspend`, {
                      method: "PUT", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ reason: item.adminIsActive ? "Suspended from Super Admin dashboard" : "Reinstated from Super Admin dashboard" }),
                    });
                    load();
                  }}>
                    <Text style={styles.actionLink}>{item.adminIsActive ? "Suspend" : "Reinstate"}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}

function AccessDenied() {
  return (
    <View style={[styles.container, styles.centerFill]}>
      <Ionicons name="lock-closed-outline" size={36} color={colors.borderBeige} />
      <Text style={styles.emptyText}>No dashboard is configured for your role yet.</Text>
    </View>
  );
}

export default function AdminHome() {
  const { profile } = useAuth();
  const role = profile?.role;

  switch (role) {
    case "super_admin": return <SuperAdminDashboard />;
    case "admin_supervisor": return <SupervisorDashboard />;
    case "admin_zone": return <ZoneOrNationalAdminDashboard role="admin_zone" />;
    case "admin_national": return <ZoneOrNationalAdminDashboard role="admin_national" />;
    case "admin_content": return <RoleQueueDashboard role="admin_content" queueLabel="Content Manager" queueSub="Curricula, modules, and lessons" queuePath="/admin/content" queueIcon="library" />;
    case "admin_translation": return <RoleQueueDashboard role="admin_translation" queueLabel="Translations" queueSub="Coverage and pending translation work" queuePath="/admin/translations" queueIcon="language" />;
    case "admin_moderation": return <RoleQueueDashboard role="admin_moderation" queueLabel="Flags Queue" queueSub="Flagged content and users" queuePath="/admin/moderation" queueIcon="flag" />;
    case "admin_verification": return <RoleQueueDashboard role="admin_verification" queueLabel="Verification Queue" queueSub="Pending identity verifications" queuePath="/admin/verification" queueIcon="shield-checkmark" />;
    case "admin_help": return <RoleQueueDashboard role="admin_help" queueLabel="Help Requests" queueSub="Crisis and struggling-tier cases" queuePath="/admin/help-requests" queueIcon="medkit" />;
    case "admin_username": return <RoleQueueDashboard role="admin_username" queueLabel="Usernames" queueSub="Reserved usernames and disputes" queuePath="/admin/usernames" queueIcon="at" />;
    case "admin_finance": return <FinanceAdminDashboard />;
    case "admin_marketing": return <MarketingAdminDashboard />;
    case "admin_church": return <ChurchAdminDashboard />;
    // Original six roles keep landing on Help Requests (their long-standing
    // default) rather than a dashboard built for the new admin_* tier.
    case "peer_guide": case "church_leader": case "regional_admin": case "moderator":
      return <RoleQueueDashboard role={role} queueLabel="Help Requests" queueSub="Crisis and struggling-tier cases" queuePath="/admin/help-requests" queueIcon="medkit" />;
    default:
      return <AccessDenied />;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  content: { padding: 16, gap: 10 },
  centerFill: { alignItems: "center", justifyContent: "center", gap: 10 },
  header: { padding: 16, paddingBottom: 4 },
  headerRole: { fontSize: 19, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  headerLocation: { fontSize: 13, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: colors.textMid, marginTop: 6, fontFamily: "Inter_700Bold", textTransform: "uppercase" },
  statsRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  statCard: {
    flex: 1, minWidth: 90, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 12, padding: 12, alignItems: "center",
  },
  statValue: { fontSize: 20, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2, textAlign: "center", fontFamily: "Inter_400Regular" },
  reportBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.accentGreen, borderRadius: 12, height: 46, marginTop: 10,
  },
  reportBtnText: { color: "#fff", fontWeight: "700", fontSize: 14, fontFamily: "Inter_700Bold" },
  queueCard: {
    flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 14, padding: 14,
  },
  queueIconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(29,158,117,0.1)", alignItems: "center", justifyContent: "center" },
  queueLabel: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  queueSub: { fontSize: 12, color: colors.textMuted, marginTop: 1, fontFamily: "Inter_400Regular" },
  noteCard: { backgroundColor: "rgba(184,134,11,0.1)", borderWidth: 1, borderColor: "rgba(184,134,11,0.3)", borderRadius: 10, padding: 12 },
  noteText: { fontSize: 12, color: "#B8860B", fontFamily: "Inter_500Medium" },
  emptyCard: { alignItems: "center", gap: 8, padding: 24, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: "center", fontFamily: "Inter_400Regular" },
  subAdminRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, padding: 12,
  },
  subAdminName: { fontSize: 13, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  subAdminStatus: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_500Medium" },
  observerBanner: {
    flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 6, padding: 10,
    backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.borderBeige,
  },
  observerText: { fontSize: 12, color: colors.textMid, flex: 1, fontFamily: "Inter_400Regular" },
  feedItem: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderLeftWidth: 3, borderLeftColor: colors.accentGreen, borderRadius: 8, padding: 10 },
  feedTime: { fontSize: 10, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  feedAction: { fontSize: 13, fontWeight: "600", color: colors.textDark, textTransform: "capitalize", fontFamily: "Inter_600SemiBold" },
  feedAdmin: { fontSize: 11, color: colors.textMuted, marginTop: 1, fontFamily: "Inter_400Regular" },
  tabsRow: { flexDirection: "row", paddingHorizontal: 16, gap: 6, paddingBottom: 8 },
  tabChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige },
  tabChipActive: { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen },
  tabChipText: { fontSize: 11, color: colors.textMid, fontFamily: "Inter_500Medium" },
  tabChipTextActive: { color: "#fff", fontWeight: "700" },
  adminRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, padding: 12, marginBottom: 8,
  },
  actionLink: { fontSize: 12, color: "#B91C1C", fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});