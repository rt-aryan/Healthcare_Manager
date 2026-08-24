/**
 * LLM integration service.
 *
 * Design goal: LLM failures must NEVER break the booking/visit flow.
 * Every call here is wrapped so callers get back a structured
 * { ok, data, error } result instead of a thrown exception, and the
 * calling route always persists a fallback record so the doctor/patient
 * still sees *something* useful even if the model call failed.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

async function callClaude(prompt, { maxTokens = 500, retries = 2 } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY not configured" };
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Anthropic API ${res.status}: ${text}`);
      }

      const data = await res.json();
      const textBlock = (data.content || []).find((b) => b.type === "text");
      if (!textBlock) throw new Error("No text content returned by model");

      return { ok: true, data: textBlock.text };
    } catch (err) {
      lastError = err;
      // simple backoff before retrying
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return { ok: false, error: lastError?.message || "Unknown LLM error" };
}

/**
 * Pre-visit summary: urgency, chief complaint, 3 suggested questions.
 * Returns parsed JSON on success; caller decides fallback behavior on failure.
 */
async function generatePreVisitSummary(symptoms) {
  const prompt = `Analyse these symptoms and return ONLY valid JSON (no markdown, no prose) in this exact shape:
{"urgency": "Low" | "Medium" | "High", "chiefComplaint": string, "suggestedQuestions": [string, string, string]}

Symptoms: ${symptoms}`;

  const result = await callClaude(prompt, { maxTokens: 400 });
  if (!result.ok) return result;

  try {
    const cleaned = result.data.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return { ok: true, data: parsed };
  } catch (err) {
    return { ok: false, error: `Failed to parse LLM JSON: ${err.message}` };
  }
}

/**
 * Post-visit summary: patient-friendly summary + medication schedule + follow-up steps.
 */
async function generatePostVisitSummary(clinicalNotes) {
  const prompt = `Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps.
Return ONLY valid JSON (no markdown, no prose) in this exact shape:
{"summary": string, "medicationSchedule": string, "followUpSteps": string}

Clinical notes: ${clinicalNotes}`;

  const result = await callClaude(prompt, { maxTokens: 600 });
  if (!result.ok) return result;

  try {
    const cleaned = result.data.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return { ok: true, data: parsed };
  } catch (err) {
    return { ok: false, error: `Failed to parse LLM JSON: ${err.message}` };
  }
}

module.exports = { generatePreVisitSummary, generatePostVisitSummary };
