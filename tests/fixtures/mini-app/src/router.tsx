import { lazy } from "solid-js"
import { Route } from "@solidjs/router"

const HomePage = lazy(() => import("./pages/home"))
const ChatPage = lazy(() => import("./pages/chat"))
const ChatSessionPage = lazy(() => import("./pages/chat-session"))
const SettingsPage = lazy(() => import("./pages/settings"))

export const routes = [
  { path: "/", component: HomePage },
  { path: "/chat", component: ChatPage },
  { path: "/chat/:id", component: ChatSessionPage },
  { path: "/settings", component: SettingsPage },
  { path: "/settings/:tab", component: SettingsPage },
]
