import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MAX_NOTE_LENGTH, MAX_NOTES_PER_USER, urlFromText } from "@/lib/notes";

/** Open (not done) notes of the current user, newest first. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const notes = await prisma.note.findMany({
    where: { userId: session.user.id, done: false },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json(notes);
}

/** Create a note: body { text }. A text that is a single URL is also stored in `url`. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > MAX_NOTE_LENGTH) {
    return NextResponse.json({ error: `text is required (max ${MAX_NOTE_LENGTH} chars)` }, { status: 400 });
  }
  const total = await prisma.note.count({ where: { userId: session.user.id } });
  if (total >= MAX_NOTES_PER_USER) {
    return NextResponse.json(
      { error: `Note limit reached (${MAX_NOTES_PER_USER}). Delete some notes first.` },
      { status: 400 },
    );
  }
  const note = await prisma.note.create({
    data: { userId: session.user.id, text, url: urlFromText(text) },
  });
  return NextResponse.json(note, { status: 201 });
}
