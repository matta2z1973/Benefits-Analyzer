#!/usr/bin/env node

/**
 * parse-plans.js
 *
 * Reads all PDFs from plan-documents/, sends them to OpenAI for extraction,
 * and writes the structured plan data to plan-data/current-plans.json.
 *
 * Usage: npm run update-plans
 * Requires: OPENAI_API_KEY environment variable
 */

const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");
const OpenAI = require("openai");

const PLAN_DOCS_DIR = path.join(__dirname, "..", "plan-documents");
const OUTPUT_FILE = path.join(__dirname, "..", "plan-data", "current-plans.json");

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Error: OPENAI_API_KEY environment variable is required.");
    console.error("Set it with: export OPENAI_API_KEY=sk-...");
    process.exit(1);
  }

  const client = new OpenAI.default({ apiKey });

  // Read all PDFs
  const files = fs.readdirSync(PLAN_DOCS_DIR).filter(f => f.toLowerCase().endsWith(".pdf"));
  if (files.length === 0) {
    console.error("No PDF files found in plan-documents/");
    console.error("Drop the plan year's PDF documents there first.");
    process.exit(1);
  }

  console.log(`Found ${files.length} PDF(s):`);
  files.forEach(f => console.log(`  - ${f}`));

  // Extract text from all PDFs
  let allText = "";
  for (const file of files) {
    const filePath = path.join(PLAN_DOCS_DIR, file);
    const buffer = fs.readFileSync(filePath);
    const data = await pdf(buffer);
    allText += `\n\n=== ${file} ===\n\n${data.text}`;
    console.log(`Extracted ${data.text.length} chars from ${file}`);
  }

  console.log("\nSending to OpenAI for plan data extraction...");

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 4000,
    messages: [
      {
        role: "system",
        content: `You are a benefits plan document parser. Extract plan data from the provided documents and return ONLY a valid JSON object matching this exact structure. All dollar amounts should be numbers (not strings). All rates should be decimals (e.g., 0.15 for 15%).

{
  "_meta": {
    "planYear": "YYYY",
    "effectiveDate": "MM/DD/YYYY",
    "lastUpdated": "YYYY-MM-DD",
    "source": "description of source documents"
  },
  "premiumsBiweekly": {
    "copay": { "employee": 0, "empChildren": 0, "empSpouse": 0, "family": 0 },
    "cdhp": { "employee": 0, "empChildren": 0, "empSpouse": 0, "family": 0 }
  },
  "hsaEmployer": { "employee": 0, "withDependents": 0 },
  "plans": {
    "copay": {
      "name": "full plan name",
      "shortName": "short name",
      "deductible": { "individual": 0, "family": 0 },
      "oopMax": { "individual": 0, "family": 0 },
      "primaryCare": { "type": "copay|coinsurance|free|free_after_deductible", "amount": 0, "rate": 0, "deductibleApplies": false },
      "specialist": { "same structure" },
      "preventive": { "type": "free" },
      "labXray": { "same structure" },
      "imaging": { "same structure" },
      "erVisit": { "same structure" },
      "urgentCare": { "same structure" },
      "hospitalFacility": { "same structure" },
      "surgeonFees": { "same structure" },
      "outpatientSurgeryFacility": { "same structure" },
      "mentalHealthOutpatient": { "same structure" },
      "mentalHealthInpatient": { "same structure" },
      "maternityDelivery": { "same structure" },
      "rx": {
        "deductibleApplies": false,
        "generic": { "shortTerm": 0, "maintenance": 0, "mailOrder": 0 },
        "preferredBrand": { "shortTerm": 0, "maintenance": 0, "mailOrder": 0 },
        "nonPreferredBrand": { "shortTerm": 0, "maintenance": 0, "mailOrder": 0 },
        "specialty": { "genericPref": 0, "nonPref": 0 }
      },
      "physicalTherapy": { "same structure" }
    },
    "cdhp": { "same structure as copay but with CDHP values" }
  },
  "avgCosts": {
    "primaryCare": 275,
    "specialist": 400,
    "erVisit": 2800,
    "urgentCare": 350,
    "labXray": 150,
    "imaging": 1200,
    "hospitalDayFacility": 3500,
    "surgeonFees": 4000,
    "outpatientSurgery": 8000,
    "mentalHealthVisit": 200,
    "maternityTotal": 12000,
    "physicalTherapyVisit": 200,
    "genericRxMonth": 30,
    "preferredBrandRxMonth": 250,
    "nonPreferredBrandRxMonth": 500,
    "specialtyRxMonth": 3000
  }
}

For service types:
- "copay" = flat dollar amount, include "amount" and "deductibleApplies"
- "coinsurance" = percentage, include "rate" as decimal (0.15 = 15%)
- "free" = no cost
- "free_after_deductible" = no cost once deductible is met

For specialty Rx, use the coinsurance rate as a decimal (0.10 = 10%).
The avgCosts section uses standard US healthcare averages — keep the defaults shown above.
Return ONLY the JSON.`,
      },
      {
        role: "user",
        content: `Parse these benefit plan documents:\n\n${allText.substring(0, 15000)}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content || "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    console.error("Error: Could not extract JSON from AI response.");
    console.error("Raw response:", content.substring(0, 500));
    process.exit(1);
  }

  try {
    const planData = JSON.parse(jsonMatch[0]);

    // Update the lastUpdated field
    planData._meta = planData._meta || {};
    planData._meta.lastUpdated = new Date().toISOString().split("T")[0];

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(planData, null, 2) + "\n");
    console.log(`\nPlan data written to: plan-data/current-plans.json`);
    console.log(`Plan year: ${planData._meta?.planYear || "unknown"}`);
    console.log(`\nPlease review the file for accuracy before committing.`);
  } catch (err) {
    console.error("Error: AI returned invalid JSON.", err.message);
    console.error("Raw response:", content.substring(0, 500));
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
