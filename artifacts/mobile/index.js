// Real-device forensic fix (Android 7.1/API 25, reproduced on Nox) —
// two prior attempts placed enableScreens(false) at the top of
// app/_layout.tsx, which was too late: expo-router/entry initializes
// react-native-screens' native navigator config before _layout.tsx is
// ever evaluated, so the call had no effect (confirmed by two separate
// real-device retests, each showing the identical crash). This custom
// entry point runs enableScreens(false) before expo-router/entry is
// even required — `require`, not `import`, so this genuinely executes
// first instead of being hoisted above it by ES module semantics.
import { enableScreens } from "react-native-screens";

enableScreens(false);

require("expo-router/entry");
