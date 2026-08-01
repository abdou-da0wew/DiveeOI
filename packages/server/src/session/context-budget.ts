import { Context, Effect, Layer } from "effect"

import type { Provider } from "@/provider/provider"
import { COMPACTION_BUFFER } from "./overflow"

export type BudgetTier = "critically-limited" | "tight" | "normal" | "generous" | "unlimited"

export interface BudgetInfo {
  readonly tier: BudgetTier
  readonly totalTokens: number
  readonly usableTokens: number
  readonly usedTokens: number
  readonly remainingTokens: number
  readonly maxOutputTokens: number
}

export function compute(input: {
  model: Provider.Model
  currentTokenEstimate: number
  outputTokenMax?: number
}): BudgetInfo {
  const totalTokens = input.model.limit.context
  const maxOutput = input.outputTokenMax ?? input.model.limit.output
  const reserved = Math.min(COMPACTION_BUFFER, maxOutput)

  const usableTokens = input.model.limit.input !== undefined
    ? Math.max(0, input.model.limit.input - reserved)
    : Math.max(0, totalTokens - maxOutput)

  const remainingTokens = usableTokens - input.currentTokenEstimate

  const tier: BudgetTier =
    remainingTokens <= 2_000
      ? "critically-limited"
      : remainingTokens <= 8_000
        ? "tight"
        : remainingTokens <= 32_000
          ? "normal"
          : remainingTokens <= 100_000
            ? "generous"
            : "unlimited"

  return {
    tier,
    totalTokens,
    usableTokens,
    usedTokens: input.currentTokenEstimate,
    remainingTokens,
    maxOutputTokens: maxOutput,
  }
}

export interface Interface {
  readonly includeIdentity: (tier: BudgetTier) => Effect.Effect<boolean>
  readonly includeSkillsBlocks: (tier: BudgetTier) => Effect.Effect<boolean>
  readonly includeReminders: (tier: BudgetTier) => Effect.Effect<boolean>
  readonly includeReferences: (tier: BudgetTier) => Effect.Effect<boolean>
  readonly includeProjectLessons: (tier: BudgetTier) => Effect.Effect<boolean>
  readonly includeSessionContext: (tier: BudgetTier) => Effect.Effect<boolean>
  readonly includeResearchMode: (tier: BudgetTier) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/ContextBudget") {}

export const layer = Layer.effect(
  Service,
  Effect.succeed(
    Service.of({
      includeIdentity: Effect.fnUntraced(function* (tier: BudgetTier) {
        return tier !== "critically-limited"
      }),
      includeSkillsBlocks: Effect.fnUntraced(function* (tier: BudgetTier) {
        return tier === "normal" || tier === "generous" || tier === "unlimited"
      }),
      includeReminders: Effect.fnUntraced(function* (tier: BudgetTier) {
        return tier !== "critically-limited"
      }),
      includeReferences: Effect.fnUntraced(function* (tier: BudgetTier) {
        return tier === "generous" || tier === "unlimited"
      }),
      includeProjectLessons: Effect.fnUntraced(function* (tier: BudgetTier) {
        return tier === "generous" || tier === "unlimited"
      }),
      includeSessionContext: Effect.fnUntraced(function* (tier: BudgetTier) {
        return tier === "generous" || tier === "unlimited"
      }),
      includeResearchMode: Effect.fnUntraced(function* (tier: BudgetTier) {
        return tier === "normal" || tier === "generous" || tier === "unlimited"
      }),
    }),
  ),
)

export * as ContextBudget from "./context-budget"
