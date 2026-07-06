import { useParams } from "@solidjs/router"
import { createQuery } from "@tanstack/solid-query"

export default function ChatSessionPage() {
  const params = useParams()
  const query = createQuery(() => ({
    queryKey: ["session", params.id],
    queryFn: () => fetch(`/api/sessions/${params.id}`).then(r => r.json()),
  }))

  return (
    <div data-component="chat-session-page">
      <h1>Session {params.id}</h1>
      {query.data && <pre>{JSON.stringify(query.data, null, 2)}</pre>}
    </div>
  )
}
