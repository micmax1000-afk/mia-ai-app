/* Mia AI — provider AI (Gemini + qualsiasi API compatibile OpenAI) */
(function (global) {
  'use strict';

  /**
   * Preset: type 'gemini' usa l'API Google; type 'openai' usa /chat/completions.
   * Il modello è sempre modificabile in Impostazioni (pulsante «Carica modelli»).
   */
  const PRESETS = {
    gemini: {
      label: 'Google Gemini',
      type: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-3.5-flash',
      needsKey: true,
      keyUrl: 'https://aistudio.google.com/apikey'
    },
    openrouter: {
      label: 'OpenRouter',
      type: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openrouter/auto',
      needsKey: true,
      keyUrl: 'https://openrouter.ai/keys'
    },
    groq: {
      label: 'Groq',
      type: 'openai',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: '',
      needsKey: true,
      keyUrl: 'https://console.groq.com/keys'
    },
    ollama: {
      label: 'Ollama (PC in rete locale)',
      type: 'openai',
      baseUrl: 'http://192.168.1.10:11434/v1',
      model: 'llama3.2',
      needsKey: false
    },
    custom: {
      label: 'Personalizzato (compatibile OpenAI)',
      type: 'openai',
      baseUrl: 'http://localhost:3000/v1',
      model: '',
      needsKey: false
    }
  };

  let controller = null;

  function trimSlash(u) {
    return String(u || '').trim().replace(/\/+$/, '');
  }

  function friendlyError(e, providerLabel) {
    const m = String((e && e.message) || e || '');
    const who = providerLabel || 'Provider';
    if (/401|403|api key|unauthori[sz]ed|permission/i.test(m)) return who + ': chiave API non valida o non autorizzata.';
    if (/429|quota|rate/i.test(m)) return who + ': limite di richieste raggiunto, riprova tra poco.';
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(m))
      return who + ': server non raggiungibile (rete, indirizzo errato o CORS non abilitato).';
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

  // ─── Gemini ───────────────────────────────────────────────
  async function streamGemini(cfg, messages, onText, signal) {
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));
    const body = {
      contents,
      generationConfig: { temperature: cfg.temperature, maxOutputTokens: 8192 }
    };
    if (cfg.systemPrompt) body.systemInstruction = { parts: [{ text: cfg.systemPrompt }] };

    const url =
      trimSlash(cfg.baseUrl) + '/models/' + encodeURIComponent(cfg.model) + ':streamGenerateContent?alt=sse';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
      body: JSON.stringify(body),
      signal
    });
    if (!res.ok) throw await readError(res, 'Gemini');

    let full = '';
    await readSSE(res, (payload) => {
      try {
        const json = JSON.parse(payload);
        if (json.error) throw new Error(json.error.message || 'Errore Gemini');
        const parts = (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) || [];
        for (const p of parts) {
          if (p.text && !p.thought) {
            full += p.text;
            onText(full);
          }
        }
      } catch (e) {
        if (e instanceof SyntaxError) return;
        throw e;
      }
    });
    return full;
  }

  async function listGeminiModels(cfg) {
    const res = await fetch(trimSlash(cfg.baseUrl) + '/models?pageSize=200', {
      headers: { 'x-goog-api-key': cfg.apiKey }
    });
    if (!res.ok) throw await readError(res, 'Gemini');
    const d = await res.json();
    return (d.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => String(m.name).replace(/^models\//, ''));
  }

  // ─── Compatibile OpenAI ───────────────────────────────────
  function openaiHeaders(cfg) {
    const h = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) h.Authorization = 'Bearer ' + cfg.apiKey;
    if (/openrouter\.ai/.test(cfg.baseUrl)) h['X-Title'] = 'Mia AI';
    return h;
  }

  async function streamOpenAI(cfg, messages, onText, signal) {
    const msgs = [];
    if (cfg.systemPrompt) msgs.push({ role: 'system', content: cfg.systemPrompt });
    messages.forEach((m) => msgs.push({ role: m.role, content: m.content }));

    const res = await fetch(trimSlash(cfg.baseUrl) + '/chat/completions', {
      method: 'POST',
      headers: openaiHeaders(cfg),
      body: JSON.stringify({ model: cfg.model, messages: msgs, temperature: cfg.temperature, stream: true }),
      signal
    });
    if (!res.ok) throw await readError(res, 'API');

    // Alcuni server ignorano stream:true e rispondono con JSON normale
    const ctype = res.headers.get('content-type') || '';
    if (ctype.includes('application/json')) {
      const d = await res.json();
      const text = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
      onText(text);
      return text;
    }

    let full = '';
    await readSSE(res, (payload) => {
      try {
        const json = JSON.parse(payload);
        if (json.error) throw new Error(json.error.message || 'Errore API');
        const delta = json.choices && json.choices[0] && json.choices[0].delta;
        if (delta && delta.content) {
          full += delta.content;
          onText(full);
        }
      } catch (e) {
        if (e instanceof SyntaxError) return;
        throw e;
      }
    });
    return full;
  }

  async function listOpenAIModels(cfg) {
    const res = await fetch(trimSlash(cfg.baseUrl) + '/models', { headers: openaiHeaders(cfg) });
    if (!res.ok) throw await readError(res, 'API');
    const d = await res.json();
    return (d.data || d.models || []).map((m) => m.id || m.name).filter(Boolean);
  }

  // ─── API pubblica ─────────────────────────────────────────
  /**
   * cfg: { provider, baseUrl, apiKey, model, systemPrompt, temperature }
   * messages: [{ role: 'user'|'assistant', content }]
   * onText(fullTextSoFar) chiamata a ogni pezzo ricevuto.
   */
  async function chat(cfg, messages, onText) {
    const preset = PRESETS[cfg.provider] || PRESETS.custom;
    if (preset.needsKey && !cfg.apiKey) throw new Error('Inserisci la chiave API in Impostazioni.');
    if (!cfg.model) throw new Error('Scegli un modello in Impostazioni.');
    abort();
    controller = new AbortController();
    const signal = controller.signal;
    try {
      const fn = preset.type === 'gemini' ? streamGemini : streamOpenAI;
      const text = await fn(cfg, messages, onText || function () {}, signal);
      if (!text.trim()) throw new Error('Risposta vuota dal modello.');
      return text;
    } finally {
      if (controller && controller.signal === signal) controller = null;
    }
  }

  async function listModels(cfg) {
    const preset = PRESETS[cfg.provider] || PRESETS.custom;
    const list = preset.type === 'gemini' ? await listGeminiModels(cfg) : await listOpenAIModels(cfg);
    return list.sort();
  }

  function abort() {
    if (controller) {
      try {
        controller.abort();
      } catch (_) {}
      controller = null;
    }
  }

  global.MiaProviders = { PRESETS, chat, listModels, abort, friendlyError };
})(window);
