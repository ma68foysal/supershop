import { signOut } from "@/app/actions";
import { getShop, getStaffNames } from "@/lib/data";
import { ShopForm, StaffSection } from "./settings-forms";
import SignOutButton from "./sign-out-button";

export const metadata = { title: "Settings · Dokan" };

export default async function SettingsPage() {
  const [{ settings, me }, staff] = await Promise.all([getShop(), getStaffNames()]);
  const isOwner = me.role === "owner";
  return (
    <main className="main">
      <h2 className="h2">Settings</h2>
      <p className="sub">
        Signed in as {me.name} ({me.role === "owner" ? "owner" : "staff"})
      </p>

      <ShopForm settings={settings} canEdit={isOwner} />
      {isOwner && <StaffSection staff={staff} meId={me.id} />}

      <form action={signOut} style={{ marginTop: 28 }}>
        <SignOutButton />
      </form>
    </main>
  );
}
