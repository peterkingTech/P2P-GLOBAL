// Kingdom Stories category & topic catalogue — the source for migration
// 210's idempotent seed (scripts/kingdom-stories/build-seed.mjs) and for the
// catalogue tests. After seeding, the DATABASE is the source of truth: every
// category and topic is editable in the admin without code changes.
//
// Integrity rules (see the brief): titles exactly as approved; no invented
// facts. Historical period, region and key people are left EMPTY (marked for
// research) — not guessed. Research notes are given only where they are
// certain: the Scripture passages a biblical topic is drawn from. Everything
// is seeded with status "topic" (catalogued, not drafted) and never published.
//
// `existing: true` marks one of migration 152's 13 original categories that is
// the direct equivalent: it keeps its id and slug (links stay valid) and gets
// the new name, description and order — nothing is duplicated.
// Priority: P1 foundational (develop first) · P2 major historical ·
// P3 regional/specialised · P4 future expansion. A priority is a production
// order only — never a judgement of spiritual importance.

const t = (title, priority, notes) => ({ title, ...(priority ? { priority } : {}), ...(notes ? { notes } : {}) });
const scripture = (refs) => `Scripture: ${refs}. Verify wording in a licensed translation before writing.`;

export const CATEGORIES = [
  {
    slug: "biblical-history", title: "Biblical History", icon: "book-outline", defaultPriority: "P2",
    description: "Narratives about people, events, nations, and turning points recorded in the Bible.",
    topics: [
      t("Creation and the Beginning of Humanity", "P1", scripture("Genesis 1–2")),
      t("Noah and the Flood", null, scripture("Genesis 6–9")),
      t("Abraham and the Covenant", "P1", scripture("Genesis 12–22 (esp. 12:1–3; 15; 17)")),
      t("Isaac and the Continuation of the Promise", null, scripture("Genesis 21–28")),
      t("Jacob and Esau", null, scripture("Genesis 25–33")),
      t("Joseph: From the Pit to the Palace", null, scripture("Genesis 37–50")),
      t("Moses and the Exodus", "P1", scripture("Exodus 1–15")),
      t("The Ten Plagues of Egypt", null, scripture("Exodus 7–12")),
      t("Crossing the Red Sea", null, scripture("Exodus 13:17–15:21")),
      t("Israel in the Wilderness", null, scripture("Exodus 15:22–18; Numbers 10–36; Deuteronomy 1–3")),
      t("Joshua and the Entry into Canaan", null, scripture("Joshua 1–12")),
      t("Deborah and Barak", null, scripture("Judges 4–5")),
      t("Gideon and the Midianites", null, scripture("Judges 6–8")),
      t("Samuel, Saul, and the Beginning of Israel's Monarchy", null, scripture("1 Samuel 1–15")),
      t("David: From Shepherd to King", "P1", scripture("1 Samuel 16–31; 2 Samuel 1–5")),
      t("Solomon and the Kingdom of Israel", null, scripture("1 Kings 1–11; 2 Chronicles 1–9")),
      t("The Divided Kingdom", null, scripture("1 Kings 12 onward; 2 Kings; 2 Chronicles 10–36")),
      t("Elijah and the Prophets of Israel", null, scripture("1 Kings 17–19, 21; 2 Kings 1–2")),
      t("The Babylonian Exile", null, scripture("2 Kings 24–25; Jeremiah 39–52; Psalm 137")),
      t("Daniel in Babylon", null, scripture("Daniel 1–6")),
      t("Esther and the Persian Court", null, scripture("Esther 1–10")),
      t("Nehemiah Rebuilds Jerusalem", null, scripture("Nehemiah 1–13")),
      t("Ezra and the Restoration of the Community", null, scripture("Ezra 1–10")),
    ],
  },
  {
    slug: "jesus-christ", title: "Jesus Christ", icon: "heart-outline", defaultPriority: "P2",
    description: "Stories centred on Jesus' life, ministry, teachings, death, resurrection, and ascension.",
    topics: [
      t("The Birth of Jesus", "P1", scripture("Matthew 1:18–2:12; Luke 1–2:20")),
      t("The Flight into Egypt", null, scripture("Matthew 2:13–23")),
      t("The Boy Jesus in the Temple", null, scripture("Luke 2:41–52")),
      t("The Baptism of Jesus", "P1", scripture("Matthew 3:13–17; Mark 1:9–11; Luke 3:21–22; John 1:29–34")),
      t("The Temptation in the Wilderness", null, scripture("Matthew 4:1–11; Mark 1:12–13; Luke 4:1–13")),
      t("The Calling of the Disciples", "P1", scripture("Matthew 4:18–22; Mark 1:16–20; Luke 5:1–11; John 1:35–51")),
      t("Jesus and the Samaritan Woman", null, scripture("John 4:1–42")),
      t("Jesus Heals the Paralytic", null, scripture("Mark 2:1–12; Matthew 9:1–8; Luke 5:17–26")),
      t("Jesus Calms the Storm", null, scripture("Mark 4:35–41; Matthew 8:23–27; Luke 8:22–25")),
      t("The Feeding of the Five Thousand", null, scripture("Matthew 14:13–21; Mark 6:30–44; Luke 9:10–17; John 6:1–15")),
      t("Jesus Walks on Water", null, scripture("Matthew 14:22–33; Mark 6:45–52; John 6:16–21")),
      t("The Good Samaritan", null, scripture("Luke 10:25–37")),
      t("The Prodigal Son", null, scripture("Luke 15:11–32")),
      t("Jesus and Zacchaeus", null, scripture("Luke 19:1–10")),
      t("The Transfiguration", null, scripture("Matthew 17:1–13; Mark 9:2–13; Luke 9:28–36")),
      t("The Raising of Lazarus", null, scripture("John 11:1–44")),
      t("The Triumphal Entry into Jerusalem", null, scripture("Matthew 21:1–11; Mark 11:1–11; Luke 19:28–44; John 12:12–19")),
      t("The Last Supper", "P1", scripture("Matthew 26:17–30; Mark 14:12–26; Luke 22:7–38; John 13–17")),
      t("Jesus in Gethsemane", null, scripture("Matthew 26:36–46; Mark 14:32–42; Luke 22:39–46")),
      t("The Trial of Jesus", null, scripture("Matthew 26:57–27:26; Mark 14:53–15:15; Luke 22:54–23:25; John 18:12–19:16")),
      t("The Crucifixion", "P1", scripture("Matthew 27:27–56; Mark 15:16–41; Luke 23:26–49; John 19:16–37")),
      t("The Resurrection", "P1", scripture("Matthew 28; Mark 16; Luke 24:1–12; John 20; 1 Corinthians 15:3–8")),
      t("The Road to Emmaus", null, scripture("Luke 24:13–35")),
      t("The Great Commission", "P1", scripture("Matthew 28:16–20")),
      t("The Ascension", "P1", scripture("Luke 24:50–53; Acts 1:6–11")),
    ],
  },
  {
    slug: "apostles-early-church", title: "The Apostles & The Early Church", icon: "people-outline", defaultPriority: "P2",
    description: "The apostles, the first Christian communities, and the expansion of the Church in the New Testament period.",
    topics: [
      t("Pentecost and the Coming of the Holy Spirit", "P1", scripture("Acts 2")),
      t("Peter and the Early Jerusalem Church", null, scripture("Acts 1–5")),
      t("Stephen: The First Christian Martyr", null, scripture("Acts 6:8–8:1")),
      t("Philip and the Ethiopian Official", null, scripture("Acts 8:26–40")),
      t("The Conversion of Saul", "P1", scripture("Acts 9:1–31; 22:3–21; 26:9–23; Galatians 1:11–24")),
      t("Peter and Cornelius", null, scripture("Acts 10:1–11:18")),
      t("The Church at Antioch", null, scripture("Acts 11:19–30; 13:1–3")),
      t("Paul's First Missionary Journey", null, scripture("Acts 13–14")),
      t("The Jerusalem Council", null, scripture("Acts 15:1–35; Galatians 2:1–10")),
      t("Paul's Second Missionary Journey", null, scripture("Acts 15:36–18:22")),
      t("Paul in Athens", null, scripture("Acts 17:16–34")),
      t("Paul's Ministry in Ephesus", null, scripture("Acts 19; Ephesians")),
      t("Paul's Arrest in Jerusalem", null, scripture("Acts 21:17–23:35")),
      t("Paul's Journey to Rome", null, scripture("Acts 27–28")),
      t("Priscilla and Aquila", null, scripture("Acts 18; Romans 16:3–5; 1 Corinthians 16:19; 2 Timothy 4:19")),
      t("Lydia and the Church at Philippi", null, scripture("Acts 16:11–15, 40; Philippians")),
      t("The Philippian Jailer", null, scripture("Acts 16:16–40")),
      t("The Early Christian Communities", null, scripture("Acts 2:42–47; 4:32–37; the New Testament letters")),
      t("The Churches Addressed in Revelation", null, scripture("Revelation 1–3")),
      t("The Spread of Christianity Beyond Jerusalem", "P1", scripture("Acts 1:8; 8–12")),
    ],
  },
  {
    slug: "early-christianity-church-fathers", title: "Early Christianity & The Church Fathers", icon: "library-outline", defaultPriority: "P2",
    description: "Early Christian leaders, teachers, writings, communities, and theological developments.",
    topics: [
      t("Polycarp: The Bishop Who Refused to Deny Jesus"), t("Ignatius of Antioch and His Journey to Rome"),
      t("Justin Martyr and His Defence of Christianity"), t("Irenaeus of Lyons and Early Christian Teaching"),
      t("Tertullian and Early Christian Apologetics", "P3"), t("Origen of Alexandria", "P3"),
      t("Athanasius and the Defence of Nicene Christianity"), t("Augustine of Hippo: Life and Conversion"),
      t("John Chrysostom and His Preaching"), t("Clement of Alexandria", "P3"),
      t("The Desert Fathers and Mothers"), t("Antony the Great and Early Monasticism", "P3"),
      t("Perpetua and Felicity"), t("Early Christian Worship and Community"),
      t("The Council of Nicaea"), t("The Council of Chalcedon", "P3"),
      t("The Development of Early Christian Creeds"), t("Christian Life in the First Three Centuries"),
    ],
  },
  {
    slug: "african-christianity", title: "African Christianity", icon: "earth-outline", defaultPriority: "P3",
    description: "Christianity in Africa, from ancient Christian communities to contemporary African-led movements.",
    topics: [
      t("Christianity in Roman North Africa", "P2"), t("Augustine of Hippo and North African Christianity"),
      t("Athanasius and the Church of Alexandria"), t("The Early Christian Tradition of Ethiopia", "P2"),
      t("The Kingdom of Aksum and Christianity"), t("The Coptic Christian Tradition of Egypt"),
      t("Christianity in Ancient Nubia"), t("The Ethiopian Orthodox Tewahedo Church"),
      t("Christian Heritage in Egypt"), t("Samuel Ajayi Crowther: From Enslavement to Church Leadership", "P2"),
      t("Mary Slessor and Her Work in Calabar"), t("The Translation of the Bible into African Languages", "P2"),
      t("The East African Revival", "P2"), t("The Growth of Christianity in Nigeria", "P2"),
      t("African Independent Church Movements"), t("African Pentecostal Movements"),
      t("Christianity in Ghana"), t("Christianity in Kenya and Uganda"),
      t("African-Led Missionary Movements"), t("Women Who Shaped African Christianity"),
    ],
  },
  {
    slug: "asian-christianity", title: "Asian Christianity", icon: "earth-outline", defaultPriority: "P3",
    description: "Ancient and modern Christian communities across Asia.",
    topics: [
      t("The Ancient Christian Tradition of India", "P2"), t("Thomas Christian Traditions in India"),
      t("The Church of the East", "P2"), t("Christianity in Ancient Persia"),
      t("Christianity Along the Silk Road"), t("The Story of Christianity in China", "P2"),
      t("Nestorian Christianity and the Xi'an Stele"), t("Matteo Ricci and Christianity in China"),
      t("Christianity in Korea", "P2"), t("The Korean Christian Revival Movements"),
      t("Christianity in Japan"), t("The Hidden Christians of Japan"),
      t("Christianity in the Philippines"), t("Christianity in Indonesia"),
      t("Christianity in Vietnam"), t("Christianity in Myanmar"),
      t("Christianity in Sri Lanka"), t("Asian Christian Missionaries and Theologians"),
      t("Christian Communities in the Middle East"), t("Modern Asian Christian Movements"),
    ],
  },
  {
    slug: "european-christianity", title: "European Christianity", icon: "earth-outline", defaultPriority: "P3",
    description: "The history and development of Christianity across Europe.",
    topics: [
      t("Christianity in the Roman Empire", "P2"), t("Constantine and the Legalisation of Christianity", "P2"),
      t("The Spread of Christianity in Ireland"), t("Patrick and the Christian Tradition of Ireland"),
      t("Christianity in Anglo-Saxon England"), t("Augustine of Canterbury and the Mission to England"),
      t("Boniface and Christianity in Central Europe"), t("Cyril and Methodius and Slavic Christianity"),
      t("Medieval Monasteries and Christian Learning"), t("The Rise of Medieval Universities", "P4"),
      t("The Great Schism of 1054"), t("Christianity in Medieval Scandinavia", "P4"),
      t("The Crusades: History, Causes, and Consequences"), t("Christianity During the Enlightenment"),
      t("Christianity Under Communist Rule in Europe"), t("The History of Christianity in Germany", "P4"),
      t("The History of Christianity in France", "P4"), t("Orthodox Christianity in Eastern Europe"),
      t("Christianity in Modern Europe"),
    ],
  },
  {
    slug: "christianity-in-the-americas", title: "Christianity in the Americas", icon: "earth-outline", defaultPriority: "P3",
    description: "Christian history in North, Central, and South America and the Caribbean.",
    topics: [
      t("The Arrival of Christianity in the Americas"), t("Christianity and Indigenous Peoples"),
      t("The First Great Awakening", "P2"), t("The Second Great Awakening"),
      t("The History of Black Christianity in America", "P2"), t("Black Churches and the Abolitionist Movement"),
      t("Christian Communities and the Civil Rights Movement"), t("The Azusa Street Revival", "P2"),
      t("William Seymour and the Pentecostal Movement"), t("Christianity in Latin America"),
      t("Christian History in the Caribbean"), t("Christianity in Brazil"),
      t("Christianity in Mexico"), t("Christian Communities in the Caribbean Diaspora", "P4"),
      t("Indigenous Christian Leaders in the Americas"), t("Christianity and the History of Slavery"),
      t("The Growth of Evangelical Christianity in the Americas"), t("Latin American Pentecostal Movements"),
    ],
  },
  {
    slug: "reformation", title: "The Reformation", icon: "document-text-outline", defaultPriority: "P2",
    description: "Reform movements that transformed Western Christianity and their historical consequences.",
    topics: [
      t("John Wycliffe and the English Reform Movement"), t("Jan Hus and His Challenge to Church Authorities"),
      t("Martin Luther: The Monk Who Challenged an Empire"), t("The Ninety-five Theses"),
      t("William Tyndale and Bible Translation"), t("Huldrych Zwingli and the Swiss Reformation", "P3"),
      t("John Calvin and the Reformation in Geneva"), t("The Anabaptist Movement"),
      t("Menno Simons and the Mennonite Tradition", "P3"), t("The English Reformation"),
      t("The Scottish Reformation and John Knox", "P3"), t("The Catholic Reformation"),
      t("The Council of Trent", "P3"), t("The Protestant Reformation and Bible Distribution"),
      t("The Reformation and the Printing Press"), t("The Religious Conflicts of Reformation Europe", "P3"),
      t("The Development of Protestant Traditions", "P3"), t("The Long-Term Effects of the Reformation", "P3"),
    ],
  },
  {
    slug: "scripture", title: "Bible History & Translation", icon: "book-outline", defaultPriority: "P2", existing: true,
    description: "The transmission, translation, printing, and distribution of biblical texts.",
    topics: [
      t("The Formation and Transmission of the Hebrew Scriptures"), t("The Septuagint: The Hebrew Scriptures in Greek"),
      t("The Dead Sea Scrolls and Biblical Manuscripts"), t("Early New Testament Manuscripts"),
      t("Codex Sinaiticus", "P3"), t("Codex Vaticanus", "P3"),
      t("Jerome and the Latin Vulgate"), t("Medieval Bible Manuscripts", "P3"),
      t("The Gutenberg Bible"), t("William Tyndale's English New Testament"),
      t("Martin Luther's German Bible"), t("The King James Version"),
      t("The History of the Bible in African Languages"), t("The Bible in Asian Languages", "P3"),
      t("The Work of Bible Societies", "P3"), t("Bible Translation in Indigenous Languages", "P3"),
      t("Modern Bible Translation Methods", "P3"), t("Audio Bibles and Digital Scripture Access", "P4"),
      t("The History of Braille Bibles", "P4"), t("The Global Distribution of Scripture", "P3"),
    ],
  },
  {
    slug: "missions", title: "Missionaries & Mission Movements", icon: "airplane-outline", defaultPriority: "P2", existing: true,
    description: "People and communities sharing the Christian faith across geographic, cultural, and social boundaries.",
    topics: [
      t("William Carey and the Mission to India"), t("Adoniram and Ann Judson in Burma"),
      t("Hudson Taylor and the China Inland Mission"), t("Mary Slessor in Calabar"),
      t("David Livingstone in Africa"), t("The Moravian Missionary Movement"),
      t("The Cambridge Seven", "P3"), t("Amy Carmichael in India"),
      t("Lottie Moon and Missions in China"), t("Samuel Ajayi Crowther and African Christian Leadership"),
      t("The Early Christian Mission to Armenia", "P3"), t("The Mission of Cyril and Methodius", "P3"),
      t("Christian Missions in Korea", "P3"), t("Christian Missions in the Pacific Islands", "P3"),
      t("Indigenous Missionaries and Local Church Leaders"), t("Women in Mission History"),
      t("Medical and Educational Missions", "P3"), t("Bible Translation Mission Movements", "P3"),
      t("The Development of Modern Global Missions", "P3"), t("Missionary Cooperation Across Cultures", "P4"),
    ],
  },
  {
    slug: "revival", title: "Revivals & Spiritual Awakenings", icon: "flame-outline", defaultPriority: "P2", existing: true,
    description: "Historical movements associated with renewed prayer, repentance, evangelism, and spiritual life.",
    topics: [
      t("The First Great Awakening"), t("The Second Great Awakening"),
      t("The Welsh Revival of 1904–1905"), t("The East African Revival"),
      t("The Azusa Street Revival"), t("The Hebrides Revival", "P3"),
      t("The Moravian Prayer Movement"), t("The Korean Revival of 1907"),
      t("Revival Movements in China", "P3"), t("The Indonesian Revival Movements", "P3"),
      t("The Jesus Movement", "P3"), t("The Development of Pentecostal Christianity"),
      t("The Charismatic Renewal", "P3"), t("The Cane Ridge Revival", "P3"),
      t("The Prayer Meetings Associated with the 1857–1858 Revival", "P3"), t("Student Mission and Prayer Movements", "P3"),
      t("African Revival Movements"), t("Revival and Social Change", "P3"),
      t("Local Church Renewal Movements", "P4"),
    ],
  },
  {
    slug: "persecution", title: "Christian Persecution & Martyrdom", icon: "shield-outline", defaultPriority: "P2", existing: true,
    description: "Documented accounts of Christians who experienced persecution, imprisonment, or death for their faith.",
    topics: [
      t("Stephen: The First Christian Martyr", null, scripture("Acts 6:8–8:1")),
      t("Polycarp of Smyrna"), t("Ignatius of Antioch"),
      t("Persecution Under the Roman Empire"), t("Perpetua and Felicity"),
      t("The Great Persecution Under Diocletian"), t("The Martyrs of Lyon", "P3"),
      t("Christian Persecution in Ancient Persia", "P3"), t("Thomas More and Religious Conflict in Tudor England", "P3"),
      t("Anabaptist Persecution in Reformation Europe", "P3"), t("Christians Under Nazi Rule"),
      t("Dietrich Bonhoeffer and Resistance to Nazism"), t("Richard Wurmbrand and Persecution Under Communism"),
      t("Christian Communities Under Communist Governments", "P3"), t("The Martyrs of Uganda"),
      t("Christian Persecution in the Modern World"), t("Christians Displaced by Religious Violence", "P3"),
      t("The Church and Prison Ministry", "P4"), t("Stories of Courage Under Religious Oppression", "P3"),
    ],
  },
  {
    slug: "people", title: "Christian Leaders & Teachers", icon: "person-outline", defaultPriority: "P2", existing: true,
    description: "Biographies of Christian leaders, theologians, teachers, pastors, and reformers with historical significance.",
    topics: [
      t("Augustine of Hippo"), t("Athanasius of Alexandria"), t("John Chrysostom"), t("Martin Luther"), t("John Calvin"),
      t("John Wesley"), t("George Whitefield"), t("Jonathan Edwards"), t("William Wilberforce"), t("Dietrich Bonhoeffer"),
      t("Desmond Tutu"), t("Samuel Ajayi Crowther"), t("Watchman Nee", "P3"), t("Pandita Ramabai", "P3"), t("Corrie ten Boom"),
      t("Charles Spurgeon"), t("Charles Finney", "P3"), t("Fanny Crosby and Her Christian Influence", "P3"),
      t("Christian Leaders Who Shaped Global Missions", "P3"), t("Women Who Influenced Christian Theology and Education", "P3"),
    ],
  },
  {
    slug: "women-of-faith", title: "Women of Faith", icon: "rose-outline", defaultPriority: "P2",
    description: "Women whose faith, leadership, scholarship, courage, service, or missionary work shaped Christian history.",
    topics: [
      t("Mary, the Mother of Jesus", null, scripture("Luke 1–2; John 2:1–11; 19:25–27; Acts 1:14")),
      t("Mary Magdalene", null, scripture("Luke 8:1–3; Mark 15:40–16:11; John 20:1–18")),
      t("Priscilla and Her Role in the Early Church", null, scripture("Acts 18; Romans 16:3–5")),
      t("Phoebe and Early Christian Service", null, scripture("Romans 16:1–2")),
      t("Perpetua and Felicity"), t("Macrina the Younger", "P3"), t("Hildegard of Bingen", "P3"),
      t("Teresa of Ávila", "P3"), t("Catherine of Siena", "P3"), t("Ann Judson"), t("Mary Slessor"), t("Amy Carmichael"),
      t("Corrie ten Boom"), t("Pandita Ramabai"), t("Lottie Moon"), t("Fanny Crosby", "P3"), t("Gladys Aylward"),
      t("Katharina von Bora and the Reformation", "P3"), t("Women in the East African Revival", "P3"),
      t("Women in African Christian Leadership"),
    ],
  },
  {
    slug: "prayer", title: "Prayer & Intercession", icon: "hand-left-outline", defaultPriority: "P2", existing: true,
    description: "Stories about individuals and communities whose lives and movements were shaped by prayer.",
    topics: [
      t("Hannah's Prayer", null, scripture("1 Samuel 1:1–2:11")),
      t("Daniel's Prayer in Babylon", null, scripture("Daniel 6; 9")),
      t("The Early Church at Prayer", null, scripture("Acts 1:14; 2:42; 4:23–31; 12:5–17")),
      t("Jesus Prays in Gethsemane", null, scripture("Matthew 26:36–46; Mark 14:32–42; Luke 22:39–46")),
      t("George Müller and the Orphanages of Bristol"), t("The Moravian Prayer Watch"),
      t("The Prayer Movement Before the Welsh Revival", "P3"), t("Prayer and the East African Revival", "P3"),
      t("Prayer Meetings During the 1857–1858 Revival", "P3"), t("Missionary Prayer Networks", "P3"),
      t("Prayer and Christian Communities Under Persecution"), t("The Role of Prayer in the Early Methodist Movement", "P3"),
      t("The Prayer Life of Historical Christian Leaders", "P3"), t("Communities United in Prayer During Crisis", "P3"),
      t("Historical Accounts of Corporate Intercession", "P3"), t("Prayer and Reconciliation in Church History", "P3"),
    ],
  },
  {
    slug: "discipleship", title: "Discipleship & Spiritual Formation", icon: "school-outline", defaultPriority: "P2", existing: true,
    description: "Stories about following Jesus, developing Christian character, mentoring others, and building communities of disciples.",
    topics: [
      t("Jesus and the Training of the Twelve", "P1", scripture("Mark 3:13–19; 6:7–13; Matthew 10; Luke 9:1–6")),
      t("Paul and Timothy: Passing Faith to the Next Generation", "P1", scripture("Acts 16:1–5; 1 and 2 Timothy")),
      t("Barnabas: The Encourager", null, scripture("Acts 4:36–37; 9:27; 11:22–26; 13–15")),
      t("Priscilla and Aquila Mentoring Apollos", null, scripture("Acts 18:24–28")),
      t("The Early Church's Pattern of Shared Learning", null, scripture("Acts 2:42–47")),
      t("The Desert Fathers and Spiritual Formation", "P3"), t("Benedict of Nursia and Monastic Life", "P3"),
      t("John Wesley and the Class Meetings"), t("Christian Catechesis in the Early Church", "P3"),
      t("The Development of Christian Discipleship Communities"), t("Missionary Mentorship Across Generations", "P3"),
      t("Christian Education and Spiritual Formation", "P3"), t("Stories of Reconciliation and Restoration"),
      t("Discipleship in African Christian Communities"), t("Small Groups in Christian History"),
      t("Mentoring and Leadership Development in the Church"),
    ],
  },
  {
    slug: "christianity-and-social-justice", title: "Christianity & Social Justice", icon: "scale-outline", defaultPriority: "P3",
    description: "Historical stories about Christian involvement in confronting injustice, poverty, discrimination, and social vulnerability.",
    topics: [
      t("William Wilberforce and the Campaign Against the Slave Trade", "P2"), t("Olaudah Equiano and Christian Abolitionism", "P2"),
      t("Black Christian Abolitionists"), t("The Underground Railroad and Christian Communities"),
      t("Christian Leaders in the Civil Rights Movement", "P2"), t("Martin Luther King Jr. and the Black Church", "P2"),
      t("Desmond Tutu and the Struggle Against Apartheid", "P2"), t("Christian Responses to Poverty"),
      t("Christian Refugee Assistance Throughout History"), t("The History of Christian Hospitals"),
      t("Christian Involvement in Prison Reform", "P4"), t("Christian Education and Literacy Movements"),
      t("Christian Responses to Human Trafficking"), t("Faith Communities and Reconciliation After Conflict"),
      t("Christians Who Protected Vulnerable People During War"), t("Christian Humanitarian Relief After Natural Disasters", "P4"),
      t("Christian Responses to Racial Discrimination"), t("The Role of Local Churches in Community Development", "P4"),
    ],
  },
  {
    slug: "courageous-witnesses", title: "Christian Martyrs, Heroes & Courageous Witnesses", icon: "star-outline", defaultPriority: "P3",
    description: "Documented stories of Christians whose courage, integrity, sacrifice, or service made a historical impact, including people who survived persecution.",
    topics: [
      t("Corrie ten Boom and Her Work During the Holocaust", "P2"), t("Dietrich Bonhoeffer and Resistance to Nazism", "P2"),
      t("André and Magda Trocmé and Le Chambon-sur-Lignon"), t("Irena Sendler and the Rescue of Jewish Children"),
      t("Christians Who Protected Others During the Holocaust"), t("Oscar Schindler and the Historical Context of Christian Rescue Efforts", "P4"),
      t("Richard Wurmbrand and His Testimony"), t("Christians Who Opposed Racial Injustice"),
      t("Christian Leaders Who Resisted Unjust Laws"), t("Missionaries Who Served During Epidemics"),
      t("Christian Humanitarians in Conflict Zones", "P4"), t("Stories of Forgiveness After Violence"),
      t("Christians Who Risked Their Careers for Their Convictions", "P4"), t("Courageous Christian Witnesses in Modern History"),
      t("Christians Who Helped Refugees Escape Persecution"),
    ],
  },
  {
    slug: "church-movements", title: "Church Councils, Denominations & Movements", icon: "git-network-outline", defaultPriority: "P3", existing: true,
    description: "Historical accounts of church councils, theological controversies, denominations, and movements.",
    topics: [
      t("The Council of Nicaea", "P2"), t("The Council of Constantinople"), t("The Council of Ephesus"), t("The Council of Chalcedon", "P2"),
      t("The Great Schism of 1054", "P2"), t("The Protestant Reformation", "P2"), t("The Anabaptist Movement"),
      t("The Birth of Methodism"), t("The Development of the Baptist Movement"), t("The History of Anglican Christianity"),
      t("The Development of Orthodox Christianity"), t("The Catholic Reformation"), t("The Rise of Pentecostal Christianity"),
      t("The Charismatic Renewal"), t("The Salvation Army"), t("The Seventh-day Adventist Movement", "P4"),
      t("The Ecumenical Movement"), t("The World Council of Churches", "P4"), t("The Development of African Independent Churches"),
      t("The Growth of Modern Evangelical Movements"),
    ],
  },
  {
    slug: "culture-and-civilisation", title: "Christianity, Culture & Civilisation", icon: "color-palette-outline", defaultPriority: "P3",
    description: "Stories about Christianity's historical relationship with education, literature, music, art, institutions, science, and cultural exchange.",
    topics: [
      t("Christian Monasteries and the Preservation of Manuscripts"), t("The Development of Medieval Universities"),
      t("Christianity and the History of Hospitals"), t("The Gutenberg Printing Revolution and Scripture"),
      t("The History of Christian Sacred Music"), t("The Development of Christian Hymnody"),
      t("The Story of Christian Art", "P4"), t("The Architecture of Ancient Churches", "P4"),
      t("Christianity and the Development of Literacy"), t("Christianity and the History of Education in Africa"),
      t("Christian Literature and Publishing", "P4"), t("The History of Christian Universities", "P4"),
      t("Christian Traditions and Scientific History"), t("Christianity and the Preservation of Ancient Texts"),
      t("Christianity and Cultural Exchange Along the Silk Road", "P4"), t("Christian Architecture in Ethiopia", "P4"),
      t("The History of Christian Education in Asia", "P4"), t("Christianity and the Development of Braille Scripture", "P4"),
    ],
  },
  {
    slug: "christianity-today", title: "Christianity in the Modern World", icon: "globe-outline", defaultPriority: "P3", existing: true,
    description: "Stories about Christianity from the modern period to the present, including global developments and contemporary communities.",
    topics: [
      t("Christianity in the Twentieth Century"), t("The Global Growth of Christianity", "P2"),
      t("The Expansion of Pentecostal Christianity"), t("Christianity Under Communist Rule"),
      t("The Growth of Christianity in Sub-Saharan Africa", "P2"), t("Christianity in Modern China"),
      t("Christianity in Modern Korea"), t("Christianity in Contemporary Latin America"),
      t("Christian Communities in Multicultural Europe", "P4"), t("Christianity and Migration"),
      t("The Development of Modern Christian Humanitarian Organisations", "P4"), t("Digital Bible Distribution", "P4"),
      t("The History of Christian Radio Broadcasting", "P4"), t("Christian Television and Global Communication", "P4"),
      t("Online Christian Communities and Discipleship"), t("Contemporary Christian Education Movements", "P4"),
      t("Christian Responses to Secularisation"), t("Christian Communities in Modern Conflict Zones"),
      t("Modern Interdenominational Cooperation", "P4"),
    ],
  },
  {
    slug: "archaeology-discoveries", title: "Archaeology, Discoveries & Historical Evidence", icon: "search-outline", defaultPriority: "P3",
    description: "Archaeological discoveries, manuscripts, inscriptions, and material evidence that illuminate biblical and Christian history.",
    topics: [
      t("The Dead Sea Scrolls", "P2"), t("The Rosetta Stone and the Study of the Ancient World", "P4"),
      t("The Archaeology of Ancient Ephesus"), t("The Historical City of Smyrna"),
      t("The Pool of Siloam", null, scripture("John 9:1–11")), t("The Pilate Stone"),
      t("The Arch of Titus and Historical Evidence"), t("Early Christian Catacombs in Rome"),
      t("Ancient Christian Inscriptions", "P4"), t("Codex Sinaiticus"), t("Codex Vaticanus"),
      t("The Rylands Library Papyrus P52", "P2"), t("Archaeological Research in Ancient Jerusalem"),
      t("The Archaeology of Corinth"), t("The Ancient City of Antioch"),
      t("Early Christian Worship Sites"), t("Archaeological Discoveries in Ancient Egypt", "P4"),
      t("Historical Evidence for Early Christian Communities", "P2"), t("Christian Artefacts and Their Historical Context", "P4"),
      t("How Historians Evaluate Archaeological Evidence", "P2"),
    ],
  },
  {
    slug: "places", title: "Places, Pilgrimages & Sacred Sites", icon: "location-outline", defaultPriority: "P3", existing: true,
    description: "Places associated with biblical narratives, Christian history, pilgrimage, and the development of Christian communities.",
    topics: [
      t("Jerusalem: The City at the Centre of Biblical History", "P2"),
      t("Bethlehem and the Birth of Jesus", "P2", scripture("Micah 5:2; Matthew 2; Luke 2")),
      t("Nazareth and the Early Life of Jesus", "P2", scripture("Luke 1:26; 2:39–52; 4:16–30")),
      t("Antioch: A Centre of Early Christianity", null, scripture("Acts 11:19–30; 13:1–3")),
      t("Ephesus and the Early Church", null, scripture("Acts 18–20; Revelation 2:1–7")),
      t("Smyrna and the Story of Polycarp", null, scripture("Revelation 2:8–11")),
      t("Alexandria and Ancient Christianity"), t("Rome and the Early Christian Community"),
      t("Constantinople and Eastern Christianity"), t("Aksum and Ethiopian Christianity"),
      t("Canterbury and the English Church", "P4"), t("Wittenberg and the Reformation"),
      t("Geneva and the Reformation", "P4"), t("Herrnhut and the Moravian Movement"),
      t("Azusa Street and Pentecostal History"), t("Iona and Celtic Christian Tradition", "P4"),
      t("The Monasteries of Mount Athos", "P4"), t("Lalibela and Ethiopian Rock-Hewn Churches"),
      t("Historic Christian Sites in India"), t("Historic Churches of the Middle East"),
    ],
  },
];

