import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MAX_NOTE_LENGTH, urlFromText } from "@/lib/notes";

type Ctx = { params: Promise<{ id: string }> };

/** Update a note: body { done?: boolean, text?: string }. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }
  const data: { done?: boolean; text?: string; url?: string | null } = {};
  if (body && "done" in body) {
    if (typeof body.done !== "boolean") {
      return NextResponse.json({ error: "done must be a boolean" }, { status: 400 });
    }
    data.done = body.done;
  }
  if (body && "text" in body) {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > MAX_NOTE_LENGTH) {
      return NextResponse.json({ error: `text must be 1-${MAX_NOTE_LENGTH} chars` }, { status: 400 });
    }
    data.text = text;
    data.url = urlFromText(text);
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const existing = await prisma.note.findFirst({ where: { id, userId: session.user.id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const note = await prisma.note.update({ where: { id }, data });
  return NextResponse.json(note);
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const { count } = await prisma.note.deleteMany({ where: { id, userId: session.user.id } });
  if (count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
