import { Redirect, useLocalSearchParams } from "expo-router";

// Calling a family member happens from the family's Members screen
// (app/family/members.tsx — same call flow, lib/callStart), which the family
// hub links to. This older list duplicated it and was no longer linked; the
// route stays so old links land on Members for the same family.
// ("fid", not "familyId": a param named familyId collides with the sibling
// app/family/[familyId].tsx segment.)
export default function FamilyCallsRedirect() {
  const { fid } = useLocalSearchParams<{ fid?: string }>();
  return <Redirect href={(fid ? { pathname: "/family/members", params: { familyId: fid } } : "/family") as any} />;
}
