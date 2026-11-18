// How each kind of queued change is sent (lib/offline). Registered once at app start (app/_layout.tsx), so
// changes saved offline are sent as soon as the connection returns — whichever screen is open.
import { registerHandler } from "@/lib/offline";
import { createStudy, setPassageRead, updateStudy } from "@/lib/studyWorkspaceApi";

registerHandler("study.create", (p) => createStudy(p as Parameters<typeof createStudy>[0]));
registerHandler("study.update", (p) => { const { id, ...b } = p as { id: string } & Parameters<typeof updateStudy>[1]; return updateStudy(id, b); });
registerHandler("collection.read", (p) => { const { itemId, read } = p as { itemId: string; read: boolean }; return setPassageRead(itemId, read); });
