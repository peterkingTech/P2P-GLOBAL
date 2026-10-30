import { Redirect } from "expo-router";

// Every way to find a study partner or group — Discovery Search, Join a Group,
// Smart Match, Choose Someone I Know, Invite a Peer, Find by Username and
// P2P Connections — is on the Discover tab. This hub repeated most of them;
// the route stays so old links land on Discover. The individual screens
// (app/connect/*) are unchanged.
export default function ConnectHubRedirect() {
  return <Redirect href={"/(tabs)/discover" as any} />;
}
