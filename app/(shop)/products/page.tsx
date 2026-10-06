import { getProducts, getShop, getSrs } from "@/lib/data";
import ProductsScreen from "./products-screen";

export const metadata = { title: "Products · Dokan" };

export default async function ProductsPage() {
  const [{ me }, products, srs] = await Promise.all([getShop(), getProducts(true), getSrs()]);
  return <ProductsScreen products={products} srs={srs} isOwner={me.role === "owner"} />;
}
