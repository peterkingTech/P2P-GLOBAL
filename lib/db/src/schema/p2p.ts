import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";

// ── Enums ────────────────────────────────────────────────────────────────────
export const discipleRoleEnum = pgEnum("disciple_role", [
  "seeker",
  "disciple",
  "mentor",
  "elder",
]);

// ── p2p_profiles ─────────────────────────────────────────────────────────────
export const p2pProfiles = pgTable("p2p_profiles", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name").notNull(),
  email: text("email").notNull(),
  avatarUrl: text("avatar_url"),
  city: text("city"),
  country: text("country"),
  languageCode: text("language_code").notNull().default("en"),
  growthLevel: integer("growth_level").notNull().default(0),
  role: text("role").notNull().default("disciple"),
  gifts: jsonb("gifts").$type<string[]>().notNull().default([]),
  mentorId: uuid("mentor_id"),
  isPraying: boolean("is_praying").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── p2p_curriculums ───────────────────────────────────────────────────────────
export const p2pCurriculums = pgTable("p2p_curriculums", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  isPublished: boolean("is_published").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── p2p_modules ───────────────────────────────────────────────────────────────
export const p2pModules = pgTable("p2p_modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  curriculumId: uuid("curriculum_id"),
  title: text("title").notNull(),
  description: text("description"),
  level: integer("level").notNull().default(1),
  lessonCount: integer("lesson_count").notNull().default(0),
  imageUrl: text("image_url"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── p2p_lessons ───────────────────────────────────────────────────────────────
export const p2pLessons = pgTable("p2p_lessons", {
  id: uuid("id").primaryKey().defaultRandom(),
  moduleId: uuid("module_id"),
  title: text("title").notNull(),
  content: text("content"),
  verseRef: text("verse_ref"),
  verseText: text("verse_text"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── p2p_lesson_progress ────────────────────────────────────────────────────────
export const p2pLessonProgress = pgTable("p2p_lesson_progress", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  lessonId: uuid("lesson_id").notNull(),
  isCompleted: boolean("is_completed").notNull().default(false),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── p2p_prayer_requests ────────────────────────────────────────────────────────
export const p2pPrayerRequests = pgTable("p2p_prayer_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  userName: text("user_name").notNull(),
  nation: text("nation"),
  text: text("text").notNull(),
  prayerCount: integer("prayer_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── p2p_sessions ──────────────────────────────────────────────────────────────
export const p2pSessions = pgTable("p2p_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  hostId: uuid("host_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(45),
  participantCount: integer("participant_count").notNull().default(0),
  isLive: boolean("is_live").notNull().default(false),
  hostName: text("host_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── p2p_discipleship_links ────────────────────────────────────────────────────
export const p2pDiscipleshipLinks = pgTable("p2p_discipleship_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  mentorId: uuid("mentor_id").notNull(),
  discipleId: uuid("disciple_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── p2p_notifications ─────────────────────────────────────────────────────────
export const p2pNotifications = pgTable("p2p_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