/** migration 152's original categories with no direct equivalent: set inactive (never deleted) when they hold no stories. */
export const RETIRED_ORIGINAL_SLUGS = ["christian-history", "the-church", "global-church"];
/** Original titles of the mapped rows: a mapped row is only relabelled while it still carries its original title. */
export const ORIGINAL_TITLES = {
  scripture: "Scripture", missions: "Missions", revival: "Revival", persecution: "Persecution", people: "People",
  prayer: "Prayer", discipleship: "Discipleship", "church-movements": "Church Movements",
  "christianity-today": "Christianity Today", places: "Places",
};

export function slugify(s) {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/['’]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
}

const STOP = new Set(["the", "and", "of", "in", "a", "an", "to", "his", "her", "their", "its", "from", "on", "at", "for", "with", "by",
  "history", "story", "christian", "christianity", "christians", "church", "churches", "movement", "movements", "work", "role",
  "early", "development", "growth", "modern", "tradition", "traditions", "life", "rise", "who", "under", "during", "after"]);
const tokens = (title) => new Set(slugify(title).split("-").filter((w) => w.length > 2 && !STOP.has(w)));
const ORDINALS = ["first", "second", "third"];
/** Different people whose names nest. */
const DISTINCT = [["Martin Luther", "Martin Luther King Jr. and the Black Church"]];

/** Same subject in different words (a word rule can't see these). */
const SAME = [
  ["Polycarp: The Bishop Who Refused to Deny Jesus", "Polycarp of Smyrna", "Smyrna and the Story of Polycarp"],
  ["Richard Wurmbrand and His Testimony", "Richard Wurmbrand and Persecution Under Communism"],
  ["Cyril and Methodius and Slavic Christianity", "The Mission of Cyril and Methodius"],
  ["The Desert Fathers and Mothers", "The Desert Fathers and Spiritual Formation"],
  ["William Tyndale and Bible Translation", "William Tyndale's English New Testament"],
];

/** Same subject: identical titles, or all of one title's distinctive words (at least two) appear in the other (e.g. "Lottie Moon" ⊂ "Lottie Moon and Missions in China"). */
function overlaps(titleA, ta, titleB, tb) {
  if (slugify(titleA) === slugify(titleB)) return true;
  if (SAME.some((g) => g.includes(titleA) && g.includes(titleB))) return true;
  if (DISTINCT.some(([x, y]) => (x === titleA && y === titleB) || (x === titleB && y === titleA))) return false;
  if (ta.size < 2 || tb.size < 2) return false; // one shared word ("Jesus", "Prayer") is not a shared subject
  const ordA = ORDINALS.filter((o) => ta.has(o)), ordB = ORDINALS.filter((o) => tb.has(o));
  if (ordA.join() !== ordB.join()) return false; // "First" vs "Second" Great Awakening, Paul's journeys
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  return [...small].every((w) => large.has(w));
}

/**
 * Every topic with a unique, stable slug. A topic whose plain slug is already
 * taken by an earlier topic gets the category slug appended. Topics that
 * look like the same subject (identical titles, or the same distinctive
 * words) are flagged with an overlap note naming the other topic(s), for
 * editorial review — nothing is merged automatically.
 */
export function buildTopics() {
  const out = [];
  const used = new Set();
  for (const cat of CATEGORIES) {
    cat.topics.forEach((tp, i) => {
      let slug = slugify(tp.title);
      if (used.has(slug)) slug = `${slug}-${cat.slug}`;
      used.add(slug);
      out.push({
        slug, title: tp.title, categorySlug: cat.slug, categoryTitle: cat.title, displayOrder: i,
        priority: tp.priority ?? cat.defaultPriority, researchNotes: tp.notes ?? null,
        summary: `${tp.title} — a planned Kingdom Story in ${cat.title}. ${cat.description}`,
      });
    });
  }
  for (const a of out) {
    const ta = tokens(a.title);
    const others = out.filter((b) => b !== a && overlaps(a.title, ta, b.title, tokens(b.title)));
    a.overlapNote = others.length
      ? `Possible overlap — also catalogued as: ${others.map((b) => `“${b.title}” (${b.categoryTitle})`).join("; ")}. Keep both only if each has a distinct historical focus; otherwise merge or link after editorial review.`
      : null;
  }
  return out;
}
