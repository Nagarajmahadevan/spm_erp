import { createBrowserRouter } from "react-router";
import Dashboard from "./components/Dashboard";
import LoginScreen from "./components/LoginScreen";

export const router = createBrowserRouter([
  { path: "/", Component: Dashboard },
  { path: "/login", Component: LoginScreen },
]);
