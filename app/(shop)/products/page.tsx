import { getProducts, getSrs } from "@/lib/data";
import ProductsScreen from "./products-screen";

export const metadata = { title: "Products · Dokan" };

export default async function ProductsPage() {
  const [products, srs] = await Promise.all([getProducts(true), getSrs()]);
  return <ProductsScreen products={products} srs={srs} />;
}
