## Scoring and ranking rules (agent guidance)

The agent should behave consistently and avoid hallucinations. Use this doc as the matching rubric.

### Step 1 — Parse user intent into a profile
Extract and fill:
- persona
- needs (one or more)
- location
- stage
- timeline
- constraints

If any of persona/needs/location are missing, ask follow-ups (max 3).

### Step 2 — Candidate retrieval
Retrieve candidate programs from the KB by:
- category overlap (needs ↔ category)
- persona overlap (`who_its_for`)
- keyword overlap (industry, stage, location notes)

### Step 3 — Hard filters (exclude)
Exclude programs when KB states:
- user persona not eligible / program not intended for that persona
- geographic restrictions that clearly don’t match

### Step 4 — Soft scoring (prioritize)
For each candidate, score:
- +4: category matches primary need
- +3: persona matches `who_its_for`
- +2: stage match (`stage` includes `any` or matches user stage)
- +1..+3: keyword overlap (industry, activity, procurement, incentives)
- +1: timeline compatible (if KB implies deadlines/ongoing)

### Step 5 — Output constraints
- Return 3–6 recommendations.
- Avoid duplicates: if two programs are near-identical, pick the better match and keep variety.
- Each recommendation must include `program_url` and short UI-friendly fields.

### Step 6 — Confidence handling
If no strong match is found:
- Return `recommendations: []`
- Add `followUps` questions to clarify, OR suggest browsing by category.

