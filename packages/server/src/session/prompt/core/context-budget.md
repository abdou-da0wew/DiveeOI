<budget:token_budget>{tier}:{remaining}</budget:token_budget>

<context_budget>
  Your context window is limited to {total} tokens.
  Current usage: ~{used} tokens (estimated).
  Remaining: ~{remaining} tokens ({tier} tier).

  {tier-specific-instructions}
  - critically-limited (<=2K): Be extremely brief. Minimal tool calls. Only essential output.
  - tight (<=8K): Be concise. Skip explanations. One-line answers where possible.
  - normal (<=32K): Normal operation. Reasonable detail.
  - generous (<=100K): Full detail. Provide comprehensive explanations.
  - unlimited (>100K): Maximum detail. Full references. Verbose if helpful.

  If you notice the conversation growing very long, consider suggesting compaction to avoid hitting context limits.
</context_budget>
