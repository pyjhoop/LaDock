import type { ReactNode } from 'react';

/** docs/design-mvp.html의 ICONS와 같은 16×16 선 아이콘 */
function icon(width: number, d: ReactNode) {
  return function Icon() {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={width} aria-hidden>
        {d}
      </svg>
    );
  };
}

export const IconMenu = icon(1.5, <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />);
export const IconPlus = icon(1.6, <path d="M8 3v10M3 8h10" />);
export const IconChevD = icon(1.6, <path d="M4 6l4 4 4-4" />);
export const IconClose = icon(1.5, <path d="M4 4l8 8M12 4l-8 8" />);
export const IconSplitR = icon(
  1.4,
  <>
    <rect x="2" y="2.5" width="12" height="11" rx="2" />
    <path d="M8 2.5v11" />
  </>,
);
export const IconSplitD = icon(
  1.4,
  <>
    <rect x="2" y="2.5" width="12" height="11" rx="2" />
    <path d="M2 8h12" />
  </>,
);
export const IconZoom = icon(
  1.4,
  <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" />,
);
export const IconUnzoom = icon(
  1.4,
  <path d="M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5 14 2M6.5 9.5 2 14" />,
);
export const IconMoon = icon(1.5, <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />);
export const IconSun = icon(
  1.5,
  <>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
  </>,
);
export const IconAuto = icon(
  1.5,
  <>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 2.5v11a5.5 5.5 0 0 0 0-11z" fill="currentColor" />
  </>,
);
export const IconGear = icon(
  1.4,
  <>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2" />
  </>,
);

export const IconFolder = icon(
  1.4,
  <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 1.8h5A1.5 1.5 0 0 1 14 6.3v5.2a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />,
);
export const IconFolderPlus = icon(
  1.4,
  <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 1.8h5A1.5 1.5 0 0 1 14 6.3v5.2a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5zM8 7.5v3.5M6.25 9.25h3.5" />,
);
export const IconFile = icon(
  1.3,
  <path d="M4 2h5l3 3v8.5a.5.5 0 0 1-.5.5h-7.5a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5zM9 2v3h3" />,
);
export const IconChevR = icon(1.6, <path d="M6 4l4 4-4 4" />);
export const IconRefresh = icon(1.4, <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" />);
export const IconBranch = icon(
  1.4,
  <path d="M5 2.5v7.2M5 9.7a2 2 0 1 0 0 .01M11 5.5a2 2 0 1 0 0-.01M11 7.5c0 2-3 1.7-6 2.2M5 2.5a1 1 0 1 0 0 .01" />,
);
export const IconPanelR = icon(
  1.4,
  <>
    <rect x="2" y="2.5" width="12" height="11" rx="2" />
    <path d="M10 2.5v11" />
  </>,
);
