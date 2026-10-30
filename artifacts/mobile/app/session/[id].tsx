import { Redirect } from "expo-router";

// The old 1:1 session page (p2p_sessions) had no way in any more — nothing in
// the app lists or links to a session. Mentor / disciple work lives in
// My Discipleship; the route stays so an old link lands there. No session
// records were changed.
export default function SessionRedirect() {
  return <Redirect href={"/my-discipleship" as any} />;
}
