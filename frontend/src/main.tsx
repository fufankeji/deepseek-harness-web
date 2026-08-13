import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { RouterProvider } from "react-router/dom";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { router } from "./app/router";
import { store } from "./app/store";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Provider store={store}>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />
      </TooltipProvider>
    </Provider>
  </StrictMode>
);
