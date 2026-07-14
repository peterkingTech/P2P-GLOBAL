import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  FlatList,
  ActivityIndicator,
  Alert,
  Modal,
  Switch,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { supabase } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

// ── Types ──────────────────────────────────────────────────────────────────────

type ContentTab = "curriculum" | "plans" | "prayer";
type PlanInnerTab = "info" | "teachers" | "content" | "outline" | "questions";
type PlanStatus = "draft" | "published";

type PlanRow = {
  id: string; title: string; tagline: string | null; overview: string | null;
  has_submodules: boolean; status: PlanStatus; created_at: string;
};
type TeacherRow = {
  id: string; plan_id: string; name: string; ministry_or_church: string | null;
  location: string | null; youtube_handle: string | null;
  instagram_handle: string | null; other_social_handle: string | null;
};
type ModuleRow = {
  id: string; plan_id: string; module_number: number; module_title: string; order_index: number;
};
type LessonRow = {
  id: string; plan_id: string; module_id: string | null; lesson_code: string | null;
  title: string; order_index: number; memory_verse_reference: string | null;
  memory_verse_text: string | null; definition_title: string | null; what_is_it: string | null;
  why_heading: string | null; why_text: string | null; to_whom: string | null; notes: string | null;
};
type DQRow = {
  id: string; plan_id: string; question_number: number | null; topic: string | null;
  question_text: string; order_index: number;
};
type QuestionRow = {
  id: string; lesson_id: string; question_text: string; order_index: number;
};
type OutlineRow = {
  id: string; plan_id: string; opening_illustration_title: string | null;
  opening_illustration_text: string | null;
};
type SessionRow = {
  id: string; outline_id: string; session_label: string; summary: string | null; order_index: number;
};
type PrayerPostRow = {
  id: string; user_id: string; post_type: string; body: string; status: string;
  is_anonymous: boolean; created_at: string; user_name?: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function emptyPlanForm() {
  return { title: "", tagline: "", overview: "", has_submodules: true, status: "draft" as PlanStatus };
}
function emptyTeacherForm() {
  return { name: "", ministry_or_church: "", location: "", youtube_handle: "", instagram_handle: "", other_social_handle: "" };
}
function emptyModuleForm() {
  return { module_number: 1, module_title: "", order_index: 0 };
}
function emptyLessonForm(moduleId?: string | null) {
  return {
    lesson_code: "", title: "", order_index: 0, module_id: moduleId ?? null,
    memory_verse_reference: "", memory_verse_text: "",
    definition_title: "", what_is_it: "",
    why_heading: "", why_text: "",
    to_whom: "", notes: "",
  };
}
function emptyDQForm() {
  return { question_number: null as number | null, topic: "", question_text: "", order_index: 0 };
}
function emptyOutlineForm() {
  return { opening_illustration_title: "", opening_illustration_text: "" };
}
function emptySessionForm() {
  return { session_label: "", summary: "", order_index: 0 };
}

// ── FormModal ──────────────────────────────────────────────────────────────────

function FormModal({
  visible, title, onClose, onSave, saving, children,
}: {
  visible: boolean; title: string; onClose: () => void; onSave: () => void;
  saving?: boolean; children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={ms.modalRoot}>
        <View style={ms.modalHeader}>
          <TouchableOpacity onPress={onClose} style={ms.modalCloseBtn}>
            <Ionicons name="close" size={22} color={colors.textDark} />
          </TouchableOpacity>
          <Text style={ms.modalTitle}>{title}</Text>
          <TouchableOpacity onPress={onSave} style={ms.modalSaveBtn} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={ms.modalSaveText}>Save</Text>}
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={ms.modalBody} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Field({
  label, value, onChangeText, multiline = false, placeholder = "", keyboardType,
}: {
  label: string; value: string; onChangeText: (v: string) => void;
  multiline?: boolean; placeholder?: string; keyboardType?: any;
}) {
  return (
    <View style={ms.fieldWrap}>
      <Text style={ms.fieldLabel}>{label}</Text>
      <TextInput
        style={[ms.fieldInput, multiline && ms.fieldMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        multiline={multiline}
        numberOfLines={multiline ? 4 : 1}
        keyboardType={keyboardType}
      />
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ContentManager() {
  const router = useRouter();
  const [tab, setTab] = useState<ContentTab>("plans");

  return (
    <View style={s.root}>
      {/* Sub-tab bar */}
      <View style={s.subTabBar}>
        {(["curriculum", "plans", "prayer"] as ContentTab[]).map((t) => (
          <TouchableOpacity key={t} style={[s.subTab, tab === t && s.subTabActive]} onPress={() => setTab(t)}>
            <Text style={[s.subTabText, tab === t && s.subTabTextActive]}>
              {t === "curriculum" ? "Curriculum" : t === "plans" ? "Plans" : "Prayer & Testimonies"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === "curriculum" && <CurriculumSection router={router} />}
      {tab === "plans" && <PlansSection />}
      {tab === "prayer" && <PrayerSection />}
    </View>
  );
}

// ── CurriculumSection ──────────────────────────────────────────────────────────

function CurriculumSection({ router }: { router: any }) {
  return (
    <View style={s.centeredSection}>
      <Ionicons name="book-outline" size={48} color={colors.accentGreen} />
      <Text style={s.centeredTitle}>Core Curriculum Manager</Text>
      <Text style={s.centeredSub}>Create and edit the 12-module core curriculum, lessons, and translations.</Text>
      <TouchableOpacity style={s.bigBtn} onPress={() => router.push("/admin/curriculum")}>
        <Ionicons name="arrow-forward-circle" size={20} color="#fff" />
        <Text style={s.bigBtnText}>Open Curriculum Manager</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── PlansSection ───────────────────────────────────────────────────────────────

function PlansSection() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanRow | null>(null);
  const [planInnerTab, setPlanInnerTab] = useState<PlanInnerTab>("info");

  // Plan detail data
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [dqs, setDqs] = useState<DQRow[]>([]);
  const [outline, setOutline] = useState<OutlineRow | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  // Modals
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showTeacherModal, setShowTeacherModal] = useState(false);
  const [showModuleModal, setShowModuleModal] = useState(false);
  const [showLessonModal, setShowLessonModal] = useState(false);
  const [showDQModal, setShowDQModal] = useState(false);
  const [showOutlineModal, setShowOutlineModal] = useState(false);
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [showQuestionsModal, setShowQuestionsModal] = useState(false);

  // Editing targets
  const [editingTeacher, setEditingTeacher] = useState<TeacherRow | null>(null);
  const [editingModule, setEditingModule] = useState<ModuleRow | null>(null);
  const [editingLesson, setEditingLesson] = useState<LessonRow | null>(null);
  const [editingDQ, setEditingDQ] = useState<DQRow | null>(null);
  const [editingSession, setEditingSession] = useState<SessionRow | null>(null);
  const [questionsLesson, setQuestionsLesson] = useState<LessonRow | null>(null);

  // Form state
  const [planForm, setPlanForm] = useState(emptyPlanForm());
  const [teacherForm, setTeacherForm] = useState(emptyTeacherForm());
  const [moduleForm, setModuleForm] = useState(emptyModuleForm());
  const [lessonForm, setLessonForm] = useState(emptyLessonForm());
  const [dqForm, setDqForm] = useState(emptyDQForm());
  const [outlineForm, setOutlineForm] = useState(emptyOutlineForm());
  const [sessionForm, setSessionForm] = useState(emptySessionForm());

  // Questions for a lesson
  const [reflections, setReflections] = useState<QuestionRow[]>([]);
  const [assignments, setAssignments] = useState<QuestionRow[]>([]);
  const [newReflection, setNewReflection] = useState("");
  const [newAssignment, setNewAssignment] = useState("");

  const [saving, setSaving] = useState(false);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("p2p_plans")
      .select("id,title,tagline,overview,has_submodules,status,created_at")
      .order("created_at", { ascending: false });
    setPlans((data ?? []) as PlanRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { loadPlans(); }, [loadPlans]);

  const loadPlanDetail = useCallback(async (planId: string) => {
    const [
      { data: t }, { data: m }, { data: l }, { data: d },
      { data: o }, { data: se },
    ] = await Promise.all([
      supabase.from("p2p_plan_source_teachers").select("*").eq("plan_id", planId),
      supabase.from("p2p_plan_modules").select("*").eq("plan_id", planId).order("order_index"),
      supabase.from("p2p_plan_lessons").select("*").eq("plan_id", planId).order("order_index"),
      supabase.from("p2p_plan_discussion_questions").select("*").eq("plan_id", planId).order("order_index"),
      supabase.from("p2p_plan_teaching_outlines").select("*").eq("plan_id", planId).maybeSingle(),
      supabase.from("p2p_plan_teaching_sessions").select("*").order("order_index"),
    ]);
    setTeachers((t ?? []) as TeacherRow[]);
    setModules((m ?? []) as ModuleRow[]);
    setLessons((l ?? []) as LessonRow[]);
    setDqs((d ?? []) as DQRow[]);
    setOutline((o as OutlineRow | null) ?? null);
    if (o) {
      setSessions(((se ?? []) as SessionRow[]).filter(s => s.outline_id === (o as OutlineRow).id));
    } else {
      setSessions([]);
    }
  }, []);

  const selectPlan = (plan: PlanRow) => {
    setSelectedPlan(plan);
    setPlanForm({
      title: plan.title,
      tagline: plan.tagline ?? "",
      overview: plan.overview ?? "",
      has_submodules: plan.has_submodules,
      status: plan.status,
    });
    setPlanInnerTab("info");
    loadPlanDetail(plan.id);
  };

  // ── Plan CRUD ──────────────────────────────────────────────────────────────

  const openCreatePlan = () => {
    setEditingLesson(null);
    setPlanForm(emptyPlanForm());
    setShowPlanModal(true);
  };

  const savePlan = async () => {
    if (!planForm.title.trim()) { Alert.alert("Title is required"); return; }
    setSaving(true);
    if (selectedPlan) {
      const { error } = await supabase.from("p2p_plans").update({
        title: planForm.title.trim(),
        tagline: planForm.tagline.trim() || null,
        overview: planForm.overview.trim() || null,
        has_submodules: planForm.has_submodules,
        status: planForm.status,
      }).eq("id", selectedPlan.id);
      if (error) Alert.alert("Error", error.message);
      else {
        const updated = { ...selectedPlan, ...planForm };
        setSelectedPlan(updated);
        setPlans(prev => prev.map(p => p.id === selectedPlan.id ? updated : p));
      }
    } else {
      const { data, error } = await supabase.from("p2p_plans").insert({
        title: planForm.title.trim(),
        tagline: planForm.tagline.trim() || null,
        overview: planForm.overview.trim() || null,
        has_submodules: planForm.has_submodules,
        status: planForm.status,
      }).select().single();
      if (error) Alert.alert("Error", error.message);
      else if (data) {
        setPlans(prev => [data as PlanRow, ...prev]);
        setShowPlanModal(false);
        selectPlan(data as PlanRow);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    setShowPlanModal(false);
  };

  const togglePlanStatus = async (plan: PlanRow) => {
    const newStatus: PlanStatus = plan.status === "published" ? "draft" : "published";
    const { error } = await supabase.from("p2p_plans").update({ status: newStatus }).eq("id", plan.id);
    if (error) { Alert.alert("Error", error.message); return; }
    const updated = { ...plan, status: newStatus };
    setPlans(prev => prev.map(p => p.id === plan.id ? updated : p));
    if (selectedPlan?.id === plan.id) setSelectedPlan(updated);
  };

  const deletePlan = (plan: PlanRow) => {
    Alert.alert("Delete Plan", `Delete "${plan.title}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        const { error } = await supabase.from("p2p_plans").delete().eq("id", plan.id);
        if (error) Alert.alert("Error", error.message);
        else {
          setPlans(prev => prev.filter(p => p.id !== plan.id));
          if (selectedPlan?.id === plan.id) setSelectedPlan(null);
        }
      }},
    ]);
  };

  // ── Teacher CRUD ───────────────────────────────────────────────────────────

  const openAddTeacher = () => { setEditingTeacher(null); setTeacherForm(emptyTeacherForm()); setShowTeacherModal(true); };
  const openEditTeacher = (t: TeacherRow) => {
    setEditingTeacher(t);
    setTeacherForm({ name: t.name, ministry_or_church: t.ministry_or_church ?? "", location: t.location ?? "", youtube_handle: t.youtube_handle ?? "", instagram_handle: t.instagram_handle ?? "", other_social_handle: t.other_social_handle ?? "" });
    setShowTeacherModal(true);
  };

  const saveTeacher = async () => {
    if (!teacherForm.name.trim()) { Alert.alert("Name is required"); return; }
    if (!selectedPlan) return;
    setSaving(true);
    const payload = { name: teacherForm.name.trim(), ministry_or_church: teacherForm.ministry_or_church.trim() || null, location: teacherForm.location.trim() || null, youtube_handle: teacherForm.youtube_handle.trim() || null, instagram_handle: teacherForm.instagram_handle.trim() || null, other_social_handle: teacherForm.other_social_handle.trim() || null };
    if (editingTeacher) {
      const { error } = await supabase.from("p2p_plan_source_teachers").update(payload).eq("id", editingTeacher.id);
      if (error) Alert.alert("Error", error.message);
      else setTeachers(prev => prev.map(t => t.id === editingTeacher.id ? { ...t, ...payload } : t));
    } else {
      const { data, error } = await supabase.from("p2p_plan_source_teachers").insert({ plan_id: selectedPlan.id, ...payload }).select().single();
      if (error) Alert.alert("Error", error.message);
      else setTeachers(prev => [...prev, data as TeacherRow]);
    }
    setSaving(false);
    setShowTeacherModal(false);
  };

  const deleteTeacher = (t: TeacherRow) => {
    Alert.alert("Delete Teacher", `Remove ${t.name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        await supabase.from("p2p_plan_source_teachers").delete().eq("id", t.id);
        setTeachers(prev => prev.filter(x => x.id !== t.id));
      }},
    ]);
  };

  // ── Module CRUD ────────────────────────────────────────────────────────────

  const openAddModule = () => { setEditingModule(null); setModuleForm(emptyModuleForm()); setShowModuleModal(true); };
  const openEditModule = (m: ModuleRow) => {
    setEditingModule(m);
    setModuleForm({ module_number: m.module_number, module_title: m.module_title, order_index: m.order_index });
    setShowModuleModal(true);
  };

  const saveModule = async () => {
    if (!moduleForm.module_title.trim()) { Alert.alert("Title is required"); return; }
    if (!selectedPlan) return;
    setSaving(true);
    const payload = { module_number: moduleForm.module_number, module_title: moduleForm.module_title.trim(), order_index: moduleForm.order_index };
    if (editingModule) {
      const { error } = await supabase.from("p2p_plan_modules").update(payload).eq("id", editingModule.id);
      if (error) Alert.alert("Error", error.message);
      else setModules(prev => prev.map(m => m.id === editingModule.id ? { ...m, ...payload } : m));
    } else {
      const { data, error } = await supabase.from("p2p_plan_modules").insert({ plan_id: selectedPlan.id, ...payload }).select().single();
      if (error) Alert.alert("Error", error.message);
      else setModules(prev => [...prev, data as ModuleRow]);
    }
    setSaving(false);
    setShowModuleModal(false);
  };

  const deleteModule = (m: ModuleRow) => {
    Alert.alert("Delete Module", `Delete "${m.module_title}"? Lessons in this module become unassigned.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        await supabase.from("p2p_plan_modules").delete().eq("id", m.id);
        setModules(prev => prev.filter(x => x.id !== m.id));
      }},
    ]);
  };

  // ── Lesson CRUD ────────────────────────────────────────────────────────────

  const openAddLesson = (moduleId?: string | null) => {
    setEditingLesson(null);
    setLessonForm(emptyLessonForm(moduleId));
    setShowLessonModal(true);
  };
  const openEditLesson = (l: LessonRow) => {
    setEditingLesson(l);
    setLessonForm({ lesson_code: l.lesson_code ?? "", title: l.title, order_index: l.order_index, module_id: l.module_id, memory_verse_reference: l.memory_verse_reference ?? "", memory_verse_text: l.memory_verse_text ?? "", definition_title: l.definition_title ?? "", what_is_it: l.what_is_it ?? "", why_heading: l.why_heading ?? "", why_text: l.why_text ?? "", to_whom: l.to_whom ?? "", notes: l.notes ?? "" });
    setShowLessonModal(true);
  };

  const saveLesson = async () => {
    if (!lessonForm.title.trim()) { Alert.alert("Title is required"); return; }
    if (!selectedPlan) return;
    setSaving(true);
    const payload = {
      lesson_code: lessonForm.lesson_code.trim() || null,
      title: lessonForm.title.trim(),
      order_index: lessonForm.order_index,
      module_id: lessonForm.module_id || null,
      memory_verse_reference: lessonForm.memory_verse_reference.trim() || null,
      memory_verse_text: lessonForm.memory_verse_text.trim() || null,
      definition_title: lessonForm.definition_title.trim() || null,
      what_is_it: lessonForm.what_is_it.trim() || null,
      why_heading: lessonForm.why_heading.trim() || null,
      why_text: lessonForm.why_text.trim() || null,
      to_whom: lessonForm.to_whom.trim() || null,
      notes: lessonForm.notes.trim() || null,
    };
    if (editingLesson) {
      const { error } = await supabase.from("p2p_plan_lessons").update(payload).eq("id", editingLesson.id);
      if (error) Alert.alert("Error", error.message);
      else setLessons(prev => prev.map(l => l.id === editingLesson.id ? { ...l, ...payload } : l));
    } else {
      const { data, error } = await supabase.from("p2p_plan_lessons").insert({ plan_id: selectedPlan.id, ...payload }).select().single();
      if (error) Alert.alert("Error", error.message);
      else setLessons(prev => [...prev, data as LessonRow]);
    }
    setSaving(false);
    setShowLessonModal(false);
  };

  const deleteLesson = (l: LessonRow) => {
    Alert.alert("Delete Lesson", `Delete "${l.title}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        await supabase.from("p2p_plan_lessons").delete().eq("id", l.id);
        setLessons(prev => prev.filter(x => x.id !== l.id));
      }},
    ]);
  };

  const openQuestionsForLesson = async (l: LessonRow) => {
    setQuestionsLesson(l);
    const [{ data: r }, { data: a }] = await Promise.all([
      supabase.from("p2p_plan_reflection_questions").select("*").eq("lesson_id", l.id).order("order_index"),
      supabase.from("p2p_plan_assignment_questions").select("*").eq("lesson_id", l.id).order("order_index"),
    ]);
    setReflections((r ?? []) as QuestionRow[]);
    setAssignments((a ?? []) as QuestionRow[]);
    setNewReflection("");
    setNewAssignment("");
    setShowQuestionsModal(true);
  };

  const addReflectionQ = async () => {
    if (!newReflection.trim() || !questionsLesson) return;
    const { data, error } = await supabase.from("p2p_plan_reflection_questions").insert({ lesson_id: questionsLesson.id, question_text: newReflection.trim(), order_index: reflections.length }).select().single();
    if (!error && data) { setReflections(prev => [...prev, data as QuestionRow]); setNewReflection(""); }
  };
  const deleteReflectionQ = async (q: QuestionRow) => {
    await supabase.from("p2p_plan_reflection_questions").delete().eq("id", q.id);
    setReflections(prev => prev.filter(x => x.id !== q.id));
  };
  const addAssignmentQ = async () => {
    if (!newAssignment.trim() || !questionsLesson) return;
    const { data, error } = await supabase.from("p2p_plan_assignment_questions").insert({ lesson_id: questionsLesson.id, question_text: newAssignment.trim(), order_index: assignments.length }).select().single();
    if (!error && data) { setAssignments(prev => [...prev, data as QuestionRow]); setNewAssignment(""); }
  };
  const deleteAssignmentQ = async (q: QuestionRow) => {
    await supabase.from("p2p_plan_assignment_questions").delete().eq("id", q.id);
    setAssignments(prev => prev.filter(x => x.id !== q.id));
  };

  // ── Discussion questions ───────────────────────────────────────────────────

  const openAddDQ = () => { setEditingDQ(null); setDqForm(emptyDQForm()); setShowDQModal(true); };
  const openEditDQ = (dq: DQRow) => {
    setEditingDQ(dq);
    setDqForm({ question_number: dq.question_number, topic: dq.topic ?? "", question_text: dq.question_text, order_index: dq.order_index });
    setShowDQModal(true);
  };
  const saveDQ = async () => {
    if (!dqForm.question_text.trim()) { Alert.alert("Question text is required"); return; }
    if (!selectedPlan) return;
    setSaving(true);
    const payload = { question_number: dqForm.question_number, topic: dqForm.topic.trim() || null, question_text: dqForm.question_text.trim(), order_index: dqForm.order_index };
    if (editingDQ) {
      const { error } = await supabase.from("p2p_plan_discussion_questions").update(payload).eq("id", editingDQ.id);
      if (error) Alert.alert("Error", error.message);
      else setDqs(prev => prev.map(d => d.id === editingDQ.id ? { ...d, ...payload } : d));
    } else {
      const { data, error } = await supabase.from("p2p_plan_discussion_questions").insert({ plan_id: selectedPlan.id, ...payload }).select().single();
      if (error) Alert.alert("Error", error.message);
      else setDqs(prev => [...prev, data as DQRow]);
    }
    setSaving(false);
    setShowDQModal(false);
  };
  const deleteDQ = (dq: DQRow) => {
    Alert.alert("Delete", "Remove this discussion question?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        await supabase.from("p2p_plan_discussion_questions").delete().eq("id", dq.id);
        setDqs(prev => prev.filter(x => x.id !== dq.id));
      }},
    ]);
  };

  // ── Teaching outline ───────────────────────────────────────────────────────

  const openOutline = () => {
    setOutlineForm({ opening_illustration_title: outline?.opening_illustration_title ?? "", opening_illustration_text: outline?.opening_illustration_text ?? "" });
    setShowOutlineModal(true);
  };
  const saveOutline = async () => {
    if (!selectedPlan) return;
    setSaving(true);
    const payload = { opening_illustration_title: outlineForm.opening_illustration_title.trim() || null, opening_illustration_text: outlineForm.opening_illustration_text.trim() || null };
    if (outline) {
      const { error } = await supabase.from("p2p_plan_teaching_outlines").update(payload).eq("id", outline.id);
      if (!error) setOutline({ ...outline, ...payload });
    } else {
      const { data, error } = await supabase.from("p2p_plan_teaching_outlines").insert({ plan_id: selectedPlan.id, ...payload }).select().single();
      if (!error && data) setOutline(data as OutlineRow);
    }
    setSaving(false);
    setShowOutlineModal(false);
  };

  const openAddSession = () => { setEditingSession(null); setSessionForm(emptySessionForm()); setShowSessionModal(true); };
  const openEditSession = (se: SessionRow) => {
    setEditingSession(se);
    setSessionForm({ session_label: se.session_label, summary: se.summary ?? "", order_index: se.order_index });
    setShowSessionModal(true);
  };
  const saveSession = async () => {
    if (!sessionForm.session_label.trim()) { Alert.alert("Label is required"); return; }
    if (!selectedPlan) return;
    setSaving(true);
    let outlineId = outline?.id;
    if (!outlineId) {
      const { data } = await supabase.from("p2p_plan_teaching_outlines").insert({ plan_id: selectedPlan.id }).select().single();
      if (data) { setOutline(data as OutlineRow); outlineId = (data as OutlineRow).id; }
    }
    if (!outlineId) { setSaving(false); return; }
    const payload = { session_label: sessionForm.session_label.trim(), summary: sessionForm.summary.trim() || null, order_index: sessionForm.order_index };
    if (editingSession) {
      const { error } = await supabase.from("p2p_plan_teaching_sessions").update(payload).eq("id", editingSession.id);
      if (!error) setSessions(prev => prev.map(s => s.id === editingSession.id ? { ...s, ...payload } : s));
    } else {
      const { data, error } = await supabase.from("p2p_plan_teaching_sessions").insert({ outline_id: outlineId, ...payload }).select().single();
      if (!error && data) setSessions(prev => [...prev, data as SessionRow]);
    }
    setSaving(false);
    setShowSessionModal(false);
  };
  const deleteSession = (se: SessionRow) => {
    Alert.alert("Delete", "Remove this session?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        await supabase.from("p2p_plan_teaching_sessions").delete().eq("id", se.id);
        setSessions(prev => prev.filter(x => x.id !== se.id));
      }},
    ]);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!selectedPlan) {
    return (
      <View style={s.sectionRoot}>
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Plans ({plans.length})</Text>
          <TouchableOpacity style={s.addBtn} onPress={openCreatePlan}>
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={s.addBtnText}>New Plan</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.accentGreen} />
        ) : plans.length === 0 ? (
          <View style={s.emptyWrap}>
            <Ionicons name="albums-outline" size={40} color={colors.textMuted} />
            <Text style={s.emptyText}>No plans yet. Create the first one.</Text>
          </View>
        ) : (
          <FlatList
            data={plans}
            keyExtractor={p => p.id}
            contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.planCard} onPress={() => selectPlan(item)} activeOpacity={0.85}>
                <View style={s.planCardLeft}>
                  <Text style={s.planCardTitle}>{item.title}</Text>
                  {item.tagline ? <Text style={s.planCardTagline}>{item.tagline}</Text> : null}
                </View>
                <View style={s.planCardRight}>
                  <View style={[s.statusPill, { backgroundColor: item.status === "published" ? colors.accentGreen : colors.amber }]}>
                    <Text style={s.statusPillText}>{item.status}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => togglePlanStatus(item)}
                    style={s.iconBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name={item.status === "published" ? "eye-off-outline" : "eye-outline"} size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => deletePlan(item)}
                    style={s.iconBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="trash-outline" size={18} color="#E53E3E" />
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            )}
          />
        )}

        {/* Create Plan modal */}
        <FormModal visible={showPlanModal} title="New Plan" onClose={() => setShowPlanModal(false)} onSave={savePlan} saving={saving}>
          <Field label="Title *" value={planForm.title} onChangeText={v => setPlanForm(f => ({ ...f, title: v }))} placeholder="e.g. Victory Over Lustful Thoughts" />
          <Field label="Tagline" value={planForm.tagline} onChangeText={v => setPlanForm(f => ({ ...f, tagline: v }))} placeholder="Short one-line description" />
          <Field label="Overview" value={planForm.overview} onChangeText={v => setPlanForm(f => ({ ...f, overview: v }))} multiline placeholder="Paragraph overview of the plan…" />
          <View style={ms.switchRow}>
            <Text style={ms.fieldLabel}>Has Submodules (grouped lessons)</Text>
            <Switch value={planForm.has_submodules} onValueChange={v => setPlanForm(f => ({ ...f, has_submodules: v }))} trackColor={{ true: colors.accentGreen }} />
          </View>
        </FormModal>
      </View>
    );
  }

  // ── Plan detail view ───────────────────────────────────────────────────────

  return (
    <View style={s.sectionRoot}>
      {/* Plan detail header */}
      <View style={s.planDetailHeader}>
        <TouchableOpacity onPress={() => setSelectedPlan(null)} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={20} color={colors.textDark} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.planDetailTitle} numberOfLines={1}>{selectedPlan.title}</Text>
        </View>
        <View style={[s.statusPill, { backgroundColor: selectedPlan.status === "published" ? colors.accentGreen : colors.amber }]}>
          <Text style={s.statusPillText}>{selectedPlan.status}</Text>
        </View>
        <TouchableOpacity
          onPress={() => togglePlanStatus(selectedPlan)}
          style={[s.iconBtn, { marginLeft: 4 }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name={selectedPlan.status === "published" ? "eye-off-outline" : "eye-outline"} size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Inner tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.innerTabBar} contentContainerStyle={s.innerTabBarContent}>
        {(["info", "teachers", "content", "outline", "questions"] as PlanInnerTab[]).map(t => (
          <TouchableOpacity key={t} style={[s.innerTab, planInnerTab === t && s.innerTabActive]} onPress={() => setPlanInnerTab(t)}>
            <Text style={[s.innerTabText, planInnerTab === t && s.innerTabTextActive]}>
              {t === "info" ? "Info" : t === "teachers" ? "Teachers" : t === "content" ? "Content" : t === "outline" ? "Outline" : "Questions"}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Info tab */}
      {planInnerTab === "info" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Field label="Title *" value={planForm.title} onChangeText={v => setPlanForm(f => ({ ...f, title: v }))} />
          <Field label="Tagline" value={planForm.tagline} onChangeText={v => setPlanForm(f => ({ ...f, tagline: v }))} placeholder="Short one-line description" />
          <Field label="Overview" value={planForm.overview} onChangeText={v => setPlanForm(f => ({ ...f, overview: v }))} multiline placeholder="Plan overview paragraph…" />
          <View style={ms.switchRow}>
            <Text style={ms.fieldLabel}>Has Submodules</Text>
            <Switch value={planForm.has_submodules} onValueChange={v => setPlanForm(f => ({ ...f, has_submodules: v }))} trackColor={{ true: colors.accentGreen }} />
          </View>
          <TouchableOpacity style={s.saveInfoBtn} onPress={savePlan}>
            <Text style={s.saveInfoBtnText}>Save Changes</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Teachers tab */}
      {planInnerTab === "teachers" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <TouchableOpacity style={s.addBtn} onPress={openAddTeacher}>
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={s.addBtnText}>Add Teacher</Text>
          </TouchableOpacity>
          {teachers.length === 0 && <Text style={s.emptyText}>No teachers added yet.</Text>}
          {teachers.map(t => (
            <View key={t.id} style={s.rowCard}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowCardTitle}>{t.name}</Text>
                {t.ministry_or_church ? <Text style={s.rowCardSub}>{t.ministry_or_church}{t.location ? ` · ${t.location}` : ""}</Text> : null}
                {[t.youtube_handle, t.instagram_handle, t.other_social_handle].filter(Boolean).length > 0 && (
                  <Text style={s.rowCardSub}>
                    {[t.youtube_handle && `YT: ${t.youtube_handle}`, t.instagram_handle && `IG: @${t.instagram_handle}`, t.other_social_handle].filter(Boolean).join("  ")}
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={() => openEditTeacher(t)} style={s.iconBtn}><Ionicons name="pencil-outline" size={18} color={colors.accentGreen} /></TouchableOpacity>
              <TouchableOpacity onPress={() => deleteTeacher(t)} style={s.iconBtn}><Ionicons name="trash-outline" size={18} color="#E53E3E" /></TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Content tab */}
      {planInnerTab === "content" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {selectedPlan.has_submodules ? (
            <>
              <TouchableOpacity style={s.addBtn} onPress={openAddModule}>
                <Ionicons name="add" size={20} color="#fff" />
                <Text style={s.addBtnText}>Add Module</Text>
              </TouchableOpacity>
              {modules.length === 0 && <Text style={s.emptyText}>No modules yet.</Text>}
              {modules.map(m => {
                const modLessons = lessons.filter(l => l.module_id === m.id);
                return (
                  <View key={m.id} style={s.moduleBlock}>
                    <View style={s.moduleHeader}>
                      <Text style={s.moduleTitle}>Module {m.module_number}: {m.module_title}</Text>
                      <TouchableOpacity onPress={() => openEditModule(m)} style={s.iconBtn}><Ionicons name="pencil-outline" size={16} color={colors.accentGreen} /></TouchableOpacity>
                      <TouchableOpacity onPress={() => deleteModule(m)} style={s.iconBtn}><Ionicons name="trash-outline" size={16} color="#E53E3E" /></TouchableOpacity>
                    </View>
                    {modLessons.map(l => (
                      <LessonRow key={l.id} lesson={l} onEdit={openEditLesson} onDelete={deleteLesson} onQuestions={openQuestionsForLesson} />
                    ))}
                    <TouchableOpacity style={s.addLessonBtn} onPress={() => openAddLesson(m.id)}>
                      <Ionicons name="add-circle-outline" size={16} color={colors.accentGreen} />
                      <Text style={s.addLessonBtnText}>Add Lesson to Module {m.module_number}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </>
          ) : (
            <>
              <TouchableOpacity style={s.addBtn} onPress={() => openAddLesson(null)}>
                <Ionicons name="add" size={20} color="#fff" />
                <Text style={s.addBtnText}>Add Lesson</Text>
              </TouchableOpacity>
              {lessons.length === 0 && <Text style={s.emptyText}>No lessons yet.</Text>}
              {lessons.filter(l => !l.module_id).map(l => (
                <LessonRow key={l.id} lesson={l} onEdit={openEditLesson} onDelete={deleteLesson} onQuestions={openQuestionsForLesson} />
              ))}
            </>
          )}
        </ScrollView>
      )}

      {/* Outline tab */}
      {planInnerTab === "outline" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View style={s.rowCard}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowCardTitle}>Opening Illustration</Text>
              {outline?.opening_illustration_title ? (
                <Text style={s.rowCardSub}>{outline.opening_illustration_title}</Text>
              ) : (
                <Text style={s.emptyText}>Not set.</Text>
              )}
            </View>
            <TouchableOpacity onPress={openOutline} style={s.iconBtn}><Ionicons name="pencil-outline" size={18} color={colors.accentGreen} /></TouchableOpacity>
          </View>
          <View style={[s.sectionHeader, { marginTop: 20 }]}>
            <Text style={s.sectionTitle}>Teaching Sessions ({sessions.length})</Text>
            <TouchableOpacity style={s.addBtn} onPress={openAddSession}>
              <Ionicons name="add" size={20} color="#fff" />
              <Text style={s.addBtnText}>Add</Text>
            </TouchableOpacity>
          </View>
          {sessions.map(se => (
            <View key={se.id} style={s.rowCard}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowCardTitle}>{se.session_label}</Text>
                {se.summary ? <Text style={s.rowCardSub}>{se.summary}</Text> : null}
              </View>
              <TouchableOpacity onPress={() => openEditSession(se)} style={s.iconBtn}><Ionicons name="pencil-outline" size={16} color={colors.accentGreen} /></TouchableOpacity>
              <TouchableOpacity onPress={() => deleteSession(se)} style={s.iconBtn}><Ionicons name="trash-outline" size={16} color="#E53E3E" /></TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Discussion Questions tab */}
      {planInnerTab === "questions" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <TouchableOpacity style={s.addBtn} onPress={openAddDQ}>
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={s.addBtnText}>Add Discussion Question</Text>
          </TouchableOpacity>
          {dqs.length === 0 && <Text style={s.emptyText}>No discussion questions yet.</Text>}
          {dqs.map((dq, i) => (
            <View key={dq.id} style={s.rowCard}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowCardTitle}>Q{dq.question_number ?? i + 1}{dq.topic ? ` — ${dq.topic}` : ""}</Text>
                <Text style={s.rowCardSub}>{dq.question_text}</Text>
              </View>
              <TouchableOpacity onPress={() => openEditDQ(dq)} style={s.iconBtn}><Ionicons name="pencil-outline" size={16} color={colors.accentGreen} /></TouchableOpacity>
              <TouchableOpacity onPress={() => deleteDQ(dq)} style={s.iconBtn}><Ionicons name="trash-outline" size={16} color="#E53E3E" /></TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {/* Teacher modal */}
      <FormModal visible={showTeacherModal} title={editingTeacher ? "Edit Teacher" : "Add Teacher"} onClose={() => setShowTeacherModal(false)} onSave={saveTeacher} saving={saving}>
        <Field label="Name *" value={teacherForm.name} onChangeText={v => setTeacherForm(f => ({ ...f, name: v }))} />
        <Field label="Ministry / Church" value={teacherForm.ministry_or_church} onChangeText={v => setTeacherForm(f => ({ ...f, ministry_or_church: v }))} />
        <Field label="Location" value={teacherForm.location} onChangeText={v => setTeacherForm(f => ({ ...f, location: v }))} placeholder="City, Country" />
        <Field label="YouTube Handle" value={teacherForm.youtube_handle} onChangeText={v => setTeacherForm(f => ({ ...f, youtube_handle: v }))} placeholder="@handle" />
        <Field label="Instagram Handle" value={teacherForm.instagram_handle} onChangeText={v => setTeacherForm(f => ({ ...f, instagram_handle: v }))} placeholder="@handle" />
        <Field label="Other Social" value={teacherForm.other_social_handle} onChangeText={v => setTeacherForm(f => ({ ...f, other_social_handle: v }))} />
      </FormModal>

      {/* Module modal */}
      <FormModal visible={showModuleModal} title={editingModule ? "Edit Module" : "Add Module"} onClose={() => setShowModuleModal(false)} onSave={saveModule} saving={saving}>
        <Field label="Module Number" value={String(moduleForm.module_number)} onChangeText={v => setModuleForm(f => ({ ...f, module_number: parseInt(v) || 1 }))} keyboardType="number-pad" />
        <Field label="Module Title *" value={moduleForm.module_title} onChangeText={v => setModuleForm(f => ({ ...f, module_title: v }))} />
        <Field label="Order Index" value={String(moduleForm.order_index)} onChangeText={v => setModuleForm(f => ({ ...f, order_index: parseInt(v) || 0 }))} keyboardType="number-pad" />
      </FormModal>

      {/* Lesson modal */}
      <FormModal visible={showLessonModal} title={editingLesson ? "Edit Lesson" : "Add Lesson"} onClose={() => setShowLessonModal(false)} onSave={saveLesson} saving={saving}>
        <Field label="Lesson Code" value={lessonForm.lesson_code} onChangeText={v => setLessonForm(f => ({ ...f, lesson_code: v }))} placeholder="e.g. L1.1" />
        <Field label="Title *" value={lessonForm.title} onChangeText={v => setLessonForm(f => ({ ...f, title: v }))} />
        <Field label="Order Index" value={String(lessonForm.order_index)} onChangeText={v => setLessonForm(f => ({ ...f, order_index: parseInt(v) || 0 }))} keyboardType="number-pad" />
        <Text style={ms.sectionDivider}>Memory Verse</Text>
        <Field label="Reference" value={lessonForm.memory_verse_reference} onChangeText={v => setLessonForm(f => ({ ...f, memory_verse_reference: v }))} placeholder="e.g. 1 Corinthians 6:18-20" />
        <Field label="Verse Text" value={lessonForm.memory_verse_text} onChangeText={v => setLessonForm(f => ({ ...f, memory_verse_text: v }))} multiline />
        <Text style={ms.sectionDivider}>Content Sections</Text>
        <Field label="Definition Title" value={lessonForm.definition_title} onChangeText={v => setLessonForm(f => ({ ...f, definition_title: v }))} placeholder="e.g. DEFINITION: LUST" />
        <Field label="What Is It?" value={lessonForm.what_is_it} onChangeText={v => setLessonForm(f => ({ ...f, what_is_it: v }))} multiline />
        <Field label="Why Heading" value={lessonForm.why_heading} onChangeText={v => setLessonForm(f => ({ ...f, why_heading: v }))} placeholder="e.g. WHY IS THIS SIN AGAINST GOD?" />
        <Field label="Why Text" value={lessonForm.why_text} onChangeText={v => setLessonForm(f => ({ ...f, why_text: v }))} multiline />
        <Field label="To Whom" value={lessonForm.to_whom} onChangeText={v => setLessonForm(f => ({ ...f, to_whom: v }))} multiline />
        <Field label="Notes (optional)" value={lessonForm.notes} onChangeText={v => setLessonForm(f => ({ ...f, notes: v }))} multiline />
      </FormModal>

      {/* Lesson questions modal */}
      <Modal visible={showQuestionsModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowQuestionsModal(false)}>
        <View style={ms.modalRoot}>
          <View style={ms.modalHeader}>
            <TouchableOpacity onPress={() => setShowQuestionsModal(false)} style={ms.modalCloseBtn}>
              <Ionicons name="close" size={22} color={colors.textDark} />
            </TouchableOpacity>
            <Text style={ms.modalTitle} numberOfLines={1}>Questions — {questionsLesson?.title}</Text>
            <View style={{ width: 60 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <Text style={ms.sectionDivider}>Reflection Questions ({reflections.length}/5)</Text>
            {reflections.map((q, i) => (
              <View key={q.id} style={s.qRow}>
                <Text style={s.qText}>{i + 1}. {q.question_text}</Text>
                <TouchableOpacity onPress={() => deleteReflectionQ(q)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Ionicons name="close-circle" size={18} color="#E53E3E" />
                </TouchableOpacity>
              </View>
            ))}
            {reflections.length < 5 && (
              <View style={s.addQRow}>
                <TextInput style={s.addQInput} placeholder="New reflection question…" placeholderTextColor={colors.textMuted} value={newReflection} onChangeText={setNewReflection} multiline />
                <TouchableOpacity style={s.addQBtn} onPress={addReflectionQ}>
                  <Ionicons name="add" size={20} color="#fff" />
                </TouchableOpacity>
              </View>
            )}
            <Text style={[ms.sectionDivider, { marginTop: 24 }]}>Assignment Questions ({assignments.length}/5)</Text>
            {assignments.map((q, i) => (
              <View key={q.id} style={s.qRow}>
                <Text style={s.qText}>{i + 1}. {q.question_text}</Text>
                <TouchableOpacity onPress={() => deleteAssignmentQ(q)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Ionicons name="close-circle" size={18} color="#E53E3E" />
                </TouchableOpacity>
              </View>
            ))}
            {assignments.length < 5 && (
              <View style={s.addQRow}>
                <TextInput style={s.addQInput} placeholder="New assignment question…" placeholderTextColor={colors.textMuted} value={newAssignment} onChangeText={setNewAssignment} multiline />
                <TouchableOpacity style={s.addQBtn} onPress={addAssignmentQ}>
                  <Ionicons name="add" size={20} color="#fff" />
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* DQ modal */}
      <FormModal visible={showDQModal} title={editingDQ ? "Edit Question" : "Add Discussion Question"} onClose={() => setShowDQModal(false)} onSave={saveDQ} saving={saving}>
        <Field label="Question Number" value={dqForm.question_number !== null ? String(dqForm.question_number) : ""} onChangeText={v => setDqForm(f => ({ ...f, question_number: parseInt(v) || null }))} keyboardType="number-pad" />
        <Field label="Topic" value={dqForm.topic} onChangeText={v => setDqForm(f => ({ ...f, topic: v }))} placeholder="e.g. Accountability" />
        <Field label="Question *" value={dqForm.question_text} onChangeText={v => setDqForm(f => ({ ...f, question_text: v }))} multiline />
        <Field label="Order Index" value={String(dqForm.order_index)} onChangeText={v => setDqForm(f => ({ ...f, order_index: parseInt(v) || 0 }))} keyboardType="number-pad" />
      </FormModal>

      {/* Outline modal */}
      <FormModal visible={showOutlineModal} title="Teaching Outline" onClose={() => setShowOutlineModal(false)} onSave={saveOutline} saving={saving}>
        <Field label="Opening Illustration Title" value={outlineForm.opening_illustration_title} onChangeText={v => setOutlineForm(f => ({ ...f, opening_illustration_title: v }))} />
        <Field label="Opening Illustration Text" value={outlineForm.opening_illustration_text} onChangeText={v => setOutlineForm(f => ({ ...f, opening_illustration_text: v }))} multiline />
      </FormModal>

      {/* Session modal */}
      <FormModal visible={showSessionModal} title={editingSession ? "Edit Session" : "Add Session"} onClose={() => setShowSessionModal(false)} onSave={saveSession} saving={saving}>
        <Field label="Session Label *" value={sessionForm.session_label} onChangeText={v => setSessionForm(f => ({ ...f, session_label: v }))} placeholder="e.g. Session 1: The Root" />
        <Field label="Summary" value={sessionForm.summary} onChangeText={v => setSessionForm(f => ({ ...f, summary: v }))} multiline />
        <Field label="Order Index" value={String(sessionForm.order_index)} onChangeText={v => setSessionForm(f => ({ ...f, order_index: parseInt(v) || 0 }))} keyboardType="number-pad" />
      </FormModal>
    </View>
  );
}

function LessonRow({ lesson, onEdit, onDelete, onQuestions }: {
  lesson: LessonRow; onEdit: (l: LessonRow) => void; onDelete: (l: LessonRow) => void; onQuestions: (l: LessonRow) => void;
}) {
  return (
    <View style={s.lessonRow}>
      <View style={{ flex: 1 }}>
        {lesson.lesson_code ? <Text style={s.lessonCode}>{lesson.lesson_code}</Text> : null}
        <Text style={s.lessonTitle}>{lesson.title}</Text>
      </View>
      <TouchableOpacity onPress={() => onQuestions(lesson)} style={s.iconBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Ionicons name="help-circle-outline" size={18} color={colors.amber} />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => onEdit(lesson)} style={s.iconBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Ionicons name="pencil-outline" size={18} color={colors.accentGreen} />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => onDelete(lesson)} style={s.iconBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Ionicons name="trash-outline" size={18} color="#E53E3E" />
      </TouchableOpacity>
    </View>
  );
}

// ── PrayerSection ──────────────────────────────────────────────────────────────

function PrayerSection() {
  const [posts, setPosts] = useState<PrayerPostRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "request" | "testimony">("all");

  const loadPosts = useCallback(async () => {
    setLoading(true);
    const q = supabase
      .from("p2p_prayer_wall_posts")
      .select("id,user_id,post_type,body,status,is_anonymous,created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    const { data } = await q;
    setPosts((data ?? []) as PrayerPostRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { loadPosts(); }, [loadPosts]);

  const removePost = (post: PrayerPostRow) => {
    Alert.alert("Remove Post", "Remove this post from the prayer wall?", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => {
        const { error } = await supabase.from("p2p_prayer_wall_posts").delete().eq("id", post.id);
        if (error) Alert.alert("Error", error.message);
        else setPosts(prev => prev.filter(p => p.id !== post.id));
      }},
    ]);
  };

  const filteredPosts = posts.filter(p => filter === "all" || p.post_type === filter);

  return (
    <View style={s.sectionRoot}>
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>Prayer & Testimonies</Text>
        <TouchableOpacity onPress={loadPosts} style={s.iconBtn}>
          <Ionicons name="refresh-outline" size={20} color={colors.accentGreen} />
        </TouchableOpacity>
      </View>

      <View style={s.filterRow}>
        {(["all", "request", "testimony"] as const).map(f => (
          <TouchableOpacity key={f} style={[s.filterBtn, filter === f && s.filterBtnActive]} onPress={() => setFilter(f)}>
            <Text style={[s.filterBtnText, filter === f && s.filterBtnTextActive]}>{f === "all" ? "All" : f === "request" ? "Requests" : "Testimonies"}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.accentGreen} />
      ) : filteredPosts.length === 0 ? (
        <View style={s.emptyWrap}>
          <Text style={s.emptyText}>No posts found.</Text>
        </View>
      ) : (
        <FlatList
          data={filteredPosts}
          keyExtractor={p => p.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <View style={s.prayerCard}>
              <View style={s.prayerCardTop}>
                <View style={[s.typePill, { backgroundColor: item.post_type === "testimony" ? colors.accentGreen : colors.amber }]}>
                  <Text style={s.statusPillText}>{item.post_type}</Text>
                </View>
                <Text style={s.prayerDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
                <View style={{ flex: 1 }} />
                <TouchableOpacity onPress={() => removePost(item)} style={s.iconBtn}>
                  <Ionicons name="trash-outline" size={18} color="#E53E3E" />
                </TouchableOpacity>
              </View>
              <Text style={s.prayerBody} numberOfLines={4}>{item.body}</Text>
              {item.is_anonymous && <Text style={s.anonymousTag}>Anonymous</Text>}
            </View>
          )}
        />
      )}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.lightCream },
  subTabBar: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.borderBeige, paddingHorizontal: 8 },
  subTab: { paddingHorizontal: 14, paddingVertical: 12, marginRight: 4, borderBottomWidth: 2, borderBottomColor: "transparent" },
  subTabActive: { borderBottomColor: colors.accentGreen },
  subTabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.textMuted },
  subTabTextActive: { color: colors.accentGreen, fontFamily: "Inter_700Bold" },

  centeredSection: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  centeredTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
  centeredSub: { fontSize: 13, color: colors.textMuted, textAlign: "center", fontFamily: "Inter_400Regular", lineHeight: 20 },
  bigBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.primaryGreen, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 14, marginTop: 8 },
  bigBtnText: { fontSize: 14, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },

  sectionRoot: { flex: 1 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },

  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primaryGreen, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  addBtnText: { fontSize: 13, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },

  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12 },
  emptyText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 8 },

  planCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: colors.borderBeige, padding: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  planCardLeft: { flex: 1 },
  planCardTitle: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  planCardTagline: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  planCardRight: { flexDirection: "row", alignItems: "center", gap: 6 },

  statusPill: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusPillText: { fontSize: 10, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold", textTransform: "uppercase" },
  typePill: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },

  iconBtn: { padding: 4 },

  planDetailHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.borderBeige, gap: 8 },
  backBtn: { padding: 4 },
  planDetailTitle: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", flex: 1 },

  innerTabBar: { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.borderBeige, maxHeight: 44 },
  innerTabBarContent: { paddingHorizontal: 8, flexDirection: "row" },
  innerTab: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: "transparent" },
  innerTabActive: { borderBottomColor: colors.accentGreen },
  innerTabText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  innerTabTextActive: { color: colors.accentGreen, fontFamily: "Inter_700Bold" },

  saveInfoBtn: { backgroundColor: colors.primaryGreen, borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 16 },
  saveInfoBtnText: { fontSize: 14, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },

  rowCard: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: colors.borderBeige, padding: 12, marginBottom: 10, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  rowCardTitle: { fontSize: 13, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  rowCardSub: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 17 },

  moduleBlock: { backgroundColor: "#f5f5f0", borderRadius: 10, borderWidth: 1, borderColor: colors.borderBeige, padding: 12, marginBottom: 12 },
  moduleHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 6 },
  moduleTitle: { flex: 1, fontSize: 13, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },

  lessonRow: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: colors.borderBeige, padding: 10, marginBottom: 6 },
  lessonCode: { fontSize: 10, fontWeight: "700", color: colors.amber, fontFamily: "Inter_700Bold", marginBottom: 1 },
  lessonTitle: { fontSize: 13, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },

  addLessonBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 4, marginTop: 4 },
  addLessonBtnText: { fontSize: 12, color: colors.accentGreen, fontFamily: "Inter_500Medium" },

  qRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#f9f9f6", borderRadius: 8, padding: 10, marginBottom: 6 },
  qText: { flex: 1, fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular", lineHeight: 19 },
  addQRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginTop: 6 },
  addQInput: { flex: 1, backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: colors.borderBeige, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular", minHeight: 44 },
  addQBtn: { backgroundColor: colors.primaryGreen, borderRadius: 8, width: 40, height: 40, alignItems: "center", justifyContent: "center" },

  filterRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  filterBtn: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: colors.borderBeige, backgroundColor: "#fff" },
  filterBtnActive: { backgroundColor: colors.primaryGreen, borderColor: colors.primaryGreen },
  filterBtnText: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_500Medium" },
  filterBtnTextActive: { color: "#fff" },

  prayerCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: colors.borderBeige, padding: 14, marginBottom: 10 },
  prayerCardTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  prayerDate: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  prayerBody: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular", lineHeight: 20 },
  anonymousTag: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 4, fontStyle: "italic" },
});

const ms = StyleSheet.create({
  modalRoot: { flex: 1, backgroundColor: colors.lightCream },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige, backgroundColor: "#fff" },
  modalCloseBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  modalTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", textAlign: "center" },
  modalSaveBtn: { backgroundColor: colors.primaryGreen, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  modalSaveText: { fontSize: 13, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  modalBody: { padding: 16, paddingBottom: 60 },
  fieldWrap: { marginBottom: 16 },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: colors.textMid, fontFamily: "Inter_600SemiBold", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  fieldInput: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: colors.borderBeige, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
  fieldMultiline: { minHeight: 96, textAlignVertical: "top" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16, paddingVertical: 4 },
  sectionDivider: { fontSize: 12, fontWeight: "700", color: colors.textMuted, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10, marginTop: 4 },
});
