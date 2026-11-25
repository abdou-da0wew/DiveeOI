import { createMemo, Show } from "solid-js"
import type { JSX } from "solid-js"
import { createSortable } from "@thisbeyond/solid-dnd"
import { FileIcon } from "@diveeoi/ui/file-icon"
import { IconButton } from "@diveeoi/ui/icon-button"
import { TooltipKeybind } from "@diveeoi/ui/tooltip"
import { Tabs } from "@diveeoi/ui/tabs"
import { getFilename } from "@diveeoi/db/util/path"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useCommand } from "@/context/command"
import { bookIdFromTab, pendingBookCite } from "@/pages/session/book-tabs"
import { videoPathFromTab } from "@/pages/session/video-tabs"

export function FileVisual(props: { path: string; active?: boolean }): JSX.Element {
  return (
    <div class="flex items-center gap-x-1.5 min-w-0">
      <Show
        when={!props.active}
        fallback={<FileIcon node={{ path: props.path, type: "file" }} class="size-4 shrink-0" />}
      >
        <span class="relative inline-flex size-4 shrink-0">
          <FileIcon node={{ path: props.path, type: "file" }} class="absolute inset-0 size-4 tab-fileicon-color" />
          <FileIcon node={{ path: props.path, type: "file" }} mono class="absolute inset-0 size-4 tab-fileicon-mono" />
        </span>
      </Show>
      <span class="text-14-medium truncate">{getFilename(props.path)}</span>
    </div>
  )
}

// Book tabs (`book:<id>`) have no file path: show the book title (when the
// pending citation carries one) or a plain "Book" label next to a book icon.
function BookTabVisual(props: { bookId: string }): JSX.Element {
  const pending = createMemo(() => {
    const cite = pendingBookCite()
    return cite && cite.bookId === props.bookId ? cite : undefined
  })
  return (
    <div class="flex items-center gap-x-1.5 min-w-0">
      <svg viewBox="0 0 20 20" fill="none" class="size-4 shrink-0 text-text-weak" aria-hidden="true">
        <path
          d="M3.5 4.75A1.75 1.75 0 0 1 5.25 3H9.25v14H5.25a1.75 1.75 0 0 1-1.75-1.75v-10.5ZM10.75 3h4a1.75 1.75 0 0 1 1.75 1.75v10.5A1.75 1.75 0 0 1 14.75 17h-4V3Z"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linejoin="round"
        />
      </svg>
      <span class="text-14-medium truncate">{pending()?.bookTitle?.trim() || "Book"}</span>
    </div>
  )
}

// Video tabs (`video:<path>`) have no file path: show the file name next to
// a play icon (Coenx Video preview, same slot as exam and book tabs).
function VideoTabVisual(props: { path: string }): JSX.Element {
  return (
    <div class="flex items-center gap-x-1.5 min-w-0">
      <svg viewBox="0 0 20 20" fill="none" class="size-4 shrink-0 text-text-weak" aria-hidden="true">
        <rect x="3" y="4.5" width="14" height="11" rx="1.75" stroke="currentColor" stroke-width="1.3" />
        <path
          d="M8.5 8.25 12 10l-3.5 1.75v-3.5Z"
          fill="currentColor"
          stroke="currentColor"
          stroke-width="1"
          stroke-linejoin="round"
        />
      </svg>
      <span class="text-14-medium truncate">{props.path.split("/").pop() || props.path}</span>
    </div>
  )
}

export function SortableTab(props: { tab: string; onTabClose: (tab: string) => void }): JSX.Element {
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const sortable = createSortable(props.tab)
  const path = createMemo(() => file.pathFromTab(props.tab))
  const bookId = createMemo(() => bookIdFromTab(props.tab))
  const videoPath = createMemo(() => videoPathFromTab(props.tab))
  const content = createMemo(() => {
    const value = path()
    if (value) return <FileVisual path={value} />
    const id = bookId()
    if (id) return <BookTabVisual bookId={id} />
    const video = videoPath()
    if (video) return <VideoTabVisual path={video} />
    return
  })
  return (
    <div use:sortable class="h-full flex items-center" classList={{ "opacity-0": sortable.isActiveDraggable }}>
      <div class="relative">
        <Tabs.Trigger
          value={props.tab}
          closeButton={
            <TooltipKeybind
              title={language.t("common.closeTab")}
              keybind={command.keybind("tab.close")}
              placement="bottom"
              gutter={10}
            >
              <IconButton
                icon="close-small"
                variant="ghost"
                class="h-5 w-5"
                onClick={() => props.onTabClose(props.tab)}
                aria-label={language.t("common.closeTab")}
              />
            </TooltipKeybind>
          }
          hideCloseButton
          onMiddleClick={() => props.onTabClose(props.tab)}
        >
          <Show when={content()}>{(value) => value()}</Show>
        </Tabs.Trigger>
      </div>
    </div>
  )
}
