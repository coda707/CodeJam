import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": env.VITE_API_TARGET ?? "http://127.0.0.1:3000",
      },
    },
  };
});
