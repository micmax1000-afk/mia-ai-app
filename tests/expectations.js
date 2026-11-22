/*
 * Righe che l'output di ogni test DEVE contenere. Gli script stampano l'esito di ogni prova;
 * qui si indica cosa deve risultare (verificato a mano la prima volta). Se cambi un comportamento di proposito,
 * aggiorna le espressioni corrispondenti.
 */
module.exports = {
  '01-agente-github.js': [
    /S1 tool cards: 1 \| confirm visible: false/,
    /S1 sig kept: true/,
    /system has login: true/,
    /S2 confirm title: Scrivi «NOTE\.md» in mario\/app/,
    /S2 decoded content: ciao è così/,
    /S3 gh POST calls \(deve essere 0\): 0 \| denied card: 1/,
    /S4 merged responses in one turn: 2/,
    /Reload: tool cards 5 msgs 13/
  ],
  '02-file-creati.js': [
    /create_file OK +File creato: «dati\.csv»/,
    /create_file ERR +Estensione non consentita/,
    /create_zip OK +Archivio creato: «progetto\.zip»/,
    /create_svg OK +Immagine creata: «logo\.png»/,
    /create_svg ERR +SVG non valido/,
    /create_pdf OK +PDF creato: «relazione\.pdf»/,
    /create_xlsx OK +Foglio Excel creato: «conti\.xlsx»/,
    /generate_image OK +Immagine generata/,
    /chat file-card: 📎 spese\.xlsx/,
    /download: spese\.xlsx/,
    /dopo reload file-card: 1/,
    /^ERRORS: \[\]/m
  ],
  '03-sandbox-js-github.js': [
    /calcolo +OK .*somma/,
    /rete \(fetch\) +OK .*bloccato: Failed to fetch/,
    /richieste arrivate al server esterno \(deve essere 0\): 0/,
    /dati app +OK .*undefined/,
    /ciclo infinito +ERR .*Tempo scaduto/,
    /UI viva dopo il loop: Mia/,
    /errore di sintassi +ERR/,
    /eccezione \+ log +ERR .*boom/,
    /file \(csv \+ binario\) +OK .*tabella\.csv.*dati\.bin/,
    /abort: AbortError/,
    /search_code +OK .*function login/,
    /pr read +OK .*unibile: clean/,
    /pr merge +OK/,
    /actions read +OK .*Passaggi f/,
    /actions dispatch +OK/,
    /prMerge: true/, /mergeDanger: true/, /actRun: true/, /js: false/, /prList: false/
  ],
  '04-allegati-office.js': [
    /vecchio\.xls ===.*avviso: Formato vecchio non supportato/,
    /rotto\.docx ===.*avviso: File non leggibile o danneggiato/,
    /## Foglio: Vendite/,
    /"Mela, rossa",10,20\.5/,
    /,,,,=SUM\(B2:C3\)/,
    /# Relazione annuale/,
    /- Voce elenco/,
    /\| Alfa \| 42 \|/,
    /Note: Nota del relatore/,
    /- src\/main\.py/,
    /^ERRORS \[\]/m
  ],
  '05-connettori-mcp.js': [
    /connect: \{"n":5/,
    /token errato: .*HTTP 401/,
    /schema add: .*"required":\["a"\]/,
    /conferme: \{"add":false,"note":true,"ping":false\}/,
    /mcp_mockmcp_add \{"text":"Risultato: 5"/,
    /mcp_mockmcp_pic .*immagine-mcp-1\.png/,
    /mcp_mockmcp_fail \{"err":"Strumento sconosciuto/,
    /conferma chiesta per: MockMCP → create_note/,
    /UI stato: ✓ Connesso a MockMCP: 5 strumenti/,
    /^ERRORS \[\]/m
  ],
  '06-python.js': [
    /1ª \(carica\) +OK/, /2ª \(variabili\) +OK .*42/, /3ª \(persistono\) +OK/, /file in \/out +OK .*dati\.json.*note\.txt/,
    /eccezione +ERR .*ZeroDivisionError/, /rete +OK .*bloccato/, /richieste al server esterno \(0 atteso\): 0/,
    /ciclo infinito +ERR .*Tempo scaduto/, /dopo il kill +OK .*rinasce/, /^ERRORS \[\]/m
  ],
  '07-funzioni-di-main.js': [
    /1\) conferma push: Scrivere «README\.md»/, /PUT inviato: true/, /2\) rifiutato → PUT: 0/,
    /3\) file >20000 car\.: richieste al modello: 0 \| PUT: 0/, /4\) .*inviata = true/,
    /5\) .*apre Impostazioni = true \| inviata al modello = false/, /6\) contesto web inoltrato al modello: true/,
    /il messaggio mostrato NON contiene il contesto: true/
  ],
  '08-modifica-file-piano-bridge.js': [
    /modifica unica +OK/, /testo duplicato +ERR/, /testo assente +ERR/, /nessun cambio +ERR/,
    /contenuto inviato: "A\\r\\nB\\r\\nc\\r\\n"/, /richiede conferma: true/,
    /Tavily +OK/, /Tavily chiave errata +ERR/,
    /con limite 15 → richieste al modello: 15/, /con limite 4 +→ richieste al modello: 4/,
    /primo messaggio è la richiesta originale = true/,
    /conferme chieste: Computer → edit_file +\| +Computer → run_command/,
    /file sul computer: "riga uno\\nRIGA 2\\nriga tre\\n"/
  ],
  '09-ricerca-google.js': [
    /Google via Gemini +OK/, /strumenti: \[\{"google_search":\{\}\}\]/, /modello usato: gemini-2\.5-flash:generateContent/,
    /limite \(429\) +ERR/, /chat: il modello ha ricevuto le fonti = true/,
    /campo chiave visibile: gemini = false \| serper = true \| tavily = true \| disattivata = false/,
    /impostazione assente → mostra: gemini/, /^ERRORS \[\]/m
  ],
  '10-ricerca-duckduckgo.js': [
    /risultati +OK .*Roma - Wikipedia & storia/, /richiesta: POST application\/x-www-form-urlencoded/,
    /verifica anti-robot 202 +ERR/, /nessun risultato +OK .*Nessun risultato/, /bloccato \(CORS\/rete\) +ERR/,
    /chiave richiesta da ddg: no/, /campo chiave visibile: ddg = false \| gemini = false \| exa = true/,
    /salvato: ddg/, /^ERRORS \[\]/m
  ],
  '11-provider.js': [
    /provider nel menu: Google Gemini \| OpenRouter \| Groq \| NVIDIA/, /mistral +URL: https:\/\/api\.mistral\.ai\/v1/,
    /modelli NVIDIA mostrati: nvidia\/llama-3\.2-11b-vision-instruct, nvidia\/llama-3\.3-70b-instruct/,
    /profili separati: NVIDIA mantiene chiave = nvapi-TEST123/, /uguali = true \| 9 caratteri alfanumerici = true/,
    /NVIDIA: id invariato = call_mk4x9z2b7q1c/, /^ERRORS \[\]/m
  ],
  '12-ricerca-serper-exa.js': [
    /Serper +OK .*Risposta diretta/, /Serper chiave errata +ERR .*403/, /Serper vuoto +OK .*Nessun risultato/,
    /Exa +OK .*2026-03-01/, /Exa chiave errata +ERR .*401/, /Exa limite 429 +ERR/, /Brave \(rimosso\) +ERR/,
    /impostazione salvata «brave» → il menu mostra: gemini/, /campo chiave: gemini false \| ddg false \| tavily true \| serper true \| exa true \| disattivata false/,
    /^ERRORS \[\]/m
  ],
  '13-errori-github.js': [
    /permessi richiesti da GitHub: issues=write; pull_requests=write/, /token: fine-grained/,
    /scope del token: public_repo/, /Limite di richieste GitHub raggiunto: riprova più tardi\. \[HTTP 403\]/,
    /richiesta: POST \/repos\/micmax1000-afk\/Prova\/issues\/9\/comments/
  ],
  '14-connettori-web.js': [
    /strumenti web di Mia presenti = nessuno \| connettore: mcp_parallel_web_search/,
    /il prompt nomina lo strumento = true \| e la lettura = true/,
    /2\) preferenza spenta: strumenti web di Mia = web_search\+read_webpage \| prompt li nomina = false/,
    /3\) nessun connettore: strumenti web di Mia = web_search\+read_webpage/,
    /4\) connettore con web_search spento: Mia mantiene = web_search/,
    /5\) connettore disattivato: strumenti web di Mia = web_search\+read_webpage/,
    /6\) chat senza nominare Parallel: chiamate al connettore = tools\/call:web_search/,
    /7\) casella in Impostazioni selezionata: true/, /salvata: false/, /^ERRORS \[\]/m
  ],
  '15-versione-web.js': [
    /1\) avvio sotto \/mia-ai-app\/: errori JS = 0 \| file non trovati = nessuno/, /2\) service worker: .*"state":"activated"/,
    /3\) chat online: .* = true/, /4\) rete assente: l'app si riapre = true \| chat salvata ancora visibile = true/,
    /5\) aggiornamento online: titolo = Mia v2/, /6\) manifest: .*"scope":"\.\/"/, /^ERRORS \[\]/m
  ],
  '16-service-worker-android.js': [
    /browser: service worker registrati = 1/, /app Android \(simulata\): service worker registrati = 0/
  ],
  '17-elenco-chat-pc.js': [
    /PC 1366px +elenco chat all'avvio: \["Prima chat","Seconda chat"\]/, /clic sulla seconda chat → titolo aperto: Seconda chat/,
    /telefono 390px +elenco chat all'avvio: \["Prima chat","Seconda chat"\]/
  ],
  '18-importa-esporta-chat.js': [
    /formato: mia-ai v1 \| chat: 2/, /contiene chiavi o token\? +no/, /Importate 2 chat nuove/,
    /richiesta e risultato mantenuti = true \| file degli strumenti scartati = true/, /chat B aperta: schede strumento = 1 \| testo finale visibile = true/,
    /Importate 0 chat nuove, 2 già presenti più recenti/, /Importate 1 chat nuove, 1 aggiornate/, /titolo di A resta: Chat A modificata/,
    /non è JSON → Il file non è valido/, /JSON di altro tipo → Il file non contiene chat di Mia/, /elenco vuoto → Nessuna chat trovata/,
    /imageUrl javascript: scartato = true \| https mantenuto = true/, /script eseguito = false/, /ERRORI JS: \[\]/,
    /file scritto in cache = \["write","mia-ai-chat-.*","CACHE"/, /"files":\["file:\/\/\/cache\/mia-ai-chat-.*\.json"\]/
  ],
  '19-immagini-nvidia.js': [
    /artifacts\[0\]\.base64 +OK .*image\/png/, /"width":1024,"height":1024,"steps":4\} \| auth: Bearer nvapi-X/, /campo image +OK/,
    /data\[0\]\.b64_json \(\+prefisso\) +OK/, /JPEG riconosciuto dai byte +OK .*image\/jpeg/, /422 → richiesta minima +OK/,
    /filtered +ERR NVIDIA FLUX: immagine non generata \(CONTENT_FILTERED\)/, /402 +ERR .*crediti gratuiti NVIDIA/, /429 +ERR .*Troppe richieste/,
    /auto: NVIDIA ok +OK[^\n]*\n +chiamate a Gemini: 0/, /auto: NVIDIA 402 → Gemini +OK[^\n]*\n +chiamate a Gemini: 1/,
    /auto: solo chiave Gemini +OK[^\n]*Creata con Gemini/, /nvidia esplicito senza chiave +ERR Serve la chiave NVIDIA/,
    /scelte = auto,nvidia,gemini,pollinations \| predefinita = auto/, /elenco modelli NVIDIA: mostrati 17 su 26/,
    /starcoder2-15b ok/, /nvclip ok/, /^ERRORS \[\]/m
  ],
  '20-nvidia-campi-rifiutati.js': [
    /schema ufficiale di NVIDIA +OK[^\n]*\n +richieste: 1 \| ultima: \{"prompt":"a red fox","width":1024,"height":1024,"steps":4\}/,
    /width e height rifiutati +OK[^\n]*\n +richieste: 2 \| ultima: \{"prompt":"a red fox","steps":4\}/,
    /ammesso solo il prompt +OK[^\n]*\n +richieste: 2 \| ultima: \{"prompt":"a red fox"\}/,
    /prompt troppo lungo \(non risolvibile\) +ERR NVIDIA FLUX: body\.prompt: String should have at most 20 characters/,
    /formato landscape +OK \| corpo: \{"prompt":"a fox","width":1344,"height":768,"steps":4\}/,
    /formato portrait +OK \| corpo: \{"prompt":"a fox","width":768,"height":1344,"steps":4\}/,
    /formato square +OK \| corpo: \{"prompt":"a fox","width":1024,"height":1024,"steps":4\}/,
    /formato undefined +OK \| corpo: \{"prompt":"a fox","width":1024,"height":1024,"steps":4\}/,
    /finishReason ERROR → NVIDIA FLUX: immagine non generata \(ERROR\): errore del servizio/
  ],
  '21-immagini-pollinations.js': [
    /Pollinations esplicito +OK .*image\/jpeg/, /dimensioni: 1024x1024/, /auto: senza chiavi → Pollinations +OK/,
    /Poll\. ✓ +OK .*ho usato Pollinations/, /Pollinations 429 +ERR/, /Pollinations risponde con una pagina +ERR/,
    /rete bloccata, con allowLink +OK +\(nessun file\) \| link:/, /il modello ha riscritto la richiesta: .* istruzione in inglese = true/,
    /senza virgolette = true/, /file in chat: 📎 un-gatto-che-dorme\.jpg .* anteprima = true \| pulsante = Condividi \/ Salva/,
    /Condividi\/Salva \(browser\) → scarica: un-gatto-che-dorme\.jpg/, /dopo il ricaricamento il file c'è ancora = true/,
    /descrizione inviata: una casa rossa/, /messaggio «interrotto» mostrato = true \| nessun file = true/,
    /«disegna un tramonto panoramico orizzontale» → 1344x768 \(atteso\)/, /«disegna un ritratto verticale di un gufo» → 768x1344 \(atteso\)/, /«disegna una mela» → 1024x1024 \(atteso\)/,
    /immagine mostrata da collegamento = true \| caricata davvero = true/, /errore mostrato: ⚠️ NVIDIA FLUX: Out of credits/, /^ERRORS \[\]/m
  ],
  '22-mia-bridge.js': [
    /senza token +→ 401/, /token errato +→ 401/, /initialize +→ 200 mia-bridge/, /strumenti +→ list_dir\(lettura\), read_file\(lettura\), write_file, edit_file, run_command/,
    /edit_file +→ Modificato/, /uno\|DUE\|tre/, /run exit 3 +→ .*codice di uscita 3/, /run timeout +→ .*tempo scaduto/,
    /\.\.\/ +→ \[ERRORE\].*fuori dalla cartella/, /assoluto +→ \[ERRORE\].*fuori dalla cartella/, /symlink +→ \[ERRORE\].*fuori dalla cartella/,
    /esiste fuori\? false/, /cwd fuori +→ \[ERRORE\]/, /sola lettura +→ list_dir, read_file/
  ],
  '23-pdf-allegati.js': [
    /testo estratto inviato = true \| pagine = true \| contenuto = true \| nessun file binario = true/, /chip dell'allegato nel messaggio = true/,
    /PDF inviato come dati = true \| testo non duplicato = true/, /file nativo = true \| testo non duplicato = true/,
    /indica il numero di pagine reale = true \| arriva a pagina 100 = true \| non oltre = true \| avviso di testo troncato = true/,
    /errore chiaro = ⚠️ Il PDF «scansione\.pdf» non contiene testo selezionabile/, /con Gemini invece va \(legge le immagini\) = true/,
    /l'allegato si crea comunque e dà l'errore chiaro = true/, /errore chiaro con NVIDIA = true/, /il testo viene usato anche con Gemini = true/, /^ERRORS \[\]/m
  ],
  '24-ricerca-memoria.js': [
    /«besciamella» → Ricetta lasagne/, /estratto mostrato = true/, /«LISBONA tre».* → Viaggio a Lisbona/, /«itinerario» → Viaggio a Lisbona/, /«zzzz» → Nessuna chat contiene «zzzz»/,
    /testo cercato mostrato come testo = true/, /elenco completo → 3 chat/, /clic su un risultato apre la chat = Scrivi una funzione/,
    /search_chats → "• Ricetta lasagne/, /notes search «pane» → "• Spesa/, /notes search «xyz» → "Nessuna nota contiene/, /notes search nel titolo «idee» → "• Idee/,
    /memoria nelle istruzioni di sistema = true \| indicata come dati = true/, /add → Ricordato: Vivo a Torino => \[Mi chiamo Marco\. \/ Vivo a Torino\]/,
    /add doppione → Già in memoria/, /remove → Tolte 1 righe/, /remove inesistente → Nessuna riga contiene/, /memoria piena → ERR Memoria piena/,
    /add e remove chiedono conferma = true/, /^ERRORS \[\]/m
  ],
  '25-sincronizzazione.js': [
    /esito: Sincronizzato alle \d\d:\d\d · 0 nuove, 0 aggiornate · inviato\n/, /file creato nel repository = true \| scritture = 1/,
    /nessun segreto inviato = true \| token usato solo nell'intestazione = true/, /immagini non inviate, testo del PDF sì = true/, /memoria inviata = true/, /in A gli allegati restano al loro posto = true/,
    /2 nuove, 0 aggiornate/, /chat arrivate = Lasagne \| Viaggio/, /memoria arrivata = Mi chiamo Marco\./, /allegato ricevuto senza immagine ma con testo = true/,
    /seconda sincronizzazione senza novità: nessuna scrittura = true/, /nel repository: chat = c1 \| eliminata registrata = c2/,
    /0 nuove, 1 aggiornate, 1 eliminate/, /chat in A = Lasagne \| messaggi di Lasagne = 3/, /l'immagine locale non c'è più\) = true/,
    /chat più recente della lapide resta = true/, /chat più vecchia della lapide sparisce = true/, /lapidi vecchie di 90 giorni ripulite = true/,
    /inviato \| tentativi di scrittura = 2/, /file molto grande[^\n]*\n +esito: Sincronizzato/,
    /è pubblico: le chat non vengono inviate/, /nessuna scrittura = true/, /non può scrivere nel repository/, /GitHub risponde 404/, /non è di Mia: non lo sovrascrivo/,
    /chat scaricate da sole = Lasagne/, /nessuna chat = true/, /^ERRORS \[\]/m
  ]
};
