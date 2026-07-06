import { Suspense } from "solid-js"
import { Outlet } from "@solidjs/router"
import { Sidebar } from "./components/layout/sidebar"
import { Header } from "./components/layout/header"

export function App() {
  return (
    <div data-component="app-shell" class="flex h-screen">
      <Sidebar />
      <div data-component="app-main" class="flex flex-1 flex-col">
        <Header />
        <main data-component="app-content" class="flex-1 overflow-auto p-4">
          <Suspense fallback={<div>Loading...</div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
