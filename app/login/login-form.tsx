"use client";

import { useActionState } from "react";
import { signIn } from "@/app/actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(signIn, {});
  return (
    <form action={action}>
      <label className="field">
        <span>Username or email</span>
        <input name="login" autoComplete="username" autoCapitalize="none" required />
      </label>
      <label className="field">
        <span>Password</span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <button className="primary" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="sub" style={{ marginTop: 16 }}>
        Staff sign in with the username the owner gave them. The owner signs in with their email.
      </p>
    </form>
  );
}
