import ReactDOM from "react-dom/client";
import App from "./App";
import "./app.css";
import { startRendererPerformance } from "./performance";

if (window.desktopPerformance) {
  const stopPerformance = startRendererPerformance(window.desktopPerformance);
  import.meta.hot?.dispose(stopPerformance);
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
