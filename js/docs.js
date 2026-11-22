/* Mia AI — estrae il testo da allegati Office (xlsx, docx, pptx) e archivi zip */
(function (global) {
  'use strict';

  const MAX_CHARS = 200 * 1024;
  const MAX_INPUT = 15 * 1024 * 1024;
  const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|html?|css|js|mjs|ts|jsx|tsx|py|java|kt|c|h|cpp|cs|go|rs|rb|php|sh|sql|yaml|yml|ini|toml|log|srt)$/i;
  const OFFICE = /\.(xlsx|xlsm|docx|pptx|zip)$/i;
  const OLD_OFFICE = /\.(xls|doc|ppt)$/i;

  const els = (node, local) => Array.from(node.getElementsByTagNameNS('*', local));
  const attr = (el, name) => el.getAttribute(name) || el.getAttribute('r:' + name) || '';

  async function readXml(zip, path) {
    const f = zip.file(path);
    if (!f) return null;
    const doc = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
    return doc.querySelector('parsererror') ? null : doc;
  }

  function clip(text) {
    return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + '\n[…troncato…]' : text;
  }

  // ─── pdf ───────────────────────────────────────────────────
  // pdf.js (Mozilla, Apache-2.0) in js/vendor/, caricato solo quando serve: estrae il testo sul dispositivo, così anche i modelli
  // che non leggono i PDF da soli (tutti tranne Gemini e OpenRouter) possono usarlo.
  let pdfLib = null;
  async function loadPdfJs() {
    if (!pdfLib) {
      const lib = await import(new URL('js/vendor/pdf.min.mjs', document.baseURI).href);
      lib.GlobalWorkerOptions.workerSrc = new URL('js/vendor/pdf.worker.min.mjs', document.baseURI).href;
      pdfLib = lib;
    }
    return pdfLib;
  }

  /** Testo di un PDF (ArrayBuffer): { text, pages, truncated }. Il testo è vuoto se il PDF è una scansione (solo immagini). */
  async function pdfText(buffer, maxPages) {
    const lib = await loadPdfJs();
    const task = lib.getDocument({ data: new Uint8Array(buffer.slice(0)), isEvalSupported: false });
    const doc = await task.promise;
    try {
      const limit = Math.min(doc.numPages, maxPages || 100);
      let out = '';
      let truncated = doc.numPages > limit;
      for (let i = 1; i <= limit; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        let line = '';
        content.items.forEach((it) => {
          line += it.str + (it.hasEOL ? '\n' : ' ');
        });
        line = line.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        if (line) out += (out ? '\n\n' : '') + '[Pagina ' + i + ']\n' + line;
        if (out.length > MAX_CHARS) {
          truncated = true;
          break;
        }
      }
      if (truncated && out) out += '\n[…testo troncato…]';
      return { text: out.length > MAX_CHARS ? out.slice(0, MAX_CHARS) + '\n[…testo troncato…]' : out, pages: doc.numPages, truncated };
    } finally {
      try { await task.destroy(); } catch (_) {}
    }
  }

  /** Pagine di un PDF come immagini JPEG (data URL), ciascuna sotto `maxChars` caratteri (limite dell'OCR di NVIDIA: 180000). */
  async function pdfPageImages(buffer, maxPages, maxChars) {
    const lib = await loadPdfJs();
    const task = lib.getDocument({ data: new Uint8Array(buffer.slice(0)), isEvalSupported: false });
    const doc = await task.promise;
    const out = [];
    try {
      const limit = Math.min(doc.numPages, maxPages || 10);
      for (let i = 1; i <= limit; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        let side = 1600; // lato lungo in pixel; si riduce finché il JPEG sta nel limite
        let url = '';
        for (let tries = 0; tries < 6; tries++) {
          const scale = side / Math.max(base.width, base.height);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const g = canvas.getContext('2d');
          g.fillStyle = '#fff';
          g.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: g, canvas, viewport }).promise;
          url = canvas.toDataURL('image/jpeg', 0.8);
          if (url.length - 23 < (maxChars || 170000)) break;
          side = Math.round(side * 0.75);
        }
        out.push({ page: i, dataUrl: url, pages: doc.numPages });
      }
    } finally {
      try {
        await task.destroy();
      } catch (_) {}
    }
    return out;
  }

  // ─── xlsx ──────────────────────────────────────────────────
  function colIndex(ref) {
    const m = /^([A-Z]+)/i.exec(ref || '');
    if (!m) return 0;
    let n = 0;
    for (const ch of m[1].toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
    return n - 1;
  }

  const csv = (v) => (/[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);

  async function xlsxText(zip) {
    const wb = await readXml(zip, 'xl/workbook.xml');
    if (!wb) throw new Error('File xlsx non valido.');
    const rels = await readXml(zip, 'xl/_rels/workbook.xml.rels');
    const target = {};
    if (rels) els(rels, 'Relationship').forEach((r) => (target[r.getAttribute('Id')] = r.getAttribute('Target')));
    const shared = [];
    const ss = await readXml(zip, 'xl/sharedStrings.xml');
    if (ss)
      els(ss, 'si').forEach((si) =>
        shared.push(
          els(si, 't')
            .filter((t) => t.parentNode.localName !== 'rPh')
            .map((t) => t.textContent)
            .join('')
        )
      );
    let out = '';
    const sheets = els(wb, 'sheet');
    for (let i = 0; i < sheets.length && out.length < MAX_CHARS; i++) {
      const name = sheets[i].getAttribute('name') || 'Foglio' + (i + 1);
      let path = target[attr(sheets[i], 'id')] || 'worksheets/sheet' + (i + 1) + '.xml';
      path = path.startsWith('/') ? path.slice(1) : 'xl/' + path.replace(/^\.\//, '');
      const doc = await readXml(zip, path);
      out += '## Foglio: ' + name + '\n';
      if (!doc) {
        out += '(non leggibile)\n\n';
        continue;
      }
      let rows = 0;
      for (const row of els(doc, 'row')) {
        const cells = [];
        els(row, 'c').forEach((c) => {
          const t = c.getAttribute('t');
          const v = els(c, 'v')[0];
          let val = '';
          if (t === 's') val = shared[Number(v && v.textContent)] || '';
          else if (t === 'inlineStr') val = els(c, 't').map((x) => x.textContent).join('');
          else if (t === 'b') val = v && v.textContent === '1' ? 'VERO' : 'FALSO';
          else if (v && v.textContent !== '') val = v.textContent;
          else {
            const f = els(c, 'f')[0]; // formula senza valore calcolato salvato
            if (f && f.textContent) val = '=' + f.textContent;
          }
          cells[colIndex(c.getAttribute('r') || '')] = String(val);
        });
        const line = Array.from(cells, (x) => csv(x || '')).join(',').replace(/,+$/, '');
        if (!line) continue;
        out += line + '\n';
        if (++rows >= 5000 || out.length > MAX_CHARS) {
          out += '[…righe successive omesse…]\n';
          break;
        }
      }
      out += '\n';
    }
    return out.trim();
  }

  // ─── docx ──────────────────────────────────────────────────
  function runText(node) {
    let s = '';
    node.childNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      const l = n.localName;
      if (l === 't') s += n.textContent;
      else if (l === 'tab') s += '\t';
      else if (l === 'br' || l === 'cr') s += '\n';
      else if (l === 'pPr' || l === 'rPr' || l === 'instrText') return;
      else s += runText(n);
    });
    return s;
  }

  function paragraph(p) {
    const text = runText(p).trim();
    if (!text) return '';
    const style = els(p, 'pStyle')[0];
    const m = style && /^(?:heading|titolo)\s*(\d)/i.exec(style.getAttribute('w:val') || style.getAttribute('val') || '');
    if (m) return '#'.repeat(Math.min(6, Number(m[1]))) + ' ' + text;
    if (/^title$|^titolo$/i.test((style && (style.getAttribute('w:val') || '')) || '')) return '# ' + text;
    const sv = (style && (style.getAttribute('w:val') || style.getAttribute('val'))) || '';
    return els(p, 'numPr').length || /^(list|elenco)/i.test(sv) ? '- ' + text : text;
  }

  async function docxText(zip) {
    const doc = await readXml(zip, 'word/document.xml');
    if (!doc) throw new Error('File docx non valido.');
    const body = els(doc, 'body')[0];
    const lines = [];
    body.childNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      if (n.localName === 'p') lines.push(paragraph(n));
      else if (n.localName === 'tbl') {
        els(n, 'tr').forEach((tr) => {
          const cells = Array.from(tr.childNodes)
            .filter((c) => c.nodeType === 1 && c.localName === 'tc')
            .map((tc) => els(tc, 'p').map((p) => runText(p).trim()).filter(Boolean).join(' '));
          lines.push('| ' + cells.join(' | ') + ' |');
        });
        lines.push('');
      }
    });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ─── pptx ──────────────────────────────────────────────────
  async function pptxText(zip) {
    const num = (n) => Number((/(\d+)\.xml$/.exec(n) || [])[1] || 0);
    const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
    if (!slides.length) throw new Error('File pptx non valido.');
    let out = '';
    for (const path of slides) {
      const doc = await readXml(zip, path);
      if (!doc) continue;
      const paras = els(doc, 'p').map((p) => els(p, 't').map((t) => t.textContent).join('').trim()).filter(Boolean);
      out += '## Diapositiva ' + num(path) + '\n' + paras.join('\n') + '\n';
      const notes = await readXml(zip, 'ppt/notesSlides/notesSlide' + num(path) + '.xml');
      if (notes) {
        const n = els(notes, 'p').map((p) => els(p, 't').map((t) => t.textContent).join('').trim()).filter(Boolean).join(' ');
        if (n) out += 'Note: ' + n + '\n';
      }
      out += '\n';
      if (out.length > MAX_CHARS) break;
    }
    return out.trim();
  }

  // ─── zip ───────────────────────────────────────────────────
  async function zipText(zip) {
    const entries = Object.values(zip.files).filter((f) => !f.dir);
    let out = 'Contenuto dell\'archivio (' + entries.length + ' file):\n';
    entries.slice(0, 300).forEach((f) => (out += '- ' + f.name + '\n'));
    if (entries.length > 300) out += '[…altri ' + (entries.length - 300) + ' file…]\n';
    let budget = MAX_CHARS - out.length;
    for (const f of entries) {
      if (!TEXT_EXT.test(f.name) || budget <= 0) continue;
      let t = await f.async('string');
      if (t.includes('\u0000')) continue;
      if (t.length > 40000) t = t.slice(0, 40000) + '\n[…troncato…]';
      if (t.length > budget) t = t.slice(0, budget) + '\n[…troncato…]';
      out += '\n--- ' + f.name + ' ---\n' + t + '\n';
      budget -= t.length;
    }
    return out.trim();
  }

  /** true se il file è di un tipo che sa leggere questo modulo. */
  function supports(name) {
    return OFFICE.test(name) || OLD_OFFICE.test(name);
  }

  /** Estrae il testo da un file Office/zip. Restituisce { text }. */
  async function extract(file) {
    const name = file.name || 'file';
    if (OLD_OFFICE.test(name)) throw new Error('Formato vecchio non supportato: ' + name + ' (salvalo come .xlsx, .docx o .pptx)');
    if (file.size > MAX_INPUT) throw new Error('File troppo grande (max 15 MB): ' + name);
    const JSZip = await global.MiaTools.needZip();
    let zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (_) {
      throw new Error('File non leggibile o danneggiato: ' + name);
    }
    let text;
    if (/\.(xlsx|xlsm)$/i.test(name)) text = await xlsxText(zip);
    else if (/\.docx$/i.test(name)) text = await docxText(zip);
    else if (/\.pptx$/i.test(name)) text = await pptxText(zip);
    else text = await zipText(zip);
    return { text: clip(text || '(nessun testo trovato)') };
  }

  global.MiaDocs = { supports, extract, pdfText, pdfPageImages };
})(window);
