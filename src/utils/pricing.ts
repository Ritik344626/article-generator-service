export type ModelPricing = {
  inputPer1k: number; // USD per 1K input tokens
  outputPer1k: number; // USD per 1K output tokens
};

const PRICING: Record<string, ModelPricing> = {
  "gpt-4o": {
    inputPer1k: 0.0025,
    outputPer1k: 0.0100
  },
  "gpt-4.1-mini": {
    inputPer1k: 0.00040,
    outputPer1k: 0.00160
  },
  "gpt-5.1": {
    inputPer1k: 0.00125,
    outputPer1k: 0.0100
  },
  "gpt-5.2": {
    inputPer1k: 0.00175,
    outputPer1k: 0.0140
 }
};

export function computeCostUSD(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICING[model] || PRICING["gpt-4o"];
  const inputCost = (promptTokens / 1000) * p.inputPer1k;
  const outputCost = (completionTokens / 1000) * p.outputPer1k;
  return Number((inputCost + outputCost).toFixed(6));
}
