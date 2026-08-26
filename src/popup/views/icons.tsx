const commonProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function CashIcon() {
  return (
    <svg {...commonProps}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.75" />
      <circle cx="6" cy="9" r="0.4" fill="currentColor" />
      <circle cx="18" cy="15" r="0.4" fill="currentColor" />
    </svg>
  );
}

export function ChevronRightIcon() {
  return (
    <svg {...commonProps} width={14} height={14}>
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

export function ChevronLeftIcon() {
  return (
    <svg {...commonProps} width={12} height={12}>
      <polyline points="15 6 9 12 15 18" />
    </svg>
  );
}

export function FightClubIcon() {
  return (
    <svg {...commonProps}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="1" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="1" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="23" y2="12" />
    </svg>
  );
}

/** Stacked database platters — the archive is a local store of recorded traffic. */
export function ArchiveIcon() {
  return (
    <svg {...commonProps}>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
      <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </svg>
  );
}

export function BriefcaseIcon() {
  return (
    <svg {...commonProps}>
      <rect x="2" y="7" width="20" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="2" y1="12" x2="22" y2="12" />
    </svg>
  );
}

export function CrosshairIcon() {
  return (
    <svg {...commonProps}>
      <circle cx="12" cy="12" r="8" />
      <line x1="12" y1="1" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="23" />
      <line x1="1" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="23" y2="12" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg {...commonProps}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="11" cy="17" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
