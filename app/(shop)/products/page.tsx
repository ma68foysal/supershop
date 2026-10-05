import { getProducts, getShop } from "@/lib/data";
import ProductsScreen from "./products-screen";

export const metadata = { title: "Products · Dokan" };

export default async function ProductsPage() {
  const [{ me }, products] = await Promise.all([getShop(), getProducts(true)]);
  return <ProductsScreen products={products} canEdit={me.role === "owner"} />;
}
