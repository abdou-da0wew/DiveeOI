# @diveeoi/identity

Brand assets for DiveeOI. Distributes the mark, the wordmark and the
browser/app icon set as plain files — no code, no dependencies.

## Contents

```
mark.svg              the mark on charcoal (512)
mark-light.svg        the mark on off-white
mark-96x96.png        app icon / avatar
mark-192x192.png
mark-512x512.png
mark-512x512-light.png
```

The mark is "Mark 02 — Frame + Cursor": an open frame shaped like a `D` with a
solid inner `D` (the cursor) in the accent colour. The palette is charcoal
`#121212`, off-white `#EDEDEA`, steel `#8A8F98` and safety orange `#FF5B1F`.

The browser/app icon set lives in `packages/ui/src/assets/favicon/` and is
symlinked into `packages/app/public/`.

## Use

Direct file URL (Vite / asset imports):

```ts
import mark from "@diveeoi/identity/mark.svg"
```
