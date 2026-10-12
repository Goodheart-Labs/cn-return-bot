import { FEATURE_TREE, enabledFeatures, type FeatureNode } from "@cn/core/minisiteFeatures";

/** The nested checklist of reader features. Unticking a parent greys out its
 *  children, because they only count while the parent is on. */
export function FeatureChecklist({ value, onChange }: { value: readonly string[]; onChange: (next: string[]) => void }) {
  const picked = new Set(value);
  const effective: ReadonlySet<string> = enabledFeatures(value);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id); else next.delete(id);
    onChange([...next]);
  };
  const render = (nodes: readonly FeatureNode[]) => <ul className="minisite-checklist">
    {nodes.map((node) => {
      const inputId = `feature-${node.id.replace(/\./g, "-")}`;
      const active = effective.has(node.id);
      return <li key={node.id} className={active ? "" : "minisite-checklist-off"}>
        <div className="minisite-checklist-row">
          <input id={inputId} type="checkbox" checked={picked.has(node.id)} aria-describedby={`${inputId}-description`} onChange={(event) => toggle(node.id, event.target.checked)} />
          <label htmlFor={inputId}>{node.label}</label>
          <p id={`${inputId}-description`}>{node.description}</p>
        </div>
        {node.children && render(node.children)}
      </li>;
    })}
  </ul>;
  return render(FEATURE_TREE);
}
