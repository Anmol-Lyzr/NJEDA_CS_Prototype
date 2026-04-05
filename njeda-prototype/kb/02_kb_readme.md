## NJEDA Program Advisor — Knowledge Base Pack

### What this KB is for
This KB enables the **NJEDA Program Advisor** agent to recommend NJEDA programs as **UI-ready cards**. The agent is instructed to use the KB as the single source of truth for program facts.

### Files in this pack
- `00_agent_instructions.md`: paste-ready agent instructions for Lyzr Studio (JSON-only output)
- `01_output_schema.json`: JSON Schema describing the exact response object the agent must output
- `03_program_catalog.jsonl`: structured catalog; **one program per line** as JSON
- `04_program_category_index.md`: human-friendly index to help retrieval by persona/category
- `05_eligibility_taxonomy.md`: normalized tags and allowed values
- `06_scoring_and_ranking_rules.md`: deterministic matching guidance (hard filters + soft scoring)
- `07_faq_and_policies.md`: reusable answers + disclaimers (no promises; always link sources)
- `08_source_links.md`: NJEDA source hubs and URL patterns for adding/updating programs

### How to use in Lyzr Studio
1) Create an agent named **NJEDA Program Advisor**.
2) Paste `00_agent_instructions.md` into your agent’s system/instructions.
3) Upload the remaining files in this `kb/` folder into your agent’s Knowledge Base.
4) Test with 3 personas:
   - Vendor: “I’m a vendor. How do I find procurement opportunities?”
   - Small business: “Need working capital in 60 days in Newark, NJ.”
   - Startup: “Looking for non-dilutive funding and incentives for clean energy.”

### How to maintain
- Add or update programs in `03_program_catalog.jsonl`.
- Keep `program_url` canonical and add `last_verified`.
- If a program changes substantially, bump `last_verified` and update eligibility bullets.

### Important constraints
- The agent MUST cite `program_url` for each recommendation.
- The agent MUST return JSON-only output to support card rendering.

