import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  SubagentResult,
  SubagentRun,
  SubagentRuntime,
  SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'
import { runDebate, turnPrompt } from '../src/debate.ts'
import type { ConvergencePolicy, CoraRole } from '../src/types.ts'

const ROLES: CoraRole[] = [
  { name: 'Analytical', persona: 'derive it' },
  { name: 'Dimensional', persona: 'check the units' },
]

const POLICY: ConvergencePolicy = { maxRounds: 3, consensusThreshold: 0.85, stabilityThreshold: 0.05 }

/** One recorded start plus the prompt text the role received. */
interface StartedTurn {
  label: string
  prompt: string
}

/** A runtime stand-in that answers each role turn from a scripted table. */
function fakeRuntime(
  answer: (turn: StartedTurn, round: number) => SubagentResult,
): { subagents: SubagentRuntime; started: StartedTurn[]; disposed: number } {
  const started: StartedTurn[] = []
  const state = { disposed: 0 }
  const subagents = {
    async start(_provider: string, request: SubagentStartRequest): Promise<SubagentRun> {
      const prompt = request.prompt.map((block) => (block.type === 'text' ? block.text : '')).join('')
      const turn: StartedTurn = { label: request.label ?? '', prompt }
      started.push(turn)
      const round = Math.floor(started.length / ROLES.length) + (started.length % ROLES.length === 0 ? 0 : 1)
      return {
        id: `child-${started.length}` as SessionId,
        localAgent: undefined,
        result: Promise.resolve(answer(turn, round)),
        dispose: async () => {
          state.disposed += 1
        },
      }
    },
  } as unknown as SubagentRuntime
  return {
    subagents,
    started,
    get disposed() {
      return state.disposed
    },
  }
}

/** A completed child result carrying one text block. */
function completed(text: string): SubagentResult {
  return { output: [{ type: 'text', text }], stopReason: 'completed' }
}

const PARENT = {} as Agent

describe('runDebate', () => {
  it('stops once the roles agree, after one round per role', async () => {
    const fake = fakeRuntime(() => completed('the period is two seconds'))
    const outcome = await runDebate(fake.subagents, {
      problem: 'find the period',
      roles: ROLES,
      policy: POLICY,
      provider: 'spawn',
      parent: PARENT,
      signal: new AbortController().signal,
    })
    expect(outcome.stopReason).toBe('consensus')
    expect(outcome.rounds).toHaveLength(1)
    expect(outcome.rounds[0]?.solutions.map((solution) => solution.role)).toEqual(['Analytical', 'Dimensional'])
    expect(fake.started).toHaveLength(2)
    expect(fake.disposed).toBe(2)
  })

  it('runs refinement rounds that carry every peer solution, up to the ceiling', async () => {
    const fake = fakeRuntime((turn, round) => completed(`${turn.label} answer for round ${round}`))
    const outcome = await runDebate(fake.subagents, {
      problem: 'find the period',
      roles: ROLES,
      policy: POLICY,
      provider: 'spawn',
      parent: PARENT,
      signal: new AbortController().signal,
    })
    expect(outcome.stopReason).toBe('max-rounds')
    expect(outcome.rounds).toHaveLength(3)
    expect(outcome.rounds[1]?.oscillation).toBeGreaterThan(0)
    expect(fake.started[2]?.prompt).toContain('### Dimensional')
    expect(fake.started[2]?.prompt).toContain('Your previous solution')
  })

  it('ends the debate when a role produces nothing usable', async () => {
    const fake = fakeRuntime((turn) =>
      turn.label === 'Dimensional'
        ? { output: [], stopReason: 'error', diagnostic: 'model unavailable' }
        : completed('a solution'))
    const outcome = await runDebate(fake.subagents, {
      problem: 'find the period',
      roles: ROLES,
      policy: POLICY,
      provider: 'spawn',
      parent: PARENT,
      signal: new AbortController().signal,
    })
    expect(outcome.stopReason).toBe('role-failed')
    expect(outcome.failedRole).toBe('Dimensional')
    expect(outcome.rounds).toHaveLength(0)
  })
})

describe('turnPrompt', () => {
  it('asks for an independent solution in the first round', () => {
    const prompt = turnPrompt('find the period', ROLES[0]!, undefined)
    expect(prompt).toContain('Solve it from your specialty alone')
    expect(prompt).not.toContain('other specialists')
  })

  it('reports a missing own solution rather than omitting the section', () => {
    const previous = {
      index: 1,
      consensus: 1,
      solutions: [{ role: 'Dimensional', text: 'units check out', sessionId: 'child-1' }],
    }
    const prompt = turnPrompt('find the period', ROLES[0]!, previous)
    expect(prompt).toContain('Your previous solution:\n(none)')
    expect(prompt).toContain('units check out')
  })
})
