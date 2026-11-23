# Test di Mia AI

Test end-to-end con [Playwright](https://playwright.dev) (Chromium): aprono l'app vera in un browser e verificano il comportamento.
**Nessun servizio esterno viene chiamato davvero**: Gemini, GitHub, NVIDIA, Pollinations, i server MCP, le ricerche web, ecc. sono simulati
(intercettazione delle richieste), quindi i test sono veloci (circa 1 minuto in tutto), gratuiti e non consumano crediti.

## Come eseguirli

```bash
cd tests
npm install                     # Playwright (+ Pyodide, facoltativo, per la prova di Python)
npx playwright install chromium # solo la prima volta (scarica il browser)
npm test                        # tutti i test
node run-all.js immagini        # solo quelli il cui nome contiene «immagini»
node run-all.js --list          # elenco
node run-all.js --verbose       # stampa anche l'output dei test riusciti
```

Serve Node 18 o più recente. Il runner prepara da solo la cartella `www/` (`scripts/stage-www.js`) usata dalle prove della versione web.

## Come funzionano

- `e2e/NN-nome.js`: ogni script stampa l'esito di ogni prova (`OK`, `ERR`, `true/false`…).
- `expectations.js`: per ogni script, le righe che l'output **deve** contenere. Il runner controlla anche che l'uscita sia 0, che non compaia `FAIL`
  e nessun `TypeError`/`ReferenceError`/`SyntaxError`.
- `lib/mock-mcp.js`: finto server MCP (Streamable HTTP, risposte JSON e SSE, sessione, token).
- `fixtures/office/`: file xlsx, docx, pptx, zip, e due non validi, per la prova degli allegati.
- File temporanei e schermate: in una cartella di sistema (`mia-test-…`), mai nel repository.

## Cosa copre

| Test | Argomento |
|--|--|
| 01 | ciclo agente: strumenti GitHub, conferme, rifiuto, note, firma di pensiero di Gemini |
| 02 | file creati (csv, zip, svg/png, pdf, xlsx, immagine) e schede in chat |
| 03 | JavaScript isolato (rete bloccata, ciclo infinito, dati dell'app), ricerca nel codice, PR, Actions |
| 04 | allegati xlsx/docx/pptx/zip e file non validi |
| 05 | client MCP: connessione, token, schemi, conferme, immagini, errori |
| 06 | Python (Pyodide): variabili, file, rete bloccata, ciclo infinito (richiede il pacchetto `pyodide`) |
| 07 | funzioni di `main`: modifica file con push (conferma, file lungo), contesto web, messaggi «progetto» |
| 08 | modifica precisa dei file, ricerca, piano, passaggi massimi, compattazione del contesto, Mia Bridge come connettore |
| 09–10, 12 | ricerca web: Google via Gemini, DuckDuckGo, Serper, Exa, Tavily |
| 11 | provider (NVIDIA, Mistral, …), elenco modelli, id degli strumenti con Mistral |
| 13 | messaggi di errore GitHub con diagnosi dei permessi |
| 14 | connettori che sostituiscono la ricerca/lettura web di Mia |
| 15–17 | versione web: sottocartella, service worker, offline, elenco chat su PC, nessun service worker nell'app Android |
| 18 | esporta/importa chat (unione, file ostili, Condividi su Android simulato) |
| 19–21 | immagini: NVIDIA FLUX, campi rifiutati dal servizio, Pollinations e «disegna…» |
| 22 | Mia Bridge: token, strumenti, percorsi fuori cartella, timeout, sola lettura |
| 23 | PDF: testo estratto per i modelli senza lettura nativa, Gemini/OpenRouter, scansioni, 120 pagine, file rotto |
| 24 | ricerca nelle chat e nelle note, Memoria (impostazioni e strumento) |
| 31 | «continua» dopo un lavoro lungo: la richiesta originale resta nel contesto, risultati lontani accorciati |
| 30 | branch di lavoro, controllo della sintassi prima di salvare, righe mostrate dopo la modifica, conferma rossa per molte righe cancellate |
| 29 | l'agente usa GitHub solo sul repository selezionato (lettura, scrittura, ricerca, elenco, creazione) |
| 28 | file lunghi su GitHub: lettura a blocchi, «find», avviso «FILE INCOMPLETO», seconda conferma se un file si riduce di molto |
| 27 | connessione caduta: nuovi tentativi, messaggio chiaro, ripiego su un altro modello, stop dell'utente |
| 26 | OCR NVIDIA delle scansioni (consenso, forme di risposta, limite di pagine, errori) e scelta FLUX.1 schnell/dev |
| 25 | sincronizzazione con repository privato simulato (due dispositivi, eliminazioni, conflitti, repository pubblico rifiutato) |

## Aggiungere o cambiare un test

1. Copia uno script esistente di argomento simile in `e2e/` con il numero successivo.
2. Simula i servizi con `ctx.route('https://…', …)` e le impostazioni con `localStorage` (`miaai_v1_settings`), come negli altri.
3. Stampa l'esito di ogni prova e aggiungi in `expectations.js` le righe che devono comparire.
4. `node run-all.js nome-del-test`.

Se un comportamento cambia di proposito, aggiorna le espressioni corrispondenti: un test che fallisce dopo una modifica è un'informazione, non solo un fastidio.

## Cosa questi test NON provano

Non girano su Android: il WebView, le richieste native di Capacitor, il pannello Condividi, microfono, fotocamera, voce, e la ricezione di testo da altre app
vanno verificati sul telefono (APK da GitHub Actions). Non provano i servizi veri (formati di risposta, limiti, crediti): solo ciò che l'app fa con le risposte simulate.
