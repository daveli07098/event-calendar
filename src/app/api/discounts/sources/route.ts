import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Account-backed Discount Sale source URLs. Previously these lived in
 * localStorage only, which meant they didn't survive a different browser or
 * device — this persists them on `User.discountSources` instead.
 */
export type DiscountSourcesResponse = { sources: string[] };

const MAX_SOURCES = 50;

/** Narrows an unknown stored value down to a string[], never trusting the JSON blob's shape. */
function sourcesOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { discountSources: true },
  });

  const response: DiscountSourcesResponse = { sources: sourcesOf(user?.discountSources) };
  return NextResponse.json(response);
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { sources?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sources } = body;
  if (!Array.isArray(sources)) {
    return NextResponse.json({ error: "sources must be an array" }, { status: 400 });
  }

  // Validate + normalise every entry up front — a single bad entry rejects
  // the whole request rather than silently dropping it (mirrors the discount
  // scan route's "Invalid URL" handling style).
  const normalised: string[] = [];
  for (const entry of sources) {
    if (typeof entry !== "string") {
      return NextResponse.json({ error: "Every source must be a URL string" }, { status: 400 });
    }
    let parsed: URL;
    try {
      parsed = new URL(entry);
    } catch {
      return NextResponse.json({ error: `Invalid URL: ${entry}` }, { status: 400 });
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return NextResponse.json({ error: `Invalid URL: ${entry}` }, { status: 400 });
    }
    normalised.push(parsed.toString());
  }

  const deduped = Array.from(new Set(normalised)).slice(0, MAX_SOURCES);

  await prisma.user.update({
    where: { id: session.user.id },
    data: { discountSources: deduped },
  });

  const response: DiscountSourcesResponse = { sources: deduped };
  return NextResponse.json(response);
}
