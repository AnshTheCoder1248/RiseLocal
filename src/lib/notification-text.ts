/** Turns a stored notification into a sentence, a link and an icon name for the inbox. */

export type NotificationView = { title: string; body?: string; href?: string; icon: "bell" | "send" | "award" | "info" };

type Payload = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

const APP_STATUS: Record<string, string> = {
  VIEWED: "The poster viewed your application",
  SHORTLISTED: "You’ve been shortlisted",
  HIRED: "You got the job!",
  DECLINED: "You weren’t selected this time",
  WITHDRAWN: "Your application was withdrawn",
  GUARDIAN_APPROVED: "Your guardian approved your application",
  GUARDIAN_DECLINED: "Your guardian declined your application",
  FILLED: "This job has been filled",
  CLOSED: "This job is no longer accepting applications",
  NEW_APPLICANT: "New applicant",
};

export function describeNotification(kind: string, payload: unknown): NotificationView {
  const p = (payload ?? {}) as Payload;
  const jobTitle = str(p.title);
  const jobHref = str(p.jobId) ? `/jobs/${p.jobId}` : undefined;

  if (kind === "watch_match") {
    return {
      icon: "bell",
      title: `New job match: ${jobTitle ?? "a job you’re watching"}`,
      body: [str(p.pay), str(p.area), str(p.watchName) && `from your alert “${p.watchName}”`].filter(Boolean).join(" · "),
      href: jobHref,
    };
  }

  if (kind === "app_update") {
    const status = str(p.status) ?? "";
    const completed = p.action === "complete";
    return {
      icon: "send",
      title: completed ? "The poster confirmed your job is complete" : (APP_STATUS[status] ?? "Your application was updated"),
      body: jobTitle,
      href: status === "NEW_APPLICANT" ? jobHref : "/applications",
    };
  }

  if (kind === "system") {
    switch (p.type) {
      case "certificate_issued":
        return { icon: "award", title: "You earned a certificate", body: str(p.roleTitle) };
      case "certificate_revoked":
        return { icon: "award", title: "A certificate was revoked", body: str(p.reason) };
      case "content_approved":
        return { icon: "info", title: "Your post was approved and is live", href: jobHref };
      case "content_rejected":
        return { icon: "info", title: "Your post wasn’t approved", body: str(p.reason) };
      case "content_removed":
        return { icon: "info", title: "Your post was removed", body: str(p.reason) };
    }
  }

  return { icon: "info", title: "Update from RiseLocal" };
}
