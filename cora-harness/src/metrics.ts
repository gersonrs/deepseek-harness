/**
 * Convergence measurements over a debate round: mean pairwise similarity
 * (consensus) and mean per-role change (oscillation), plus the stopping rule
 * that reads them. Similarity is token-set overlap over case-folded words and
 * numbers, which is comparable across LaTeX and prose without a model call.
 *
 * @module @cora/cora-debate/metrics
 */

import type { ConvergencePolicy, DebateRound, DebateStopReason, RoleSolution } from './types.ts'

/** Word and number tokens; every other character separates tokens. */
const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu

/**
 * Case-folded token set of one solution text.
 * @param text - solution text as the child agent produced it.
 * @returns the distinct tokens, empty for text with no word or number characters.
 */
export function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(TOKEN_PATTERN) ?? [])
}

/**
 * Jaccard similarity of two solution texts.
 * @param left - one solution text.
 * @param right - the other solution text.
 * @returns overlap in [0,1]; two empty texts are identical and score 1.
 */
export function similarity(left: string, right: string): number {
  const a = tokenize(left)
  const b = tokenize(right)
  if (a.size === 0 && b.size === 0) return 1
  let shared = 0
  for (const token of a) if (b.has(token)) shared += 1
  return shared / (a.size + b.size - shared)
}

/**
 * Mean pairwise similarity across one round's solutions (C_r).
 * @param solutions - every role's solution in one round.
 * @returns consensus in [0,1]; a single solution has nothing to disagree with and scores 1.
 */
export function consensus(solutions: readonly RoleSolution[]): number {
  if (solutions.length < 2) return 1
  let total = 0
  let pairs = 0
  for (let i = 0; i < solutions.length; i += 1) {
    for (let j = i + 1; j < solutions.length; j += 1) {
      total += similarity(solutions[i]!.text, solutions[j]!.text)
      pairs += 1
    }
  }
  return total / pairs
}

/**
 * Mean distance between each role's consecutive solutions (O_r).
 * @param previous - the previous round's solutions.
 * @param current - this round's solutions.
 * @returns change in [0,1] over the roles present in both rounds; `undefined` when no role is.
 */
export function oscillation(
  previous: readonly RoleSolution[],
  current: readonly RoleSolution[],
): number | undefined {
  const before = new Map(previous.map((solution) => [solution.role, solution.text]))
  let total = 0
  let compared = 0
  for (const solution of current) {
    const earlier = before.get(solution.role)
    if (earlier === undefined) continue
    total += 1 - similarity(earlier, solution.text)
    compared += 1
  }
  return compared === 0 ? undefined : total / compared
}

/**
 * The stopping rule applied after a round is measured.
 * @param round - the round just completed, carrying its own measurements.
 * @param policy - the configured thresholds and round ceiling.
 * @returns the reason to stop, or `undefined` to run another round.
 */
export function stopReasonFor(
  round: DebateRound,
  policy: ConvergencePolicy,
): DebateStopReason | undefined {
  if (round.consensus >= policy.consensusThreshold) return 'consensus'
  if (round.oscillation !== undefined && round.oscillation < policy.stabilityThreshold) return 'stability'
  if (round.index >= policy.maxRounds) return 'max-rounds'
  return undefined
}
