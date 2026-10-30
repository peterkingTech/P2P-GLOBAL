import { Redirect } from "expo-router";

// The conversation list is the Messages tab (app/(tabs)/messages.tsx); this
// older copy was no longer linked anywhere. The route stays so old links
// land on the tab. Individual chats (app/messages/[id].tsx) are unchanged.
export default function MessagesIndexRedirect() {
  return <Redirect href={"/(tabs)/messages" as any} />;
}
