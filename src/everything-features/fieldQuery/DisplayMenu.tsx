import type { FieldOption } from "@cn/core/fieldQuery";
import { DropdownMenu } from "@cn/ui/DropdownMenu";
import { pillButtonClass } from "@cn/ui/QueryChip";

/** The Display button: one list of what each card shows, ticked on or off. */
export function DisplayMenu({ options, shown, onChange }: { options: readonly FieldOption[]; shown: string[]; onChange: (shown: string[]) => void }) {
  return (
    <DropdownMenu
      label="Display"
      entries={[{ type: "choice", key: "display", multiple: true, options: [...options], selected: shown, onChange }]}
      trigger={
        <button type="button" className={pillButtonClass}>
          Display
        </button>
      }
    />
  );
}
