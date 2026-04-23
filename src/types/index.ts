export interface CalendarType {
  id: string;
  userId: string;
  name: string;
  color: string;
  isDefault: boolean;
  isVisible: boolean;
  googleCalendarId: string | null;
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
