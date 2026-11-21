# Mia AI

App di chat AI personale per Android (Capacitor), senza bundler: HTML + CSS + JavaScript.

## Funzioni

- Chat con risposte in streaming, pulsante ■ per fermare
- Più conversazioni salvate sul dispositivo (menu ☰), modifica messaggio, rigenera, copia
- Markdown nelle risposte (codice con pulsante «Copia»)
- Istruzioni di sistema (personalità) e creatività regolabili
- Tema chiaro/scuro, esportazione delle chat in JSON
- Microfono (riconoscimento vocale) e lettura ad alta voce (TTS)
- Più provider AI, scelti in **Impostazioni**:

| Provider | Cosa serve |
|--|--|
| Google Gemini | chiave da [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| OpenRouter | chiave da [openrouter.ai/keys](https://openrouter.ai/keys) (modelli `:free`) |
| Groq | chiave da [console.groq.com/keys](https://console.groq.com/keys) |
| Personalizzato | qualsiasi server con API `/v1/chat/completions` (es. LM Studio, vLLM, un tuo proxy) |

Dopo aver inserito la chiave, premi **Carica modelli** e scegli il modello.

### Modelli gratuiti

- **Gemini**: la chiave di Google AI Studio è gratuita, con un limite di richieste al giorno.
- **OpenRouter**: chiave gratuita; i modelli che finiscono con `:free` non costano nulla
  (limite giornaliero di richieste). «Carica modelli» li mette in cima all'elenco con l'etichetta «gratis».
- **Groq**: chiave gratuita con limiti di richieste al minuto/giorno.

### Allegati (📎)

- **Immagini** (ridimensionate a 1280 px): Gemini e i modelli «vision» di OpenRouter/Groq.
- **PDF** (max 8 MB): solo Gemini e OpenRouter.
- **File di testo/codice** (txt, md, csv, json, py, js…): funzionano con tutti i modelli,
  perché il contenuto viene inserito nel messaggio.
- Se il modello non accetta l'allegato, compare un avviso: usa **Prova con…** per passare a un altro modello.
- Se la memoria del telefono si riempie, gli allegati più vecchi vengono rimossi (resta il nome).

### Più modelli nella stessa app

- Tocca il nome del modello in alto (▾) per passare al volo da un modello all'altro,
  anche tra provider diversi. Ogni modello usato viene aggiunto all'elenco.
- Sotto ogni risposta c'è il modello che l'ha scritta.
- **Prova con…** rigenera l'ultima risposta con un altro modello, senza cambiare quello attivo.

Chiavi e conversazioni restano solo nel `localStorage` del dispositivo.

## APK con GitHub Actions

1. Ogni push (o **Actions → Build APK → Run workflow**) compila l'APK.
2. A fine job scarica l'artifact **`mia-ai-debug-apk`** e installalo sul telefono
   (abilita «Installa app sconosciute»).

La firma usa la chiave fissa `resources/signing/miaai-debug.keystore` (password `android`),
così ogni nuovo APK si installa sopra il precedente senza perdere le chat.
Tieni il repo **privato**.

## Icona

Sorgenti in `resources/icon-background.svg` e `resources/icon-foreground.svg` (icona adattiva Android).
Le PNG già generate sono in `resources/android-res/` e la Action le copia nel progetto Android.

## Sviluppo in locale

```bash
npm install
npm run serve          # apre su http://localhost:8080
npm run build:apk      # serve JDK 21 + Android SDK
```

## Struttura

- `index.html`, `css/app.css`, `css/app-fix.css` — interfaccia (app-fix.css corregge le sheet su mobile)
- `js/providers.js` — chiamate a Gemini e alle API compatibili OpenAI (streaming SSE)
- `js/markdown.js` — renderer Markdown sicuro (tutto l'HTML viene escapato)
- `js/app.js` — conversazioni, impostazioni, UI
- `js/app-fix.js` — gestione classe `sheet-open` per bloccare lo scroll dello sfondo
