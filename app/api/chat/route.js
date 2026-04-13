import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(request) {
  try {
    const { system, messages } = await request.json();

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 1000,
      messages: [
        { role: "system", content: system },
        ...messages,
      ],
    });

    // Format response to match what the frontend expects
    const reply = response.choices[0]?.message?.content || "";
    return Response.json({
      content: [{ text: reply }],
    });
  } catch (error) {
    console.error("OpenAI API error:", error);
    return Response.json(
      { error: "Failed to get response from AI" },
      { status: 500 }
    );
  }
}
