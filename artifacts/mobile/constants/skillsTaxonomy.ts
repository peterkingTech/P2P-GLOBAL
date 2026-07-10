export interface SkillOption {
  key: string;
  label: string;
  category: string;
}

export const SKILLS_TAXONOMY: SkillOption[] = [
  { key: "accounting", label: "Accounting & Bookkeeping", category: "Business" },
  { key: "entrepreneurship", label: "Entrepreneurship & Microenterprise", category: "Business" },
  { key: "event_planning", label: "Event Planning", category: "Business" },
  { key: "fundraising", label: "Fundraising & Grant Writing", category: "Business" },
  { key: "legal", label: "Legal Advice", category: "Business" },
  { key: "logistics", label: "Logistics & Supply Chain", category: "Business" },
  { key: "project_management", label: "Project Management", category: "Business" },
  { key: "curriculum_development", label: "Curriculum Development", category: "Education" },
  { key: "teaching_general", label: "General Education/Tutoring", category: "Education" },
  { key: "music_instruction", label: "Music Instruction", category: "Education" },
  { key: "sports_recreation", label: "Sports & Recreation", category: "Education" },
  { key: "crisis_response", label: "Crisis & Disaster Response", category: "Humanitarian" },
  { key: "housing_construction", label: "Housing & Shelter Building", category: "Humanitarian" },
  { key: "refugee_support", label: "Refugee & Migrant Support", category: "Humanitarian" },
  { key: "water_sanitation", label: "Water & Sanitation", category: "Humanitarian" },
  { key: "translation", label: "Bible Translation", category: "Language" },
  { key: "language_teaching", label: "Language Teaching", category: "Language" },
  { key: "interpretation", label: "Live Interpretation", category: "Language" },
  { key: "writing_editing", label: "Writing & Editing", category: "Language" },
  { key: "first_aid", label: "First Aid & Emergency Response", category: "Medical" },
  { key: "medical_care", label: "Medical Care", category: "Medical" },
  { key: "mental_health", label: "Mental Health Support", category: "Medical" },
  { key: "nursing", label: "Nursing", category: "Medical" },
  { key: "nutrition", label: "Nutrition & Public Health", category: "Medical" },
  { key: "teaching_bible", label: "Bible Teaching", category: "Ministry" },
  { key: "counseling", label: "Biblical Counseling", category: "Ministry" },
  { key: "childrens_ministry", label: "Children's Ministry", category: "Ministry" },
  { key: "church_planting", label: "Church Planting", category: "Ministry" },
  { key: "discipleship_coaching", label: "Discipleship Coaching", category: "Ministry" },
  { key: "evangelism_outreach", label: "Evangelism & Outreach", category: "Ministry" },
  { key: "prayer_ministry", label: "Prayer Ministry", category: "Ministry" },
  { key: "preaching", label: "Preaching", category: "Ministry" },
  { key: "worship_leading", label: "Worship Leading", category: "Ministry" },
  { key: "youth_ministry", label: "Youth Ministry", category: "Ministry" },
  { key: "audio_engineering", label: "Audio Engineering", category: "Technical" },
  { key: "data_analysis", label: "Data Analysis", category: "Technical" },
  { key: "graphic_design", label: "Graphic Design", category: "Technical" },
  { key: "it_support", label: "IT Support", category: "Technical" },
  { key: "photography", label: "Photography", category: "Technical" },
  { key: "social_media", label: "Social Media & Marketing", category: "Technical" },
  { key: "video_production", label: "Video Production", category: "Technical" },
  { key: "web_development", label: "Web Development", category: "Technical" },
  { key: "agriculture", label: "Agriculture & Farming", category: "Trades" },
  { key: "mechanics", label: "Auto/Mechanical Repair", category: "Trades" },
  { key: "carpentry", label: "Carpentry", category: "Trades" },
  { key: "construction", label: "Construction", category: "Trades" },
  { key: "cooking_catering", label: "Cooking & Catering", category: "Trades" },
  { key: "electrical", label: "Electrical Work", category: "Trades" },
  { key: "plumbing", label: "Plumbing", category: "Trades" },
  { key: "sewing_textiles", label: "Sewing & Textiles", category: "Trades" },
];

export function skillLabel(key: string): string {
  return SKILLS_TAXONOMY.find((s) => s.key === key)?.label ?? key;
}

export function groupSkillsByCategory(skills: SkillOption[]): { category: string; items: SkillOption[] }[] {
  const map = new Map<string, SkillOption[]>();
  for (const s of skills) {
    if (!map.has(s.category)) map.set(s.category, []);
    map.get(s.category)!.push(s);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, items]) => ({ category, items }));
}
