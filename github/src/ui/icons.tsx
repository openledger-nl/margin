// 16px line icons, drawn for Margin. They take the text color.
import type { ComponentChildren } from 'preact';

function Svg({ children, label, class: cls }: { children: ComponentChildren; label?: string; class?: string }) {
  return (
    <svg
      class={`hb-icon${cls ? ` ${cls}` : ''}`}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
    >
      {label && <title>{label}</title>}
      {children}
    </svg>
  );
}

type P = { label?: string; class?: string };

export const RefreshIcon = (p: P) => (
  <Svg {...p}>
    <path d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71" />
    <path d="M13.25 2.5v3h-3" />
  </Svg>
);

export const SlidersIcon = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 4h6M12 4h1.5M2.5 8H4M7.5 8h6M2.5 12h7.5M13.5 12h0" />
    <circle cx="10.25" cy="4" r="1.5" />
    <circle cx="5.75" cy="8" r="1.5" />
    <circle cx="11.75" cy="12" r="1.5" />
  </Svg>
);

export const StarIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 1.75l1.9 3.9 4.3.6-3.1 3 .73 4.25L8 11.5l-3.83 2 .73-4.25-3.1-3 4.3-.6z" />
  </Svg>
);

export const BranchIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="4.5" r="1.5" />
    <path d="M4.5 5v6M11.5 6c0 3-7 2.5-7 5" />
  </Svg>
);

export const LockIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.25" y="7" width="9.5" height="6.75" rx="1.25" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </Svg>
);

export const ExternalIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9.5 2.75h3.75V6.5M13.25 2.75 7.5 8.5M11.5 9.5v3.75h-8.75V4.5H6.5" />
  </Svg>
);

export const PlusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);

export const PullRequestIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="12.5" r="1.5" />
    <path d="M4.5 5v6M11.5 11V6.5a2 2 0 0 0-2-2H7M8.5 3 7 4.5 8.5 6" />
  </Svg>
);

export const IssueIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.75" />
    <circle cx="8" cy="8" r="1" fill="currentColor" />
  </Svg>
);

export const BellIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 11V7a4 4 0 0 1 8 0v4l1 1.25H3z" />
    <path d="M6.5 14.25h3" />
  </Svg>
);

export const PersonIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="5.25" r="2.75" />
    <path d="M2.75 14a5.25 5.25 0 0 1 10.5 0" />
  </Svg>
);

export const CloseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);
