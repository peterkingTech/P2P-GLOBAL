import { createOrFindScriptureReference, parseScriptureInput } from "@/lib/prayerTopicsApi";

// Turns what someone typed ("Philippians 4:6-7") into a saved Scripture
// reference id, for the forms that attach one (Kingdom Wins, Mission
// stories). Blank → null. Unreadable → ScriptureInputError, whose message the
// form shows; any other failure (e.g. offline) is passed on unchanged.
export class ScriptureInputError extends Error {}

export async function scriptureReferenceIdFor(input: string): Promise<string | null> {
  if (!input.trim()) return null;
  const parsed = parseScriptureInput(input);
  if (!parsed) throw new ScriptureInputError('Try a format like "Philippians 4:6-7".');
  const ref = await createOrFindScriptureReference(parsed);
  return ref.id;
}
