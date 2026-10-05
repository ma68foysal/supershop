import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dokan — shop sales",
    short_name: "Dokan",
    description: "Record daily shop sales and get a PDF report every day",
    start_url: "/sell",
    display: "standalone",
    background_color: "#F2F5F0",
    theme_color: "#9E1B22",
    icons: [
      { src: "/app-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/app-icon/512", sizes: "512x512", type: "image/png" },
      { src: "/app-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
