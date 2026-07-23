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
