import { JsonView, darkStyles } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";

export function JsonViewer({ data }: { data: unknown }) {
  if (!data || (typeof data === "object" && Object.keys(data as object).length === 0)) {
    return <div className="text-gray-400 italic text-sm p-3">No pipeline logs available</div>;
  }

  return (
    <div className="overflow-x-auto font-mono text-xs max-h-[600px] overflow-y-auto rounded bg-gray-900 p-3">
      <JsonView
        data={data}
        shouldExpandNode={(level) => level < 1}
        style={darkStyles}
      />
    </div>
  );
}
