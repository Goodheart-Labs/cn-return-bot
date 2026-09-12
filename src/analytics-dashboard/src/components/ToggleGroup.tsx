/** A row of pill buttons of which exactly one is selected. */
export function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #d1d5db",
            background: option.value === value ? "#111827" : "#fff",
            color: option.value === value ? "#fff" : "#111827",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
