import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.mock must live in this file so Vitest hoists it above the mutate import below.
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args), success: (...args: unknown[]) => toastSuccess(...args) },
}));

import { mutate } from "@/lib/mutate";

describe("mutate", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok + parsed data on a successful response, without an error toast", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "1" }), { status: 200 }));

    const result = await mutate<{ id: string }>("/api/thing", { method: "PUT", body: { name: "x" } });

    expect(result).toEqual({ ok: true, data: { id: "1" } });
    expect(toastError).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/thing",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      }),
    );
  });

  it("shows a success toast when successMessage is provided", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ imported: 3 }), { status: 200 }));

    await mutate<{ imported: number }>("/api/import", {
      successMessage: (data) => `Imported ${data.imported} events`,
    });

    expect(toastSuccess).toHaveBeenCalledWith("Imported 3 events");
  });

  it("surfaces the server's { error } message on a non-OK response and calls rollback", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Cannot downgrade a collaborative calendar to broadcast." }), {
        status: 409,
      }),
    );
    const rollback = vi.fn();

    const result = await mutate("/api/calendars/1/share", { rollback });

    expect(result).toEqual({ ok: false, error: "Cannot downgrade a collaborative calendar to broadcast." });
    expect(toastError).toHaveBeenCalledWith("Cannot downgrade a collaborative calendar to broadcast.");
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default/fallback message when the error body has no `error` field", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 500 }));

    const result = await mutate("/api/thing", { fallbackError: "Update failed." });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Update failed.");
    expect(toastError).toHaveBeenCalledWith("Update failed.");
  });

  it("falls back gracefully when the error body isn't JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>500</html>", { status: 500 }));

    const result = await mutate("/api/thing");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Something went wrong. Please try again.");
    expect(toastError).toHaveBeenCalledWith("Something went wrong. Please try again.");
  });

  it("rolls back and toasts on a network rejection (fetch throws)", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const rollback = vi.fn();
    const optimisticUpdate = vi.fn();

    const result = await mutate("/api/thing", { optimisticUpdate, rollback, fallbackError: "Network error." });

    expect(optimisticUpdate).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, error: "Network error." });
    expect(toastError).toHaveBeenCalledWith("Network error.");
  });

  it("applies optimisticUpdate before the request and does NOT roll back on success", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const optimisticUpdate = vi.fn();
    const rollback = vi.fn();

    await mutate("/api/thing", { optimisticUpdate, rollback });

    expect(optimisticUpdate).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();
  });

  it("suppresses the error toast when silent is true, but still returns the error", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "nope" }), { status: 400 }));

    const result = await mutate("/api/thing", { silent: true });

    expect(result).toEqual({ ok: false, error: "nope" });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("handles a body-less 2xx response (e.g. 204) without throwing", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const result = await mutate("/api/thing", { method: "DELETE" });

    expect(result).toEqual({ ok: true, data: undefined });
  });
});
