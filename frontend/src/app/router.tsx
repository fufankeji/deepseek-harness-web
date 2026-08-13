import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router";

const SetupPage = lazy(() => import("../pages/SetupPage").then((module) => ({ default: module.SetupPage })));
const WorkbenchPage = lazy(() => import("../pages/WorkbenchPage").then((module) => ({ default: module.WorkbenchPage })));
const ResultsPage = lazy(() => import("../pages/ResultsPage").then((module) => ({ default: module.ResultsPage })));
const DiagnosticsPage = lazy(() => import("../pages/DiagnosticsPage").then((module) => ({ default: module.DiagnosticsPage })));

function page(element: ReactNode) {
  return <Suspense fallback={<div className="route-loading" role="status"><span />正在准备页面…</div>}>{element}</Suspense>;
}

export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/setup" replace /> },
  { path: "/setup", element: page(<SetupPage />) },
  { path: "/workbench", element: page(<WorkbenchPage />) },
  { path: "/results", element: page(<ResultsPage />) },
  { path: "/diagnostics", element: page(<DiagnosticsPage />) },
  { path: "*", element: <Navigate to="/setup" replace /> }
]);
