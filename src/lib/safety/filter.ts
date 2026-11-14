// Content safety filter + teen-suitability rules (SAFE-4, SAFE-5).
// Pure functions so they're easy to unit test and reuse in the Scout classifier.

export type SafetyFlag =
  | "pii_phone" | "pii_email" | "pii_solicitation" | "off_platform_contact" | "profanity"
  | "alcohol" | "hazardous_machinery" | "late_hours" | "door_to_door" | "adult_content" | "cash_only";

type Rule = { flag: SafetyFlag; pattern: RegExp; weight: number; prohibited?: boolean };

const RULES: Rule[] = [
  // PII / off-platform contact → hold for moderation
  { flag: "pii_phone", pattern: /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/, weight: 0.4 },
  { flag: "pii_email", pattern: /[\w.+-]+@[\w-]+\.[\w.]{2,}/, weight: 0.4 },
  { flag: "off_platform_contact", pattern: /\b(text|call|dm|snap(chat)?|whats ?app|telegram|message) me\b/i, weight: 0.4 },
  { flag: "pii_solicitation", pattern: /\b(send|share|need) (me )?(your|ur) (address|photo|pic|number|phone|ssn|social)\b/i, weight: 0.5 },
  { flag: "cash_only", pattern: /\bcash (only|job)\b|\bunder the table\b/i, weight: 0.25 },
  { flag: "profanity", pattern: /\b(fuck|shit|bitch|cunt|dick)\w*\b/i, weight: 0.3 },
  // Prohibited categories for minors → reject
  { flag: "alcohol", pattern: /\b(bartend\w*|bar[- ]?back|liquor|brewery|tavern|pub|serve (alcohol|beer|wine)|cocktail)\b/i, weight: 0.9, prohibited: true },
  { flag: "hazardous_machinery", pattern: /\b(forklift|chainsaw|meat slicer|roofing|demolition|power press|wood ?chipper)\b/i, weight: 0.9, prohibited: true },
  { flag: "door_to_door", pattern: /\bdoor[- ]to[- ]door\b/i, weight: 0.8, prohibited: true },
  { flag: "adult_content", pattern: /\b(adult entertainment|nightclub|strip club|casino|vape shop|cannabis|dispensary)\b/i, weight: 1, prohibited: true },
  { flag: "late_hours", pattern: /\b(overnight|graveyard shift|late[- ]night|midnight|(1[01]|12)\s?pm\s?[-–to]+\s?\d{1,2}\s?am)\b/i, weight: 0.4 },
];

export type SafetyDecision = "pass" | "hold" | "reject";

export type SafetyResult = {
  decision: SafetyDecision;
  /** 0–1 teen-suitability score (1 = clearly suitable). */
  score: number;
  flags: SafetyFlag[];
};

export function checkContent(fields: { title?: string; description?: string; tags?: string[] }): SafetyResult {
  const text = [fields.title, fields.description, ...(fields.tags ?? [])].filter(Boolean).join("\n");
  const hits = RULES.filter((r) => r.pattern.test(text));
  const flags = [...new Set(hits.map((h) => h.flag))];
  const penalty = hits.reduce((sum, h) => sum + h.weight, 0);
  const score = Math.max(0, Math.round((1 - penalty) * 100) / 100);

  // Prohibited work is rejected outright; anything else flagged (PII, off-platform contact,
  // late hours…) is held for a human moderator. Scout applies its own score threshold.
  let decision: SafetyDecision = "pass";
  if (hits.some((h) => h.prohibited)) decision = "reject";
  else if (hits.length > 0) decision = "hold";
  return { decision, score, flags };
}

export const PROHIBITED_FLAGS = new Set<SafetyFlag>(RULES.filter((r) => r.prohibited).map((r) => r.flag));
