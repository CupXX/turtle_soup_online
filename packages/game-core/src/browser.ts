import type { JudgeVerdict } from '@turtle-soup/contracts';

// Browser-safe leaf entrypoint for UI components. The package root keeps Node
// ESM extensions, while this source-only entry lets Next/Turbopack resolve the
// deterministic reaction without importing the Node ESM barrel. Keep this map
// aligned with src/verdict.ts; both are covered by the same public contract.
export type VerdictReaction = '✅' | '❌' | '❓' | '👎';

const REACTIONS: Record<JudgeVerdict, VerdictReaction> = {
  YES: '✅',
  NO: '❌',
  BOTH: '❓',
  IRRELEVANT: '👎',
};

export function reactionForVerdict(verdict: JudgeVerdict): VerdictReaction {
  return REACTIONS[verdict];
}
