import { describe, expect, it } from 'vitest'
import { consensus, oscillation, similarity, stopReasonFor } from '../src/metrics.ts'
import type { ConvergencePolicy, DebateRound, RoleSolution } from '../src/types.ts'

const POLICY: ConvergencePolicy = { maxRounds: 3, consensusThreshold: 0.85, stabilityThreshold: 0.05 }

/** Build a solution with a synthetic session id. */
function solution(role: string, text: string): RoleSolution {
  return { role, text, sessionId: `session-${role}` }
}

/** Build a measured round from its solutions and an optional oscillation. */
function round(index: number, solutions: RoleSolution[], change?: number): DebateRound {
  return {
    index,
    solutions,
    consensus: consensus(solutions),
    ...change === undefined ? {} : { oscillation: change },
  }
}

describe('similarity', () => {
  it('ignores case and punctuation', () => {
    expect(similarity('v = 9.8 m/s', 'V = 9.8 M/S')).toBe(1)
  })

  it('scores disjoint texts as zero and empty texts as identical', () => {
    expect(similarity('alpha beta', 'gamma delta')).toBe(0)
    expect(similarity('', '  ')).toBe(1)
  })
})

describe('consensus', () => {
  it('averages every pair', () => {
    const solutions = [solution('a', 'x y'), solution('b', 'x y'), solution('c', 'z w')]
    expect(consensus(solutions)).toBeCloseTo(1 / 3)
  })

  it('treats a lone solution as agreed', () => {
    expect(consensus([solution('a', 'x')])).toBe(1)
  })
})

describe('oscillation', () => {
  it('averages each role change and ignores roles absent from the previous round', () => {
    const previous = [solution('a', 'x y'), solution('b', 'p q')]
    const current = [solution('a', 'x y'), solution('b', 'r s'), solution('c', 'new')]
    expect(oscillation(previous, current)).toBeCloseTo(0.5)
  })

  it('reports no change measurement when no role carried over', () => {
    expect(oscillation([solution('a', 'x')], [solution('b', 'y')])).toBeUndefined()
  })
})

describe('stopReasonFor', () => {
  it('stops on consensus before the round ceiling', () => {
    const agreed = round(1, [solution('a', 'x y'), solution('b', 'x y')])
    expect(stopReasonFor(agreed, POLICY)).toBe('consensus')
  })

  it('stops when the roles stopped changing', () => {
    const stable = round(2, [solution('a', 'x y'), solution('b', 'p q')], 0.01)
    expect(stopReasonFor(stable, POLICY)).toBe('stability')
  })

  it('continues while the roles still disagree and still move', () => {
    const moving = round(2, [solution('a', 'x y'), solution('b', 'p q')], 0.4)
    expect(stopReasonFor(moving, POLICY)).toBeUndefined()
  })

  it('stops at the round ceiling', () => {
    const last = round(3, [solution('a', 'x y'), solution('b', 'p q')], 0.4)
    expect(stopReasonFor(last, POLICY)).toBe('max-rounds')
  })
})
