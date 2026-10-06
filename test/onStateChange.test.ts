import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { AgentCircuitBreaker, type CircuitState } from "../src";

type Change = [CircuitState, CircuitState];

const fail = async (): Promise<string> => {
  throw new Error("upstream down");
};
const ok = async (): Promise<string> => "primary";
const fallback = async (): Promise<string> => "fallback";

async function failTimes(breaker: AgentCircuitBreaker, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    await breaker.execute(fail).catch(() => undefined);
  }
}

/** A breaker that records every state change it reports. */
function recording(options: { failureThreshold?: number; resetTimeoutMs?: number } = {}) {
  const changes: Change[] = [];
  const breaker = new AgentCircuitBreaker({
    ...options,
    onStateChange: (from, to) => {
      changes.push([from, to]);
    },
  });
  return { breaker, changes };
}

describe("onStateChange", () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  });
  afterEach(() => {
    mock.timers.reset();
  });

  describe("when it fires", () => {
    it("reports CLOSED to OPEN when the failure threshold is reached, and not before", async () => {
      const { breaker, changes } = recording({ failureThreshold: 3 });
      await failTimes(breaker, 2);
      assert.deepEqual(changes, []);
      await failTimes(breaker, 1);
      assert.deepEqual(changes, [["CLOSED", "OPEN"]]);
    });

    it("reports OPEN to HALF_OPEN once, on the first read after the wait, however often the state is read", async () => {
      const { breaker, changes } = recording({ failureThreshold: 1, resetTimeoutMs: 1000 });
      await failTimes(breaker, 1);
      mock.timers.tick(1001);
      breaker.getState();
      breaker.getState();
      breaker.getState();
      assert.deepEqual(changes, [
        ["CLOSED", "OPEN"],
        ["OPEN", "HALF_OPEN"],
      ]);
    });

    it("reports HALF_OPEN to CLOSED when the trial call succeeds", async () => {
      const { breaker, changes } = recording({ failureThreshold: 1, resetTimeoutMs: 1000 });
      await failTimes(breaker, 1);
      mock.timers.tick(1001);
      await breaker.execute(ok);
      assert.deepEqual(changes.slice(-1), [["HALF_OPEN", "CLOSED"]]);
    });

    it("reports HALF_OPEN to OPEN when the trial call fails", async () => {
      const { breaker, changes } = recording({ failureThreshold: 1, resetTimeoutMs: 1000 });
      await failTimes(breaker, 1);
      mock.timers.tick(1001);
      await failTimes(breaker, 1);
      assert.deepEqual(changes, [
        ["CLOSED", "OPEN"],
        ["OPEN", "HALF_OPEN"],
        ["HALF_OPEN", "OPEN"],
      ]);
    });

    it("reports a whole recovery cycle in order", async () => {
      const { breaker, changes } = recording({ failureThreshold: 2, resetTimeoutMs: 500 });
      await failTimes(breaker, 2);
      mock.timers.tick(501);
      await breaker.execute(ok);
      assert.deepEqual(changes, [
        ["CLOSED", "OPEN"],
        ["OPEN", "HALF_OPEN"],
        ["HALF_OPEN", "CLOSED"],
      ]);
    });
  });

  describe("when it does not fire", () => {
    it("stays silent for successes while CLOSED", async () => {
      const { breaker, changes } = recording();
      await breaker.execute(ok);
      await breaker.execute(ok);
      assert.deepEqual(changes, []);
    });

    it("stays silent for failures below the threshold, and for a success that resets them", async () => {
      const { breaker, changes } = recording({ failureThreshold: 3 });
      await failTimes(breaker, 2);
      await breaker.execute(ok);
      await failTimes(breaker, 2);
      assert.deepEqual(changes, []);
    });

    it("stays silent when the state is only read", async () => {
      const { breaker, changes } = recording();
      breaker.getState();
      breaker.getState();
      assert.deepEqual(changes, []);
    });

    it("stays silent for calls that are turned away while OPEN", async () => {
      const { breaker, changes } = recording({ failureThreshold: 1 });
      await failTimes(breaker, 1);
      await breaker.execute(ok, fallback);
      await breaker.execute(ok, fallback);
      assert.deepEqual(changes, [["CLOSED", "OPEN"]]);
    });

    it("needs no listener at all", async () => {
      const breaker = new AgentCircuitBreaker({ failureThreshold: 1 });
      await failTimes(breaker, 1);
      assert.equal(breaker.getState(), "OPEN");
    });
  });

  describe("what the listener sees", () => {
    it("is called after the state has changed, so getState() inside it agrees with `to`", async () => {
      const seen: CircuitState[] = [];
      const breaker = new AgentCircuitBreaker({
        failureThreshold: 1,
        resetTimeoutMs: 1000,
        onStateChange: (_from, to) => {
          seen.push(breaker.getState());
          assert.equal(breaker.getState(), to);
        },
      });
      await failTimes(breaker, 1);
      mock.timers.tick(1001);
      breaker.getState();
      assert.deepEqual(seen, ["OPEN", "HALF_OPEN"]);
    });
  });

  describe("a faulty listener", () => {
    it("cannot change the result of a successful call", async () => {
      const breaker = new AgentCircuitBreaker({
        failureThreshold: 1,
        onStateChange: () => {
          throw new Error("listener bug");
        },
      });
      await failTimes(breaker, 1);
      assert.equal(breaker.getState(), "OPEN");
      mock.timers.tick(30_001);
      assert.equal(await breaker.execute(ok), "primary");
      assert.equal(breaker.getState(), "CLOSED");
    });

    it("cannot hide the primary error, or replace the fallback result, of a failing call", async () => {
      const breaker = new AgentCircuitBreaker({
        failureThreshold: 1,
        onStateChange: () => {
          throw new Error("listener bug");
        },
      });
      await assert.rejects(breaker.execute(fail), { message: "upstream down" });
      const second = new AgentCircuitBreaker({
        failureThreshold: 1,
        onStateChange: () => {
          throw new Error("listener bug");
        },
      });
      assert.equal(await second.execute(fail, fallback), "fallback");
    });

    it("cannot cause an unhandled rejection when it returns a rejecting promise", async () => {
      const unhandled: unknown[] = [];
      const record = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", record);
      try {
        const breaker = new AgentCircuitBreaker({
          failureThreshold: 1,
          onStateChange: async () => {
            throw new Error("async listener bug");
          },
        });
        await failTimes(breaker, 1);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(breaker.getState(), "OPEN");
        assert.deepEqual(unhandled, []);
      } finally {
        process.off("unhandledRejection", record);
      }
    });

    it("is still told about the following changes after it has thrown once", async () => {
      let calls = 0;
      const breaker = new AgentCircuitBreaker({
        failureThreshold: 1,
        resetTimeoutMs: 1000,
        onStateChange: () => {
          calls++;
          throw new Error("listener bug");
        },
      });
      await failTimes(breaker, 1);
      mock.timers.tick(1001);
      breaker.getState();
      await breaker.execute(ok);
      assert.equal(calls, 3);
    });
  });
});
