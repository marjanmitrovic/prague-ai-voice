# Demo scénář

## Cíl

Ukázat český prototyp AI recepčního bez Twilia, Supabase a placeného OpenAI API.

## Průběh ukázky

1. Otevřete dashboard.
2. Ukažte stav systému.
3. Otevřete sekci **Agent a hlas**.
4. Spusťte test českého neuralního hlasu.
5. Zeptejte se: `Dobrý den, kdy máte otevřeno?`
6. Zeptejte se: `Kolik stojí úprava obočí?`
7. Položte neznámý dotaz a ukažte záložní odpověď.
8. Otevřete **Konverzační rezervace**.
9. Zadejte:

```text
Chci základní kosmetické ošetření dne 2099-08-15 v 10 hodin, jmenuji se Jan Novak, telefon +420111222333
```

10. Potvrďte odpovědí `ano`.
11. Ukažte rezervaci v přehledu.
12. Exportujte CSV.
13. Otevřete **Admin editor** a změňte cenu jedné služby.
14. Uložte profil a položte stejný dotaz na cenu znovu.

## Co říct klientovi

Prague AI Voice je webový prototyp českého AI recepčního. Umí odpovídat podle profilu firmy, přijímat rezervace, kontrolovat dostupnost termínů, ukládat data do Neon PostgreSQL a mluvit českým neuralním hlasem.

## Aktuální omezení

- Není napojené skutečné telefonní číslo.
- Administrace je chráněná jednoduchým heslem.
- Demo používá pravidlového lokálního agenta, ne plný LLM.
- Pro produkci je potřeba doplnit finální GDPR proces a klientské nastavení.
