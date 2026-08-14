export function isFinalAnswerSuccessful(
  allIds: readonly string[],
  coveredIds: readonly string[],
): boolean {
  const all = new Set(allIds);
  const covered = new Set(coveredIds);

  return covered.size === all.size && [...all].every((id) => covered.has(id));
}
