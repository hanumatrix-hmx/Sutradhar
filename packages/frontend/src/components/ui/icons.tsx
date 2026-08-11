/**
 * @file packages/frontend/src/components/ui/icons.tsx
 * @description Single inline-SVG icon module — the only icon source in the app.
 *
 * Rules (UX_OVERHAUL_PROMPT §4.5):
 *  - stroke 1.5, round caps/joins, no fills
 *  - zero emoji in controls — use these instead
 *  - icons sit in soft circular wells when actionable (CSS handles the well)
 */

import React from 'react';

export interface IconProps {
  /** Pixel size (square). Defaults to 16. */
  size?: number;
  /** Stroke width override. Defaults to 1.5. */
  strokeWidth?: number;
  className?: string;
}

function makeIcon(paths: React.ReactNode) {
  const Icon: React.FC<IconProps> = ({ size = 16, strokeWidth = 1.5, className }) => (
    // Stroke lives on the <svg> so EVERY descendant shape inherits it.
    // (Cloning children missed fragment-wrapped paths → blank icons.)
    // Children may still override with their own strokeWidth attribute.
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={{ flexShrink: 0 }}
    >
      {paths}
    </svg>
  );
  return Icon;
}

/* -- Navigation / structure ------------------------------------------ */

export const IconLayers = makeIcon(
  <>
    <path d="M8 2L14 5.5V10.5L8 14L2 10.5V5.5L8 2Z" />
    <path d="M2 5.5L8 9L14 5.5" />
  </>,
);

export const IconHome = makeIcon(
  <>
    <path d="M2.5 7.5L8 2.5L13.5 7.5" />
    <path d="M4 6.5V13.5H12V6.5" />
  </>,
);

export const IconSettings = makeIcon(
  <>
    <path d="M6.8 1.8h2.4l.4 1.7a5.3 5.3 0 0 1 1.3.7l1.7-.7 1.7 1.7-.7 1.7c.3.4.5.9.7 1.3l1.7.4v2.4l-1.7.4a5.3 5.3 0 0 1-.7 1.3l.7 1.7-1.7 1.7-1.7-.7a5.3 5.3 0 0 1-1.3.7l-.4 1.7H6.8l-.4-1.7a5.3 5.3 0 0 1-1.3-.7l-1.7.7-1.7-1.7.7-1.7a5.3 5.3 0 0 1-.7-1.3l-1.7-.4V6.8l1.7-.4a5.3 5.3 0 0 1 .7-1.3l-.7-1.7 1.7-1.7 1.7.7a5.3 5.3 0 0 1 1.3-.7l.4-1.7z" strokeWidth={1.2} />
    <circle cx="8" cy="8" r="2.2" strokeWidth={1.2} />
  </>,
);

export const IconSearch = makeIcon(
  <>
    <circle cx="6.5" cy="6.5" r="4" />
    <path d="M10 10L13.5 13.5" />
  </>,
);

export const IconDownload = makeIcon(
  <>
    <path d="M8 2v8M5 7l3 3 3-3" />
    <path d="M2 12h12" />
  </>,
);

export const IconClock = makeIcon(
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5V8l2.5 1.5" />
  </>,
);

/* -- Actions ---------------------------------------------------------- */

export const IconPlay = makeIcon(<path d="M5 3.5L12 8L5 12.5V3.5Z" />);

export const IconPause = makeIcon(
  <>
    <path d="M5.5 3.5v9" />
    <path d="M10.5 3.5v9" />
  </>,
);

export const IconStop = makeIcon(
  <rect x="4" y="4" width="8" height="8" rx="1.5" />,
);

export const IconRefresh = makeIcon(
  <>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
    <path d="M13.5 1.5v3h-3" />
  </>,
);

export const IconCopy = makeIcon(
  <>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </>,
);

export const IconPlus = makeIcon(<path d="M8 3v10M3 8h10" />);

export const IconX = makeIcon(<path d="M4 4l8 8M12 4l-8 8" />);

export const IconCheck = makeIcon(<path d="M3 8.5L6.5 12L13 4.5" />);

export const IconTrash = makeIcon(
  <>
    <path d="M2.5 4h11" />
    <path d="M5.5 4V2.5h5V4" />
    <path d="M4 4l.8 9.5h6.4L12 4" />
  </>,
);

export const IconExternal = makeIcon(
  <>
    <path d="M9 2.5h4.5V7" />
    <path d="M13.5 2.5L7 9" />
    <path d="M11.5 9.5v4h-9v-9h4" />
  </>,
);

export const IconChevronDown = makeIcon(<path d="M4 6l4 4 4-4" />);
export const IconChevronUp = makeIcon(<path d="M4 10l4-4 4 4" />);
export const IconChevronRight = makeIcon(<path d="M6 4l4 4-4 4" />);

export const IconArrowLeft = makeIcon(<path d="M13 8H3M7 4L3 8l4 4" />);
export const IconArrowRight = makeIcon(<path d="M3 8h10M9 4l4 4-4 4" />);

/* -- Status / feedback -------------------------------------------------- */

export const IconCheckCircle = makeIcon(
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M5.5 8.5L7.2 10.2L10.7 6" />
  </>,
);

export const IconXCircle = makeIcon(
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M6 6l4 4M10 6l-4 4" />
  </>,
);

export const IconAlert = makeIcon(
  <>
    <path d="M8 2L14.5 13.5H1.5L8 2Z" />
    <path d="M8 6.5v3" />
    <path d="M8 11.5v.01" />
  </>,
);

export const IconInfo = makeIcon(
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.5v3.5" />
    <path d="M8 5v.01" />
  </>,
);

/* -- Browser / session --------------------------------------------------- */

export const IconGlobe = makeIcon(
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M2 8h12" />
    <path d="M8 2c1.8 1.7 2.7 3.7 2.7 6s-.9 4.3-2.7 6c-1.8-1.7-2.7-3.7-2.7-6S6.2 3.7 8 2Z" />
  </>,
);

export const IconLock = makeIcon(
  <>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </>,
);

export const IconLockOpen = makeIcon(
  <>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" />
  </>,
);

export const IconTerminal = makeIcon(
  <>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M5 7l2.2 2.2L5 11.4M8.8 11h2.7" />
  </>,
);

export const IconKeyboard = makeIcon(
  <>
    <rect x="1.5" y="4" width="13" height="8.5" rx="1.5" />
    <path d="M4 7h.01M6.7 7h.01M9.4 7h.01M12 7h.01M4 9.7h.01M6.7 9.7h.01M9.4 9.7h.01M12 9.7h.01M5.5 12h5" strokeWidth={1.2} />
  </>,
);

export const IconSparkle = makeIcon(
  <>
    <path d="M8 2l1.4 4.1L13.5 8l-4.1 1.9L8 14l-1.4-4.1L2.5 8l4.1-1.9L8 2Z" />
  </>,
);

/* -- Theme ---------------------------------------------------------------- */

export const IconSun = makeIcon(
  <>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.55 3.55l1.06 1.06M11.39 11.39l1.06 1.06M3.55 12.45l1.06-1.06M11.39 4.61l1.06-1.06" />
  </>,
);

export const IconMoon = makeIcon(
  <path d="M13.5 10A6 6 0 0 1 6 2.5a6 6 0 1 0 7.5 7.5Z" />,
);
