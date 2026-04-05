## Starter programs + checklist

### Why this file exists
You asked for a KB you can upload immediately. NJEDA programs change often, so the most reliable method is:
- Keep a **structured catalog** (`03_program_catalog.jsonl`)
- Add programs iteratively
- Track `last_verified`

### Starter program entries (use as placeholders until verified)
Add/replace these in `03_program_catalog.jsonl` with the official URLs and facts.

#### Vendor / procurement starters
- Add vendor-facing resources such as:
  - vendor registration guidance pages
  - procurement portals / bid opportunities pages
  - supplier diversity resources (if present on NJEDA.gov)

Recommended fields to emphasize:
- `benefit_type: "procurement"`
- `who_its_for: ["vendor"]`
- `keywords`: `rfp`, `bid_opportunities`, `registration`, `supplier_diversity`

#### Small business financing starters
- Add:
  - working capital loan programs
  - microloan programs (if present)
  - guarantee/participation programs (if present)

Recommended fields to emphasize:
- `benefit_type: "loan"`
- `who_its_for: ["small_business"]`
- `keywords`: `working_capital`, `equipment`, `expansion`

#### Startup / innovation starters
- Add:
  - entrepreneurship / innovation support programs
  - accelerator/incubator support pages (if present)
  - R&D or innovation incentives pages (if present)

Recommended fields:
- `benefit_type: "technical_assistance"` or `grant`/`tax_credit` as applicable
- `who_its_for: ["startup"]`
- `keywords`: `innovation`, `entrepreneurship`, `accelerator`, `r_and_d`

#### Incentives starters
- Add:
  - tax credit and incentive overview pages
  - industry-specific incentive pages

Recommended fields:
- `benefit_type: "tax_credit"`
- `who_its_for`: match eligible personas

### Catalog completion checklist (per program)
For each program you add to `03_program_catalog.jsonl`, verify:
- **URL**: `program_url` is the canonical NJEDA page (or official application portal)
- **Title**: matches site heading
- **Category**: one or more of `funding|incentives|procurement|technical_assistance|real_estate`
- **Benefit type**: grant/loan/tax_credit/procurement/technical_assistance/real_estate/other
- **Who it’s for**: vendor/small_business/startup/lender/other
- **Eligibility bullets**: 2–6 short bullets
- **How to apply**: 1–3 steps + link
- **Keywords/tags**: 5–15 relevant keywords
- **Last verified**: set today’s date

### Test prompts (copy/paste into agent chat)
Vendor:
- “I’m a vendor providing IT services. How do I find NJ public-sector bid opportunities and NJEDA procurement programs?”

Small business:
- “I own a small business in Jersey City and need working capital in the next 60 days. What NJEDA programs fit?”

Startup:
- “We’re an early-stage clean energy startup in Newark. Looking for non-dilutive support and incentives.”

Lender:
- “I’m a community lender in NJ. Which NJEDA programs support lenders or participation/guarantee partnerships?”

