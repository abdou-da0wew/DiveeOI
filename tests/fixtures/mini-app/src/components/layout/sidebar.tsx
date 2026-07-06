import { A } from "@solidjs/router"

export function Sidebar() {
  return (
    <nav data-component="sidebar" class="w-64 border-r p-4">
      <ul>
        <li><A href="/">Home</A></li>
        <li><A href="/chat">Chat</A></li>
        <li><A href="/settings">Settings</A></li>
      </ul>
    </nav>
  )
}
