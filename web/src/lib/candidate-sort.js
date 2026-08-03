export function sortCandidatesByMarketCap(items, direction) {
  if (!["asc", "desc"].includes(direction)) return items;
  const multiplier = direction === "asc" ? 1 : -1;
  return [...items].sort((left, right) => {
    const leftRaw = left.marketCap;
    const rightRaw = right.marketCap;
    const leftValue = Number(leftRaw);
    const rightValue = Number(rightRaw);
    const leftKnown = leftRaw !== null && leftRaw !== "" && Number.isFinite(leftValue);
    const rightKnown = rightRaw !== null && rightRaw !== "" && Number.isFinite(rightValue);
    if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
    if (!leftKnown) return 0;
    return (leftValue - rightValue) * multiplier;
  });
}
