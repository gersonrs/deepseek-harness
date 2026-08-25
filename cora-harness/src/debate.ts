/**
 * The CORA round driver: independent proposals, then peer-informed refinement
 * rounds, each measured and tested against the convergence policy. Every role
 * turn is one one-shot child agent on the configured `ctx.subagents` provider,
 * so each contribution keeps its own session log.
 *
 * @module @cora/cora-debate/debate
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentResult, SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { consensus, oscillation, stopReasonFor } from './metrics.ts'
import type {
  ConvergencePolicy,
  CoraRole,
  DebateOutcome,
  DebateRound,
  RoleSolution,
} from './types.ts'

/** What one debate needs from its caller. */
export interface DebateRequest {
  /** The problem statement every role receives verbatim. */
  problem: string
  /** The specialists, in the order they are presented to each other. */
  roles: readonly CoraRole[]
  /** Round ceiling and convergence thresholds. */
  policy: ConvergencePolicy
  /** The `ctx.subagents` provider every role turn starts on. */
  provider: string
  /** The agent delegating the debate; children inherit its workspace and lineage. */
  parent: Agent
  /** Caller cancellation covering every remaining role turn. */
  signal: AbortSignal
}

/** The role turn that produced no usable solution, with the reason to report. */
interface FailedTurn {
  role: string
  reason: string
}

/** One role turn's outcome: its solution, or the failure that ends the debate. */
type TurnOutcome = { solution: RoleSolution } | { failure: FailedTurn }

/**
 * Run one debate to its stopping condition.
 * @param subagents - the registry the role turns start on.
 * @param request - problem, roles, provider, policy, delegating agent, and cancellation.
 * @returns every measured round and the reason production stopped.
 */
export async function runDebate(
  subagents: SubagentRuntime,
  request: DebateRequest,
): Promise<DebateOutcome> {
  const rounds: DebateRound[] = []
  for (let index = 1; index <= request.policy.maxRounds; index += 1) {
    const previous = rounds[rounds.length - 1]
    const outcomes = await Promise.all(
      request.roles.map((role) => runRoleTurn(subagents, request, role, previous)),
    )
    const solutions: RoleSolution[] = []
    for (const outcome of outcomes) {
      if ('failure' in outcome) {
        return {
          problem: request.problem,
          rounds,
          stopReason: 'role-failed',
          failedRole: outcome.failure.role,
        }
      }
      solutions.push(outcome.solution)
    }
    const change = previous === undefined ? undefined : oscillation(previous.solutions, solutions)
    const round: DebateRound = {
      index,
      solutions,
      consensus: consensus(solutions),
      ...change === undefined ? {} : { oscillation: change },
    }
    rounds.push(round)
    const stopReason = stopReasonFor(round, request.policy)
    if (stopReason !== undefined) return { problem: request.problem, rounds, stopReason }
  }
  return { problem: request.problem, rounds, stopReason: 'max-rounds' }
}

/**
 * Run one role's turn as a one-shot child agent.
 * @param subagents - the registry the child starts on.
 * @param request - the debate this turn belongs to.
 * @param role - the specialist taking the turn.
 * @param previous - the previous round, absent for the initial proposals.
 * @returns the role's solution, or the failure that ends the debate.
 */
async function runRoleTurn(
  subagents: SubagentRuntime,
  request: DebateRequest,
  role: CoraRole,
  previous: DebateRound | undefined,
): Promise<TurnOutcome> {
  const run = await subagents.start(request.provider, {
    label: role.name,
    persona: role.persona,
    prompt: [{ type: 'text', text: turnPrompt(request.problem, role, previous) }],
    parent: request.parent,
    signal: request.signal,
    ...role.provider === undefined && role.model === undefined
      ? {}
      : {
          agentOptions: {
            ...role.provider === undefined ? {} : { provider: role.provider },
            ...role.model === undefined ? {} : { model: role.model },
          },
        },
  })
  let result: SubagentResult
  try {
    result = await run.result
  } finally {
    await run.dispose()
  }
  if (result.stopReason !== 'completed') {
    return { failure: { role: role.name, reason: result.diagnostic ?? result.stopReason } }
  }
  const text = textOf(result.output)
  if (text === '') return { failure: { role: role.name, reason: 'produced no text' } }
  return { solution: { role: role.name, text, sessionId: run.id } }
}

/**
 * The prompt one role receives for one round.
 * @param problem - the problem statement.
 * @param role - the specialist taking the turn.
 * @param previous - the previous round, absent for the initial proposals.
 * @returns the initial-proposal prompt, or the refinement prompt carrying every peer solution.
 */
export function turnPrompt(
  problem: string,
  role: CoraRole,
  previous: DebateRound | undefined,
): string {
  if (previous === undefined) {
    return [
      `Problem:\n${problem}`,
      'Solve it from your specialty alone. State your reasoning steps and end with your answer.',
    ].join('\n\n')
  }
  const own = previous.solutions.find((solution) => solution.role === role.name)
  const peers = previous.solutions
    .filter((solution) => solution.role !== role.name)
    .map((solution) => `### ${solution.role}\n${solution.text}`)
    .join('\n\n')
  return [
    `Problem:\n${problem}`,
    `Your previous solution:\n${own?.text ?? '(none)'}`,
    `Solutions from the other specialists:\n\n${peers}`,
    'Review their work for errors, then restate your own complete solution — corrected where they convinced you, unchanged where they did not. End with your answer.',
  ].join('\n\n')
}

/**
 * The visible text of a child's final output.
 * @param output - the child's terminal content blocks.
 * @returns the concatenated text blocks, empty when the child produced none.
 */
function textOf(output: readonly ContentBlock[]): string {
  return output
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
}
