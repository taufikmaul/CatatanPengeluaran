import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/app/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 300,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (
              id.includes("/node_modules/react/") ||
              id.includes("/node_modules/react-dom/") ||
              id.includes("/node_modules/scheduler/") ||
              id.includes("/node_modules/react-router/") ||
              id.includes("/node_modules/react-router-dom/")
            ) {
              return "vendor-react";
            }
            if (id.includes("/node_modules/@tanstack/react-query")) {
              return "vendor-query";
            }
            if (
              id.includes("/node_modules/@tanstack/react-table") ||
              id.includes("/node_modules/@tanstack/table-core") ||
              id.includes("/node_modules/@tanstack/react-virtual") ||
              id.includes("/node_modules/@tanstack/virtual-core")
            ) {
              return "vendor-table";
            }
            if (
              id.includes("/node_modules/d3-") ||
              id.includes("/node_modules/victory-vendor") ||
              id.includes("/node_modules/decimal.js-light") ||
              id.includes("/node_modules/internmap") ||
              id.includes("/node_modules/lodash/") ||
              id.includes("/node_modules/fast-equals") ||
              id.includes("/node_modules/recharts-scale") ||
              id.includes("/node_modules/eventemitter3")
            ) {
              return "vendor-charts-deps";
            }
            if (
              id.includes("/node_modules/recharts") ||
              id.includes("/node_modules/react-smooth")
            ) {
              return "vendor-charts";
            }
            if (id.includes("/node_modules/framer-motion")) {
              return "vendor-motion";
            }
            if (id.includes("/node_modules/lucide-react")) {
              return "vendor-icons";
            }
            if (
              id.includes("/node_modules/@radix-ui/") ||
              id.includes("/node_modules/@floating-ui/")
            ) {
              return "vendor-radix";
            }
            if (id.includes("/node_modules/@base-ui/")) {
              return "vendor-base-ui";
            }
            if (
              id.includes("/node_modules/react-hook-form") ||
              id.includes("/node_modules/@hookform/") ||
              id.includes("/node_modules/zod/")
            ) {
              return "vendor-forms";
            }
            if (id.includes("/node_modules/@dnd-kit/")) {
              return "vendor-dnd";
            }
            if (
              id.includes("/node_modules/axios/") ||
              id.includes("/node_modules/sonner/") ||
              id.includes("/node_modules/tailwind-merge/") ||
              id.includes("/node_modules/clsx/") ||
              id.includes("/node_modules/class-variance-authority/")
            ) {
              return "vendor-utils";
            }
          }
          if (
            id.includes("/src/components/ui/") &&
            !id.includes("/src/components/ui/chart.tsx")
          ) {
            return "ui-components";
          }
          if (id.includes("/src/components/reui/data-grid/")) {
            return "reui-data-grid";
          }
          if (id.includes("/src/components/reui/cascader/")) {
            return "reui-cascader";
          }
          if (id.includes("/src/components/reui/filters/")) {
            return "reui-filters";
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        secure: false,
      },
      "/dashboard": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
