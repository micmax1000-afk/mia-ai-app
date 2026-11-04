# Mia AI

App di chat AI personale per Android (Capacitor), senza bundler: HTML + CSS + JavaScript.

## Funzioni

- Chat con risposte in streaming, pulsante ■ per fermare
- Più conversazioni salvate sul dispositivo (menu ☰), modifica messaggio, rigenera, copia
- Markdown nelle risposte (codice con pulsante «Copia»)
- Istruzioni di sistema (personalità) e creatività regolabili
- Tema chiaro/scuro, esportazione delle chat in JSON
- Più provider AI, scelti in **Impostazioni**:

| Provider | Cosa serve |
|--|--|
| Google Gemini | chiave da [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| OpenRouter | chiave da [openrouter.ai/keys](https://openrouter.ai/keys) (ha modelli gratuiti) |
| Groq | chiave da [console.groq.com/keys](https://console.groq.com/keys) |
| Duck.ai (tramite proxy) | il proxy non ufficiale [duckai](https://github.com/amirkabiri/duckai) acceso su un PC/server: `docker run -p 3000:3000 amirkabiri/duckai` |
| Ollama | Ollama sul PC in rete locale (`OLLAMA_HOST=0.0.0.0 OLLAMA_ORIGINS=*`) |
| Personalizzato | qualsiasi server con API `/v1/chat/completions` (es. un proxy tuo) |

Dopo aver inserito la chiave, premi **Carica modelli** e scegli il modello.

### Più modelli nella stessa app

- Tocca il nome del modello in alto (▾) per passare al volo da un modello all'altro,
  anche tra provider diversi. Ogni modello usato viene aggiunto all'elenco.
- Sotto ogni risposta c'è il modello che l'ha scritta.
- **Prova con…** rigenera l'ultima risposta con un altro modello, senza cambiare quello attivo.

> Duck.ai non ha un'API ufficiale: il proxy si basa su chiamate non documentate, può smettere
> di funzionare quando DuckDuckGo cambia qualcosa e va contro i termini d'uso di Duck.ai.
Chiavi e conversazioni restano solo nel `localStorage` del dispositivo.

## APK con GitHub Actions

1. Ogni push (o **Actions → Build APK → Run workflow**) compila l'APK.
2. A fine job scarica l'artifact **`mia-ai-debug-apk`** e installalo sul telefono
   (abilita «Installa app sconosciute»).

La firma usa la chiave fissa `resources/signing/miaai-debug.keystore` (password `android`),
così ogni nuovo APK si installa sopra il precedente senza perdere le chat.
Tieni il repo **privato**.

## Sviluppo in locale

```bash
npm install
npm run serve          # apre su http://localhost:8080
npm run build:apk      # serve JDK 21 + Android SDK
```

## Struttura

- `index.html`, `css/app.css` — interfaccia
- `js/providers.js` — chiamate a Gemini e alle API compatibili OpenAI (streaming SSE)
- `js/markdown.js` — renderer Markdown sicuro (tutto l'HTML viene escapato)
- `js/app.js` — conversazioni, impostazioni, UI
