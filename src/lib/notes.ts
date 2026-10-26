export const MAX_NOTE_LENGTH = 2000;
/** Cap on a user's notes (open + done). */
export const MAX_NOTES_PER_USER = 500;

/** http(s) URL if the whole text is one, else null. */
export function urlFromText(text: string): string | null {
  if (/\s/.test(text)) return null;
  try {
    const u = new URL(text);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
