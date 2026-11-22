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

### Integrazione GitHub

In Impostazioni puoi inserire un **Personal Access Token** (con permesso `repo`).
Il modulo `js/github.js` espone:

- `MiaGitHub.me(token)` — verifica il token
- `MiaGitHub.listRepos(token)` — elenco repository
- `MiaGitHub.getFile(token, owner, repo, path)` — leggi un file
- `MiaGitHub.putFile(token, owner, repo, path, content, message, sha?, branch?)` — crea o aggiorna un file (commit)

Il token resta solo nel `localStorage` del dispositivo.

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

### Modalità agente (strumenti)

In **Impostazioni → Modalità agente** Mia può usare 21 strumenti (più quelli dei connettori), non solo rispondere a parole:

| Strumento | Cosa fa | Conferma |
|--|--|--|
| `github_list_repos` | elenca i tuoi repository | no |
| `github_create_repo` | crea un repository (privato di default) | **sì** |
| `github_read_file` | legge un file o elenca una cartella | no |
| `github_write_file` | crea/sostituisce un file con un commit | **sì** |
| `github_delete_file` | elimina un file con un commit | **sì** |
| `github_create_branch` | crea un branch | **sì** |
| `github_list_branches_commits` | elenca branch o ultimi commit | no |
| `github_issues` | elenca/legge issue; crea issue o commenta | solo crea/commenta |
| `read_webpage` | legge il testo di una pagina web | no |
| `notes` | note salvate sul telefono | solo elimina |
| `github_search_code` | cerca testo/codice nei repository | no |
| `github_pull_requests` | elenca/legge PR (con diff); crea, commenta, unisce | solo crea/commenta/**unisce** |
| `github_actions` | esecuzioni di test e build, log degli errori; avvia o rilancia workflow | solo avvia/rilancia |
| `run_javascript` | esegue JavaScript in ambiente isolato (niente rete), può creare file | no |
| `run_python` | esegue Python (Pyodide: numpy, pandas, matplotlib…) in ambiente isolato; i file vanno in `/out/` | no |
| `create_file` | file di testo: txt, md, csv, json, html, codice… | no |
| `create_zip` | archivio .zip con più file | no |
| `create_svg` | immagine disegnata in SVG, salvata anche come PNG | no |
| `generate_image` | immagine generata dall'AI (modello immagini di Gemini) | no |
| `create_pdf` | PDF A4 con titoli, elenchi, tabelle (caratteri latini, niente emoji) | no |
| `create_xlsx` | foglio Excel con più fogli, numeri e formule | no |

- **File creati:** compaiono nella chat con il pulsante **Condividi / Salva** (pannello di Android: Drive, File, WhatsApp…);
  nel browser vengono scaricati. Sono tenuti sul dispositivo (IndexedDB) finché non elimini la chat.
- `run_python` usa Pyodide, scaricato da cdn.jsdelivr.net alla prima esecuzione (circa 10 MB, più i pacchetti usati): serve internet quella volta.
  Stesso isolamento di `run_javascript` (nessuna rete oltre alla CDN, nessun accesso ai dati dell'app); la sessione resta viva 5 minuti
  (le variabili persistono) e viene chiusa se il codice supera il tempo (90 s di default, max 180).
- `run_javascript` gira in un iframe «sandbox» con CSP che blocca la rete, dentro un Worker che viene terminato allo scadere
  del tempo (10 s di default, max 30). Non ha accesso a chiavi, chat o file dell'app. Python non è disponibile.
- `generate_image` usa la chiave del provider Gemini e il «Modello immagini» in Impostazioni (predefinito `gemini-2.5-flash-image`);
  il piano gratuito potrebbe non includere le immagini.
- Serve un **token GitHub** (resta solo sul dispositivo). Consigliato un token *fine-grained* limitato ai repository che vuoi
  far gestire, con permessi **Contents**, **Issues**, **Pull requests**, **Actions**, **Metadata** in lettura/scrittura. Per creare nuovi repository serve un
  token *classic* con permesso `repo`.
- Ogni azione che modifica qualcosa mostra una finestra «Consenti / Rifiuta». Non esiste uno strumento per eliminare repository.
- Il modello deve supportare le chiamate a funzioni: Gemini sì; sui modelli gratuiti di OpenRouter/Groq dipende dal modello.
- `read_webpage` prova l'indirizzo direttamente; se il sito blocca la richiesta usa il servizio r.jina.ai.
- Ogni richiesta può fare al massimo 8 giri di strumenti; il pulsante ■ ferma tutto.

### Connettori (MCP)

In **Impostazioni → Modalità agente → Connettori (MCP)** puoi collegare servizi esterni che offrono un server
[MCP](https://modelcontextprotocol.io) con trasporto «Streamable HTTP» (indirizzo `https://…`, token facoltativo).
Premi **Prova**: Mia legge gli strumenti del server e puoi disattivare quelli che non servono (troppi strumenti confondono i modelli).

- Gli strumenti compaiono al modello come `mcp_<connettore>_<strumento>`.
- Quelli che il server non dichiara «di sola lettura» chiedono sempre conferma. I contenuti restituiti sono trattati come dati, non come istruzioni.
- Nel browser il server deve accettare richieste CORS; nell'APK Android le richieste passano dal plugin HTTP nativo di Capacitor.
- Non sono supportati i server MCP con solo il vecchio trasporto «SSE» né i login OAuth: serve un token che incolli tu.

### Allegati Office e zip

Oltre a immagini, PDF e testo, nel 📎 puoi allegare **.xlsx, .docx, .pptx e .zip**: l'app ne estrae il testo (fogli come CSV, titoli e tabelle di Word,
diapositive e note di PowerPoint, elenco e contenuto dei file di testo di uno zip) e lo passa a qualsiasi modello. I formati vecchi (.xls, .doc, .ppt) non sono supportati.

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
- `js/github.js` — integrazione GitHub (token + commit file)
- `js/tools.js` — strumenti della modalità agente (GitHub, web, note, file)
- `js/mcp.js` — client MCP; `js/docs.js` — testo da xlsx/docx/pptx/zip
- `js/files.js` — archivio dei file creati e condivisione
- `js/vendor/` — librerie incluse: JSZip (zip/xlsx) e jsPDF (pdf), caricate solo quando servono
- `js/markdown.js` — renderer Markdown sicuro (tutto l'HTML viene escapato)
- `js/app.js` — conversazioni, impostazioni, UI
- `js/app-fix.js` — gestione classe `sheet-open` per bloccare lo scroll dello sfondo
