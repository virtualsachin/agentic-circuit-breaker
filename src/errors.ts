export class CircuitOpenError extends Error {
  constructor(message: string = "Circuit breaker is OPEN. API calls are temporarily blocked.") {
    super(message);
    this.name = "CircuitOpenError";
  }
}
