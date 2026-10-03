import { hydrate } from "preact";
import Home from "./page";
import "./globals.css";

hydrate(<Home />, document.getElementById("app")!);
