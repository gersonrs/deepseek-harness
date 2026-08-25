/**
 * The `cora_debate` tool: a coordinator agent submits one problem, every
 * configured specialist solves it as a one-shot child agent, and refinement
 * rounds continue until the convergence policy stops them. The canonical
 * result carries each round's solutions and measurements, so the coordinator
 * consolidates from recorded contributions rather than from prose it must
 * re-parse.
 *
 * @module @cora/cora-debate
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-subagent'
import { runDebate } from './debate.ts'
import type { ConvergencePolicy, CoraRole } from './types.ts'

export type * from './types.ts'
export { consensus, oscillation, similarity, stopReasonFor, tokenize } from './metrics.ts'
export { runDebate, turnPrompt } from './debate.ts'

export const name = 'cora-debate'
export const inject = ['tools', 'subagents']

/** Deployment configuration for one debate tool instance. */
export interface Config {
  /** The `ctx.subagents` provider every role turn starts on; it must support per-child personas. */
  provider: string
  /** The specialists that debate every problem, in presentation order. */
  roles: CoraRole[]
  /** Round ceiling and convergence thresholds. */
  convergence: ConvergencePolicy
  /** Model-facing tool name; each loaded instance must use a distinct one. */
  toolName: string
}

/** Canonical result of one debate: every round with its solutions and measurements. */
const OUTCOME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    problem: { type: 'string', required: true },
    stopReason: { type: 'string', required: true, description: 'consensus, stability, max-rounds, or role-failed.' },
    failedRole: { type: 'string', description: 'The specialist whose run failed, for `role-failed` only.' },
    rounds: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'number', required: true },
          consensus: { type: 'number', required: true, description: 'Mean pairwise agreement in [0,1].' },
          oscillation: { type: 'number', description: 'Mean change from the previous round in [0,1].' },
          solutions: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                role: { type: 'string', required: true },
                text: { type: 'string', required: true },
                sessionId: { type: 'string', required: true, description: 'The child session holding the full reasoning.' },
              },
            },
          },
        },
      },
    },
  },
} as const satisfies ValueSchemaSpec

/** Schemastery configuration for the debate tool consumer. */
export const Config: z<Config> = z.object({
  provider: z.string().required(),
  roles: z.array(z.object({
    name: z.string().required(),
    persona: z.string().required(),
    provider: z.string(),
    model: z.string(),
  })).required(),
  convergence: z.object({
    maxRounds: z.natural().min(1).max(20).default(4),
    consensusThreshold: z.number().min(0).max(1).default(0.85),
    stabilityThreshold: z.number().min(0).max(1).default(0.05),
  }).default({ maxRounds: 4, consensusThreshold: 0.85, stabilityThreshold: 0.05 }),
  toolName: z.string().default('cora_debate'),
})

/**
 * Register the debate tool for the configured specialists.
 * @param ctx - the context the tool is registered on.
 * @param config - provider, roles, convergence policy, and tool name.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.roles.length < 2) {
    throw new Error('cora-debate needs at least two roles: one specialist cannot cross-check itself')
  }
  const names = new Set(config.roles.map((role) => role.name))
  if (names.size !== config.roles.length) {
    throw new Error('cora-debate role names must be distinct: peer solutions are attributed by name')
  }
  ctx.tools.register(defineTool({
    name: config.toolName,
    description:
      `Solve one problem by structured debate between ${config.roles.length} specialists `
      + `(${config.roles.map((role) => role.name).join(', ')}). Each one solves it independently, `
      + 'then reads the others and revises, until they converge or the round limit is reached. '
      + 'Returns every round with each specialist\'s solution and the measured agreement, for you '
      + 'to consolidate into one answer. Use it for problems where an independent check is worth '
      + 'the extra model calls; solve simple questions yourself.',
    parameters: {
      problem: { type: 'string', required: true, description: 'The complete problem statement, self-contained.' },
    },
    output: {
      schema: OUTCOME_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderOutcome(value) }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) {
        // Every role turn is a child of the calling agent; a non-agent caller
        // has no lineage or workspace to spawn them from.
        throw new Error(`${config.toolName} requires an owning agent session`)
      }
      return runDebate(ctx.subagents, {
        problem: args.problem,
        roles: config.roles,
        policy: config.convergence,
        provider: config.provider,
        parent: exec.agent,
        signal: exec.signal,
      })
    },
    presentCall: (args) => ({ card: 'generic', title: `cora debate: ${args.problem.slice(0, 60)}` }),
  }))
}

/**
 * Model-facing rendering of one debate.
 * @param outcome - the debate's terminal record.
 * @returns each round's measurements followed by the final solutions.
 */
function renderOutcome(outcome: InferValue<typeof OUTCOME_SCHEMA>): string {
  const last = outcome.rounds[outcome.rounds.length - 1]
  const trace = outcome.rounds
    .map((round) => {
      const change = round.oscillation === undefined ? '' : `, change ${round.oscillation.toFixed(2)}`
      return `round ${round.index}: agreement ${round.consensus.toFixed(2)}${change}`
    })
    .join('\n')
  const failure = outcome.failedRole === undefined ? '' : ` (${outcome.failedRole} failed)`
  const solutions = last === undefined
    ? 'No round completed.'
    : last.solutions.map((solution) => `## ${solution.role}\n${solution.text}`).join('\n\n')
  return `Debate ended: ${outcome.stopReason}${failure}\n${trace}\n\n${solutions}`
}
