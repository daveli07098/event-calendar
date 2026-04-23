import { google } from "googleapis";
import { prisma } from "@/lib/prisma";

export async function getGoogleCalendarClient(userId: string) {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });

  if (!account?.refresh_token) {
    throw new Error("No Google account linked");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: account.refresh_token,
    access_token: account.access_token,
  });

  return google.calendar({ version: "v3", auth: oauth2Client });
}

export async function listGoogleCalendars(userId: string) {
  const calendar = await getGoogleCalendarClient(userId);
  const res = await calendar.calendarList.list();
  return res.data.items || [];
}

export async function importGoogleCalendarEvents(
  userId: string,
  googleCalendarId: string,
  localCalendarId: string
) {
  const calendarClient = await getGoogleCalendarClient(userId);

  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const sixMonthsAhead = new Date(now);
  sixMonthsAhead.setMonth(sixMonthsAhead.getMonth() + 6);

  const res = await calendarClient.events.list({
    calendarId: googleCalendarId,
    timeMin: threeMonthsAgo.toISOString(),
    timeMax: sixMonthsAhead.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 2500,
  });

  const events = res.data.items || [];
  let imported = 0;

  for (const event of events) {
    if (!event.id || !event.summary) continue;

    const startTime = event.start?.dateTime || event.start?.date;
    const endTime = event.end?.dateTime || event.end?.date;
    if (!startTime || !endTime) continue;

    const allDay = !event.start?.dateTime;

    await prisma.event.upsert({
      where: {
        id: `google_${event.id}`,
      },
      update: {
        title: event.summary,
        description: event.description || null,
        location: event.location || null,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        allDay,
      },
      create: {
        id: `google_${event.id}`,
        calendarId: localCalendarId,
        title: event.summary,
        description: event.description || null,
        location: event.location || null,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        allDay,
        googleEventId: event.id,
      },
    });
    imported++;
  }

  return imported;
}
