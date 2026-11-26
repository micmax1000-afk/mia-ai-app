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
    /scelte = auto,nvidia,gemini,pollinations \| predefinita = auto/, /elenco modelli NVIDIA: mostrati 16 su 26/, /nvidia\/riva-translate-4b-instruct-v2 ok/,
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
  ],
  '26-ocr-flux-dev.js': [
    /domanda mostrata = true/, /richieste OCR = 3 \| formato \{input:\[\{type,url\}\]\} = true \| immagine sotto i 180000 caratteri = true/,
    /testo riconosciuto inviato al modello = true \| indicato come OCR = true \| nessun errore = true/, /detections → Prima riga 1\\nSeconda riga 1/, /jsonstring → Dal JSON 1/,
    /l'utente rifiuta[^\n]*\n +richieste OCR = 0/, /domande = 0 \| richieste OCR = 0/, /richieste OCR = 10 \| avviso = true/,
    /richieste OCR = 2 \(si smette dopo 2 errori\) \| messaggio = OCR NVIDIA \[HTTP 401\]/, /errore «scansione» come prima = true/,
    /predefinito → OK .*flux\.1-schnell \{"prompt":"a fox","width":1344,"height":768,"steps":4\}/, /dev → OK .*flux\.1-dev \{"prompt":"a fox","width":1344,"height":768,"steps":30\}/,
    /dev con formato rifiutato → OK .*richieste = 2 \| ultima = \{"prompt":"a fox","steps":30\}/, /arriva allo strumento = \/v1\/genai\/black-forest-labs\/flux\.1-dev/, /^ERRORS \[\]/m
  ],
  '27-connessione-caduta.js': [
    /riconosciuti = true \| 401\/429 e interruzione dell'utente non lo sono = true/, /messaggio in italiano = NVIDIA: la connessione è caduta/,
    /richieste = 3 \| nessun errore = true/, /richieste = 3 \| ⚠️ NVIDIA .*la connessione è caduta/, /richieste NVIDIA = 3 \| richieste Gemini = 1/,
    /richieste dopo lo stop <= 2 = true/, /^ERRORS \[\]/m
  ],
  '28-file-lunghi-github.js': [
    /avviso «FILE INCOMPLETO» = true \| indica il totale = true \| avverte di non riscrivere = true/, /lunghezza della risposta \(≈12000\) = true/, /blocchi = 28 \| ricostruito identico = true/,
    /riga 4004: \{ front: "parola 3999/, /nessun risultato → Nessuna riga contiene «zzz»/, /senza avviso = true/, /al più 40000 = true/,
    /senza conferma disponibile → RIFIUTATO .*scritture = 0/, /utente rifiuta → RIFIUTATO \| scritture = 0 \| consiglia github_edit_file = true/, /utente conferma → scritto \| scritture = 1/,
    /riduzione −20% → scritto \| scritture = 1/, /file sotto i 2000 caratteri → scritto/, /file nuovo → scritto/,
    /1ª domanda: Scrivi «data\.js» in mario\/flash .*mostra la lunghezza = true/, /2ª domanda: ATTENZIONE: «data\.js» passa da 329880 a 18 caratteri \(−100%\) \| avviso rosso = true/,
    /nessuna scrittura = true \| il modello riceve il motivo = true/, /^ERRORS \[\]/m
  ],
  '29-solo-repository-selezionato.js': [
    /si completano\) → OK File a\.txt .*GET \/repos\/mario\/flash\/contents\/a\.txt/, /maiuscole diverse → OK/,
    /altro repository dello stesso utente → ERR Repository non consentito: «mario\/segreto».*richieste a GitHub = 0/, /altro proprietario → ERR Repository non consentito: «altro\/flash».*richieste a GitHub = 0/,
    /scrittura in un altro repository → ERR .*richieste = 0/, /modifica in un altro repository → ERR .*richieste = 0/, /eliminazione in un altro repository → ERR .*richieste = 0/, /pull request di un altro repository → ERR .*richieste = 0/,
    /repo omesso → OK File aggiornato: n\.md .*PUT \/repos\/mario\/flash\/contents\/n\.md/, /limitata a questo repository = true/, /forzata su questo = true/,
    /elenco dei repository → OK L'agente lavora solo sul repository selezionato: mario\/flash\. \| richieste = 0/, /creazione di un repository → ERR Non consentito/,
    /lettura → ERR Nessun repository selezionato.*richieste = 0/, /altro repository → OK File a\.txt .*richieste = 1/,
    /nessuna domanda di conferma = true \| richieste di scrittura = 0 \| il modello riceve il motivo = true/, /il modello sa quale repository usare = true/,
    /casella attiva di serie = true/, /salvata = true/, /^ERRORS \[\]/m
  ],
  '30-branch-sintassi-conferme.js': [
    /valido: valido \| rotto: errore \| json rotto: errore \| json: valido \| modulo: non controllabile \| await: valido \| markdown: non controllabile/, /il codice NON viene eseguito = true/,
    /esito: Modifica NON salvata: dopo la modifica «data\.js» non sarebbe più valido .*scritture = 0 \| file intatto = en:25 fr:25 de:25/,
    /esito: File modificato: data\.js — 1 sostituzioni, -\d+ caratteri, righe 102 → 69 \(-33\)/, /mazzi dopo = en:25 fr:25 \| righe mostrate al modello = true \| invito a controllare = true/,
    /salvato, avviso = true/, /JSON rotto → rifiutato/, /file nuovo \.js non valido → rifiutato/, /file \.md → salvato \| righe nel risultato = true/,
    /lettura prima che il branch esista → legge il principale = true/, /modifica \(il modello chiede «main»\) → File modificato: data\.js \(branch mia-lavoro\)/,
    /branch creato dal principale = true \| principale intatto = true \| modifica sul branch = true/, /la lettura successiva vede la modifica = true/, /file nuovo sul branch = true/, /eliminazione solo sul branch = true/,
    /opzione spenta\) scrive sul principale = true/, /nessun riallineamento = true/, /il branch si riallinea da solo = true \| modifica salvata = true/,
    /cancella molte righe: ATTENZIONE: cancella 33 righe .* righe = true \| branch = true \| avviso rosso = true/, /il modello sa del branch = true \| riceve le righe dopo la modifica = true/,
    /modifica piccola: Modifica «data\.js» .* righe = true \| avviso rosso = false/, /branch di lavoro attivo di serie = true \| nome = mia-lavoro/, /nome salvato = prove/, /^ERRORS \[\]/m
  ],
  '31-continua-ricorda-il-lavoro.js': [
    /la richiesta originale è nel contesto = true \| «continua» c'è = true/, /dimensione della richiesta ragionevole \(< 120 KB\) = true/,
    /i risultati più vecchi sono accorciati = true \| gli ultimi 6 sono interi = true \| il più vecchio non è intero = true/,
    /richiesta originale presente = true \| passaggi più recenti presenti = true \| passaggi lontani omessi = true \| dimensione \(< 160 KB\) = true/,
    /richiesta originale \+ «grazie» \+ «e poi\?» presenti = true/, /contiene i messaggi precedenti = true/, /^ERRORS \[\]/m
  ],
  '32-cancella-righe.js': [
    /mazzo tedesco = righe 414 – 619/, /Controllo riuscito: le righe 414–619 \(206 righe\) corrispondono a quanto atteso\. .* Non ho scritto nulla\. \| scritture = 0/,
    /mostra i bordi = true \| conferma richiesta = false/, /la riga 415 non contiene «\{».*scritture = 0/, /ultima riga sbagliata → rifiutato \| scritture = 0/, /testo atteso diverso → rifiutato/,
    /oltre la fine del file → Il file ha 621 righe/, /intervallo invertito → Intervallo non valido/,
    /Modifica NON salvata: dopo la modifica «data\.js» non sarebbe più valido .*file intatto = en:200 fr:200 de:200/,
    /Cancellate 206 righe \(414–619\) di data\.js — righe 621 → 415/, /mazzi dopo = en:200 fr:200 \| scritture = 1 \| mostra il punto e avvisa dei numeri = true/,
    /anteprima: branch creato = false \| richieste di scrittura = 0 \| esito = ok/, /cancellazione → Cancellate N righe \(414–619\) di data\.js \(branch mia-lavoro\)/,
    /principale intatto = true \| branch di lavoro = en:200 fr:200/, /Repository non consentito: «mario\/segreto»/,
    /conferma: ATTENZIONE: cancella 206 righe .* righe = true \| branch = true \| rossa = true/, /il modello conosce lo strumento = true \| riceve l'esito = true \| branch di lavoro = en:200 fr:200/,
    /campo: max = 100/, /100 salvato = 100/, /500 → ridotto a = 100/, /^ERRORS \[\]/m
  ],
  '33-istruzioni-controlli.js': [
    /modifica senza lettura → Non ho modificato nulla: in questa chat non hai ancora letto «piccolo\.js».* \| scritture = 0/, /dopo aver letto \(anche solo in parte\) → salvata/,
    /sostituire un file letto solo in parte → Non ho scritto nulla.* \| scritture = 0/, /sostituire un file letto per intero → scritto/, /file nuovo \(nulla da leggere\) → scritto/, /controllo spento → scritto/,
    /cancella righe senza lettura → Non ho cancellato nulla/, /anteprima senza lettura → ok/,
    /prima compariva 600 volte, dopo 300 volte, attese 600.* \| scritture = 0/, /variazione -300 → ok, mazzi: en:300/, /modifica che non cambia il numero → ok \| scritture = 1/,
    /equals 600 → rifiutata/, /file nuovo con regola non rispettata → rifiutato/, /regola senza equals\/change → Regola 1/,
    /elenco dei file cambiati → «mia-lavoro» rispetto a «main»: 3 commit avanti, 0 indietro; 3 file cambiati/, /branch di lavoro non ancora creato → Il branch «mia-lavoro» non esiste ancora/,
    /«front:» compare: main 600 volte → mia-lavoro 590 volte/, /stesso branch → Base e head sono lo stesso branch/,
    /nessun workflow → true/, /in corso → true/, /uno fallito → true/, /tutti passati → true/, /branch inesistente → true/, /non chiede conferma \(sola lettura\) = true/,
    /regole del progetto \(MIA\.md\) nelle istruzioni = true \| non cambiano le regole di sicurezza = true/, /istruzioni principali presenti = true/, /senza MIA\.md si usa AGENTS\.md = true/,
    /nessuna sezione = true/, /molto lungo → tagliato = true/, /non si legge il file = true/,
    /1\) senza lettura: nessuna scrittura = true \| il modello riceve il motivo = true/, /2\) dopo la lettura: scritto = true \| contenuto = const a = 10;/, /scritto senza rileggere = true/,
    /casella «leggere prima di modificare» attiva = true/, /salvata = true/, /^ERRORS \[\]/m
  ],
  '34-ripiego-schermo-ripresa.js': [
    /all'inizio copiato dai preferiti, in ordine → 1\. Gemini · gemini-3\.5-flash \| 2\. Mistral · mistral-large/, /aggiunto Groq in fondo → .* 3\. Groq · llama/,
    /Groq spostato su → 1\. Gemini · gemini-3\.5-flash \| 2\. Groq · llama \| 3\. Mistral/, /il primo spostato giù → 1\. Groq · llama \| 2\. Gemini/, /le frecce ai bordi sono spente = true true/,
    /tolto il secondo → 1\. Groq · llama \| 2\. Mistral · mistral-large/, /doppione ignorato → 2 voci/, /senza chiave → 3\. OpenRouter · qualcosa:free \(manca la chiave\)/,
    /salvato nelle impostazioni = groq,mistral,openrouter \| preferiti intatti = true/,
    /ordine dei tentativi → nvidia → groq \| risposta = Risposta di groq\./, /ordine con più modelli occupati → nvidia → groq → mistral → gemini/,
    /richieste totali = 9 \(1 \+ 8\), il nono \(Gemini\) non viene provato = true/, /ripiego spento: nessun altro modello provato = nvidia/,
    /non finisce da solo nell'elenco di ripiego = true \| ma nei preferiti sì = true/,
    /mentre risponde: blocco attivo = true/, /tornando in primo piano lo riprende = true/, /a lavoro finito è rilasciato = true \| \{"req":2,"rel":2,"active":0\}/,
    /con l'opzione spenta non lo chiede mai = true/, /plugin nativo \(Android\): attivato mentre lavora = true \| riposo a fine lavoro = true/, /nessuna delle due funzioni: nessun errore = true/,
    /errore «riprendibile» = true \| richieste = 3/, /riprende da sola e risponde = true \| richieste totali = 4 \| errore sparito = true/,
    /si ferma dopo 3 riprese → richieste = 12 .* messaggio finale = true/, /con la ripresa spenta resta l'errore con «Rigenera» = true \| richieste = 3/,
    /app in secondo piano: non riprende = true/, /tornando in primo piano riprende = true/,
    /risultato di uno strumento → riprende da solo = true/, /domanda senza risposta → riprende = true/, /la toglie e riprende = true \| nella cronologia inviata non c'è la richiesta orfana = true/,
    /l'avevi fermato tu → non riprende = true/, /interrotto 30 minuti fa → non riprende = true/, /lavoro finito → niente da riprendere = true/,
    /errore normale → non riprende da sola = true/, /con l'opzione spenta non riprende = true/,
    /«schermo acceso» = true \| «riprendi da sola» = true/, /salvate = true/, /^ERRORS \[\]/m
  ],
  '35-secondo-parere.js': [
    /dopo un lavoro con strumenti → Copia \| Rigenera \| Prova con… \| Condividi \| Secondo parere \| Riepilogo \| Push \| Ascolta/, /in una chat senza strumenti → Copia \| Rigenera \| Prova con… \| Condividi \| Secondo parere \| Push \| Ascolta/,
    /sezioni = true \| la richiesta originale c'è = true \| lunghezza ≤ 8000 = true/, /modifiche elencate \(solo quelle riuscite\) = true \| con il commit = true/, /domanda finale chiara = true/, /tempo ricordato nella chat = true/,
    /file = secondo-parere\.md \| contiene la domanda = true \| lunghezza = true .* tagliato in modo ordinato = true/,
    /file = riepilogo-lavoro\.md \| titolo = true \| azioni = 5 = true/, /esiti = true true true true true/, /errore e file toccati = true \| true \| repository e branch = true \| risposta finale = true/,
    /la condivisione verso Mia è attiva = true/, /nessuna etichetta = true/, /etichettato come suggerimento = true/, /una seconda parte non ripete l'etichetta = true/,
    /file di testo condiviso \(\.md\) → allegato = true/, /immagine condivisa → allegato \(come prima\) = true/, /altri tipi di file \(zip\) → ignorati = true/,
    /spiega come trattare un «Parere di un'altra app» = true/, /^ERRORS \[\]/m
  ],
  '36-stop-non-interrompibile.js': [
    /ero occupato = true \| dopo «Stop» torna libero entro 1,5 s = true/, /nessun messaggio di errore né testo parziale = true \| si può scrivere di nuovo = true/,
    /torna libero entro 1,5 s = true .*nessun nuovo tentativo dopo lo stop = true \| nessun errore mostrato = true/,
    /in corso = true \| richieste = .*a\.txt/, /torna libero entro 1,5 s = true \(\d+ ms\) \| nessun nuovo giro del modello = true/,
    /preparazione[^\n]*\n +torna libero entro 1,5 s = true/, /risposta mostrata = true \| libero = true/,
    /403 permesso mancante → true/, /401 token non valido → true/, /402 crediti finiti → true/, /modello non disponibile → true/, /resta quello di connessione = true/,
    /OpenRouter 402\) = true \| \(NVIDIA 401\) = true/, /avviso = true/, /^ERRORS \[\]/m
  ],
  '37-velocita-streaming.js': [
    /aggiornamenti del testo visti = 1 \(1 = tutto insieme\) \| richieste: native = 1 , web = 0/, /mostra il tempo totale e le parole al secondo, senza «1° testo» = true/,
    /aggiornamenti del testo visti = \d{2,} \(> 5 = progressivo\) \| prima parte = "uno" \| native = 0 , web = generativelanguage\.googleapis\.com/, /mostra anche il «1° testo» = true/,
    /Groq → web = api\.groq\.com \| native = 0/, /NVIDIA → web = 0 \| native = integrate\.api\.nvidia\.com/,
    /risposta arrivata =  true \| web provato = 1 , nativo usato = 1/, /alla seconda richiesta non riprova il canale del browser = true \| nativo = 2/,
    /torna libero subito = true .* testo parziale conservato con «\(interrotto\)» = true/,
    /mostra modello, parole al secondo, tempo medio, 1° testo e numero di risposte = true/, /«Azzera le misure» = true/, /resta solo il modello = true/, /^ERRORS \[\]/m
  ],
  '38-impostazioni-pausa-versione.js': [
    /all'inizio = model:aperta istr:chiusa fall:chiusa gh:chiusa agent:chiusa sync:chiusa/, /riassunti: modello = NVIDIA · nvidia\/uno \| ripiego = 2 modelli di ripiego · ripresa automatica no \| agente = spenta \| sync = non configurata \| repository = nessun token/,
    /mostra i suoi campi = true \| le altre sono nascoste = true/, /un clic sul titolo apre la sezione = true/, /un altro clic la chiude = true/,
    /si ricorda cosa era aperto = model,fall,sync/, /sezione chiusa vengono salvati lo stesso = true/,
    /1ª domanda: ordine = nvidia → groq \| risposta = Risposta di groq\./, /si parte da Groq → ordine = groq \| NVIDIA richieste totali = 1/,
    /1ª volta = nvidia,groq,mistral \| 2ª volta = nvidia,groq,mistral/, /elenca i tre modelli con il motivo = true/, /con un solo modello non compare l'elenco = true/,
    /versione web \(version\.json\) = Mia AI · versione 0\.3\.0 \(build 57\)/, /Android \(dal sistema\) = Mia AI · versione 0\.3\.0\.57 \(build 57\)/,
    /aggiorna la versione: versionCode = true \| versionName = true \| esito = 0/, /il passo fallisce \(si vede subito\) = true/,
    /text\/plain = true \| text\/\* = true \| pdf = true \| immagini = true \| secondo passaggio senza duplicati = true/, /www\/version\.json = .* corretto = true/, /^ERRORS \[\]/m
  ],
  '39-repository-per-chat-token.js': [
    /chat esistente \(senza repository salvato\) → resta sul repository di prima = 📁 mario\/flash/, /chat nuova → parte senza repository = 📁 nessun repository \| riquadro tratteggiato = true/,
    /gli strumenti GitHub sono bloccati = true \| nessuna richiesta di lettura a GitHub = true/, /scelto dal riquadro \(prima del primo messaggio\) = 📁 mario\/flash/,
    /salvato nella chat e usato dall'agente = true \| lettura eseguita = true/, /un'altra chat nuova riparte senza repository = 📁 nessun repository/, /normalizzato = 📁 mario\/altro/,
    /avviso, il riquadro resta aperto = true true/, /«Carica i miei repository» = \(nessuno\), mario\/flash, mario\/altro, mario\/terzo/, /scelta dall'elenco = 📁 mario\/terzo/, /«Nessun repository» = 📁 nessun repository/,
    /riappare il suo repository = 📁 mario\/flash/, /partono dal repository predefinito» = 📁 mario\/flash/, /il riquadro del repository non compare = true/,
    /all'inizio = 0 token/, /"in":1200,"out":400,"think":100,"est":false/, /barra = 1,6k token \| etichetta del messaggio = Gemini · gemini-3\.5-flash · .* · 1,2k→400 tk/,
    /il costo è = \$0,0024 \| barra = 1,6k token · \$0,0024/, /"in":5000,"out":700,"think":0,"est":false\} \| barra = 5,7k token/,
    /stima = true .*barra con ≈ = true ≈ \d+ token/, /modelli senza prezzo → «senza prezzo», nessun costo inventato = true/, /«Azzera il mese» svuota il mese = true \| questa chat conserva il suo conteggio = true/, /^ERRORS \[\]/m
  ],
  '40-mappa-struttura-acorn.js': [
    /acorn caricato = true/, /modulo valido → null/, /errore con posizione → riga 4, colonna 6/, /modulo rotto → riga 2/, /await al primo livello \(script\) → null/, /file json → null \| json rotto = string/,
    /intestazione = «data\.js» — 634 righe.* sola lettura \(scritture\) = 0/, /array DECKS = 3 elementi con id = true \| righe del mazzo tedesco = 414–619/,
    /funzione e costante trovate = true \| classe con metodi = true \| oggetto con chiavi = true/, /non chiede conferma = false/, /con symbol: solo DECKS = true/,
    /array lungo \(100 carte\) → taglio con primi e ultimi = true/, /modulo con export = true/, /json = radice con 2 elementi/, /markdown = true/, /file rotto → Impossibile analizzare «rotto\.js»: .*riga 1, colonna 11/, /altro repository → Repository non consentito/,
    /anteprima: ANTEPRIMA \(non ho scritto nulla\).*tolti 1 elementi da «DECKS» \(3 → 2\).*righe 414–619 id=de \| scritture = 0 \| conferma richiesta = false/, /dopo l'anteprima il file è intatto = en:200 fr:200 de:200/,
    /elemento inesistente → Operazione 1 \(remove_element\): Nessun elemento corrisponde/, /variabile inesistente → Operazione 1 \(remove_element\): Non trovo «NONESISTE»/, /nessuna corrispondenza → rifiutato/, /non è un array → «CONFIG» non è un array/,
    /must_count non rispettato → rifiutato \| scritture = 0/, /toglie il mazzo centrale \(fr\) = en:200 de:200 \| scritture = 1/, /toglie l'ultimo \(de\) = en:200$/m, /il resto del file è intatto = true/,
    /aggiunge un mazzo in fondo = en:200 it:0/, /doppione → non aggiungo un doppione/, /elemento non valido → rifiutato/, /aggiunge all'inizio = pt:0 en:200 it:0/, /aggiunge dopo "en" = pt:0 en:200 ru:0 it:0/,
    /toglie una proprietà dall'oggetto = tolta \| CONFIG ok = prova/, /toglie una funzione = tolta \| LIMITE ancora = true/, /dichiarazione inesistente → Non trovo una funzione/, /operazione sconosciuta → remove_element/, /il file finale è valido = true/,
    /due corrispondenze senza all → /, /con all = ac \| virgola finale conservata = true/, /ultimo con virgola finale → ancora valido = true \| elementi = 1/, /json: tolto = 1$/m, /json: aggiunto = 1,3/, /file già rotto → Impossibile analizzare/,
    /window\.DECKS dentro \(function\(\)\{…\}\)\(\) = en$/m, /anteprima: branch creato = false \| scritture = 0 \| esito = ok/, /scrittura → ok \| principale intatto = true \| branch di lavoro = en:200 fr:200$/m, /altro repository → Repository non consentito/,
    /senza lettura → Non ho modificato nulla = true \| scritture = 0/, /anteprima senza lettura → ok = true/, /dopo la mappa\/lettura → scritto = true \| mazzi = en:200 fr:200/,
    /conferma: Modifica la struttura di «data\.js».* mostra l'operazione = true/, /il modello conosce gli strumenti = true \| dopo la mappa, la modifica non è stata rifiutata = true \| mazzi = en:200 fr:200/, /istruzioni: mappa invece di rileggere = true/, /errore ripetuto o esterno → cerca sul web \(web_search\), errore nel codice → rileggi = true/, /^ERRORS \[\]/m
  ]
};
