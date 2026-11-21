import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import devApi from "./dev-api.js";

export default defineConfig({
  plugins: [react(), devApi()],
  // The Anon Aadhaar SDK's dependencies require("crypto") on Node-only paths; give the browser a stub.
  resolve: { alias: { crypto: resolve(__dirname, "src/shims/crypto.js") } },
  // host: true -> reachable from phones on the same Wi-Fi (the Android app opens /aadhaar.html).
  server: { port: 5173, host: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        aadhaar: resolve(__dirname, "aadhaar.html"),
        prove: resolve(__dirname, "prove.html"),
        fanpass: resolve(__dirname, "fanpass.html"),
        kiosk: resolve(__dirname, "kiosk.html"),
      },
    },
  },
});
