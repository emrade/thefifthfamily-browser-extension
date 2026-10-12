import { useState } from 'preact/hooks';

interface NumberInputProps {
  value: number;
  /** Called with the parsed number on Enter / leaving the field / an arrow
   *  click. Not called when the field holds nothing usable. */
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  class?: string;
}

/**
 * A number field that keeps what's being typed or pasted until it's
 * committed. A plain controlled `<input value={stored}>` gets reset to the
 * stored value on every re-render, and the popups re-render every second
 * for their countdowns — so an edit was thrown away before `change` (which
 * only fires on Enter or blur) could save it.
 */
export function NumberInput({ value, onCommit, min, max, step, class: className }: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      class={className}
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft ?? String(value)}
      onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
      onChange={(e) => {
        const raw = (e.target as HTMLInputElement).value.trim();
        setDraft(null);
        const n = Number(raw);
        if (raw !== '' && Number.isFinite(n)) onCommit(n);
      }}
    />
  );
}
