# Website Import bez LLM

Verze 2.1.0 přidává kontrolovaný import údajů z webu firmy bez použití LLM.

## Stránky

```text
/website-import
/admin/website-import
```

## API

```text
POST /api/import/website
```

Požaduje administrátorské heslo v hlavičce:

```text
x-admin-password: ADMIN_PASSWORD
```

## Princip

1. Administrátor vloží URL webu firmy.
2. Server stáhne HTML stránky.
3. Aplikace bez LLM extrahuje možné údaje pomocí pravidel a regulárních výrazů:
   - název stránky,
   - meta popis,
   - e-mail,
   - telefon,
   - možné adresy,
   - možné ceny,
   - možné služby,
   - možné řádky s otevírací dobou.
4. Výsledek se zobrazí jako návrh.
5. Nic se automaticky neukládá do profilu firmy.
6. Člověk musí údaje zkontrolovat a ručně je převést do onboarding/admin editoru.

## Proč neukládat automaticky

Web firmy může obsahovat zastaralé ceny, staré kontakty, skryté texty, duplicitní ceníky nebo špatně strukturované bloky. Automatické uložení by mohlo vytvořit nepřesný profil. Proto je import jen návrh.

## Bezpečnostní omezení

Import povoluje pouze `http` a `https` URL a blokuje základní lokální/private adresy jako `localhost`, `127.0.0.1`, `10.x.x.x`, `192.168.x.x` a `172.16-31.x.x`.

## Omezení

- Nečte obrázky ani PDF.
- Neprovádí OCR.
- Nerozumí kontextu jako LLM.
- Neumí spolehlivě poznat, která cena patří ke které službě, pokud je web špatně strukturovaný.
- Slouží jako urychlení ručního nastavení, ne jako plně automatický import.

## Doporučený prodejní výklad

Asistent nepřebírá údaje slepě z internetu. Web umí načíst jako pracovní návrh, ale finální profil firmy se ukládá až po lidské kontrole. To zvyšuje přesnost a snižuje riziko špatných odpovědí.
