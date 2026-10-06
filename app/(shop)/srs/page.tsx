import { getProducts, getShop, getSrs } from "@/lib/data";
import { weekdayNow } from "@/lib/format";
import SrsScreen, { type SrStats } from "./srs-screen";

export const metadata = { title: "SRs · Dokan" };

export default async function SrsPage() {
  const [{ settings }, srs, products] = await Promise.all([getShop(), getSrs(), getProducts()]);

  // How many products each SR brings, and how many of those are running low
  const stats: Record<string, SrStats> = {};
  for (const p of products) {
    if (!p.sr_id) continue;
    const s = (stats[p.sr_id] ??= { products: 0, low: 0 });
    s.products++;
    if (p.low_stock_at !== null && Number(p.stock_qty) <= Number(p.low_stock_at)) s.low++;
  }

  return (
    <SrsScreen srs={srs} stats={stats} today={weekdayNow(settings.timezone)} canEdit />
  );
}
