# Static assets fix 1.8.4

Verze 1.8.4 opravuje servírování loga, favicon a dalších souborů z `public/assets`.

Nové veřejné cesty:

```text
/assets/prague-ai-voice-logo.svg
/assets/favicon.svg
/favicon.svg
/favicon.png
/site.webmanifest
```

Důvod opravy: HTML používalo obrázek, ale server neměl obecnou statickou routu `/assets/*`, takže Render vracel `not found`.
