import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { ToastProvider } from "./ui.jsx";
import "./styles.css";

// Website: organiser, gate and public check. Fans use the Android app; its Anon Aadhaar
// step loads /aadhaar.html (src/aadhaar-bridge.jsx) inside the app.
createRoot(document.getElementById("root")).render(
  <ToastProvider>
    <App />
  </ToastProvider>
);
