/**
 * Debate vocabulary shared by the round driver, the metrics module, and the
 * model-facing tool.
 *
 * @module @cora/cora-debate/types
 */

/** One specialist participating in a debate. */
export interface CoraRole {
  /** Model-facing name used in peer attributions (`Analitico`, `Dimensional`). */
  name: string
  /** Persona shadowing the deployment persona for this role's child agents. */
  persona: string
  /** Provider route for this role's child agents; omitted uses the child-loop default. */
  provider?: string
  /** Model id for this role's child agents; omitted uses the child-loop default. */
  model?: string
}

/** Why a debate stopped producing rounds. */
export type DebateStopReason =
  /** Mean pairwise similarity reached the consensus threshold. */
  | 'consensus'
  /** Mean per-role change fell below the stability threshold. */
  | 'stability'
  /** The configured round ceiling was reached. */
  | 'max-rounds'
  /** A role's child agent ended without a usable solution. */
  | 'role-failed'

/** One role's solution in one round. */
export interface RoleSolution {
  /** The role that produced it. */
  role: string
  /** The child agent's final assistant text. */
  text: string
  /** The child session id, so the full reasoning is recoverable from the log. */
  sessionId: string
}

/** Everything one round produced, including its convergence measurements. */
export interface DebateRound {
  /** One-based round index; round 1 holds the independent initial proposals. */
  index: number
  /** Each role's solution in role order. */
  solutions: RoleSolution[]
  /** Mean pairwise similarity across this round's solutions (C_r in [0,1]). */
  consensus: number
  /** Mean distance from each role's previous solution (O_r in [0,1]); `undefined` in round 1. */
  oscillation?: number
}

/** The debate's terminal record, returned by the `cora_debate` tool. */
export interface DebateOutcome {
  /** The problem every role received. */
  problem: string
  /** Every round in order. */
  rounds: DebateRound[]
  /** Why round production stopped. */
  stopReason: DebateStopReason
  /** The role whose child failed, present only for `role-failed`. */
  failedRole?: string
}

/** Stopping rule applied after each round. */
export interface ConvergencePolicy {
  /** Round ceiling; the debate always stops here. */
  maxRounds: number
  /** Consensus level (C_r) that ends the debate. */
  consensusThreshold: number
  /** Change level (O_r) below which the debate is considered stable. */
  stabilityThreshold: number
}
