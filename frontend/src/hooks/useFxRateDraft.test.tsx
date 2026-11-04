// @vitest-environment jsdom
import { useLayoutEffect } from "react";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InvoiceFx } from "@ch/core/api/routes/invoices";

const patchInvoiceFx = vi.fn();
class FakeApiError extends Error {
  detail?: string;
  constructor(detail: string) {
    super(detail);
    this.detail = detail;
  }
}
vi.mock("../lib/api", () => ({ patchInvoiceFx: (...a: unknown[]) => patchInvoiceFx(...a), ApiError: FakeApiError }));

const { useFxRateDraft } = await import("./useFxRateDraft");

const FX: InvoiceFx = { rate: 1.3712, enteredAt: "2026-10-01T12:00:00.000Z" };
const saved = (rate: number | null) => ({ fx: rate === null ? null : { rate, enteredAt: "2026-11-02T09:30:00.000Z" } });

afterEach(() => {
  cleanup();
  patchInvoiceFx.mockReset();
});

function setup(fx: InvoiceFx | null, onSaved = vi.fn()) {
  const hook = renderHook(() => useFxRateDraft({ invoiceId: "inv-1", fx, onSaved }));
  return { ...hook, onSaved };
}

describe("useFxRateDraft (T-67)", () => {
  it("starts from the saved rate, or empty when there is none", () => {
    expect(setup(FX).result.current.draft).toBe("1.3712");
    expect(setup(null).result.current.draft).toBe("");
  });

  it("is dirty only once the draft differs from the saved value", () => {
    const { result } = setup(FX);
    expect(result.current.dirty).toBe(false);
    act(() => result.current.setDraft("1.40"));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.setDraft("  1.3712 "));
    expect(result.current.dirty).toBe(false);
  });

  it("unchanged → no PATCH", async () => {
    const { result } = setup(FX);
    await act(() => result.current.save());
    expect(patchInvoiceFx).not.toHaveBeenCalled();
  });

  it("PATCHes the number typed, adopts the response, and re-reads the weeks", async () => {
    patchInvoiceFx.mockResolvedValue(saved(1.4));
    const { result, onSaved } = setup(null);
    act(() => result.current.setDraft("1.4"));
    await act(() => result.current.save());
    expect(patchInvoiceFx).toHaveBeenCalledWith("inv-1", 1.4);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(result.current.fx).toEqual({ rate: 1.4, enteredAt: "2026-11-02T09:30:00.000Z" });
    expect(result.current.dirty).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("an empty box clears the rate with null", async () => {
    patchInvoiceFx.mockResolvedValue(saved(null));
    const { result } = setup(FX);
    act(() => result.current.setDraft(""));
    await act(() => result.current.save());
    expect(patchInvoiceFx).toHaveBeenCalledWith("inv-1", null);
    expect(result.current.fx).toBeNull();
  });

  it.each(["abc", "1,5", "0x1", "-1", "1.", ".5"])("rejects %j without calling the API", async (text) => {
    const { result } = setup(null);
    act(() => result.current.setDraft(text));
    await act(() => result.current.save());
    expect(patchInvoiceFx).not.toHaveBeenCalled();
    expect(result.current.error).toBe("Enter the rate as a number, e.g. 1.3712");
    expect(result.current.draft).toBe(text);
  });

  it("a 400 shows its reason and keeps what was typed; onSaved is not called", async () => {
    patchInvoiceFx.mockRejectedValue(new FakeApiError("fxCadPerUsd must be between 0.5 and 3"));
    const { result, onSaved } = setup(FX);
    act(() => result.current.setDraft("9"));
    await act(() => result.current.save());
    expect(result.current.error).toBe("fxCadPerUsd must be between 0.5 and 3");
    expect(result.current.draft).toBe("9");
    expect(result.current.fx).toEqual(FX);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("follows the saved rate when the invoice is re-read with a new one", () => {
    let fx: InvoiceFx | null = null;
    const { result, rerender } = renderHook(() => useFxRateDraft({ invoiceId: "inv-1", fx, onSaved: vi.fn() }));
    expect(result.current.draft).toBe("");
    fx = FX;
    rerender();
    expect(result.current.draft).toBe("1.3712");
    expect(result.current.fx).toEqual(FX);
  });

  // T-96: the follow-the-prop step ran on mount too, and a keystroke landing before it was wiped —
  // the post-import dialog's flaky "entering 1.3712 PATCHes that invoice". A layout effect types
  // before the mount's passive effects run, so the race is deterministic here.
  it("keeps text typed before the mount has settled", () => {
    function TypesAtOnce() {
      const { draft, setDraft } = useFxRateDraft({ invoiceId: "inv-1", fx: null, onSaved: vi.fn() });
      useLayoutEffect(() => setDraft("1.3712"), [setDraft]);
      return <span data-testid="draft">{draft}</span>;
    }
    render(<TypesAtOnce />);
    expect(screen.getByTestId("draft").textContent).toBe("1.3712");
  });

  it("a re-read with the same rate, as a new object, keeps the draft", () => {
    let fx: InvoiceFx | null = FX;
    const { result, rerender } = renderHook(() => useFxRateDraft({ invoiceId: "inv-1", fx, onSaved: vi.fn() }));
    act(() => result.current.setDraft("1.40"));
    fx = { ...FX };
    rerender();
    expect(result.current.draft).toBe("1.40");
  });
});
