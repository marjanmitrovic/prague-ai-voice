# Správa klientů

Verze 1.8.0 přidává českou stránku pro správu klientů.

## Odkazy

```text
/admin/clients
/clients
```

## Funkce

- zobrazení všech firem v aplikaci,
- kopírování veřejného rezervačního odkazu,
- otevření rezervační stránky klienta,
- načtení rezervací vybraného klienta,
- export CSV podle klienta,
- stažení JSON zálohy podle klienta.

## Přístup

Rezervace, CSV export a záloha jsou chráněné heslem z proměnné:

```env
ADMIN_PASSWORD=...
```

Veřejné rezervační stránky zůstávají dostupné bez hesla.
