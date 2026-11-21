---
name: coenx-video-learning
description: Build source-grounded interactive lessons, checks for understanding, worked examples, adaptive explanations and feedback using DiveeOI Targeted Learning.
---

# Targeted Learning video

Start from a measurable learning objective and the learner's current context. Retrieve relevant passages from the active learning library before writing factual explanations, numerical claims, definitions, examples or answer keys. Keep the source book and passage identifiers attached to the composition provenance.

Educational compositions require mode=education, a learning objective and at least one real retrieved citation. Use citations from the retrieval result, never placeholders or invented page numbers. Add a visible source note where it helps the learner verify a claim; metadata alone is not a learner-visible citation.

Teach one core idea per scene. Use a short explanation, a concrete example, a visual representation, a learner action and feedback that explains why an answer is correct or incorrect. Distractors should reflect plausible misunderstandings and the correction should address the misconception rather than only reveal the answer.

Keep educational language appropriate to the learner and source. Preserve exact scientific notation, units and definitions. For Arabic, use the font catalogue's Arabic-capable families and review right-to-left punctuation and mixed Latin numerals.

The interactive client is not a secure grading service. Store only learner-facing state in the composition. Private answer keys, mastery records, attempt history, analytics and assessment decisions must remain in server-side Targeted Learning services. Do not claim learner progress was saved unless the integration actually did so.\n