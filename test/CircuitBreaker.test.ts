import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { AgentCircuitBreaker, CircuitOpenError } from "../src";

const fail = async (): Promise<string> => {
  throw new Error("upstream down");
};
const ok = async (): Promise<string> => "primary";
const fallback = async (): Promise<string> => "fallback";

/** Fail the breaker `times` times in a row, swallowing the errors it rethrows. */
async function failTimes(breaker: AgentCircuitBreaker, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    await breaker.execute(fail).catch(() => undefined);
  }
}

describe("AgentCircuitBreaker", () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  });
  afterEach(() => {
    mock.timers.reset();
  });

  describe("defaults", () => {
    it("starts CLOSED", () => {
      assert.equal(new AgentCircuitBreaker().getState(), "CLOSED");
    });

    it("opens after 3 failures by default", async () => {
      const breaker = new AgentCircuitBreaker();
      await failTimes(breaker, 2);
      assert.equal(breaker.getState(), "CLOSED");
      await failTimes(breaker, 1);
      assert.equal(breaker.getState(), "OPEN");
    });

    it("stays open for 30 seconds by default", async () => {
      const breaker = new AgentCircuitBreaker();
      await failTimes(breaker, 3);
      mock.timers.tick(30_000);
      assert.equal(breaker.getState(), "OPEN");
      mock.timers.tick(1);
      assert.equal(breaker.getState(), "HALF_OPEN");
    });
  });

  describe("execute while CLOSED", () => {
    it("returns the primary result", async () => {
      assert.equal(await new AgentCircuitBreaker().execute(ok), "primary");
    });

    it("rethrows the primary error when there is no fallback", async () => {
      await assert.rejects(new AgentCircuitBreaker().execute(fail), { message: "upstream down" });
    });

    it("returns the fallback result when the primary fails", async () => {
      assert.equal(await new AgentCircuitBreaker().execute(fail, fallback), "fallback");
    });

    it("counts a failure that the fallback hid", async () => {
      const breaker = new AgentCircuitBreaker({ failureThreshold: 2 });
      await breaker.execute(fail, fallback);
      await breaker.execute(fail, fallback);
      assert.equal(breaker.getState(), "OPEN");
    });

    it("resets the failure count on a success", async () => {
      const breaker = new AgentCircuitBreaker({ failureThreshold: 3 });
      await failTimes(breaker, 2);
      await breaker.execute(ok);
      await failTimes(breaker, 2);
      assert.equal(breaker.getState(), "CLOSED");
    });
  });

  describe("execute while OPEN", () => {
    it("throws CircuitOpenError without calling the primary", async () => {
      const breaker = new AgentCircuitBreaker({ failureThreshold: 1 });
      await failTimes(breaker, 1);
      const primary = mock.fn(ok);
      await assert.rejects(breaker.execute(primary), CircuitOpenError);
      assert.equal(primary.mock.callCount(), 0);
    });

    it("uses the fallback without calling the primary", async () => {
      const breaker = new AgentCircuitBreaker({ failureThreshold: 1 });
      await failTimes(breaker, 1);
      const primary = mock.fn(ok);
      assert.equal(await breaker.execute(primary, fallback), "fallback");
      assert.equal(primary.mock.callCount(), 0);
    });

    it("carries a readable default message and name on CircuitOpenError", async () => {
      const breaker = new AgentCircuitBreaker({ failureThreshold: 1 });
      await failTimes(breaker, 1);
      await assert.rejects(breaker.execute(ok), (error: Error) => {
        assert.equal(error.name, "CircuitOpenError");
        assert.match(error.message, /OPEN/);
        assert.ok(error instanceof Error);
        return true;
      });
    });
  });

  describe("recovery", () => {
    it("closes again after a successful HALF_OPEN trial", async () => {
      const breaker = new AgentCircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
      await failTimes(breaker, 1);
      mock.timers.tick(1001);
      assert.equal(breaker.getState(), "HALF_OPEN");
      assert.equal(await breaker.execute(ok), "primary");
      assert.equal(breaker.getState(), "CLOSED");
    });

    it("re-opens, and restarts the wait, after a failed HALF_OPEN trial", async () => {
      const breaker = new AgentCircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
      await failTimes(breaker, 1);
      mock.timers.tick(1001);
      await failTimes(breaker, 1);
      assert.equal(breaker.getState(), "OPEN");
      mock.timers.tick(999);
      assert.equal(breaker.getState(), "OPEN");
      mock.timers.tick(2);
      assert.equal(breaker.getState(), "HALF_OPEN");
    });
  });

  describe("HALF_OPEN trial", () => {
    async function halfOpen(options: ConstructorParameters<typeof AgentCircuitBreaker>[0] = {}): Promise<AgentCircuitBreaker> {
      const breaker = new AgentCircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000, ...options });
      await failTimes(breaker, 1);
      mock.timers.tick(1001);
      assert.equal(breaker.getState(), "HALF_OPEN");
      return breaker;
    }

    it("lets exactly one concurrent call through as the trial and sends the rest to the fallback", async () => {
      const breaker = await halfOpen();
      const primary = mock.fn(ok);
      const results = await Promise.all(Array.from({ length: 5 }, () => breaker.execute(primary, fallback)));
      assert.equal(primary.mock.callCount(), 1);
      assert.deepEqual(results, ["primary", "fallback", "fallback", "fallback", "fallback"]);
      assert.equal(breaker.getState(), "CLOSED");
    });

    it("rejects the other concurrent calls with CircuitOpenError when there is no fallback", async () => {
      const breaker = await halfOpen();
      const primary = mock.fn(ok);
      const settled = await Promise.allSettled(Array.from({ length: 4 }, () => breaker.execute(primary)));
      assert.equal(primary.mock.callCount(), 1);
      assert.equal(settled[0]?.status, "fulfilled");
      for (const outcome of settled.slice(1)) {
        assert.equal(outcome.status, "rejected");
        assert.ok(outcome.status === "rejected" && outcome.reason instanceof CircuitOpenError);
      }
    });

    it("re-opens after a failed trial and lets one new trial through after the next wait", async () => {
      const breaker = await halfOpen();
      const failing = mock.fn(fail);
      await Promise.allSettled(Array.from({ length: 3 }, () => breaker.execute(failing, fallback)));
      assert.equal(failing.mock.callCount(), 1);
      assert.equal(breaker.getState(), "OPEN");
      mock.timers.tick(1001);
      assert.equal(await breaker.execute(ok), "primary");
      assert.equal(breaker.getState(), "CLOSED");
    });

    it("releases the trial when the primary throws before returning a promise", async () => {
      const breaker = await halfOpen();
      const throwsAtOnce = (): Promise<string> => {
        throw new Error("sync failure");
      };
      await assert.rejects(breaker.execute(throwsAtOnce), /sync failure/);
      assert.equal(breaker.getState(), "OPEN");
      mock.timers.tick(1001);
      assert.equal(await breaker.execute(ok), "primary");
    });

    it("does not report a state change for calls it turns away", async () => {
      const changes: string[] = [];
      const breaker = await halfOpen({ onStateChange: (from, to) => void changes.push(`${from}>${to}`) });
      changes.length = 0;
      await Promise.all(Array.from({ length: 5 }, () => breaker.execute(ok, fallback)));
      assert.deepEqual(changes, ["HALF_OPEN>CLOSED"]);
    });
  });

  describe("options", () => {
    it("honours a custom failureThreshold", async () => {
      const breaker = new AgentCircuitBreaker({ failureThreshold: 5 });
      await failTimes(breaker, 4);
      assert.equal(breaker.getState(), "CLOSED");
      await failTimes(breaker, 1);
      assert.equal(breaker.getState(), "OPEN");
    });

    it("treats a zero option as unset and uses the default (current behaviour: `||`, not `??`)", async () => {
      const breaker = new AgentCircuitBreaker({ failureThreshold: 0 });
      await failTimes(breaker, 2);
      assert.equal(breaker.getState(), "CLOSED");
      await failTimes(breaker, 1);
      assert.equal(breaker.getState(), "OPEN");
    });
  });
});
