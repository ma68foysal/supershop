import StatusBar from "@/components/status-bar";
import TabBar from "@/components/tab-bar";
import { ToastProvider } from "@/components/toast";
import { getShop } from "@/lib/data";

export default async function ShopLayout({ children }: LayoutProps<"/">) {
  const { supabase, settings, openDay } = await getShop();
  const { data: totals } = openDay
    ? await supabase.from("day_totals").select("total,sales_count").eq("business_day_id", openDay.id).single()
    : { data: null };

  return (
    <ToastProvider>
      <div className="shell">
        <StatusBar
          settings={settings}
          openDay={openDay}
          todayTotal={Number(totals?.total ?? 0)}
          todayCount={Number(totals?.sales_count ?? 0)}
        />
        {children}
        <TabBar />
      </div>
    </ToastProvider>
  );
}
