import { Redirect } from "expo-router";

// The decoration level ("Style Details") is now a section of the one
// Appearance screen. This route stays so old links land there.
export default function StyleDetailsRedirect() {
  return <Redirect href={"/settings/appearance" as any} />;
}
