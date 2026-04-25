import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddCalendarDialog } from "@/components/calendar/AddCalendarDialog";

describe("AddCalendarDialog", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onAdd: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the dialog with title", () => {
    render(<AddCalendarDialog {...defaultProps} />);
    expect(screen.getByText("New Calendar")).toBeInTheDocument();
  });

  it("renders name input and color swatches", () => {
    render(<AddCalendarDialog {...defaultProps} />);
    expect(screen.getByPlaceholderText("Calendar name")).toBeInTheDocument();
    expect(screen.getByText("Color")).toBeInTheDocument();
  });

  it("disables create button when name is empty", () => {
    render(<AddCalendarDialog {...defaultProps} />);
    const createBtn = screen.getByRole("button", { name: /create/i });
    expect(createBtn).toBeDisabled();
  });

  it("enables create button when name is entered", async () => {
    const user = userEvent.setup();
    render(<AddCalendarDialog {...defaultProps} />);
    const input = screen.getByPlaceholderText("Calendar name");
    await user.type(input, "Work");
    const createBtn = screen.getByRole("button", { name: /create/i });
    expect(createBtn).toBeEnabled();
  });

  it("calls onAdd with name and color on submit", async () => {
    const user = userEvent.setup();
    render(<AddCalendarDialog {...defaultProps} />);
    const input = screen.getByPlaceholderText("Calendar name");
    await user.type(input, "Work");
    const createBtn = screen.getByRole("button", { name: /create/i });
    await user.click(createBtn);
    expect(defaultProps.onAdd).toHaveBeenCalledWith("Work", "#4285f4");
  });

  it("calls onOpenChange(false) on cancel", async () => {
    const user = userEvent.setup();
    render(<AddCalendarDialog {...defaultProps} />);
    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    await user.click(cancelBtn);
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });
});
