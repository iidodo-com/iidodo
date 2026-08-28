interface ChipSelectProps<T extends string> {
  label: string;
  options: readonly T[];
  value: T | null;
  onChange: (value: T | null) => void;
}

export function ChipSelect<T extends string>({ label, options, value, onChange }: ChipSelectProps<T>) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label}（任意）</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const selected = value === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(selected ? null : opt)}
              className={
                "px-2.5 py-1 rounded-full text-xs border transition-colors " +
                (selected
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-700 border-gray-300 hover:border-gray-400")
              }
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
