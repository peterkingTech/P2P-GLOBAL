import { Redirect } from "expo-router";

// App Style is now a section of the one Appearance screen. This route stays so
// old links land there.
export default function AppStyleRedirect() {
  return <Redirect href={"/settings/appearance" as any} />;
}
