import React from "react";
import { BibleStudyHome } from "@/app/bible-study/index";

// The Bible tab: the Bible Study page (cover, Continue Reading, reader, search, notes, highlights,
// library, topics). The reader and its tools open on top and come back here.
export default function BibleTab() {
  return <BibleStudyHome asTab />;
}
