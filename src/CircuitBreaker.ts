import { CircuitOpenError } from "./errors";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/**
 * Called after the breaker has moved from one state to another. It may return a promise; if it throws, or the
 * promise rejects, the error is swallowed so a faulty listener can never break the call being protected.
 */
export type StateChangeListener = (from: CircuitState, to: CircuitState) => void | Promise<void>;

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  onStateChange?: StateChangeListener;
}

export class AgentCircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount: number = 0;
  private nextAttempt: number | null = null;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly onStateChange: StateChangeListener | undefined;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold || 3;
    this.resetTimeoutMs = options.resetTimeoutMs || 30000;
    this.onStateChange = options.onStateChange;
  }

  getState(): CircuitState {
    if (this.state === "OPEN" && this.nextAttempt && Date.now() > this.nextAttempt) {
      this.setState("HALF_OPEN");
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
    this.nextAttempt = null;
    this.setState("CLOSED");
  }

  private onFailure(): void {
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold) {
      this.nextAttempt = Date.now() + this.resetTimeoutMs;
      this.setState("OPEN");
    }
  }

  /** Move to `next` and tell the listener, once, only if the state really changed. */
  private setState(next: CircuitState): void {
    const from = this.state;
    if (from === next) {
      return;
    }
    this.state = next;
    this.notify(from, next);
  }

  /** Run the listener after the state is updated; whatever it throws or rejects with is dropped. */
  private notify(from: CircuitState, to: CircuitState): void {
    const listener = this.onStateChange;
    if (!listener) {
      return;
    }
    try {
      const result = listener(from, to);
      if (result && typeof result.then === "function") {
        result.then(undefined, () => undefined);
      }
    } catch {
      // A listener must not break the protected call.
    }
  }
}
