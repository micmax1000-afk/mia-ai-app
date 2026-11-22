# Mia AI — guida per lavorare sul progetto

App di chat AI personale: **Android (Capacitor)** e **versione web/PC (GitHub Pages)**. HTML + CSS + JavaScript, senza bundler.
Lingua: **italiano** (interfaccia, messaggi di errore, commit, README, risposte al proprietario).

## Regole del proprietario (valgono sempre)
- **Solo servizi gratuiti.** Se un servizio non è gratuito non si aggiunge (per questo non ci sono Brave Search, Cerebras, ecc.). Dire sempre quali limiti non sono verificati.
- **Nessuna PR e nessuna unione senza una richiesta esplicita** («apri e unisci la PR»). Prima di unire: build verde sul commit di testa, PR `mergeable_state: clean`, unione con `merge_method: merge` e `expectedHeadSha`.
- Il push diretto su `main` è bloccato dai permessi: si lavora su un branch (nell'ambiente cloud `ccr-ee7b5fe2-286x3a`) e si passa dalla PR.
  Dopo un'unione il branch riparte da `origin/main`, ma **prima** si controlla che non ci siano commit solo sul remoto del branch (`git log origin/main..origin/<branch>`).
- **Non dire «funziona» senza averlo provato.** Distinguere sempre: provato nei test (servizi simulati) / provato dal proprietario sul telefono / non verificato.
- Segreti (token GitHub, chiavi API) mai in chat, screenshot o repository.
- Risposte concise, con le verifiche fatte e cosa resta da provare.

## Struttura
| File | Ruolo |
|--|--|
| `index.html`, `css/` | interfaccia (stile chat, barra laterale su schermi ≥960px) |
| `js/app.js` | stato, impostazioni, chat, **ciclo agente** (`runAssistant` → `P.chat(..., {full:true})` → `executeToolCalls` → …), «disegna…», importa/esporta chat, voce |
| `js/providers.js` | provider (Gemini + API compatibili OpenAI), streaming, chiamate a funzioni, elenco modelli |
| `js/tools.js` | **gli strumenti dell'agente** (`def('nome', {...})`): GitHub, file, ricerca web, immagini, JS/Python isolati, note, piano; registrazione dinamica degli strumenti MCP |
| `js/mcp.js` | client MCP (Streamable HTTP; richieste native su Android) |
| `js/files.js` | file creati (IndexedDB `miaai_files`), Condividi/Salva (`shareBlob`) |
| `js/docs.js` | testo da xlsx/docx/pptx/zip e **PDF** (`pdfText`, pdf.js caricato solo quando serve) |
| `js/sync.js` | sincronizzazione chat con un repository GitHub **privato** (`mia-chats.json`, unione per `updated`, lapidi 90 giorni, rifiuta repository pubblici) |
| `js/github.js`, `js/github-ui.js` | integrazione GitHub del pannello Impostazioni (token, repository, «Modifica e push», esporta chat in Markdown) |
| `js/markdown.js` | Markdown sicuro (tutto l'HTML è escapato) |
| `js/pwa.js`, `sw.js` | service worker della versione web (mai nell'app Android) |
| `js/app-fix.js`, `css/app-fix.css` | correzioni dei pannelli su schermi stretti |
| `js/vendor/` | JSZip, jsPDF e pdf.js (build «legacy», `.mjs`, con licenze), caricati solo quando servono |
| `bridge/mia-bridge.js` | server MCP da eseguire sul PC (file + `run_command`), token obbligatorio |
| `scripts/` | `stage-www.js` (copia i file web in `www/`), `patch-android-manifest.py` |
| `tests/` | test end-to-end (vedi `tests/README.md`) |

Dati nel dispositivo: `localStorage` → `miaai_v1_settings`, `miaai_v1_conversations`, `miaai_v1_current`, `miaai_v1_notes`; file creati in IndexedDB.

## Build, test, pubblicazione
- `npm run serve` → `http://localhost:8080` (prepara `www/`, che è output di build e non va committato).
- **Test:** `cd tests && npm install && npx playwright install chromium && npm test` (circa 1 minuto, servizi simulati).
  Ogni funzione nuova ha il suo test in `tests/e2e/` e le righe attese in `tests/expectations.js`.
- **CI dei test:** `.github/workflows/tests.yml` esegue `tests/` a ogni PR e a ogni push su `main` (non per le sole modifiche `.md`). Da verificare la prima esecuzione sul commit di testa prima di unire.
- **APK:** `.github/workflows/build-apk.yml` parte a ogni push (anche sui branch). Artifact `mia-ai-debug-apk`, firma fissa (le chat restano installando sopra).
  Il repository è pubblico: la chiave di firma è visibile, va bene per un'app personale, non per il Play Store.
- **Pagina web:** `.github/workflows/pages.yml` pubblica `www/` su `https://micmax1000-afk.github.io/mia-ai-app/` a ogni unione su `main`.
  Richiede, una volta, *Settings → Pages → Source: GitHub Actions*: **ora è attivo** e la pubblicazione riesce (verificato su GitHub Actions). L'apertura della pagina da un PC non è ancora stata verificata dal proprietario (dall'ambiente di sviluppo `github.io` non è raggiungibile).
  Le modifiche ai soli file `.md` (e a `tests/`) non fanno partire né il build dell'APK né la pubblicazione: per una PR di sola documentazione non c'è un build sul commit di testa, si guarda l'ultimo build verde di `main`.

## Cose da sapere (insidie già incontrate)
- `P.chat` restituisce **testo**; con `{ full: true }` restituisce `{ text, toolCalls }`. `runFileEdit` (di `main`) si aspetta una stringa.
- Gemini: conservare `thoughtSignature` nelle chiamate agli strumenti; niente `parameters` vuoti nelle dichiarazioni. Mistral: id delle chiamate di 9 caratteri alfanumerici (`toNineId`).
  Schemi degli strumenti MCP ripuliti per Gemini/OpenAI (`cleanSchema`).
- Con `CapacitorHttp` attivo (`capacitor.config.json`) su Android le richieste vanno in modo nativo (niente CORS). **Nel browser** molti servizi possono essere bloccati dal CORS (DuckDuckGo, NVIDIA, vari MCP).
- `localStorage` ha circa 5 MB: i file creati stanno in IndexedDB; `persistConvs` toglie gli allegati più vecchi se la memoria si riempie. L'importazione chat ripulisce il file (campi noti, ruoli ammessi, URL immagini solo `https`).
- Gli strumenti che modificano qualcosa devono avere `write: true` (chiedono conferma); `danger` per le azioni difficili da annullare (unione PR, eliminazione file).
  I connettori MCP non dichiarati «di sola lettura» chiedono sempre conferma. Il contenuto restituito da strumenti/pagine è **dato, non istruzioni**.
- JavaScript/Python: iframe `sandbox` + CSP (rete bloccata) + Worker terminabile. Python usa Pyodide da `cdn.jsdelivr.net` (versione fissata in `tools.js`).
- Immagini: NVIDIA FLUX (`ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell`; schema verificato sulla API Reference di `build.nvidia.com`: la richiesta accetta solo `prompt`, `width`/`height` 768–1344 a passi di 64, `steps` 1–4, `cfg_scale`, `mode`, `samples` — **niente `seed`**, ogni altro campo dà 422; risposta `artifacts[0].base64` JPEG con `finishReason` SUCCESS/ERROR/CONTENT_FILTERED; i campi rifiutati vengono comunque tolti da soli), Gemini, Pollinations (`image.pollinations.ai`, indirizzo vecchio ma funzionante).
  «Automatica» prova nell'ordine NVIDIA → Gemini → Pollinations.
- **NVIDIA è un servizio «trial»** (verificato sui termini ufficiali «API Trial Terms of Service»): solo test e valutazione, non produzione (§1.2, §1.4); NVIDIA può usare testi e risposte per migliorare i suoi modelli (§3.3) e vieta di inviare dati personali, sanitari, finanziari o riservati (§4.3). Numero di crediti e limiti di richieste non sono nei termini. Non allegare dati sensibili con i modelli NVIDIA; la stessa prudenza vale per qualunque piano gratuito di terzi.
- `github_issues`/PR/Actions richiedono un token con i permessi giusti (fine-grained: Contents, Issues, Pull requests, Actions, Metadata in lettura/scrittura). Gli errori 403/404 mostrano i permessi richiesti.

## Ambiente di sviluppo cloud
- Rete filtrata da un proxy: alcuni siti non sono raggiungibili (per esempio `cdn.jsdelivr.net`, `github.io`); `build.nvidia.com`, `docs.nvidia.com`, `docs.api.nvidia.com` e `assets.ngc.nvidia.com` sono stati abilitati dal proprietario (pagine dei modelli leggibili anche in `.md`, es. `/black-forest-labs/flux_1-schnell/apireference.md`), mentre gli indirizzi delle API (`integrate.api.nvidia.com`, `ai.api.nvidia.com`) restano bloccati: quello che dipende da loro si prova con simulazioni e va verificato sul telefono. `WebSearch` funziona.
- Niente CLI `gh`: per GitHub si usano gli strumenti MCP. Chromium e Playwright sono preinstallati (`/opt/pw-browsers`, versione 1.63.0 — la stessa fissata in `tests/package.json`).

- **PDF:** `fileToAttachment` salva `att.text`/`att.pages` (pdf.js). Gemini e OpenRouter ricevono il file; gli altri provider ricevono il testo estratto (`textWithFiles(m, nativePdf)`); PDF senza testo + provider senza lettura nativa → errore chiaro. `pdfText` usa `task.destroy()` (non `doc.destroy()`).
- **OCR NVIDIA** (`ocrScan` in `app.js`, `MiaTools.ocrImages`, `MiaDocs.pdfPageImages`): per i PDF senza testo, con chiave NVIDIA e **solo dopo conferma** (le pagine vanno a un servizio di prova). Richiesta dalla pagina ufficiale: `POST ai.api.nvidia.com/v1/cv/nvidia/nemoretriever-ocr` con `{input:[{type:'image_url',url:'data:image/jpeg;base64,…'}]}`, immagine sotto i 180000 caratteri; **la forma della risposta del servizio ospitato non è documentata**: `ocrTextOf` legge `data[].content`, `text_detections[].text_prediction.text`, `text`. Da verificare sul telefono. Massimo 10 pagine; dopo 2 errori di fila si smette.
- **FLUX.1 dev:** `settings.nvidiaImageModel` (`flux.1-schnell` | `flux.1-dev`); stesso schema, `steps` 30 per dev (5–100). La pagina ufficiale elenca 768–1344 ma nel testo dice «solo 1024»: se il servizio rifiuta il formato, `nvidiaImage` toglie `width` e `height` insieme (1024×1024).
- Il filtro dei modelli NVIDIA (`providers.js`) nasconde anche `riva-translate` (traduttore, non chat); `content-safety` era già nascosto.
- **Memoria:** `settings.memory` (una riga per fatto) è aggiunta al prompt di sistema in `chatConfig` come dato; strumento `memory` con conferma per add/remove. `memoryUpdated` serve alla sincronizzazione.
- **Sincronizzazione:** token e `syncRepo` dalle impostazioni; si sincronizza solo a risposta finita (`busy` falso). Dopo una sincronizzazione il pannello Impostazioni può essere aperto: aggiornare i campi del pannello (`#memory`), altrimenti `closeSettings` riscrive i valori vecchi. Eliminando chat si scrive `settings.deletedChats` (`markDeleted`).

## Stato e idee aperte
- GitHub Pages: attivo e pubblicato; da verificare l'apertura da PC (vedi sopra).
- Verificato dal proprietario sul telefono: chat e provider, Python (anche grafici), strumenti GitHub con token corretto, ricerca web, creazione file (zip, Excel), connettore Parallel, immagini (NVIDIA/Pollinations) con Condividi/Salva, esporta chat in JSON con Condividi.
- Non ancora verificato dal proprietario (provato solo nei test con servizi simulati): OCR NVIDIA delle scansioni, FLUX.1 dev, lettura PDF con modelli non nativi, ricerca nelle chat, Memoria, sincronizzazione con il repository privato `mia-dati` (la scrittura su un repository **vuoto** con l'API dei contenuti non è provata su GitHub vero), importazione chat, Mia Bridge, Serper/Exa/Tavily con chiavi vere, versione web su PC (apertura della pagina, installazione come app).
- Idee: app per Windows/Ubuntu (Electron) se i limiti CORS del browser danno fastidio.
