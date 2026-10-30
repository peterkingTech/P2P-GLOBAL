import { Redirect } from "expo-router";

// The Foundations list now lives only in Kingdom School (app/kingdom-school.tsx),
// which shows the same three journeys with progress. This route stays so old
// links and bookmarks land there instead of a dead end. Each journey's own
// page (app/curriculum/[id].tsx) is unchanged.
export default function CurriculumRedirect() {
  return <Redirect href={"/kingdom-school" as any} />;
}
