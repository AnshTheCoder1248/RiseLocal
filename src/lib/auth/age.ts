// Age model (spec §03): under 13 blocked; 13–15 need guardian consent;
// 16–17 minors may self-activate; 18+ adults.

export function ageOn(dob: Date, at: Date = new Date()) {
  let age = at.getFullYear() - dob.getFullYear();
  const m = at.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < dob.getDate())) age--;
  return age;
}

export type AgeBand = "13-15" | "16-17" | "18+";

export function ageBand(age: number): AgeBand {
  if (age < 16) return "13-15";
  if (age < 18) return "16-17";
  return "18+";
}

export const MIN_AGE = 13;
export const MAX_STUDENT_AGE = 18;
export const needsGuardian = (age: number) => age >= MIN_AGE && age < 16;
