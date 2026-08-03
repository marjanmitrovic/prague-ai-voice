# Klientský onboarding

Verze `1.7.0` přidává chráněnou stránku pro rychlé založení nové firmy.

## Odkaz

```text
/onboarding
/admin/onboarding
```

## Co stránka umí

- vytvořit nový firemní profil,
- vygenerovat bezpečný URL slug,
- nastavit základní otevírací dobu,
- zadat služby ve formátu `Název | Cena | Délka minut | Popis`,
- uložit profil do Neon PostgreSQL přes existující admin API,
- ihned vytvořit veřejný rezervační odkaz `/booking/<slug>`.

## Přístup

Stránka používá stejné heslo jako administrace:

```env
ADMIN_PASSWORD=...
```

Heslo se posílá v hlavičce `x-admin-password` pouze na vlastní backend.

## Doporučený postup pro demo

1. Otevři `/onboarding`.
2. Zadej admin heslo.
3. Vyplň firmu a služby.
4. Klikni `Vytvořit klienta`.
5. Otevři `/booking/<slug>`.
6. Vytvoř testovací rezervaci.
7. Zkontroluj ji v administraci.
