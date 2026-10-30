import { Redirect } from "expo-router";

// This screen showed a hard-coded list of example people, not real members,
// and nothing linked to it. Real recognition lives on Graduates
// (app/graduates.tsx); the route stays so an old link lands there.
export default function HallOfFaithRedirect() {
  return <Redirect href={"/graduates" as any} />;
}
