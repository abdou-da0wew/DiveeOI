# Technical Interview Question Bank

Applies to: rounds 1-2 (technical rounds) for engineering / algorithm / data / DevOps roles.

Tiered by seniority:
- **Junior (0-3 years)**: fundamentals + simple algorithms + project details
- **Mid-level (3-5 years)**: system design + complex scenario questions + deep project probing
- **Senior (5+ years)**: architecture trade-offs + cross-team problems + business understanding

## I. Backend / Server-Side

### Fundamentals (every company asks)
1. HTTP / HTTPS / TLS flow; session vs. cookie vs. token
2. TCP three-way handshake / four-way teardown — why 4 steps to close
3. MySQL index internals (B+ trees), when indexes fail, leftmost-prefix rule
4. MySQL transaction isolation levels + what problem each solves
5. Redis persistence (RDB / AOF) + replication + Sentinel + Cluster
6. Solving Redis cache breakdown / penetration / avalanche
7. Three implementations of distributed locks (Redis / ZooKeeper / database) + pitfalls of each
8. How Kafka guarantees no message loss, no duplication, and ordering
9. JVM memory model + GC (Java roles) / Goroutine scheduling (Go roles)
10. Consistent hashing, CAP, BASE, and a brief tour of Raft / Paxos

### High-Frequency System Design
- Design a flash-sale system (100k QPS)
- Design a URL shortener (creation / redirect / analytics)
- Design a distributed ID generator
- Design a Twitter/Weibo-style feed (push / pull / hybrid)
- Design a rate limiter (token bucket / leaky bucket / sliding window)

### System Design Answer Framework
```
1. Clarify requirements (ask about QPS, read/write ratio, data volume, SLA)
2. Estimate capacity (QPS × average request size = bandwidth; data volume × time = storage)
3. High-level architecture (access layer → business layer → storage layer → data flow)
4. Deep-dive key modules (explain why each choice was made)
5. Scalability / high availability / disaster recovery
6. Proactively call out trade-offs
```

## II. Frontend

1. Browser rendering pipeline (DNS → TCP → TLS → HTTP → HTML parsing → layout → paint)
2. Event loop + microtasks / macrotasks
3. Closures, prototype chain, `this` binding
4. React / Vue reactivity internals
5. Performance optimization (FCP / LCP / CLS metrics + hands-on tactics)
6. SSR vs. CSR vs. SSG — when to use which
7. Cross-origin solutions (CORS / JSONP / reverse proxy)
8. webpack vs. vite — differences and internals

## III. Algorithms / Machine Learning

### Fundamentals
1. Bias / variance; how to fix overfitting
2. L1 vs. L2 regularization
3. Random forest vs. GBDT vs. XGBoost
4. Vanishing / exploding gradients + fixes (BatchNorm / residuals / activation functions)
5. Explain the attention mechanism; Transformer vs. RNN
6. Handling imbalanced data (sampling / class weights / Focal Loss)
7. Model evaluation: accuracy, precision, recall, AUC, F1 — when to use which

### LLM / GenAI Direction (hot since 2024)
1. SFT vs. RLHF vs. DPO — principles + when to use
2. Full RAG pipeline: chunking strategy, embedding choice, retrieval fusion, reranker
3. Agent tool use / planning / memory, vs. a single LLM
4. Long context (YaRN / RoPE scaling, context-window extension)
5. Inference optimization: KV cache, speculative decoding, quantization
6. Evaluating LLMs: benchmarks, human eval, LLM-as-Judge — pitfalls of each

### Project Deep-Dives (every interviewer asks)
- Why did you choose ___ for this model instead of ___?
- How was the data labeled / cleaned, and at what scale?
- What hardware did training use, how long did it run, how were hyperparameters tuned?
- How did you evaluate production performance against baseline?
- Failure / bug cases — how did you debug them?

## IV. Data / Data Warehouse / Analytics

### SQL (guaranteed)
- Pivot rows to columns / columns to rows
- Window functions (rank / dense_rank / lead / lag)
- Computing 7-day / 30-day active users
- Consecutive login days per user
- Retention / funnel / cohort analysis
- Performance tuning (indexes, explain, partitioning, avoiding subqueries)

### Business Questions
- Given a business scenario, design a metrics system
- DAU dropped 5% — how do you investigate?
- Design an A/B test (sample size, significance, stopping rules)
- User segmentation models (RFM / lifecycle)

## V. Technical Interview Answering Principles

1. **Clarify before answering**: for vague questions, ask 1-2 clarifying questions first
2. **Structured output**: answer in points / modules, not a stream of consciousness
3. **Trade-off thinking**: when choosing A over B, proactively say "because ___"
4. **Honesty**: for questions you can't answer, say "I haven't studied this, but based on my understanding of X, I might approach it as ___"
5. **Draw / write code**: for whiteboard coding, explain the approach first, then write, then walk through test cases
