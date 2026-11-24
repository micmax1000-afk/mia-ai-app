/* Mia AI — provider AI (Gemini + qualsiasi API compatibile OpenAI) */
(function (global) {
  'use strict';

  /**
   * Preset: type 'gemini' usa l'API Google; type 'openai' usa /chat/completions.
   * Il modello è sempre modificabile in Impostazioni (pulsante «Carica modelli»).
   * Solo provider con tier gratuito utilizzabile.
   */
  const PRESETS = {
    gemini: {
      label: 'Google Gemini',
      short: 'Gemini',
      type: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-3.6-flash',
      needsKey: true,
      keyUrl: 'https://aistudio.google.com/apikey'
    },
    openrouter: {
      label: 'OpenRouter',
      short: 'OpenRouter',
      type: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: '',
      needsKey: true,
      keyUrl: 'https://openrouter.ai/keys',
      hint:
        'Chiave gratuita su openrouter.ai/keys. I modelli gratuiti finiscono con «:free»: ' +
        'premi «Carica modelli» e li trovi in cima all\'elenco (filtro «Solo gratis»).'
    },
    groq: {
      label: 'Groq',
      short: 'Groq',
      type: 'openai',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: '',
      needsKey: true,
      keyUrl: 'https://console.groq.com/keys'
    },
    nvidia: {
      label: 'NVIDIA (build.nvidia.com)',
      short: 'NVIDIA',
      type: 'openai',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      model: '',
      needsKey: true,
      keyUrl: 'https://build.nvidia.com/settings/api-keys',
      hint:
        'Chiave «nvapi-…» da build.nvidia.com. È un servizio di PROVA (termini «API Trial» di NVIDIA): crediti gratuiti che si esauriscono, solo per test e valutazione, ' +
        'non per produzione. Importante: NVIDIA può usare i testi che invii e le risposte per migliorare i suoi modelli, e i termini vietano di inviare dati personali di ' +
        'persone identificabili, dati sanitari, finanziari o riservati: non allegare documenti sensibili a questi modelli. ' +
        'Premi «Carica modelli» e scegli un modello per chat. Nel browser le richieste possono essere bloccate dal CORS; nell\'app Android funzionano.'
    },
    mistral: {
      label: 'Mistral AI',
      short: 'Mistral',
      type: 'openai',
      baseUrl: 'https://api.mistral.ai/v1',
      model: '',
      needsKey: true,
      keyUrl: 'https://console.mistral.ai/api-keys',
      hint: 'Chiave da console.mistral.ai. Il piano gratuito («Experiment»), se disponibile per il tuo account, ha limiti di richieste.'
    },
    sambanova: {
      label: 'SambaNova',
      short: 'SambaNova',
      type: 'openai',
      baseUrl: 'https://api.sambanova.ai/v1',
      model: '',
      needsKey: true,
      keyUrl: 'https://cloud.sambanova.ai/apis',
      hint: 'Chiave da cloud.sambanova.ai: piano gratuito con limiti di richieste.'
    },
    huggingface: {
      label: 'Hugging Face (Inference Providers)',
      short: 'HF',
      type: 'openai',
      baseUrl: 'https://router.huggingface.co/v1',
      model: '',
      needsKey: true,
      keyUrl: 'https://huggingface.co/settings/tokens',
      hint: 'Token da huggingface.co/settings/tokens (inizia con «hf_»): se è «fine-grained» deve avere il permesso «Make calls to Inference Providers». Poi premi «Carica modelli» e scegli un modello dall\'elenco: il nome va scritto esatto (per esempio «Qwen/Qwen2.5-72B-Instruct»). I crediti gratuiti mensili sono limitati e alcuni provider sono a pagamento.'
    },
    custom: {
      label: 'Personalizzato (compatibile OpenAI)',
      short: 'Custom',
      type: 'openai',
      baseUrl: 'http://localhost:3000/v1',
      model: '',
      needsKey: false,
      hint: 'Qualsiasi server con API /v1/chat/completions (es. LM Studio, vLLM, un tuo proxy).'
    }
  };

  let controller = null;

  function trimSlash(u) {
    return String(u || '').trim().replace(/\/+$/, '');
  }

  const oneLineMsg = (t) => String(t).replace(/\s+/g, ' ').slice(0, 140);

  function friendlyError(e, providerLabel) {
    const m = String((e && e.message) || e || '');
    const who = providerLabel || 'Provider';
    if (e && e.attachmentError) return m;
    // Hugging Face (Inference Providers): errori tipici e cosa fare
    if (/Hugging ?Face|huggingface/i.test(who + ' ' + m) && !isConnectionError(e)) {
      if (/\b402\b|credits|exceeded|payment required/i.test(m))
        return who + ': i crediti gratuiti mensili di Hugging Face sono finiti, oppure il modello scelto usa un provider a pagamento. Prova un altro modello o un altro provider.';
      if (/sufficient permissions|permission|\b403\b/i.test(m))
        return who + ': il token non ha il permesso «Make calls to Inference Providers». Apri huggingface.co/settings/tokens, modifica il token e attiva quel permesso (oppure crea un token nuovo con quel permesso), poi incollalo qui.';
      if (/\b401\b|invalid (username|token|credentials)|unauthori[sz]ed/i.test(m))
        return who + ': token non valido o scaduto. Copialo di nuovo per intero da huggingface.co/settings/tokens (inizia con «hf_», senza spazi né a capo).';
      if (/not supported|model_not_supported|not found|does not exist|no provider|\b404\b|\b400\b/i.test(m))
        return who + ': il modello scelto non è disponibile con i tuoi provider (' + oneLineMsg(m) + '). Premi «Carica modelli» nelle Impostazioni e scegline uno dall\'elenco.';
    }
    if (/tool|function.?call/i.test(m) && /support|endpoint|enabled|not (available|allowed)|invalid/i.test(m))
      return who + ': questo modello non supporta gli strumenti (modalità agente). Scegline un altro (es. Gemini) o disattiva la modalità agente in Impostazioni.';
    if (/image|vision|multimodal|image_url|inline_?data|mime|pdf|file/i.test(m) && /support|invalid|not|unsupported|allowed/i.test(m))
      return who + ': questo modello non accetta questo tipo di allegato. Usa «Prova con…» e scegli un modello che legge immagini/PDF (es. Gemini).';
    if (/402|insufficient|credit|payment required/i.test(m))
      return (
        who +
        ': crediti esauriti. Il modello scelto è a pagamento oppure la chiave ha un limite di spesa. ' +
        'Su OpenRouter scegli un modello che finisce con «:free» (Impostazioni → Carica modelli → Solo gratis).'
      );
    if (/401|403|api key|unauthori[sz]ed|permission/i.test(m)) return who + ': chiave API non valida o non autorizzata.';
    if (/per-day|per day|daily/i.test(m) && /429|limit|quota/i.test(m))
      return who + ': limite giornaliero gratuito raggiunto. Usa un altro provider (es. Gemini) o riprova domani.';
    if (/429|quota|rate|overload|capacity|503|502/i.test(m))
      return who + ': modello occupato o limite di richieste raggiunto. Riprova tra poco o usa «Prova con…».';
    if (isConnectionError(e))
      return who + ': la connessione è caduta mentre aspettavo la risposta (rete mobile debole, schermo spento o server che chiude la connessione). Riprova: se capita spesso con questo modello, usa «Prova con…» o un altro modello.';
    if (/404|not found/i.test(m)) return who + ': modello o indirizzo non trovato. Controlla le Impostazioni.';
    return m.length > 300 ? m.slice(0, 300) + '…' : m || 'Errore sconosciuto.';
  }

  async function readError(res, fallback) {
    let msg = fallback + ' (' + res.status + ')';
    try {
      const d = await res.json();
      msg = (d.error && (d.error.message || d.error)) || d.message || msg;
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
      msg += ' (' + res.status + ')';
    } catch (_) {}
    return new Error(msg);
  }

  /** Legge uno stream SSE e chiama onData(payloadString) per ogni riga "data:". */
  async function readSSE(res, onData) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        onData(payload);
      }
    }
    const rest = buffer.trim();
    if (rest.startsWith('data:')) {
      const payload = rest.slice(5).trim();
      if (payload && payload !== '[DONE]') onData(payload);
    }
  }

  // ─── Allegati ──────────────────────────────
  // attachment: { kind: 'image'|'pdf'|'text', name, mime, data (base64) | text, dropped? }
  function attachmentError(msg) {
    const e = new Error(msg);
    e.attachmentError = true;
    return e;
  }

  /**
   * Testo del messaggio + contenuto dei file di testo allegati. Il testo estratto da un PDF viene aggiunto solo se il provider
   * non legge i PDF da solo (nativePdf = false), oppure se il PDF originale non c'è più (messaggio vecchio, memoria liberata).
   */
  function textWithFiles(m, nativePdf) {
    let t = m.content || '';
    (m.attachments || []).forEach((a) => {
      if (a.kind === 'text') t += '\n\n--- File allegato: ' + a.name + ' ---\n' + a.text + '\n--- Fine file ---';
      else if (a.kind === 'pdf' && a.text && (!nativePdf || a.dropped || !a.data))
        t += '\n\n--- Testo estratto dal PDF «' + a.name + '»' + (a.pages ? ' (' + a.pages + ' pagine)' : '') + (a.ocr ? ', riconosciuto con OCR: può contenere errori' : '') + ' ---\n' + a.text + '\n--- Fine PDF ---';
      else if (a.dropped) t += '\n\n[Allegato «' + a.name + '» non più disponibile]';
    });
    return t.trim() || '(allegato)';
  }

  function binaries(m) {
    return (m.attachments || []).filter((a) => (a.kind === 'image' || a.kind === 'pdf') && a.data && !a.dropped);
  }

  // ─── Gemini ──────────────────────────────
  function newCallId() {
    return 'call_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function parseArgs(raw) {
    if (raw && typeof raw === 'object') return { args: raw };
    try {
      const v = JSON.parse(raw || '{}');
      return { args: v && typeof v === 'object' && !Array.isArray(v) ? v : {} };
    } catch (_) {
      return { args: {}, argsError: true };
    }
  }

  /** Converte la cronologia in «contents» Gemini (inclusi richieste e risultati degli strumenti). */
  function geminiContents(cfg, messages) {
    const out = [];
    const isResponse = (c) => c.parts.every((p) => p.functionResponse);
    messages
      .filter((m) => m.role !== 'system')
      .forEach((m) => {
        if (m.role === 'tool') {
          const part = {
            functionResponse: { name: m.name, response: m.ok === false ? { error: m.content } : { result: m.content } }
          };
          const last = out[out.length - 1];
          if (last && last.role === 'user' && isResponse(last)) last.parts.push(part);
          else out.push({ role: 'user', parts: [part] });
          return;
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length) {
          const parts = [];
          if (m.content && m.content.trim()) parts.push({ text: m.content });
          m.toolCalls.forEach((tc) => {
            const part = { functionCall: { name: tc.name, args: tc.args || {} } };
            // Gemini 3 richiede la «firma di pensiero»: se la chiamata viene da un altro modello si salta il controllo
            if (tc.sig) part.thoughtSignature = tc.sig;
            else if (/gemini-3/i.test(cfg.model)) part.thoughtSignature = 'skip_thought_signature_validator';
            parts.push(part);
          });
          out.push({ role: 'model', parts });
          return;
        }
        const parts = [{ text: textWithFiles(m, true) }];
        binaries(m).forEach((a) => parts.push({ inlineData: { mimeType: a.mime, data: a.data } }));
        out.push({ role: m.role === 'user' ? 'user' : 'model', parts });
      });
    return out;
  }

  /**
   * Su Android con CapacitorHttp il fetch normale passa dal canale nativo, che restituisce la risposta solo a richiesta finita (niente testo «a poco a poco»).
   * Per i provider che accettano richieste dal browser (CORS) si usa il fetch originale del browser (window.CapacitorWebFetch), che fa arrivare il testo in streaming.
   * Se fallisce prima di ricevere una risposta (CORS o rete) si ripiega sul canale nativo e si ricorda l'host per il resto della sessione.
   */
  const WEB_STREAM_HOSTS = /^(generativelanguage\.googleapis\.com|api\.groq\.com|api\.mistral\.ai|openrouter\.ai)$/;
  const nativeOnly = new Set();
  async function streamFetch(url, init) {
    const web = typeof window !== 'undefined' && window.CapacitorWebFetch;
    let host = '';
    try {
      host = new URL(url).host;
    } catch (_) {}
    if (typeof web === 'function' && WEB_STREAM_HOSTS.test(host) && !nativeOnly.has(host)) {
      try {
        return await web.call(window, url, init);
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        nativeOnly.add(host);
      }
    }
    return fetch(url, init);
  }

  async function streamGemini(cfg, messages, onText, signal, tools) {
    const body = {
      contents: geminiContents(cfg, messages),
      generationConfig: { temperature: cfg.temperature, maxOutputTokens: 8192 }
    };
    if (cfg.systemPrompt) body.systemInstruction = { parts: [{ text: cfg.systemPrompt }] };
    if (tools && tools.length)
      body.tools = [
        {
          functionDeclarations: tools.map((t) => {
            const d = { name: t.name, description: t.description };
            // Gemini rifiuta «parameters» con proprietà vuote: per gli strumenti senza argomenti si omette
            if (t.parameters && t.parameters.properties && Object.keys(t.parameters.properties).length) d.parameters = t.parameters;
            return d;
          })
        }
      ];

    const url =
      trimSlash(cfg.baseUrl) + '/models/' + encodeURIComponent(cfg.model) + ':streamGenerateContent?alt=sse';
    const res = await streamFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
      body: JSON.stringify(body),
      signal
    });
    if (!res.ok) throw await readError(res, 'Gemini');

    let full = '';
    const toolCalls = [];
    await readSSE(res, (payload) => {
      try {
        const json = JSON.parse(payload);
        if (json.error) throw new Error(json.error.message || 'Errore Gemini');
        const parts = (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];
        for (const p of parts) {
          if (p.functionCall) {
            toolCalls.push({ id: newCallId(), name: p.functionCall.name, args: p.functionCall.args || {}, sig: p.thoughtSignature });
          } else if (p.text && !p.thought) {
            full += p.text;
            onText(full);
          }
        }
      } catch (e) {
        if (e instanceof SyntaxError) return;
        throw e;
      }
    });
    return { text: full, toolCalls };
  }

  async function listGeminiModels(cfg) {
    const res = await fetch(trimSlash(cfg.baseUrl) + '/models?pageSize=200', {
      headers: { 'x-goog-api-key': cfg.apiKey }
    });
    if (!res.ok) throw await readError(res, 'Gemini');
    const d = await res.json();
    return (d.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .filter((m) => !/embed|aqa|imagen|veo|tts|native-audio/i.test(m.name))
      .map((m) => ({
        id: String(m.name).replace(/^models\//, ''),
        name: m.displayName || '',
        free: null,
        vision: true
      }));
  }

  // ─── Compatibile OpenAI ──────────────────────────────
  function openaiHeaders(cfg) {
    const h = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) h.Authorization = 'Bearer ' + cfg.apiKey;
    if (/openrouter\.ai/.test(cfg.baseUrl)) h['X-Title'] = 'Mia AI';
    return h;
  }

  /** Id di 9 caratteri [A-Za-z0-9] derivato in modo stabile da un id qualsiasi. */
  function toNineId(id) {
    id = String(id == null ? '' : id);
    if (/^[A-Za-z0-9]{9}$/.test(id)) return id;
    let h1 = 0x811c9dc5;
    let h2 = 0x1b873593;
    for (let i = 0; i < id.length; i++) {
      h1 = Math.imul(h1 ^ id.charCodeAt(i), 16777619) >>> 0;
      h2 = Math.imul(h2 + id.charCodeAt(i), 2246822519) >>> 0;
    }
    return (h1.toString(36) + h2.toString(36) + '000000000').replace(/[^a-z0-9]/g, '0').slice(0, 9);
  }

  async function streamOpenAI(cfg, messages, onText, signal, tools) {
    const msgs = [];
    if (cfg.systemPrompt) msgs.push({ role: 'system', content: cfg.systemPrompt });
    const isOpenRouter = /openrouter\.ai/.test(cfg.baseUrl);
    // Mistral accetta solo id di chiamata agli strumenti di 9 caratteri alfanumerici: se serve, ne ricava uno stabile
    const nineId = /mistral\.ai/.test(cfg.baseUrl) ? toNineId : (id) => id;
    messages.forEach((m) => {
      if (m.role === 'tool') {
        return msgs.push({ role: 'tool', tool_call_id: nineId(m.toolCallId), content: m.content });
      }
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length) {
        return msgs.push({
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: nineId(tc.id),
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) }
          }))
        });
      }
      const all = binaries(m);
      // senza lettura nativa dei PDF (tutti tranne Gemini e OpenRouter) si usa il testo estratto sul dispositivo
      all.forEach((a) => {
        if (a.kind === 'pdf' && !isOpenRouter && !a.text)
          throw attachmentError('Il PDF «' + a.name + '» non contiene testo selezionabile (forse è una scansione): questo modello non può leggerlo. Usa «Prova con…» e scegli Gemini o OpenRouter, che leggono anche le immagini.');
      });
      const bins = all.filter((a) => a.kind === 'image' || isOpenRouter);
      if (!bins.length) return msgs.push({ role: m.role, content: textWithFiles(m, isOpenRouter) });
      const content = [{ type: 'text', text: textWithFiles(m, isOpenRouter) }];
      bins.forEach((a) => {
        const url = 'data:' + a.mime + ';base64,' + a.data;
        if (a.kind === 'image') content.push({ type: 'image_url', image_url: { url } });
        else content.push({ type: 'file', file: { filename: a.name, file_data: url } });
      });
      msgs.push({ role: m.role, content });
    });

    const reqBody = { model: cfg.model, messages: msgs, temperature: cfg.temperature, stream: true };
    if (tools && tools.length) {
      reqBody.tools = tools.map((t) => ({ type: 'function', function: t }));
      reqBody.tool_choice = 'auto';
    }
    const res = await streamFetch(trimSlash(cfg.baseUrl) + '/chat/completions', {
      method: 'POST',
      headers: openaiHeaders(cfg),
      body: JSON.stringify(reqBody),
      signal
    });
    if (!res.ok) throw await readError(res, 'API');

    const finishCalls = (acc) =>
      acc
        .filter((c) => c && c.name)
        .map((c) => Object.assign({ id: c.id || newCallId(), name: c.name }, parseArgs(c.args)));

    // Alcuni server ignorano stream:true e rispondono con JSON normale
    const ctype = res.headers.get('content-type') || '';
    if (ctype.includes('application/json')) {
      const d = await res.json();
      const msg = (d.choices && d.choices[0] && d.choices[0].message) || {};
      const text = msg.content || '';
      if (text) onText(text);
      const calls = (msg.tool_calls || []).map((c) => ({
        id: c.id,
        name: c.function && c.function.name,
        args: c.function && c.function.arguments
      }));
      return { text, toolCalls: finishCalls(calls) };
    }

    let full = '';
    const acc = []; // chiamate a strumenti ricevute a pezzi
    await readSSE(res, (payload) => {
      try {
        const json = JSON.parse(payload);
        if (json.error) throw new Error(json.error.message || 'Errore API');
        const delta = json.choices && json.choices[0] && json.choices[0].delta;
        if (!delta) return;
        if (delta.content) {
          full += delta.content;
          onText(full);
        }
        (delta.tool_calls || []).forEach((tc, n) => {
          const i = tc.index != null ? tc.index : n;
          const slot = acc[i] || (acc[i] = { id: '', name: '', args: '' });
          if (tc.id) slot.id = tc.id;
          if (tc.function) {
            if (tc.function.name) slot.name += tc.function.name;
            if (tc.function.arguments) slot.args += tc.function.arguments;
          }
        });
      } catch (e) {
        if (e instanceof SyntaxError) return;
        throw e;
      }
    });
    return { text: full, toolCalls: finishCalls(acc) };
  }

  async function listOpenAIModels(cfg) {
    const res = await fetch(trimSlash(cfg.baseUrl) + '/models', { headers: openaiHeaders(cfg) });
    if (!res.ok) throw await readError(res, 'API');
    const d = await res.json();
    return (d.data || d.models || [])
      .map((m) => {
        const id = m.id || m.name;
        const pr = m.pricing;
        const free = /:free$/.test(id) || (pr ? Number(pr.prompt) === 0 && Number(pr.completion) === 0 : null);
        const arch = m.architecture || {};
        const out = arch.output_modalities;
        const inp = arch.input_modalities || [];
        return {
          id,
          name: m.name && m.name !== id ? m.name : '',
          free: pr || /:free$/.test(id) ? free : null,
          vision: inp.includes('image') || /vision|-vl\b|vl-|omni/i.test(id) || null,
          // solo modelli che rispondono con testo (no embedding, rerank, moderazione, audio, immagini)
          chat: !(Array.isArray(out) && !out.includes('text')) && !/embed|rerank|guard|content-safety|moderation|whisper|tts|clip|detector|gliner|\bpii\b|calibration|reward|parakeet|canary|retriev|starcoder|riva-(asr|tts|translate)|video-detector/i.test(id)
        };
      })
      .filter((m) => m.id && m.chat);
  }

  // ─── API pubblica ──────────────────────────────
  /**
   * cfg: { provider, baseUrl, apiKey, model, systemPrompt, temperature }
   * messages: [{ role: 'user'|'assistant'|'tool', content, toolCalls?, toolCallId?, name? }]
   * onText(fullTextSoFar) chiamata a ogni pezzo ricevuto.
   * opts.tools: schemi degli strumenti ({ name, description, parameters }) per la modalità agente.
   * Restituisce il testo; con opts.full = true restituisce { text, toolCalls: [{ id, name, args }] }.
   */
  /**
   * Rende interrompibile una promessa: quando il segnale scatta, la promessa restituita fallisce subito con un AbortError,
   * anche se la richiesta sotto non si interrompe (su Android CapacitorHttp ignora l'AbortSignal e risponde solo a richiesta finita).
   */
  function raceAbort(promise, signal) {
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
      const stop = () => reject(Object.assign(new Error('Interrotto'), { name: 'AbortError' }));
      if (signal.aborted) return stop();
      signal.addEventListener('abort', stop, { once: true });
      promise.then(
        (v) => {
          signal.removeEventListener('abort', stop);
          resolve(v);
        },
        (e) => {
          signal.removeEventListener('abort', stop);
          reject(e);
        }
      );
    });
  }

  async function chat(cfg, messages, onText, opts) {
    const preset = PRESETS[cfg.provider] || PRESETS.custom;
    if (preset.needsKey && !cfg.apiKey) throw new Error('Inserisci la chiave API in Impostazioni.');
    if (!cfg.model) throw new Error('Scegli un modello in Impostazioni.');
    abort();
    controller = new AbortController();
    const signal = controller.signal;
    try {
      const fn = preset.type === 'gemini' ? streamGemini : streamOpenAI;
      const cb = onText || function () {};
      const out = await raceAbort(fn(cfg, messages, (full) => cb(cleanText(full)), signal, opts && opts.tools), signal);
      const text = cleanText(out.text);
      if (!text.trim() && !out.toolCalls.length) throw new Error('Risposta vuota dal modello.');
      // Senza opts.full restituisce solo il testo (come prima): così funzionano anche le chiamate che si aspettano una stringa.
      return opts && opts.full ? { text, toolCalls: out.toolCalls } : text;
    } finally {
      if (controller && controller.signal === signal) controller = null;
    }
  }

  async function listModels(cfg) {
    const preset = PRESETS[cfg.provider] || PRESETS.custom;
    const list = preset.type === 'gemini' ? await listGeminiModels(cfg) : await listOpenAIModels(cfg);
    // gratuiti in cima, poi in ordine alfabetico
    return list.sort((a, b) => (b.free === true) - (a.free === true) || a.id.localeCompare(b.id));
  }

  function abort() {
    if (controller) {
      try {
        controller.abort();
      } catch (_) {}
      controller = null;
    }
  }

  /**
   * Pulisce la risposta: toglie il «ragionamento» (<think>…</think>) che alcuni modelli
   * gratuiti mettono nel testo e i token tecnici di fine turno (<|im_end|>, <end_of_turn>…).
   */
  function cleanText(t) {
    let s = String(t || '');
    s = s.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '');
    s = s.replace(/^\s*<(think|thinking|reasoning)>[\s\S]*$/i, ''); // ragionamento non ancora chiuso
    s = s.replace(/<\|[a-z_]+\|>|<\/?(start_of_turn|end_of_turn|eos|bos|s)>/gi, '');
    return s.replace(/^\s+/, '');
  }

  /** Modelli specializzati (codice, matematica…) da non usare come ripiego automatico. */
  function isSpecialized(model) {
    return /cod(e|er|ing)|math|embed|rerank|guard|safety|ocr|vision-only/i.test(String(model || ''));
  }

  /** Connessione caduta o rete assente (non è un errore del modello): ha senso riprovare. L'interruzione voluta dall'utente non conta. */
  function isConnectionError(e) {
    if (e && (e.name === 'AbortError' || e.attachmentError)) return false;
    const m = String((e && e.message) || e || '');
    return /connection (abort|reset|closed|refused)|software caused|ECONN(RESET|ABORTED|REFUSED)|socket|timed? ?out|timeout|unexpected end|premature|incomplete|ERR_(NETWORK|CONNECTION|INTERNET|EMPTY)|Failed to fetch|NetworkError|Load failed|network|offline/i.test(m);
  }

  /** Errori per cui ha senso riprovare subito con un altro modello. */
  function isBusyError(e) {
    const m = String((e && e.message) || e || '');
    return !(e && e.attachmentError) && /429|quota|rate.?limit|overload|capacity|unavailable|50[234]|no endpoints/i.test(m);
  }

  global.MiaProviders = { raceAbort, PRESETS, chat, listModels, abort, friendlyError, isBusyError, isConnectionError, cleanText, isSpecialized };
})(window);
