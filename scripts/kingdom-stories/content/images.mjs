// Images from the editor's Topic 001–009 PDFs, in the order they appear.
// file: extracted from the PDF (<pdf>_p<page>_<n>.jpg); the files themselves
// are not kept in the repo — pass their folder to import-stories.mjs --images.
// chapter: the chapter whose heading the image sits under (null = story-level,
// e.g. the title-page image). cover: the story's card/cover image (one each;
// where the PDF has no title-page image, the first image is used).
// credit: the website named under the image in the PDF, exactly as printed;
// null where the PDF names none (no credit is invented).
const img = (file, chapter, credit = null, cover = false) => ({ file, chapter, credit, cover });

export default {
  "creation-and-the-beginning-of-humanity": [
    img("02_p02_1.jpg", 1, null, true),
    img("02_p05_1.jpg", 2, "hisscripture.com"),
    img("02_p07_1.jpg", 3, "bible.art"),
    img("02_p10_1.jpg", 4, "christianpublishinghouse.co"),
    img("02_p12_1.jpg", 5),
    img("02_p15_1.jpg", 6, "christianpublishinghouse.co"),
  ],
  "the-fall-of-humanity": [
    img("03_p02_1.jpg", 1, "christianpublishinghouse.co", true),
    img("03_p04_1.jpg", 2, "medium.com"),
    img("03_p07_1.jpg", 3, "apologeticsark.com"),
    img("03_p10_1.jpg", 4, "christianpublishinghouse.co"),
    img("03_p13_1.jpg", 5, "tiny3dtemples.com"),
    img("03_p15_1.jpg", 6),
  ],
  "noah-and-the-flood": [
    img("04_p01_1.jpg", null, "opovo.com.br", true),
    img("04_p03_1.jpg", 1, "bible.art"),
    img("04_p06_1.jpg", 2, "meisterdrucke.com"),
    img("04_p09_1.jpg", 3, "storyforkids.org"),
    img("04_p12_1.jpg", 4, "apologeticsark.com"),
    img("04_p15_1.jpg", 5, "bible.art"),
    img("04_p18_1.jpg", 6, "bible.art"),
  ],
  "abraham-and-the-covenant": [
    img("05_p01_1.jpg", null, null, true),
    img("05_p02_1.jpg", null),
    img("05_p03_1.jpg", null),
    img("05_p04_1.jpg", 1, "thelightofulsan.tistory.com"),
    img("05_p07_1.jpg", 2, "bible.art"),
    img("05_p10_1.jpg", 3, "bibleworld.ai"),
    img("05_p13_1.jpg", 4, "apologeticsark.com"),
    img("05_p16_1.jpg", 5, "bible.art"),
    img("05_p19_1.jpg", 6, "bookofworldhistory.com"),
    img("05_p22_1.jpg", 7, "prayersfor.com"),
    img("05_p25_1.jpg", 8, "bookofworldhistory.com"),
  ],
  "isaac-and-the-continuation-of-the-promise": [
    img("06_p01_1.jpg", null, null, true),
    img("06_p03_1.jpg", 1, "bookofworldhistory.com"),
    img("06_p06_1.jpg", 2, "prayersfor.com"),
    img("06_p09_1.jpg", 3, "biblepics.co"),
    img("06_p12_1.jpg", 4, "bible.art"),
    img("06_p15_1.jpg", 5, "bible.art"),
    img("06_p19_1.jpg", 6, "bible.art"),
  ],
  "jacob-and-esau": [
    img("07_p02_1.jpg", null, null, true),
    img("07_p04_1.jpg", 1, "watermarkwaves.com"),
    img("07_p07_1.jpg", 2, "bibleo.ai"),
    img("07_p09_1.jpg", 3, "bibleworld.ai"),
    img("07_p12_1.jpg", 4, "bible.art"),
    img("07_p15_1.jpg", 5, "openthebible.tistory.com"),
    img("07_p18_1.jpg", 6, "bible.art"),
  ],
  "joseph-from-the-pit-to-the-palace": [
    img("08_p01_1.jpg", null, "universtorah.com", true),
    img("08_p02_1.jpg", 1, "bible.art"),
    img("08_p05_1.jpg", 2, "bibleworld.ai"),
    img("08_p08_1.jpg", 3, "bible.art"),
    img("08_p11_1.jpg", 4, "pl.gospelimages.com"),
    img("08_p14_1.jpg", 5, "apologeticsark.com"),
    img("08_p17_1.jpg", 6, "start2finish.substack.com"),
    img("08_p21_1.jpg", 7, "bible.art"),
  ],
  "moses-and-the-exodus": [
    img("09_p01_1.jpg", null, "bible.art", true),
    img("09_p02_1.jpg", 1, "wol.jw.org"),
    img("09_p04_1.jpg", 2, "hnaftali.com"),
    img("09_p06_1.jpg", 3, "bible.art"),
    img("09_p09_1.jpg", 4, "apologeticsark.com"),
    img("09_p12_1.jpg", 5, "bible.art"),
    img("09_p14_1.jpg", 6, "hebroni.com"),
    img("09_p17_1.jpg", 7, "watermarkwaves.com"),
  ],
  "israel-in-the-wilderness": [
    img("10_p01_1.jpg", null, "bible.art", true),
    img("10_p02_1.jpg", 1, "bible.art"),
    img("10_p04_1.jpg", 2, "sacrilo.com"),
    img("10_p06_1.jpg", 3, "apologeticsark.com"),
    img("10_p08_1.jpg", 4),
    img("10_p11_1.jpg", 5, "shawnshashidharan.substack.com"),
    img("10_p13_1.jpg", 6, "hidabroot.org"),
  ],
};
