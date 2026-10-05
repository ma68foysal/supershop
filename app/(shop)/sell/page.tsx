import { cookies } from "next/headers";
import { getProducts, getShop } from "@/lib/data";
import SellScreen from "./sell-screen";

export const metadata = { title: "Sell · Dokan" };

export default async function SellPage() {
  const [{ openDay }, products, jar] = await Promise.all([getShop(), getProducts(), cookies()]);
  return (
    <SellScreen
      products={products}
      isOpen={Boolean(openDay)}
      initialMode={jar.get("sell-mode")?.value === "items" ? "items" : "quick"}
    />
  );
}
