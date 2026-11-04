import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { serverNowMs, splitDuration } from "@/lib/serverClock";

/**
 * The live 48-hour countdown: days, hours, minutes, seconds until the
 * SERVER's deadline (never computed from the phone's clock), then the time
 * overdue. Re-renders each second; nothing resets it — it always reads the
 * same deadline from the server.
 */
export default function Countdown({ deadlineAt, overdueNote, compact }: { deadlineAt: string; overdueNote?: string; compact?: boolean }) {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const d = splitDuration(Date.parse(deadlineAt) - serverNowMs());
  const parts: [number, string][] = [[d.days, "days"], [d.hours, "hours"], [d.minutes, "min"], [d.seconds, "sec"]];
  const spoken = `${d.overdue ? "Overdue by" : "Time remaining:"} ${d.days} days, ${d.hours} hours, ${d.minutes} minutes`;
  const tone = d.overdue ? c.amber : d.days === 0 && d.hours < 6 ? c.amber : c.accentGreen;
  if (compact) {
    return <Text style={[s.compact, { color: tone }]} accessibilityLabel={spoken}>{d.overdue ? "Overdue " : ""}{d.days ? `${d.days}d ` : ""}{String(d.hours).padStart(2, "0")}:{String(d.minutes).padStart(2, "0")}:{String(d.seconds).padStart(2, "0")}{d.overdue ? "" : " left"}</Text>;
  }
  return (
    <View style={s.wrap} accessible accessibilityRole="timer" accessibilityLabel={spoken}>
      <Text style={[s.label, { color: tone }]}>{d.overdue ? "Overdue by" : "Time remaining"}</Text>
      <View style={s.row}>
        {parts.map(([n, u]) => (
          <View key={u} style={[s.box, { borderColor: tone }]}>
            <Text style={[s.n, { color: tone }]}>{String(n).padStart(2, "0")}</Text>
            <Text style={s.u}>{u}</Text>
          </View>
        ))}
      </View>
      {d.overdue && overdueNote ? <Text style={s.note}>{overdueNote}</Text> : null}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    wrap: { gap: 8, padding: 14, borderRadius: 16, backgroundColor: c.card },
    label: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.8, textTransform: "uppercase" },
    row: { flexDirection: "row", gap: 8 },
    box: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 12, borderWidth: 1.5, backgroundColor: c.lightCream },
    n: { fontSize: 24, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
    u: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_600SemiBold" },
    note: { fontSize: 13, lineHeight: 18, color: c.textMid, fontFamily: "Inter_400Regular" },
    compact: { fontSize: 13, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  });
}
