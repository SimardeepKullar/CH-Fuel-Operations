// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getHealth = vi.fn();
const getReceiptQueue = vi.fn();
vi.mock("../lib/api", () => ({
  getHealth: (...args: unknown[]) => getHealth(...args),
  getReceiptQueue: (...args: unknown[]) => getReceiptQueue(...args),
}));

const { useStandingCounts } = await import("./useStandingCounts");

function Probe() {
  const { receipts, flags, loading } = useStandingCounts();
  return (
    <div>
      <span data-testid="receipts">{receipts ? `${receipts.done}/${receipts.total}` : "none"}</span>
      <span data-testid="flags">{flags ?? "none"}</span>
      <span data-testid="loading">{String(loading)}</span>
    </div>
  );
}

afterEach(() => {
  cleanup();
  getHealth.mockReset();
  getReceiptQueue.mockReset();
});

describe("useStandingCounts (T-39, A7)", () => {
  it("surfaces the global receipt progress and the global undismissed-anomaly count from the API", async () => {
    getReceiptQueue.mockResolvedValue({ items: [], progress: { done: 48, total: 60 } });
    getHealth.mockResolvedValue({ openAnomalyCount: 3 });

    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("receipts").textContent).toBe("48/60");
    expect(screen.getByTestId("flags").textContent).toBe("3");
  });

  it("degrades to unknown (null), not zero, when either call fails", async () => {
    getReceiptQueue.mockRejectedValue(new Error("boom"));
    getHealth.mockResolvedValue({ openAnomalyCount: 3 });

    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("receipts").textContent).toBe("none");
    expect(screen.getByTestId("flags").textContent).toBe("none");
  });
});
