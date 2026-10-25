import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let pathname = "/";
let status = "authenticated";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status }) }));

import { AppNav } from "@/components/nav/AppNav";

describe("AppNav", () => {
  beforeEach(() => {
    pathname = "/";
    status = "authenticated";
  });

  it("marks only the current section active", () => {
    pathname = "/calendar";
    render(<AppNav />);
    expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("Home is active only on /", () => {
    render(<AppNav />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });

  it("is hidden on auth pages and when signed out", () => {
    pathname = "/login";
    const { container, rerender } = render(<AppNav />);
    expect(container).toBeEmptyDOMElement();
    pathname = "/join/abc";
    rerender(<AppNav />);
    expect(container).toBeEmptyDOMElement();
    pathname = "/";
    status = "unauthenticated";
    rerender(<AppNav />);
    expect(container).toBeEmptyDOMElement();
  });
});
