import { render } from "solid-js/web"
import { Router } from "@solidjs/router"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { SessionProvider } from "./stores/session-store"
import { App } from "./App"
import "./styles/index.css"

const queryClient = new QueryClient()

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <Router>
          <App />
        </Router>
      </SessionProvider>
    </QueryClientProvider>
  ),
  document.getElementById("app")!,
)
