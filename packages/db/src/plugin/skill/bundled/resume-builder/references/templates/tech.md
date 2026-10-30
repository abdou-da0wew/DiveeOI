# Engineering / R&D / Data Resume Template

## Structure

```
Name | Phone | Email | GitHub | City | Target role

[Personal Profile / Summary] (optional, 1-2 lines)
X years of ___ experience, focused on ___ (high-concurrency backend / recommender systems / LLM applications / ...), familiar with the ___ stack

[Skills] (engineering roles put it first — HR checks stack fit at a glance)
- Languages: Java (expert), Python (proficient), Go (familiar)
- Backend: Spring Boot, Spring Cloud, gRPC, Kafka, Redis, MySQL, ClickHouse
- Big data / ML: Spark, Flink, Hive, PyTorch (for algorithm roles)
- Infrastructure: Docker, Kubernetes, Linux, Git, CI/CD
- Other: TypeScript, AWS

[Work Experience]
Company A | Level (Senior Engineer / Staff Engineer / Tech Lead) | Dates
- System-level achievements (with numbers: QPS, latency, availability, scale)
- Architecture / design contributions (what you designed and why you chose it)
- Business impact (what business results you drove)

[Project Experience]
Project name | Role | Tech stack | Dates
- Background: business scale / pain point (one sentence)
- Solution: your core design + key technical decisions (explain why)
- Results: performance / stability / cost numbers

[Education]

[Open Source / Papers / Competitions] (strong plus)
- GitHub projects (star count / major contributor)
- Papers (name the conference / journal)
- Competitions (Kaggle / ACM / Tianchi / hackathons, with placement)
```

## Style Points

- **Fewer adjectives, more numbers + technical detail**
  - Weak: "optimized system performance"
  - Strong: "introduced a secondary cache + SQL rewrites, cutting the product-detail API's P99 from 480ms to 110ms"
- **Make clear "what YOU did" vs. "what the team did"**: use "led" / "owned" to draw the ownership boundary
- Algorithm roles: in the skills list, **name specific model / framework versions** (avoid buzzword pileups)
- LLM / Agent roles: state exactly which of "training / fine-tuning / inference / application" you did, so you're not mistaken for prompt-only
- Length: 1-2 pages

## Common Landmines

- Writing "expert" on the resume and going blank when asked in the interview → if you're not fluent, write "proficient / familiar"
- Listing 20+ skills but shallow on all → trim to the 8-12 you truly know
- Passing off coursework as project experience → label it "Course Project", never pretend it's industrial
- Project description only says "what ___ is" with no "what I did" → rewrite
