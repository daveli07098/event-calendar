export const EVENT_CATEGORIES = [
  "concert",    // live music, band shows
  "exhibition", // art galleries, exhibitions, museums
  "theatre",    // theatre, musicals, opera, dance
  "sports",     // sporting events, matches
  "festival",   // cultural festivals, fairs, parades
  "anime",      // anime/manga/IP events, character pop-up stores
  "popup",      // pop-up stores, limited retail, brand activations
  "kuji",       // ichiban kuji / one kuji lottery merchandise events
  "crane",      // crane game / UFO catcher prize merchandise
  "comedy",     // stand-up comedy
  "film",       // screenings, premieres
  "food",       // food festivals, wine tasting
  "ticket",     // ticket sale / presale events
  "other",      // catch-all
] as const;

export type EventCategory = typeof EVENT_CATEGORIES[number];

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  concert:    "🎵 Concert",
  exhibition: "🖼️ Exhibition",
  theatre:    "🎭 Theatre",
  sports:     "⚽ Sports",
  festival:   "🎉 Festival",
  anime:      "🌸 Anime / IP",
  popup:      "🏪 Pop-up / Café",
  kuji:       "🎲 Ichiban Kuji",
  crane:      "🕹️ Crane Game",
  comedy:     "😂 Comedy",
  film:       "🎬 Film",
  food:       "🍜 Food",
  ticket:     "🎟️ Ticket Sale",
  other:      "📅 Other",
};

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
  category: EventCategory | null;
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
  category?: EventCategory | null;
}
