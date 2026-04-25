export interface CalendarMemberType {
  id: string;
  calendarId: string;
  userId: string;
  role: "editor" | "viewer";
  joinedAt: string;
  user?: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  };
}

export interface CalendarType {
  id: string;
  userId: string;    // owner id
  name: string;
  color: string;
  isDefault: boolean;
  isVisible: boolean;
  googleCalendarId: string | null;
  shareToken: string | null;
  shareMode: "collaborative" | "broadcast" | null;
  // For member (non-owner) calendars
  memberRole?: "editor" | "viewer";
  members?: CalendarMemberType[];
  createdAt: string;
  updatedAt: string;
}

export interface EventType {
  id: string;
  calendarId: string;
  title: string;
  description: string | null;
  location: string | null;
  startTime: string;
  endTime: string;
  allDay: boolean;
  recurrenceRule: string | null;
  googleEventId: string | null;
  createdAt: string;
  updatedAt: string;
  calendar?: CalendarType;
}

export interface EventFormData {
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  calendarId: string;
}
