/// <reference types="vite/client" />
import { hydrate } from "preact";
import Home from "./page";
import "./globals.css";

hydrate(<Home />, document.getElementById("app")!);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const register = () => {
    void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
      .catch(() => { /* Retry when the network returns; the online app still works. */ });
  };
  register();
  window.addEventListener("online", register);
}
