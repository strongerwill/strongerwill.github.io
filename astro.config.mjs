import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://strongerwill.github.io",
  trailingSlash: "always",
  redirects: {
    "/writing": "/blog",
  },
});
