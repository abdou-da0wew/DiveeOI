// packages/app/src/utils/usr-quotations.ts
//
// usr_quotations — app-side surface for the quotation wire format.
//
// The canonical (pure) implementation lives in @diveeoi/ui (usr-quote.ts) so
// that message rendering (packages/ui) and composer serialization (this
// package) share one parser/serializer — the ui package cannot import from
// the app, so the shared module had to live on the ui side. See the
// re-exported module for the exact format and docs.

export {
  serializeUsrQuotation,
  parseUsrQuotations,
  stripUsrQuotation,
  type UsrQuotation,
} from "@diveeoi/ui/usr-quote"
