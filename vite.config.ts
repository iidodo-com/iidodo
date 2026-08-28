import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { apiPlugin } from "./server/index";

export default defineConfig({
  plugins: [react(), apiPlugin()],
});
