# 1.6.1 Build fix

Tato verze opravuje TypeScript chyby v multi-business rezervacích:

- `businessSlug` je součástí availability requestu.
- `listAvailableSlots` vrací `businessSlug` v typu návratové hodnoty.
- Interní volání `checkAvailability` předává správný `businessSlug`.
- `BusinessSummary.updatedAt` se nepředává jako `undefined`, aby prošel `exactOptionalPropertyTypes`.

Po nasazení spusťte v Renderu:

```text
Manual Deploy → Clear build cache & deploy
```
