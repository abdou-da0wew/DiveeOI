import { DiveeWordmark } from "@diveeoi/ui/divee-wordmark"

/**
 * The v2 wordmark: the DiveeOI typography lockup.
 *
 * Previously this was a hand-cut path rendering of the old wordmark; it is now
 * the real lockup from the brand sheet — "Divee" in Bebas Neue with the "OI"
 * suffix in steel gray — so every v2 surface shows the current brand.
 */
export function WordmarkV2(props: { class?: string }) {
  return <DiveeWordmark class={props.class} />
}
