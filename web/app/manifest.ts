import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Threads",
    short_name: "Threads",
    description: "Voice memory — recordings, threads, and the links between days",
    start_url: "/",
    display: "standalone",
    background_color: "#26221c",
    theme_color: "#26221c",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
