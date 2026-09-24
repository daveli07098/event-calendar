import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { put } from "@vercel/blob";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const PDF_TYPE = "application/pdf";
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB, same cap as venue photo uploads
const MAX_PDF_SIZE = 10 * 1024 * 1024; // 10 MB — official seating plans are often PDFs

/**
 * POST /api/venues/[id]/seatmap/plan — attach an official seating-plan image/PDF to a venue.
 * Accepts EITHER:
 *   - multipart/form-data with a "file" field (image or PDF, uploaded to Vercel Blob under
 *     `venue-seat-plans/`), same pattern as POST /api/venues/[id]/images; or
 *   - `application/json` body `{ "url": "https://..." }` — an already-hosted plan, linked
 *     directly rather than re-uploaded (https only).
 * Sets `seatMapPlanUrl` and returns it. Does not touch `seatMapConfig`/`seatMapStatus`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const venue = await prisma.eventVenue.findUnique({ where: { id }, select: { id: true } });
  if (!venue) return NextResponse.json({ error: "Venue not found" }, { status: 404 });

  const contentType = req.headers.get("content-type") ?? "";
  let planUrl: string;

  if (contentType.includes("application/json")) {
    let body: { url?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { url } = body;
    if (typeof url !== "string" || !url.trim()) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }
    if (parsed.protocol !== "https:") {
      return NextResponse.json({ error: "url must be an https:// URL" }, { status: 400 });
    }
    planUrl = parsed.toString();
  } else {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: "Expected multipart/form-data with a file, or a JSON { url } body" }, { status: 400 });
    }
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const isPdf = file.type === PDF_TYPE;
    if (!isPdf && !ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 415 });
    }
    const maxSize = isPdf ? MAX_PDF_SIZE : MAX_IMAGE_SIZE;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: `File too large (max ${Math.round(maxSize / (1024 * 1024))} MB): ${file.name}` },
        { status: 413 }
      );
    }

    const ext = file.name.split(".").pop() || (isPdf ? "pdf" : "jpg");
    const blobName = `venue-seat-plans/${id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const blob = await put(blobName, file, { access: "public", contentType: file.type });
    planUrl = blob.url;
  }

  const updated = await prisma.eventVenue.update({
    where: { id },
    data: { seatMapPlanUrl: planUrl },
    select: { seatMapPlanUrl: true },
  });

  return NextResponse.json({ planUrl: updated.seatMapPlanUrl });
}
