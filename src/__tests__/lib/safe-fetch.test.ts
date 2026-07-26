import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.mock must live in this file (not a shared helper) so Vitest hoists it
// above the safe-fetch import below.
const lookupMock = vi.fn();
vi.mock("node:dns", () => ({
  default: { promises: { lookup: (...args: unknown[]) => lookupMock(...args) } },
  promises: { lookup: (...args: unknown[]) => lookupMock(...args) },
}));

import { safeFetch, assertPublicUrl, UnsafeUrlError } from "@/lib/safe-fetch";

/** Convenience: make dns.promises.lookup(host, { all: true }) resolve to these addresses. */
function mockLookup(addresses: Array<{ address: string; family: number }>) {
  lookupMock.mockResolvedValue(addresses);
}

const PUBLIC_V4 = [{ address: "93.184.216.34", family: 4 }]; // example.com-ish public IP

describe("assertPublicUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects non-http(s) protocols", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(UnsafeUrlError);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects malformed URLs", async () => {
    await expect(assertPublicUrl("not a url")).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects the localhost hostname", async () => {
    await expect(assertPublicUrl("http://localhost/x")).rejects.toThrow(UnsafeUrlError);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects .local and .internal suffixes", async () => {
    await expect(assertPublicUrl("http://printer.local/x")).rejects.toThrow(UnsafeUrlError);
    await expect(assertPublicUrl("http://svc.internal/x")).rejects.toThrow(UnsafeUrlError);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("allows a public hostname resolving to a public IPv4 address", async () => {
    mockLookup(PUBLIC_V4);
    await expect(assertPublicUrl("http://example.com/x")).resolves.toBeInstanceOf(URL);
  });

  describe("IPv4 literal ranges (no DNS lookup needed)", () => {
    it.each([
      ["0.0.0.0", "unspecified / this-network"],
      ["10.1.2.3", "RFC1918 10/8"],
      ["100.64.0.1", "CGNAT 100.64/10"],
      ["100.127.255.254", "CGNAT upper bound"],
      ["127.0.0.1", "loopback"],
      ["169.254.169.254", "link-local / cloud metadata"],
      ["172.16.0.1", "RFC1918 172.16/12 lower bound"],
      ["172.31.255.254", "RFC1918 172.16/12 upper bound"],
      ["192.168.1.1", "RFC1918 192.168/16"],
      ["224.0.0.1", "multicast"],
      ["240.0.0.1", "reserved"],
    ])("blocks %s (%s)", async (ip) => {
      await expect(assertPublicUrl(`http://${ip}/x`)).rejects.toThrow(UnsafeUrlError);
      expect(lookupMock).not.toHaveBeenCalled();
    });

    it("does NOT block 172.32.x.x — outside the real 172.16/12 range", async () => {
      // 172.32.0.1 is a public-looking literal IP; the naive "172." prefix
      // match the old guards used would have wrongly blocked this.
      await expect(assertPublicUrl("http://172.32.0.1/x")).resolves.toBeInstanceOf(URL);
    });

    it("does NOT block 172.15.x.x — just below the 172.16/12 range", async () => {
      await expect(assertPublicUrl("http://172.15.255.255/x")).resolves.toBeInstanceOf(URL);
    });
  });

  describe("IPv6 literal ranges", () => {
    it.each([
      ["::1", "loopback"],
      ["::", "unspecified"],
      ["fe80::1", "link-local fe80::/10"],
      ["febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "link-local upper bound"],
      ["fc00::1", "unique-local fc00::/7"],
      ["fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "unique-local upper bound"],
      ["ff00::1", "multicast ff00::/8"],
      ["::ffff:127.0.0.1", "IPv4-mapped loopback"],
      ["::ffff:192.168.1.1", "IPv4-mapped RFC1918"],
      ["::ffff:169.254.169.254", "IPv4-mapped cloud metadata"],
      ["0:0:0:0:0:ffff:c0a8:0101", "IPv4-mapped RFC1918 (fully expanded form)"],
    ])("blocks [%s] (%s)", async (ip) => {
      await expect(assertPublicUrl(`http://[${ip}]/x`)).rejects.toThrow(UnsafeUrlError);
    });

    it("does not block a public IPv6 address", async () => {
      await expect(assertPublicUrl("http://[2001:4860:4860::8888]/x")).resolves.toBeInstanceOf(URL);
    });

    it("does not block a public IPv4-mapped IPv6 address", async () => {
      await expect(assertPublicUrl("http://[::ffff:8.8.8.8]/x")).resolves.toBeInstanceOf(URL);
    });

    it("rejects fec0::/10 as outside the link-local range boundary sanity check", async () => {
      // fec0:: is just past fe80::/10's upper edge (febf:ffff:...); it is a
      // deprecated site-local range and NOT part of fe80::/10 or fc00::/7 —
      // it should be treated as public by our (deliberately narrow) ranges.
      await expect(assertPublicUrl("http://[fec0::1]/x")).resolves.toBeInstanceOf(URL);
    });
  });

  describe("DNS resolution", () => {
    it("rejects a public-looking hostname that resolves to a private IPv4 address (DNS rebinding)", async () => {
      mockLookup([{ address: "10.0.0.5", family: 4 }]);
      await expect(assertPublicUrl("http://evil.example.com/x")).rejects.toThrow(UnsafeUrlError);
    });

    it("rejects a public-looking hostname that resolves to a private IPv6 address", async () => {
      mockLookup([{ address: "fe80::1", family: 6 }]);
      await expect(assertPublicUrl("http://evil.example.com/x")).rejects.toThrow(UnsafeUrlError);
    });

    it("rejects when ANY resolved address is private, even if others are public", async () => {
      mockLookup([
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]);
      await expect(assertPublicUrl("http://multi.example.com/x")).rejects.toThrow(UnsafeUrlError);
    });

    it("rejects when DNS resolution fails", async () => {
      lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
      await expect(assertPublicUrl("http://nowhere.example.com/x")).rejects.toThrow(UnsafeUrlError);
    });
  });
});

describe("safeFetch", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches a normal public URL successfully", async () => {
    mockLookup(PUBLIC_V4);
    fetchMock.mockResolvedValue(new Response("hello world", { status: 200 }));

    const res = await safeFetch("http://example.com/page");
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe("hello world");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: "manual" });
  });

  it("follows a redirect to another public URL", async () => {
    mockLookup(PUBLIC_V4);
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "http://example.com/final" } })
      )
      .mockResolvedValueOnce(new Response("final page", { status: 200 }));

    const res = await safeFetch("http://example.com/start");
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe("final page");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("blocks a redirect whose target resolves to an internal address", async () => {
    // First hop: public hostname → public IP, then redirects to an internal IP literal.
    mockLookup(PUBLIC_V4);
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } })
    );

    await expect(safeFetch("http://example.com/start")).rejects.toThrow(UnsafeUrlError);
    // Only the first (allowed) hop should ever have reached the network.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks a redirect to a hostname that resolves to a private address (DNS rebinding on hop 2)", async () => {
    lookupMock
      .mockResolvedValueOnce(PUBLIC_V4) // first hop: public
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]); // second hop: rebinds to loopback
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://internal.example.com/x" } })
    );

    await expect(safeFetch("http://example.com/start")).rejects.toThrow(UnsafeUrlError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after exceeding the redirect hop limit", async () => {
    mockLookup(PUBLIC_V4);
    let n = 0;
    fetchMock.mockImplementation(() => {
      n += 1;
      return Promise.resolve(
        new Response(null, { status: 302, headers: { location: `http://example.com/hop-${n}` } })
      );
    });

    await expect(safeFetch("http://example.com/start", { maxRedirects: 2 })).rejects.toThrow(
      "Too many redirects"
    );
    // hop 0, 1, 2 are attempted (3 fetches); hop 3 exceeds the limit and throws
    // before a 4th fetch is made.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects a response larger than maxBytes", async () => {
    mockLookup(PUBLIC_V4);
    const big = "x".repeat(1000);
    fetchMock.mockResolvedValue(new Response(big, { status: 200 }));

    await expect(safeFetch("http://example.com/big", { maxBytes: 10 })).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects the target URL up front without ever calling fetch", async () => {
    await expect(safeFetch("http://127.0.0.1/admin")).rejects.toThrow(UnsafeUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
