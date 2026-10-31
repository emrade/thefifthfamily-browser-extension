import { useState } from 'preact/hooks';
import { formatDollars, parseDollars, reformatDollarInput } from '@/shared/moneyInput';

interface MoneyInputProps {
  /** Whole dollars. */
  value: number;
  /** Called with the amount on Enter / leaving the field. Not called when
   *  the field holds no digits. */
  onCommit: (value: number) => void;
  class?: string;
}

/**
 * A dollar field showing "1,000,000" as it's typed. Keeps the draft until
 * it's committed, for the same re-render reason as NumberInput.
 */
export function MoneyInput({ value, onCommit, class: className }: MoneyInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      class={className}
      type="text"
      inputMode="numeric"
      value={draft ?? formatDollars(String(value))}
      onInput={(e) => {
        const input = e.target as HTMLInputElement;
        reformatDollarInput(input);
        setDraft(input.value);
      }}
      onChange={(e) => {
        const amount = parseDollars((e.target as HTMLInputElement).value);
        setDraft(null);
        if (amount !== null) onCommit(amount);
      }}
    />
  );
}
