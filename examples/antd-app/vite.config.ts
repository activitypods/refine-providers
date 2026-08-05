import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      // The app description in public/*.json is fetched by the Pod provider (not through
      // Vite/HMR), so the browser and any intermediate cache have no reason to revalidate it.
      // Disable caching for those files so edits take effect immediately on the next request.
      name: "no-cache-app-description",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && /^\/(app|access-need-[\w-]+)\.json(\?|$)/.test(req.url)) {
            res.setHeader("Cache-Control", "no-store");
          }
          next();
        });
      },
    },
  ],
  // Pinned: public/app.json and the other public/*.json files it references hardcode this
  // port in their URLs. If you change it, update those files' URLs to match (see README).
  server: {
    port: 5173,
    strictPort: true,
  },
});
