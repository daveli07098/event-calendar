"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Building2, Loader2, FolderSync, MapPin, ImagePlus, X, ChevronDown, ChevronUp } from "lucide-react";
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
  imageUrls: string[];
  createdAt: string;
}

export function VenueSection() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", city: "Hong Kong", tags: "" });
  // Per-venue image upload state
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [expandedImages, setExpandedImages] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingUploadVenueId, setPendingUploadVenueId] = useState<string | null>(null);

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

  const handleBackfillHKLocations = async () => {
    setBackfilling(true);
    try {
      const res = await fetch("/api/events", { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Backfill failed");
      if (data.updated > 0) {
        toast.success(`Updated ${data.updated} event${data.updated > 1 ? "s" : ""} with Hong Kong location`);
      } else {
        toast.info(data.message ?? "No events needed updating");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backfill failed");
    } finally {
      setBackfilling(false);
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

  const handleImageUpload = async (venueId: string, files: FileList | null) => {
    if (!files?.length) return;
    setUploadingFor(venueId);
    try {
      const formData = new FormData();
      for (const file of Array.from(files)) formData.append("file", file);
      const res = await fetch(`/api/venues/${venueId}/images`, { method: "POST", body: formData });
      if (!res.ok) throw new Error((await res.json()).error ?? "Upload failed");
      const { imageUrls } = await res.json() as { imageUrls: string[] };
      setVenues((prev) => prev.map((v) => v.id === venueId ? { ...v, imageUrls } : v));
      setExpandedImages((prev) => new Set(prev).add(venueId));
      toast.success(`${files.length} image${files.length > 1 ? "s" : ""} uploaded`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingFor(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleImageDelete = async (venueId: string, imageUrl: string) => {
    try {
      const res = await fetch(`/api/venues/${venueId}/images`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: imageUrl }),
      });
      if (!res.ok) throw new Error("Failed to delete image");
      const { imageUrls } = await res.json() as { imageUrls: string[] };
      setVenues((prev) => prev.map((v) => v.id === venueId ? { ...v, imageUrls } : v));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
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
          <Button variant="outline" size="sm" onClick={handleBackfillHKLocations} disabled={backfilling} className="gap-1.5" title="Add 'Hong Kong' to imported events missing location">
            {backfilling ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
            Fix Locations
          </Button>
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
        <div className="space-y-2">
          {/* Hidden shared file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(e) => {
              if (pendingUploadVenueId) handleImageUpload(pendingUploadVenueId, e.target.files);
              setPendingUploadVenueId(null);
            }}
          />

          {venues.map((v) => {
            const imagesExpanded = expandedImages.has(v.id);
            return (
              <div key={v.id} className="rounded-lg border border-border bg-card overflow-hidden">
                {/* Venue header row */}
                <div className="flex items-start gap-3 px-4 py-3 group">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">{v.name}</p>
                    {v.address && <p className="text-xs text-muted-foreground mt-0.5">{v.address}, {v.city}</p>}
                    {!v.address && v.city && <p className="text-xs text-muted-foreground mt-0.5">{v.city}</p>}
                    {v.aliases.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5 italic">aka {v.aliases.join(", ")}</p>
                    )}
                    {v.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {v.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">{tag}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Upload image button */}
                    <button
                      onClick={() => { setPendingUploadVenueId(v.id); fileInputRef.current?.click(); }}
                      disabled={uploadingFor === v.id}
                      className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                      title="Upload venue images"
                    >
                      {uploadingFor === v.id
                        ? <Loader2 className="size-3.5 animate-spin" />
                        : <ImagePlus className="size-3.5" />
                      }
                    </button>
                    {/* Toggle images */}
                    {v.imageUrls.length > 0 && (
                      <button
                        onClick={() => setExpandedImages((prev) => {
                          const next = new Set(prev);
                          next.has(v.id) ? next.delete(v.id) : next.add(v.id);
                          return next;
                        })}
                        className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors text-xs flex items-center gap-0.5"
                        title="Toggle images"
                      >
                        <span>{v.imageUrls.length}</span>
                        {imagesExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                      </button>
                    )}
                    {/* Delete venue */}
                    <button
                      onClick={() => handleDelete(v.id, v.name)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                      title="Remove venue"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>

                {/* Image gallery — collapsible */}
                {imagesExpanded && v.imageUrls.length > 0 && (
                  <div className="border-t border-border px-4 py-3 bg-muted/20">
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                      {v.imageUrls.map((url, i) => (
                        <div key={url} className="relative group/img aspect-video rounded-md overflow-hidden border border-border bg-muted">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`${v.name} image ${i + 1}`}
                            className="w-full h-full object-cover"
                          />
                          <button
                            onClick={() => handleImageDelete(v.id, url)}
                            className="absolute top-1 right-1 size-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-destructive"
                            title="Remove image"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
