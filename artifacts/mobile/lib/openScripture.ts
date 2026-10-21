import { Linking } from "react-native";
import { router } from "expo-router";
import { bibleRoute, readerTarget } from "@/lib/bibleReaderApi";

/**
 * Open a Scripture reference ("John 3:16-18", "Psalm 23") in the P2P Bible
 * reader. Only when the reference can't be read as Book Chapter[:Verse] does
 * it fall back to the bible.com search it used before.
 */
export function openScripture(reference: string | null | undefined, translation?: string | null) {
  const target = readerTarget(reference);
  if (target) {
    router.push(bibleRoute({ ...target, translation }) as any);
    return;
  }
  if (reference) Linking.openURL(`https://www.bible.com/search/bible?query=${encodeURIComponent(reference)}`).catch(() => {});
}
