/** The one icon-button style: the close and overflow buttons on cards, menus
 *  and modals. A fixed 24px hit target, gray at rest in both themes, a subtle
 *  fill on hover. */
export function IconButton(props: {
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300 ${props.className ?? ""}`}
    >
      {props.children}
    </button>
  );
}
