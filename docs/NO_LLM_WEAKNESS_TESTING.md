# Prague AI Voice 2.0.0 — Test slabých míst bez LLM

Tato verze nepoužívá OpenAI ani jiný velký jazykový model. Cílem je ověřit, kam až stačí kontrolovaný pravidlový agent a kde je potřeba doplnit ručně ověřená data.

## Nové části

- `/weaknesses`
- `/admin/weaknesses`
- `GET /api/knowledge/faq`
- `PUT /api/knowledge/faq`
- `POST /api/assistant/test-suite`

## Princip

1. Firma má profil v databázi: služby, ceny, pracovní dobu, adresu a pravidla rezervací.
2. Admin může doplnit FAQ znalostní bázi.
3. Agent nejdříve hledá odpověď ve FAQ, potom v pravidlech a službách.
4. Pokud odpověď nenajde, použije kontrolovaný fallback a neimprovizuje.
5. Test slabých míst ukáže dotazy s vysokým rizikem a doporučí doplnění FAQ nebo synonym.

## Proč je to důležité

Bez LLM je systém levnější a kontrolovatelný, ale nerozumí všem formulacím. Proto je potřeba testovat reálné otázky zákazníků a průběžně doplňovat FAQ.

## Doporučený test

Použijte otázky typu:

- Máte parkování?
- Dá se platit kartou?
- Mohu přijít se psem?
- Děláte dárkové poukazy?
- Jak dlouho trvá ošetření?
- Kdy máte otevřeno?
- Kolik stojí konkrétní služba?

Vysoké riziko znamená, že agent odpověď nezná. To není chyba — je to signál, že je potřeba doplnit ověřenou FAQ odpověď.
