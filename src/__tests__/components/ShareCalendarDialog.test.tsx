import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShareCalendarDialog } from "@/components/calendar/ShareCalendarDialog";
import type { CalendarType, CalendarMemberType } from "@/types";

// vi.mock must live in this file so Vitest hoists it above the sonner import below.
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args), success: (...args: unknown[]) => toastSuccess(...args) },
}));

const member: CalendarMemberType = {
  id: "member-1",
  calendarId: "cal-1",
  userId: "user-2",
  role: "editor",
  joinedAt: "2025-01-01T00:00:00Z",
  user: { id: "user-2", name: "Alex Collaborator", email: "alex@example.com", image: null },
};

const calendar: CalendarType = {
  id: "cal-1",
  userId: "user-1",
  name: "Team Calendar",
  color: "#4285f4",
  isDefault: false,
  isVisible: true,
  googleCalendarId: null,
  shareToken: "abc123",
  shareMode: "collaborative",
  members: [member],
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};

/** The remove-member row has an icon-only button with no accessible name, and
 * the invite-link section also has an icon-only (copy) button — so scope the
 * query to the member's own row instead of a bare getByRole("button"). */
function getRemoveMemberButton(memberName: string) {
  const row = screen.getByText(memberName).closest("div.flex.items-center.gap-2");
  if (!row) throw new Error(`Could not find row for member "${memberName}"`);
  return within(row as HTMLElement).getByRole("button");
}

describe("ShareCalendarDialog — removeMember", () => {
  const fetchMock = vi.fn();
  const onUpdated = vi.fn();
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    confirmSpy.mockRestore();
  });

  it("does NOT drop the member from the list when the DELETE fails", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    );
    const user = userEvent.setup();

    render(
      <ShareCalendarDialog
        calendar={calendar}
        open={true}
        onOpenChange={vi.fn()}
        onUpdated={onUpdated}
      />,
    );

    expect(screen.getByText("Alex Collaborator")).toBeInTheDocument();

    const removeButton = getRemoveMemberButton("Alex Collaborator");
    await user.click(removeButton);

    // Confirmation was requested for this access-control action.
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    // Server rejected the removal — the collaborator must still be listed
    // (i.e. still has access), not optimistically dropped.
    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Forbidden");
    });
    expect(screen.getByText("Alex Collaborator")).toBeInTheDocument();
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it("removes the member from the list when the DELETE succeeds", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const user = userEvent.setup();

    render(
      <ShareCalendarDialog
        calendar={calendar}
        open={true}
        onOpenChange={vi.fn()}
        onUpdated={onUpdated}
      />,
    );

    const removeButton = getRemoveMemberButton("Alex Collaborator");
    await user.click(removeButton);

    await waitFor(() => {
      expect(screen.queryByText("Alex Collaborator")).not.toBeInTheDocument();
    });
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("skips the DELETE entirely (and keeps the member) when the confirmation is cancelled", async () => {
    confirmSpy.mockReturnValue(false);
    const user = userEvent.setup();

    render(
      <ShareCalendarDialog
        calendar={calendar}
        open={true}
        onOpenChange={vi.fn()}
        onUpdated={onUpdated}
      />,
    );

    const removeButton = getRemoveMemberButton("Alex Collaborator");
    await user.click(removeButton);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Alex Collaborator")).toBeInTheDocument();
  });
});
