import OpenAI from "openai";
import pdf from "pdf-parse";

function getClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file) {
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const pdfData = await pdf(buffer);
    const text = pdfData.text;

    const response = await getClient().chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 1500,
      messages: [
        {
          role: "system",
          content: `You are a benefits plan document parser. Extract the key plan details from the provided document text and return ONLY a valid JSON object with these fields:

{
  "planName": "string - the plan name",
  "planType": "string - PPO, HMO, HDHP, EPO, etc.",
  "network": "string - insurance company/network name",
  "premiums": {
    "employee": number or null (bi-weekly cost),
    "empChildren": number or null,
    "empSpouse": number or null,
    "family": number or null,
    "frequency": "string - biweekly, monthly, etc."
  },
  "deductible": {
    "individual": number or null,
    "family": number or null
  },
  "oopMax": {
    "individual": number or null,
    "family": number or null
  },
  "primaryCare": "string - copay amount or coinsurance description",
  "specialist": "string - copay amount or coinsurance description",
  "erVisit": "string - copay or coinsurance",
  "urgentCare": "string - copay or coinsurance",
  "hospitalStay": "string - coinsurance or description",
  "rxGeneric": "string - copay amount",
  "rxBrand": "string - copay amount",
  "hsaContribution": number or null (employer contribution),
  "coinsuranceRate": "string - e.g. '20%' or 'varies'",
  "notes": "string - any important caveats or unique features"
}

If a field cannot be determined from the document, use null. Return ONLY the JSON, no other text.`,
        },
        {
          role: "user",
          content: `Parse this health plan document:\n\n${text.substring(0, 8000)}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return Response.json({ planData: parsed, rawText: text.substring(0, 2000) });
    }

    return Response.json(
      { error: "Could not parse plan details" },
      { status: 422 }
    );
  } catch (error) {
    console.error("Parse plan error:", error);
    return Response.json(
      { error: "Failed to parse document" },
      { status: 500 }
    );
  }
}
