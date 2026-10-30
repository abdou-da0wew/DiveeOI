# Engineering / R&D / Data Interview Special Topics

Generic technical fundamentals + system design live in `technical.md`. This file focuses on:
- Project deep-dive talking points
- Role-specific questions for algorithm / LLM / data positions
- Team / soft-skill questions (engineering candidates get them too)

## Project Deep-Dives (every company asks)

Interviewers love "root-cause interrogation" — prepare for it.

For every project, be able to answer at least these 8 questions:

1. **Background** — Why was this project built? What business problem did it solve?
2. **Your role** — What was your role on the team? Which ___ module did you build?
3. **Tech choices** — Why X instead of Y? What were the trade-offs?
4. **Challenges** — What was the hardest technical problem? How did you solve it?
5. **Data** — What were the system's QPS / data volume / latency / availability?
6. **Results** — How did it perform after launch? Improvement over baseline ___?
7. **Failures / pitfalls** — What pitfalls did you hit? How did you debug? How do you prevent them?
8. **Improvement** — If you rebuilt this project today, what would you do differently?

## Algorithm / Machine Learning Role-Specific

### Business Understanding Questions
1. Given a ___ business, how would you frame an ML problem?
2. How do you collaborate with business / product / data teams?
3. A model underperforms after launch — how do you troubleshoot?
4. Model vs. rules — when do you choose which?
5. Have any of your models been decommissioned / replaced? Why?

### "Fake LLM Experience" Detection Questions for Algorithm Roles
- You say you know RLHF — how exactly is the KL term added in PPO? Why that way?
- You built RAG — how did you compute retrieval precision? Did you compare chunking strategies?
- You say you built an Agent — is the planning module ReAct / CoT / custom? How does error recovery work?

Self-protection: **only list projects you actually did** — fabricated LLM projects are the easiest to get caught.

## Data / Data Warehouse / Analytics Role-Specific

### Business Questions (very high frequency)
1. How do you measure the health of a ___ business?
2. DAU dropped 5% — how do you diagnose it?
3. Your most valuable data-analysis project
4. How do you communicate analysis conclusions to business stakeholders / product / leadership?
5. Given the data request "analyze why users are churning", what do you do?

### Live SQL Questions (guaranteed)
- Write SQL: each user's consecutive login days
- Write SQL: repurchase rate per product
- Write SQL: new users per day for the last 7 days
- Write SQL: A/B test result comparison + significance

Tip: **when writing SQL live, narrate your thinking as you write** — don't code in silence.

### Data Warehouse Modeling Questions
- How would you design a data model for a ___ business?
- Dimensional modeling vs. normalized modeling — how do you choose?
- How do you handle slowly changing dimensions / type-2 history tables?
- How is data quality assured (monitoring / inspections / retrospectives)?

## Soft-Skill Questions (engineering candidates get them too)

Assuming engineering roles only test tech = a big mistake. Mid-level and above will be asked:

1. You disagree with another team / PM / designer — what do you do?
2. How do you review other people's code / documents?
3. How do you mentor new team members?
4. Nobody responds to a technical decision you proposed — how do you drive it forward?
5. You inherit a legacy codebase — how do you refactor it?
6. How do you manage your own technical growth?

## Questions to Ask (technical / leader rounds)

Technical round:
- What is the team's tech stack and future roadmap?
- What technical challenges is the team facing recently?
- What do code review / on-call / weekly meeting processes look like?

Leader round:
- How do you see the future of ___ technology / business direction?
- What shape is the team's technical debt in?
- What do you find most challenging about this team?
