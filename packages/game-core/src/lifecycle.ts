import type { GameStatus } from '@turtle-soup/contracts';

export function canAcceptGameplayAction(status: GameStatus): boolean {
  return status === 'ACTIVE';
}
