/** Fozmu Studios "F" mark. */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="170 280 1650 1440" className={className} aria-label="F.S. Editor">
      <polygon points={LOGO.topShadow} fill="#1ba162" />
      <polygon points={LOGO.top} fill="#2aff98" />
      <polygon points={LOGO.lowShadow} fill="#16643f" />
      <polygon points={LOGO.low} fill="#13d47c" />
    </svg>
  );
}

export const LOGO = {
  topShadow: '522,338 1790,338 1448,654 250,654',
  top: '467,301 1735,301 1393,617 195,617',
  lowShadow: '472,807 1441,807 1191,1102 597,1102 597,1425 254,1693 254,1075',
  low: '417,734 1386,734 1136,1028 542,1028 542,1352 199,1620 199,1002',
};
