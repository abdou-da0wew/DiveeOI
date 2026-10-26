// packages/learning/src/retrieve/rrf.ts
//
// Reciprocal Rank Fusion (plan §8.1).
// Pure function, no side effects. Tested in test/rrf.test.ts.

export const rrf = (
  bm25Ranked: string[],
  denseRanked: string[],
  k: number,
  weightBm25 = 1.0,
  weightDense = 1.0,
): Map<string, number> => {
  const scores = new Map<string, number>()
  bm25Ranked.forEach((id, rank) => {
    scores.set(id, (scores.get(id) ?? 0) + weightBm25 / (k + rank + 1))
  })
  denseRanked.forEach((id, rank) => {
    scores.set(id, (scores.get(id) ?? 0) + weightDense / (k + rank + 1))
  })
  return scores
}
