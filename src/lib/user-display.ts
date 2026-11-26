export const ROLE_LABEL: Record<string, string> = {
  STUDENT: "Student",
  EMPLOYER: "Business",
  COMMUNITY: "Community member",
  ADMIN: "Admin",
};

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
