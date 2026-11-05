"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import "../../App.css";

/**
 * Only Auth.js's `CredentialsSignin` means the email or password was wrong.
 * Anything else — `Configuration` when authorize() throws because the database
 * is unreachable, or signIn itself failing — is the server's fault, and must
 * not send the dispatcher hunting for a typo (T-106).
 */
function signInErrorMessage(error: string): string {
  return error === "CredentialsSignin"
    ? "Incorrect email or password."
    : "Sign-in is unavailable — the server could not be reached.";
}

export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    let error: string | undefined;
    try {
      const result = await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirect: false,
      });
      error = result?.error ?? undefined;
    } catch {
      error = "Unreachable";
    }

    if (error) {
      setSubmitting(false);
      setError(signInErrorMessage(error));
      return;
    }

    router.push("/overview");
    router.refresh();
  }

  return (
    <div className="signin-page">
      <div className="signin-shell">
        <img className="signin-brand" src="/ch-logo-white.png" alt="CH Logistics" />
        <form className="signin-card" onSubmit={handleSubmit} noValidate>
          <h1 className="signin-title">Dispatch sign in</h1>

          {error && (
            <p className="signin-error" role="alert">
              {error}
            </p>
          )}

          <div className="signin-fields">
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                className="input"
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="input"
              />
            </div>
          </div>

          <button type="submit" className="btn btn-primary signin-submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
