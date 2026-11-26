export const MAX_RESUME_BYTES = 2 * 1024 * 1024; // 2 MB

/** Accepted resume types, keyed by MIME type → allowed file extensions. */
export const RESUME_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
};

export const RESUME_ACCEPT = Object.entries(RESUME_TYPES).flatMap(([mime, exts]) => [mime, ...exts]).join(",");

/** Returns an error message, or null if the file is an acceptable resume. */
export function resumeFileError(file: { name: string; type: string; size: number }): string | null {
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_RESUME_BYTES) return "Resumes can be up to 2 MB.";
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  const exts = RESUME_TYPES[file.type];
  if (!exts || !exts.includes(ext)) return "Upload a PDF or Word document (.pdf, .doc, .docx).";
  return null;
}

export function formatBytes(n: number) {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
