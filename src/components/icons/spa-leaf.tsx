interface SpaLeafProps {
  className?: string;
  strokeOpacity?: number;
}

/**
 * Watercolor-style sprig of leaves — SPA branding icon.
 * Uses overlapping semi-transparent leaf shapes for soft, painted feel.
 */
export function SpaLeaf({ className, strokeOpacity = 0.5 }: SpaLeafProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="currentColor"
    >
      <defs>
        <linearGradient id="leaf-vein" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.95" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.55" />
        </linearGradient>
      </defs>

      {/* Stem — curving central line */}
      <path
        d="M 32 60 Q 30 48 28 36 Q 26 22 30 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity={strokeOpacity}
      />

      {/* Top leaf — pointed tip */}
      <path
        d="M 30 8 Q 22 6 19 14 Q 17 22 24 26 Q 30 26 32 19 Q 32 11 30 8 Z"
        opacity="0.85"
      />

      {/* Upper right leaf */}
      <path
        d="M 30 18 Q 40 16 44 24 Q 45 31 37 33 Q 30 32 28 24 Q 28 19 30 18 Z"
        opacity="0.7"
      />

      {/* Mid left leaf */}
      <path
        d="M 28 26 Q 18 26 14 34 Q 13 41 21 42 Q 28 41 30 33 Q 30 27 28 26 Z"
        opacity="0.75"
      />

      {/* Mid right leaf */}
      <path
        d="M 29 36 Q 39 36 42 44 Q 42 51 34 51 Q 28 50 27 42 Q 27 37 29 36 Z"
        opacity="0.6"
      />

      {/* Lower left leaf */}
      <path
        d="M 27 46 Q 18 46 15 53 Q 15 59 22 58 Q 28 57 29 50 Q 29 47 27 46 Z"
        opacity="0.55"
      />

      {/* Highlight veins for depth */}
      <path
        d="M 24 14 Q 26 19 28 24"
        stroke="url(#leaf-vein)"
        strokeWidth="0.6"
        fill="none"
        opacity="0.6"
      />
      <path
        d="M 37 22 Q 35 27 33 30"
        stroke="url(#leaf-vein)"
        strokeWidth="0.6"
        fill="none"
        opacity="0.5"
      />
      <path
        d="M 22 32 Q 25 36 27 38"
        stroke="url(#leaf-vein)"
        strokeWidth="0.6"
        fill="none"
        opacity="0.5"
      />
    </svg>
  );
}
