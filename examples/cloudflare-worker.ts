import { AgentCircuitBreaker } from "../src";

// Example simulating a Cloudflare Worker interacting with an LLM Provider
const llmBreaker = new AgentCircuitBreaker({
  failureThreshold: 3, // Trip after 3 consecutive errors (e.g. HTTP 429)
  resetTimeoutMs: 15000 // Wait 15s before attempting recovery (HALF_OPEN)
});

async function primaryLLMCall(prompt: string) {
  // Simulate an API that is currently rate limiting
  throw new Error("HTTP 429: Rate Limit Exceeded");
}

async function fallbackLLMCall(prompt: string) {
  return `Fallback response to: ${prompt} (Using local Llama-3-8B)`;
}

export async function processAgentTask(task: string) {
  try {
    const result = await llmBreaker.execute(
      () => primaryLLMCall(task),
      () => fallbackLLMCall(task)
    );
    console.log("Result:", result);
  } catch (error: any) {
    console.error("Execution failed:", error.message);
  }
}

// Simulated Execution
(async () => {
  console.log("Attempt 1:");
  await processAgentTask("Analyze this data");
  
  console.log("\nAttempt 2:");
  await processAgentTask("Analyze this data");
  
  console.log("\nAttempt 3 (Trips circuit):");
  await processAgentTask("Analyze this data");
  
  console.log("\nAttempt 4 (Circuit is OPEN, instantly routes to fallback):");
  await processAgentTask("Analyze this data");
})();
