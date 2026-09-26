// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const signIn = vi.fn();
vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signIn(...args),
}));

const { default: SignInPage } = await import("./page");

afterEach(() => {
  cleanup();
  push.mockClear();
  refresh.mockClear();
  signIn.mockClear();
});

describe("SignInPage", () => {
  it("renders the password field as type=password", () => {
    render(<SignInPage />);
    const password = screen.getByLabelText("Password");
    expect(password.getAttribute("type")).toBe("password");
  });

  it("submits credentials to next-auth's signIn and navigates home on success, without logging them", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    signIn.mockResolvedValue({ error: undefined });
    render(<SignInPage />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "dispatch@ch-logistics.example" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));

    expect(signIn).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({
        email: "dispatch@ch-logistics.example",
        password: "correct horse battery staple",
        redirect: false,
      }),
    );
    for (const call of logSpy.mock.calls) {
      expect(call.join(" ")).not.toContain("correct horse battery staple");
    }
    logSpy.mockRestore();
  });

  it("shows an inline error and stays on the page when credentials are rejected", async () => {
    signIn.mockResolvedValue({ error: "CredentialsSignin" });
    render(<SignInPage />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "dispatch@ch-logistics.example" },
    });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong password" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/incorrect/i);
    expect(push).not.toHaveBeenCalled();
  });
});
