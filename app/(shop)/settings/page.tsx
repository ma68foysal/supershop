import { signOut } from "@/app/actions";
import LanguageSwitch from "@/components/language-switch";
import { getShop, getStaffNames } from "@/lib/data";
import { getI18n } from "@/lib/i18n-server";
import { ShopForm, StaffSection } from "./settings-forms";
import SignOutButton from "./sign-out-button";

export const metadata = { title: "Settings · Dokan" };

export default async function SettingsPage() {
  const [{ settings, me }, { t }, staff] = await Promise.all([getShop(), getI18n(), getStaffNames()]);
  const isOwner = me.role === "owner";
  return (
    <main className="main">
      <h2 className="h2">{t.settings}</h2>
      <p className="sub">{t.signedInAs(me.name, isOwner ? t.ownerRole : t.staffRole)}</p>

      <div className="section-head">
        <h3>{t.language}</h3>
      </div>
      <LanguageSwitch />
      <p className="sub" style={{ marginTop: 6 }}>
        {t.languageHint}
      </p>

      <ShopForm settings={settings} canEdit />
      {isOwner && <StaffSection staff={staff} meId={me.id} />}

      <form action={signOut} style={{ marginTop: 28 }}>
        <SignOutButton />
      </form>
    </main>
  );
}
