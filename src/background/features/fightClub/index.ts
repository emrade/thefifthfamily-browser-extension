import { storage } from '@/shared/storage';
import type { ExtensionMessage } from '@/shared/messaging';

export async function handleMessage(msg: ExtensionMessage) {
  if (msg.type !== 'fight-stats') return;
  await storage.setFightClubStats({ ...msg.heroStats, timestamp: msg.timestamp });
}
