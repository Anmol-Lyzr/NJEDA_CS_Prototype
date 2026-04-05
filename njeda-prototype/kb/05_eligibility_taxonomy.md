## Eligibility taxonomy (normalized tags)

Use these normalized values to keep the catalog consistent and to help retrieval.

### Personas (`userProfile.persona`)
- `vendor`
- `small_business`
- `startup`
- `lender`
- `other`

### Functional areas (KB field `functional_area`)
- `Financial Assistance`
- `Business Support`
- `Innovation & Technology`
- `Real Estate & Community Development`
- `Incentives & Tax Credits`

### Need areas (`userProfile.needs[]`)
- `funding`
- `incentives`
- `procurement`
- `technical_assistance`
- `real_estate`
- `other`

### Benefit types (`recommendations[].benefit_type`)
- `grant`
- `loan`
- `tax_credit`
- `procurement`
- `technical_assistance`
- `real_estate`
- `other`

### Stages (catalog + userProfile.stage)
Allowed values for catalog `stage[]` (multiple allowed):
- `idea`
- `mvp`
- `revenue`
- `growth`
- `any`

### Suggested tag vocabulary (`recommendations[].tags[]`)
Prefer short, reusable tags:
- Funding: `working_capital`, `equipment`, `expansion`, `microloan`, `guarantee`, `participation`
- Startup: `innovation`, `entrepreneurship`, `accelerator`, `incubator`, `seed`, `r_and_d`
- Incentives: `tax_credit`, `tax_incentive`, `hiring`, `capex`, `redevelopment`
- Vendor/procurement: `procurement`, `rfp`, `bid_opportunities`, `supplier_diversity`, `registration`
- Geography (optional): `statewide`, `north_jersey`, `central_jersey`, `south_jersey`, `county_*`, `city_*`

### Location notes conventions
In `location_notes` use one of:
- `NJ statewide`
- `NJ (specified counties/cities)` and list them
- `Municipal-specific (see program_url)`

