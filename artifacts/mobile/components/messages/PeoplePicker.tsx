import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppColors } from "@/constants/themes";
import { Avatar } from "@/components/Avatar";
import { searchRecipients, type MailPerson } from "@/lib/mailApi";

// Choose P2P participants by name or username (server search; people with a block either way never
// appear). Used for P2P Mail recipients and group/community members.
export default function PeoplePicker({ value, onChange, placeholder = "Search by name or username", max = 50, exclude = [] }: {
  value: MailPerson[]; onChange: (people: MailPerson[]) => void; placeholder?: string; max?: number; exclude?: string[];
}) {
  const { colors: c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MailPerson[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    const my = ++seq.current;
    setBusy(true);
    const h = setTimeout(() => {
      searchRecipients(term).then((r) => { if (my === seq.current) setResults(r.people); }).catch(() => { if (my === seq.current) setResults([]); }).finally(() => { if (my === seq.current) setBusy(false); });
    }, 250);
    return () => clearTimeout(h);
  }, [q]);
  const chosen = new Set(value.map((p) => p.id));
  const hidden = new Set(exclude);
  return (
    <View style={{ gap: 8 }}>
      {value.length ? (
        <View style={s.chips}>
          {value.map((p) => (
            <TouchableOpacity key={p.id} style={s.chip} onPress={() => onChange(value.filter((x) => x.id !== p.id))} accessibilityRole="button" accessibilityLabel={`Remove ${p.name}`}>
              <Text style={s.chipText} numberOfLines={1}>{p.name}</Text>
              <Ionicons name="close" size={14} color={c.textMid} />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      {value.length < max ? (
        <View style={s.search}>
          <Ionicons name="person-add-outline" size={16} color={c.textMuted} />
          <TextInput value={q} onChangeText={setQ} placeholder={placeholder} placeholderTextColor={c.textMuted} style={s.input} autoCorrect={false} autoCapitalize="none" accessibilityLabel={placeholder} />
          {busy ? <ActivityIndicator size="small" color={c.accentGreen} /> : null}
        </View>
      ) : null}
      {results.filter((p) => !chosen.has(p.id) && !hidden.has(p.id)).slice(0, 8).map((p) => (
        <TouchableOpacity key={p.id} style={s.result} onPress={() => { onChange([...value, p]); setQ(""); setResults([]); }} accessibilityRole="button" accessibilityLabel={`Add ${p.name}`}>
          <Avatar photoUrl={p.photoUrl ?? null} name={p.name} size={32} />
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{p.name}</Text>
            {(p as MailPerson & { username?: string | null }).username ? <Text style={s.sub}>@{(p as MailPerson & { username?: string | null }).username}</Text> : null}
          </View>
          <Ionicons name="add-circle-outline" size={20} color={c.accentGreen} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: 200, paddingHorizontal: 10, minHeight: 32, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    chipText: { fontSize: 13, color: c.textDark, fontFamily: "Inter_500Medium", flexShrink: 1 },
    search: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderBeige },
    input: { flex: 1, fontSize: 15, color: c.textDark, fontFamily: "Inter_400Regular", paddingVertical: 8 },
    result: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, minHeight: 44 },
    name: { fontSize: 14.5, color: c.textDark, fontFamily: "Inter_600SemiBold" },
    sub: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
  });
}
