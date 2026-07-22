# Oprava ikony a loga

Verze 1.8.3 nahrazuje externě generované PNG logo lokálním SVG logem.

Důvod: pokud se místo loga zobrazoval placeholder, prohlížeč nenašel nebo nenačetl PNG soubor. SVG je nyní přímo součástí repozitáře a používá se na stránkách aplikace i jako favicon.

Kontrola po deployi:

```text
/assets/prague-ai-voice-logo.svg?v=183
/assets/favicon.svg?v=183
/
/sales
/booking/studio-aurora
```
