import { CircuitOpenError } from "./errors";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
}

export class AgentCircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount: number = 0;
  private nextAttempt: number | null = null;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold || 3;
    this.resetTimeoutMs = options.resetTimeoutMs || 30000;
  }

  getState(): CircuitState {
    if (this.state === "OPEN" && this.nextAttempt && Date.now() > this.nextAttempt) {
      this.state = "HALF_OPEN";
    }
    return this.state;
  }

  async execute<T>(
    primaryAction: () => Promise<T>,
    fallbackAction?: () => Promise<T>
  ): Promise<T> {
    const currentState = this.getState();

    if (currentState === "OPEN") {
      if (fallbackAction) {
        return await fallbackAction();
      }
      throw new CircuitOpenError();
    }

    try {
      const result = await primaryAction();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      if (fallbackAction) {
        return await fallbackAction();
      }
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = "CLOSED";
    this.nextAttempt = null;
  }

  private onFailure(): void {
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      this.nextAttempt = Date.now() + this.resetTimeoutMs;
    }
  }
}
