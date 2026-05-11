import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { put, del } from "@vercel/blob";

// ---------------------------------------------------------------------------
// POST /api/venues/[id]/images  — upload image(s) for a venue
// Accepts multipart/form-data with one or more "file" fields.
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify venue exists (no ownership enforcement — venues are shared)
  const venue = await prisma.eventVenue.findUnique({ where: { id }, select: { id: true, imageUrls: true } });
  if (!venue) return NextResponse.json({ error: "Venue not found" }, { status: 404 });

  const formData = await req.formData();
  const files = formData.getAll("file") as File[];
  if (!files.length) return NextResponse.json({ error: "No files provided" }, { status: 400 });

  const MAX_SIZE = 5 * 1024 * 1024; // 5 MB per image
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

  const uploadedUrls: string[] = [];
  for (const file of files) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 415 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: `File too large (max 5 MB): ${file.name}` }, { status: 413 });
    }
    const ext = file.name.split(".").pop() ?? "jpg";
    const blobName = `venues/${id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const blob = await put(blobName, file, { access: "public", contentType: file.type });
    uploadedUrls.push(blob.url);
  }

  // Append new URLs to the venue record
  const updated = await prisma.eventVenue.update({
    where: { id },
    data: { imageUrls: { push: uploadedUrls } },
    select: { id: true, imageUrls: true },
  });

  return NextResponse.json({ imageUrls: updated.imageUrls });
}

// ---------------------------------------------------------------------------
// DELETE /api/venues/[id]/images  — remove a single image by URL
// Body: { url: string }
// ---------------------------------------------------------------------------
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { url } = await req.json() as { url?: string };
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });

  const venue = await prisma.eventVenue.findUnique({ where: { id }, select: { imageUrls: true } });
  if (!venue) return NextResponse.json({ error: "Venue not found" }, { status: 404 });

  // Remove from blob storage (best-effort — don't fail if already gone)
  try { await del(url); } catch { /* ignore */ }

  // Remove URL from venue record
  const updated = await prisma.eventVenue.update({
    where: { id },
    data: { imageUrls: venue.imageUrls.filter((u) => u !== url) },
    select: { id: true, imageUrls: true },
  });

  return NextResponse.json({ imageUrls: updated.imageUrls });
}
