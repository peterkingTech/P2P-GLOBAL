import { APP_SCREEN_COMPONENTS } from "@/components/appui/AppScreens";
import { getMediaSlot } from "@/lib/media";
import { DemoBadge } from "./DemoBadge";

const SCREEN_LABELS: Record<string, string> = {
  P2P_APP_SCREEN_HOME: "Home",
  P2P_APP_SCREEN_LEARN: "Kingdom School",
  P2P_APP_SCREEN_PRAYER: "Pray the Word",
  P2P_APP_SCREEN_FAMILY: "Family Gathering",
  P2P_APP_SCREEN_STORIES: "Kingdom Stories",
  P2P_APP_SCREEN_WINS: "Kingdom Wins",
};

/**
 * A horizontal, device-framed gallery of app screens. Each phone renders a
 * polished mock UI (components/appui/AppScreens.tsx) built from the real
 * app's terminology and navigation — not a real screenshot. A small badge
 * inside each phone marks it as a presentation mockup so it's never
 * mistaken for a captured screen. Once a real screenshot exists for a
 * screen id, swap that one phone's content — no layout change needed.
 */
export function AppShowcase({ screenIds }: { screenIds: readonly string[] }) {
  return (
    <div className="app-showcase" role="region" aria-label="App screen gallery" tabIndex={0}>
      {screenIds.map((id, i) => {
        const slot = getMediaSlot(id);
        if (!slot) return null;
        const Screen = APP_SCREEN_COMPONENTS[id];
        return (
          <div key={id} className="phone-frame-wrap" style={{ ["--i" as string]: i }}>
            <div className="phone-frame">
              <div className="phone-notch" aria-hidden="true" />
              <div className="phone-screen">
                {Screen ? <Screen /> : null}
                <span className="phone-mock-badge">
                  <DemoBadge label="Mock UI" />
                </span>
              </div>
            </div>
            <span className="phone-label">{SCREEN_LABELS[id] ?? slot.subject}</span>
          </div>
        );
      })}
    </div>
  );
}
