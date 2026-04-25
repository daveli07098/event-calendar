"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileUp, Loader2 } from "lucide-react";

const PRESET_COLORS = [
  "#4285f4", "#0f9d58", "#db4437", "#f4b400",
  "#7c4dff", "#00acc1", "#e67c73", "#33b679",
];

interface ICSImportProps {
  onImported: () => void;
}

export function ICSImport({ onImported }: ICSImportProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [calendarName, setCalendarName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setResult(null);
    setError(null);
    // Pre-fill calendar name from filename
    if (file && !calendarName) {
      setCalendarName(file.name.replace(/\.ics$/i, ""));
    }
  };

  const handleImport = async () => {
    if (!selectedFile) return;

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const icsContent = await selectedFile.text();
      const res = await fetch("/api/ics/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          icsContent,
          calendarName: calendarName.trim() || undefined,
          color,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Import failed");
        return;
      }

      setResult(
        `Imported ${data.importedEvents} of ${data.totalEvents} events into "${data.calendarName}"`,
      );
      setSelectedFile(null);
      setCalendarName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      onImported();
    } catch {
      setError("Failed to read or upload the file");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* File picker */}
      <div className="space-y-1">
        <Label>ICS / iCalendar file</Label>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp className="size-4 mr-2" />
            Choose file
          </Button>
          <span className="text-sm text-muted-foreground truncate max-w-xs">
            {selectedFile ? selectedFile.name : "No file chosen"}
          </span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".ics,text/calendar"
          onChange={handleFileChange}
          className="hidden"
        />
        {selectedFile && (
          <p className="text-xs text-muted-foreground">
            {(selectedFile.size / 1024).toFixed(1)} KB
          </p>
        )}
      </div>

      {/* Calendar name */}
      <div className="space-y-1">
        <Label htmlFor="ics-cal-name">Calendar name (optional)</Label>
        <Input
          id="ics-cal-name"
          placeholder="Leave blank to use name from file"
          value={calendarName}
          onChange={(e) => setCalendarName(e.target.value)}
        />
      </div>

      {/* Color picker */}
      <div className="space-y-1">
        <Label>Calendar color</Label>
        <div className="flex gap-2 flex-wrap">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              style={{ backgroundColor: c }}
              className={`size-7 rounded-full border-2 transition-transform hover:scale-110 ${
                color === c ? "border-foreground scale-110" : "border-transparent"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Feedback */}
      {result && (
        <p className="text-sm text-green-600 dark:text-green-400">{result}</p>
      )}
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <Button
        onClick={handleImport}
        disabled={!selectedFile || loading}
        variant="outline"
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin mr-2" />
        ) : (
          <FileUp className="size-4 mr-2" />
        )}
        Import from file
      </Button>
    </div>
  );
}
