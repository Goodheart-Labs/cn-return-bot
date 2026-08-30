import { useState, useRef } from "react";
import Papa from "papaparse";
import { uploadDatasetRun } from "../lib/data";

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  onUploaded: (id: string, name: string) => void;
}

export function UploadDialog({ open, onClose, onUploaded }: UploadDialogProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Select a results.csv file");
      return;
    }

    const uploadName = name.trim() || file.name.replace(/\.csv$/, "");
    setUploading(true);
    setError(null);

    try {
      const text = await file.text();
      const { data, errors } = Papa.parse(text, { header: true, skipEmptyLines: true });

      if (errors.length > 0) {
        setError(`CSV parse errors: ${errors[0]?.message}`);
        setUploading(false);
        return;
      }

      const rows = data as Record<string, string>[];
      if (rows.length === 0) {
        setError("CSV has no data rows");
        setUploading(false);
        return;
      }

      // The logs column arrives as a JSON string, so turn it back into an object.
      for (const row of rows) {
        if (row.logs && typeof row.logs === "string") {
          try {
            row.logs = JSON.parse(row.logs);
          } catch {
            // Some rows hold something that is not JSON. We leave those as text.
          }
        }
      }

      const id = await uploadDatasetRun(uploadName, rows);
      onUploaded(id, uploadName);
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-6 w-[420px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">Upload Dataset Run</h2>

        <div className="space-y-3">
          <div>
            <label className="text-sm text-gray-600 block mb-1">Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. videos-2026-03-26"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-sm text-gray-600 block mb-1">CSV file</label>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="w-full text-sm"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}
