/** The extension's icon, drawn from src/everything-extension/assets/icon.svg:
 *  a note card with two text lines and the three vote pills. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" aria-hidden="true">
      <rect x="4" y="4" width="120" height="120" rx="24" fill="#aecdf3" stroke="#2563eb" strokeWidth="6" />
      <line x1="26" y1="40" x2="102" y2="40" stroke="#1f2937" strokeWidth="8" strokeLinecap="round" />
      <line x1="26" y1="62" x2="86" y2="62" stroke="#1f2937" strokeWidth="8" strokeLinecap="round" />
      <rect x="24" y="82" width="24" height="18" rx="6" fill="#fecaca" stroke="#dc2626" strokeWidth="4" />
      <rect x="52" y="82" width="24" height="18" rx="6" fill="#fde68a" stroke="#d97706" strokeWidth="4" />
      <rect x="80" y="82" width="24" height="18" rx="6" fill="#bbf7d0" stroke="#16a34a" strokeWidth="4" />
    </svg>
  );
}
