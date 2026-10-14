import React from "react";
import { View, Text, ScrollView } from "react-native";
import { useStudioQuery } from "@/components/studio/useStudioQuery";
import { Card, Chip, StateView, studioStyles as ss } from "@/components/studio/StudioUI";
import { getSettings } from "@/lib/studioApi";

// Publishing Settings: the configuration actually in force, read from the
// API. Nothing here is editable in the app — these rules live in the
// database migration and the server environment, and changing them is a
// reviewed change, not a toggle.

const roleName = (r: string) => r.replace(/_/g, " ");

export default function StudioSettings() {
  const { data, loading, error, reload } = useStudioQuery(() => getSettings(), []);
  if (loading && !data) return <StateView loading />;
  if (error) return <StateView error={error} onRetry={reload} />;
  if (!data) return null;
  const s = data.scheduling;
  return (
    <ScrollView style={ss.screen} contentContainerStyle={ss.content}>
      <Text style={ss.meta}>Read-only: these rules are set by the server and database, not in the app. Your role: {roleName(data.yourRole)}.</Text>
      <Card>
        <View style={ss.row}>
          <Text style={[ss.h2, { flex: 1 }]} accessibilityRole="header">Scheduled publishing</Text>
          <Chip label={data.schedulerEnabled ? "Scheduler on" : "Scheduler off"} tone={data.schedulerEnabled ? "green" : "amber"} />
        </View>
        {!data.schedulerEnabled ? <Text style={ss.body}>Jobs can be scheduled, but nothing runs until the scheduler is switched on for this server.</Text> : null}
        <Text style={ss.body}>• Schedule between {s.minLeadMinutes} minute and {s.maxLeadDays} days ahead.</Text>
        <Text style={ss.body}>• A failed job is retried up to {s.maxAttempts} times, waiting {s.retryBaseSeconds} s at first and at most {s.retryMaxMinutes} min between attempts.</Text>
        <Text style={ss.body}>• A job left running by a stopped server is picked up again after {s.staleClaimMinutes} minutes.</Text>
      </Card>
      <Card>
        <Text style={ss.h2} accessibilityRole="header">Approval rules</Text>
        <Text style={ss.body}>• A Kingdom Story is published only after approval in the Studio{data.approval.independentReviewer ? ", by an editor other than the one who submitted it" : ""}{data.approval.superAdminMaySelfApprove ? " (super admins may approve their own submissions)" : ""}.</Text>
        {data.approval.bindsToContent ? <Text style={ss.body}>• Approval covers the exact text, media and sources reviewed; any later change needs a new review.</Text> : null}
        {data.approval.liveStoriesFrozen ? <Text style={ss.body}>• A live story's content is locked; unpublish it to make changes.</Text> : null}
      </Card>
      <Card>
        <Text style={ss.h2} accessibilityRole="header">Who can do what</Text>
        <Text style={ss.label}>Open the Studio</Text>
        <View style={ss.row}>{data.roles.view.map((r) => <Chip key={r} label={roleName(r)} />)}</View>
        <Text style={ss.label}>Review, approve, publish and schedule Kingdom Stories</Text>
        <View style={ss.row}>{data.roles.edit.map((r) => <Chip key={r} label={roleName(r)} tone="green" />)}</View>
        <Text style={ss.label}>Read the audit history</Text>
        <View style={ss.row}>{data.roles.audit.map((r) => <Chip key={r} label={roleName(r)} tone="blue" />)}</View>
      </Card>
    </ScrollView>
  );
}
