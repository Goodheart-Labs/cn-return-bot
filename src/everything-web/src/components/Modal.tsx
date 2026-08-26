import { useRef } from "react";
import { FLOATING_CARD } from "../../../everything-shared/ui";
import { IconButton } from "./IconButton";

/** The one modal shell: dimmed backdrop, centred card, title row with a close
 *  button. A click that both starts and ends on the backdrop closes it, so a
 *  drag that leaves the card does not. */
export function Modal(props: {
  title: string;
  onClose: () => void;
  widthClassName?: string;
  children: React.ReactNode;
}) {
  const backdropPress = useRef(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => { backdropPress.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (backdropPress.current && e.target === e.currentTarget) props.onClose(); }}
    >
      <div className={`${FLOATING_CARD} max-h-[90vh] w-full space-y-3 overflow-y-auto p-6 ${props.widthClassName ?? "max-w-sm"}`}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-extrabold text-gray-900 dark:text-gray-100">{props.title}</h2>
          <IconButton label="Close" onClick={props.onClose}>
            <span className="text-xl leading-none">×</span>
          </IconButton>
        </div>
        {props.children}
      </div>
    </div>
  );
}
