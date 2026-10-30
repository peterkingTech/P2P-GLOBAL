// Test double for the shared button system (components/ui) in screen tests
// whose harness mocks react-native with simple host components. Each part
// renders as the harness's TouchableOpacity host with exactly what the real
// part exposes to people and screen readers — its label, role, onPress,
// disabled / busy / selected state — so a screen test can still find a button
// by its label and press it. The real parts' visuals and behaviour (colours,
// sizes, loading, double-tap guard) are tested in tests/buttonSystem.test.mjs.
export function buttonDouble(React, RN) {
  const h = React.createElement;
  const press = (p, role, label, extra = {}) => h(RN.TouchableOpacity, {
    onPress: p.onPress, disabled: !!(p.disabled || p.loading), accessibilityRole: role, accessibilityLabel: label,
    accessibilityHint: p.accessibilityHint, accessibilityState: { disabled: !!(p.disabled || p.loading), busy: !!p.loading, ...extra }, style: p.style, testID: p.testID,
  }, p.label !== undefined ? h(RN.Text, null, p.label) : null);
  const pass = ({ children }) => children ?? null;
  return {
    AppButton: (p) => press(p, "button", p.accessibilityLabel ?? p.label),
    IconButton: (p) => press(p, "button", p.accessibilityLabel, p.selected === undefined ? {} : { selected: p.selected }),
    Chip: (p) => press(p, "button", p.accessibilityLabel ?? p.label),
    FilterChip: (p) => press(p, p.selection === "single" ? "radio" : "checkbox", p.accessibilityLabel ?? p.label, { checked: p.selected, selected: p.selected }),
    ChipRow: pass,
    SegmentedControl: (p) => h(RN.View, { accessibilityRole: "radiogroup", accessibilityLabel: p.accessibilityLabel },
      p.options.map((o) => press({ label: o.label, onPress: () => p.onChange(o.value) }, "radio", o.label, { checked: o.value === p.value }))),
    CallControl: (p) => press(p, "button", p.label, p.kind === "end" ? {} : { selected: !!p.active }),
    ButtonThemeProvider: pass, FixedLightButtons: pass, useButtonTokens: () => ({}),
  };
}
