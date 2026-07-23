import { useState } from 'preact/hooks';
import { resetAllData } from '@/shared/resetAllData';

export function ResetDataButton() {
  const [confirming, setConfirming] = useState(false);
  const [cleared, setCleared] = useState(false);

  if (cleared) {
    return <div class="ff-reset-done">All data cleared.</div>;
  }

  if (confirming) {
    return (
      <div class="ff-reset-confirm">
        <span>Erase every trade, price, and customs record? This can't be undone.</span>
        <div class="ff-reset-confirm__actions">
          <button class="ff-reset-confirm__cancel" onClick={() => setConfirming(false)}>Cancel</button>
          <button
            class="ff-reset-confirm__go"
            onClick={async () => {
              await resetAllData();
              setCleared(true);
            }}
          >
            Yes, clear everything
          </button>
        </div>
      </div>
    );
  }

  return (
    <button class="ff-reset-trigger" onClick={() => setConfirming(true)}>
      Clear All Data
    </button>
  );
}
