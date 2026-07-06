import { createSignal, For } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useSession } from "../stores/session-store"

export default function ChatPage() {
  const [session] = useSession()
  const navigate = useNavigate()
  const [messages, setMessages] = createSignal<{ id: string; text: string }[]>([])

  async function sendMessage(text: string) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ text }),
    })
    const data = await res.json()
    setMessages(m => [...m, data])
  }

  return (
    <div data-component="chat-page">
      <For each={messages()}>
        {msg => <div data-component="message">{msg.text}</div>}
      </For>
      <button onClick={() => sendMessage("hello")}>Send</button>
    </div>
  )
}
