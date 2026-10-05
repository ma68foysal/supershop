import LanguageSwitch from "@/components/language-switch";
import { getI18n } from "@/lib/i18n-server";
import { isConfigured } from "@/lib/supabase/env";
import LoginForm from "./login-form";

export const metadata = { title: "Sign in · Dokan" };

export default async function LoginPage(props: PageProps<"/login">) {
  const [{ error }, { t, f }] = await Promise.all([props.searchParams, getI18n()]);
  return (
    <div className="shell">
      <header className="status">
        <div className="shop-name">Dokan</div>
        <p className="status-text">{t.tagline}</p>
      </header>
      <main className="main">
        <div className="ledger" style={{ marginBottom: 20 }}>
          <div className="ledger-label">{t.signInToStart}</div>
          <div className="ledger-amount empty">
            <span className="tk">৳</span>
            <span>{f.digits(0)}</span>
          </div>
        </div>
        {!isConfigured() ? (
          <div className="notice">
            Supabase isn&apos;t connected yet. Add <b>NEXT_PUBLIC_SUPABASE_URL</b> and{" "}
            <b>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</b> to <code>.env.local</code>, then restart the dev server. The
            steps are in <code>docs/SETUP.md</code>.
          </div>
        ) : (
          <>
            {error === "inactive" && <p className="error">{t.inactive}</p>}
            <LoginForm />
          </>
        )}
        <div style={{ marginTop: 28 }}>
          <LanguageSwitch />
        </div>
      </main>
    </div>
  );
}
