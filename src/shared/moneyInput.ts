/**
 * Dollar-amount fields that add thousands separators as you type
 * ("1000000" shows as "1,000,000"), shared by the popup's MoneyInput and the
 * in-page Street Intel panel. Plain text inputs with a numeric keyboard —
 * `type="number"` can't hold the commas.
 */

/** "1,000,000" from any typed text; '' when there are no digits. */
export function formatDollars(text: string): string {
  const digits = text.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits ? Number(digits).toLocaleString('en-US') : '';
}

/** The amount in a field, or null when it holds no digits. */
export function parseDollars(text: string): number | null {
  const digits = text.replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

/** Reformats a field as it's typed in, keeping the caret after the same digit. */
export function reformatDollarInput(input: HTMLInputElement): void {
  const caret = input.selectionStart ?? input.value.length;
  const digitsBefore = input.value.slice(0, caret).replace(/\D/g, '').length;
  const next = formatDollars(input.value);
  if (next === input.value) return;
  input.value = next;
  let position = 0;
  for (let seen = 0; position < next.length && seen < digitsBefore; position++) {
    if (/\d/.test(next[position])) seen++;
  }
  input.setSelectionRange(position, position);
}
