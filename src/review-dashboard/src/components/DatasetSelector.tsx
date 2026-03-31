import type { DatasetOption, UploadInfo } from "../lib/types";

interface DatasetSelectorProps {
  current: DatasetOption;
  uploads: UploadInfo[];
  onChange: (option: DatasetOption) => void;
  onUploadClick: () => void;
  onDeleteUpload: (id: string) => void;
}

export function DatasetSelector({
  current,
  uploads,
  onChange,
  onUploadClick,
  onDeleteUpload,
}: DatasetSelectorProps) {
  return (
    <div className="flex items-center gap-3">
      <select
        value={current.type === "production" ? "production" : current.id}
        onChange={(e) => {
          const val = e.target.value;
          if (val === "production") {
            onChange({ type: "production", name: "Production" });
          } else if (val === "__upload__") {
            onUploadClick();
          } else {
            const upload = uploads.find((u) => u.id === val);
            if (upload) onChange({ type: "dataset_run", id: upload.id, name: upload.name });
          }
        }}
        className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
      >
        <option value="production">Production</option>
        {uploads.length > 0 && (
          <optgroup label="Dataset Runs">
            {uploads.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.itemCount} items)
              </option>
            ))}
          </optgroup>
        )}
        <option value="__upload__">Upload new...</option>
      </select>

      {current.type === "dataset_run" && current.id && (
        <button
          onClick={() => {
            if (confirm(`Delete "${current.name}"?`)) {
              onDeleteUpload(current.id!);
            }
          }}
          className="text-xs text-red-500 hover:text-red-700"
        >
          Delete
        </button>
      )}
    </div>
  );
}
