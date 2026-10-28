import { Router } from "express";
import { verifyCaller } from "../lib/supabase";
import { getLearningOverview } from "../lib/learningCentre";

// Learning Centre — the signed-in learner's Comprehensive Checks across
// Kingdom School, Kingdom Stories, Family Circle and Church (read-only; see
// lib/learningCentre.ts). Only ever the caller's own work.
const router = Router();

// GET /learning/centre/overview → { toDo, awaitingReview, feedback, toReview }
router.get("/overview", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  try {
    return res.json(await getLearningOverview(userId));
  } catch {
    return res.status(500).json({ error: "Couldn't load your learning. Please try again." });
  }
});

export default router;
