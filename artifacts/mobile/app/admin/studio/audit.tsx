import React, { useState } from "react";
import { View, Text, FlatList, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import colors from "@/constants/colors";
import { useStudioQuery } from "@/components/studio/useStudioQuery";
import { Card, Chip, Pager, Pill, StateView, studioStyles as ss } from "@/components/studio/StudioUI";
import { getAuditLog } from "@/lib/studioApi";
import { AUDIT_FILTERS, auditActionLabel, auditDetailLines, deviceTimeZone, formatInZone } from "@/lib/studioModel";

// Audit History — read-only, for the audit-reader roles (super_admin,
// admin_supervisor, admin_content; the API and the database both enforce
// this). The log is append-only in the database (migration 188) and this
// screen offers no way to change it. With ?sourceId it shows one story.

const PAGE_SIZE = 25;

export default function StudioAudit() {
  const params = useLocalSearchParams<{ sourceId?: string; title?: string }>();
  const tz = deviceTimeZone();
  const [action, setAction] = useState("");
  const [page, setPage] = useState(0);
  const { data, loading, error, reload } = useStudioQuery(
    () => getAuditLog({ action: action || undefined, sourceType: params.sourceId ? "kingdom_story" : undefined, sourceId: params.sourceId || undefined, page, pageSize: PAGE_SIZE }),
    [action, page, params.sourceId],
  );

  return (
    <View style={ss.screen}>
      <View style={styles.filters}>
        <Text style={ss.h2} accessibilityRole="header">{params.sourceId ? `History${params.title ? `: ${params.title}` : ""}` : "Audit history"}</Text>
        <Text style={ss.meta}>Newest first. Times in {tz}. This record cannot be edited or deleted.</Text>
        <View style={ss.row} accessibilityRole="radiogroup" accessibilityLabel="Filter by kind of action">
          {AUDIT_FILTERS.map((f) => <Pill key={f.value} label={f.label} selected={action === f.value} onPress={() => { setAction(f.value); setPage(0); }} />)}
        </View>
      </View>
      {loading && !data ? <StateView loading /> : error ? <StateView error={error} onRetry={reload} /> : data ? (
        <FlatList
          contentContainerStyle={ss.content}
          data={data.entries}
          keyExtractor={(e) => String(e.id)}
          onRefresh={reload}
          refreshing={loading}
          ListEmptyComponent={<StateView empty emptyText={params.sourceId ? "No Studio activity recorded for this story yet." : "No Studio activity recorded yet."} />}
          ListFooterComponent={data.total > PAGE_SIZE ? <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /> : null}
          renderItem={({ item: e }) => (
            <Card>
              <View style={[ss.row, { justifyContent: "space-between" }]}>
                <Text style={ss.title}>{auditActionLabel(e.action)}</Text>
                <Chip label={e.actor_role === "scheduler" ? "Scheduler" : e.actor_role === "direct" ? "Direct change" : e.actor_role ?? "unknown role"} tone={e.actor_role === "scheduler" ? "blue" : "grey"} />
              </View>
              <Text style={ss.meta}>{formatInZone(e.at, tz)}{e.actor_id ? ` · user ${e.actor_id.slice(0, 8)}` : ""}</Text>
              {auditDetailLines(e.details).map((l, i) => <Text key={i} style={styles.detail}>{l}</Text>)}
            </Card>
          )}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { padding: 14, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  detail: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_400Regular" },
});
