"use client";

import { useState, useEffect } from "react";
import { Plus, Trash2, Building2, Loader2, FolderSync } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface Venue {
  id: string;
  name: string;
  aliases: string[];
  address: string | null;
  city: string;
  country: string;
  tags: string[];
  createdAt: string;
}

export function VenueSection() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", city: "Hong Kong", tags: "" });

  useEffect(() => {
    fetch("/api/venues")
      .then((r) => r.json())
      .then((d) => setVenues(Array.isArray(d) ? d : []))
      .catch(() => toast.error("Failed to load venues"))
      .finally(() => setLoading(false));
  }, []);

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/venues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          address: form.address.trim() || undefined,
          city: form.city.trim() || "Hong Kong",
          tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      const venue: Venue = await res.json();
      setVenues((prev) => [...prev, venue].sort((a, b) => a.name.localeCompare(b.name)));
      setForm({ name: "", address: "", city: "Hong Kong", tags: "" });
      setShowForm(false);
      toast.success(`Venue "${venue.name}" added`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add venue");
    } finally {
      setAdding(false);
    }
  };

  const handleImportFromEvents = async () => {
    setImporting(true);
    try {
      const res = await fetch("/api/venues", { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      if (data.imported > 0) {
        const refreshed = await fetch("/api/venues").then((r) => r.json());
        setVenues(Array.isArray(refreshed) ? refreshed : []);
        toast.success(`Imported ${data.imported} venue${data.imported > 1 ? "s" : ""} from your events`);
      } else {
        toast.info("No new venues found in your events");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/venues/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      setVenues((prev) => prev.filter((v) => v.id !== id));
      toast.success(`Removed "${name}"`);
    } catch {
      toast.error("Failed to remove venue");
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Event Venues</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            A reference list of venues for your events. Use this to track building names,
            aliases, and tags for future matching.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={handleImportFromEvents} disabled={importing} className="gap-1.5">
            {importing ? <Loader2 className="size-4 animate-spin" /> : <FolderSync className="size-4" />}
            Import
          </Button>
          <Button size="sm" onClick={() => setShowForm((v) => !v)} className="gap-1.5">
            <Plus className="size-4" />
            Add Venue
          </Button>
        </div>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <p className="text-sm font-medium">New Venue</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground block mb-1">Venue Name *</label>
              <Input
                placeholder="e.g. 西九文化區 戲曲中心 大劇院"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">City</label>
              <Input
                placeholder="Hong Kong"
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Tags (comma-separated)</label>
              <Input
                placeholder="theatre, concert-hall"
                value={form.tags}
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground block mb-1">Address (optional)</label>
              <Input
                placeholder="e.g. 香港尖沙咀柯士甸道88號"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button size="sm" disabled={!form.name.trim() || adding} onClick={handleAdd}>
              {adding ? <Loader2 className="size-4 animate-spin mr-1" /> : null}
              Add
            </Button>
          </div>
        </div>
      )}

      {/* Venue list */}
      {loading ? (
        <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">Loading venues…</span>
        </div>
      ) : venues.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
          <Building2 className="size-10 opacity-20" />
          <p className="text-sm">No venues yet. Add one to get started.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 font-medium">Venue</th>
                <th className="text-left px-4 py-2.5 font-medium hidden sm:table-cell">City</th>
                <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Tags</th>
                <th className="w-8 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {venues.map((v) => (
                <tr key={v.id} className="hover:bg-muted/20 transition-colors group">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{v.name}</p>
                    {v.address && (
                      <p className="text-xs text-muted-foreground mt-0.5">{v.address}</p>
                    )}
                    {v.aliases.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5 italic">
                        aka {v.aliases.join(", ")}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    {v.city}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {v.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">{tag}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-3">
                    <button
                      onClick={() => handleDelete(v.id, v.name)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                      title="Remove venue"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
