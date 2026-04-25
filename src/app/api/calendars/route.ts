import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Serialize a Prisma calendar row to JSON-safe object
function serializeCal(
  cal: {
    id: string; userId: string; name: string; color: string;
    isDefault: boolean; isVisible: boolean; googleCalendarId: string | null;
    shareToken: string | null; shareMode: string | null;
    createdAt: Date; updatedAt: Date;
    members?: { id: string; userId: string; calendarId: string; role: string; joinedAt: Date;
      user: { id: string; name: string | null; email: string | null; image: string | null } }[];
  },
  memberRole?: string
) {
  return {
    ...cal,
    shareMode: cal.shareMode as "collaborative" | "broadcast" | null,
    memberRole: memberRole ?? undefined,
    members: (cal.members ?? []).map((m) => ({
      ...m,
      joinedAt: m.joinedAt.toISOString(),
    })),
    createdAt: cal.createdAt.toISOString(),
    updatedAt: cal.updatedAt.toISOString(),
  };
}

const MEMBER_INCLUDE = {
  members: {
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
  },
};

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const uid = session.user.id;

  // Own calendars (with member list)
  const owned = await prisma.calendar.findMany({
    where: { userId: uid },
    include: MEMBER_INCLUDE,
    orderBy: { createdAt: "asc" },
  });

  // Calendars joined as a member
  const memberships = await prisma.calendarMember.findMany({
    where: { userId: uid },
    include: {
      calendar: { include: MEMBER_INCLUDE },
    },
  });

  const ownedSerialized = owned.map((c) => serializeCal(c));
  const joinedSerialized = memberships.map((m) =>
    serializeCal(m.calendar, m.role)
  );

  return NextResponse.json([...ownedSerialized, ...joinedSerialized]);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { name, color } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const calendar = await prisma.calendar.create({
    data: {
      userId: session.user.id,
      name: name.trim(),
      color: color || "#4285f4",
    },
    include: MEMBER_INCLUDE,
  });

  return NextResponse.json(serializeCal(calendar), { status: 201 });
}
