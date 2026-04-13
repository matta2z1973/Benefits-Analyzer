# Plan Documents

Drop the current year's benefit plan PDFs here. The app uses these to generate plan data.

## Required files:

1. **Summary of Benefits** - The overview document (e.g., `Summary of Benefits.pdf`)
2. **Co-Pay Plan SBC** - The Summary of Benefits and Coverage for the Co-Pay/PPO plan (e.g., `COPAY PLAN.pdf`)
3. **CDHP Plan SBC** - The Summary of Benefits and Coverage for the CDHP/HSA plan (e.g., `CDHP PLAN.pdf`)

## How to update for a new plan year:

1. Replace the PDFs in this folder with the new year's documents
2. Run `npm run update-plans` from the project root
3. Review the generated file at `plan-data/current-plans.json` for accuracy
4. Commit and push — the app will auto-deploy with the new data

## File naming:

Name files however you like. The update script reads all PDFs in this folder.
