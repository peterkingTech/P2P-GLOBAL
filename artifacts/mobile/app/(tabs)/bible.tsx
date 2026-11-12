import React from "react";
import { BibleStudyHome } from "@/app/bible-study/index";
import { withScreenBoundary } from "@/components/ScreenErrorBoundary";

// The Bible tab: the Bible Study page (cover, Continue Reading, reader, search, notes, highlights,
// library, topics). The reader and its tools open on top and come back here.
function BibleTab() {
  return <BibleStudyHome asTab />;
}

// One tab's error stays in that tab (components/ScreenErrorBoundary.tsx).
export default withScreenBoundary(BibleTab, "tabs/bible");
