import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** GET /api/google/account — returns 200 if the user has a Google account
 *  linked, 404 if not. Used by the UI to show Connect/Unlink buttons.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const account = await prisma.account.findFirst({
    where: { userId: session.user.id, provider: "google" },
    select: { id: true },
  });

  if (!account) {
    return NextResponse.json({ linked: false }, { status: 404 });
  }

  return NextResponse.json({ linked: true });
}

/** DELETE /api/google/account — unlinks the Google OAuth account from the
 *  current user. Also clears googleCalendarId on all their calendars so the
 *  sync UI hides correctly.
 */
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Remove the Google Account row
  const deleted = await prisma.account.deleteMany({
    where: { userId, provider: "google" },
  });

  if (deleted.count === 0) {
    return NextResponse.json(
      { error: "No Google account linked" },
      { status: 404 }
    );
  }

  // Clear googleCalendarId on all the user's calendars so the sync badge disappears
  await prisma.calendar.updateMany({
    where: { userId, googleCalendarId: { not: null } },
    data: { googleCalendarId: null },
  });

  return NextResponse.json({ ok: true });
}
