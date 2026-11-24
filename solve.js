// makefun-site-fast — a faster drop-in for makefun-site 1.0.0.
// Returns the same answer for every input, byte for byte, with a single-pass
// Markdown renderer, a compiled template interpreter, an ASCII fast path for
// slugs and no per-character regex work. No dependencies, no imports.
// MIT.

// ---------- text ----------

const ESC_AMP = '&amp;';
const ESC_LT = '&lt;';
const ESC_GT = '&gt;';
const ESC_QUOT = '&quot;';
const ESC_APOS = '&#39;';

/** `text` with & < > " ' escaped. Returns the input unchanged when it holds none. */
function esc(text) {
  let out = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 38 || c === 60 || c === 62 || c === 34 || c === 39) {
      if (start < i) out += text.slice(start, i);
      out += c === 38 ? ESC_AMP : c === 60 ? ESC_LT : c === 62 ? ESC_GT : c === 34 ? ESC_QUOT : ESC_APOS;
      start = i + 1;
    }
  }
  if (start === 0) return text;
  if (start < text.length) out += text.slice(start);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A YYYY-MM-DD date in words, from the string alone: "2026-11-09" is "9 November 2026". */
function longDate(date) {
  const y = date.slice(0, 4);
  const m = date.slice(5, 7);
  const d = date.slice(8, 10);
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** Code-unit order (never the locale's). */
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The most characters a slug keeps before a collision suffix. */
const SLUG_MAX = 64;

/** The slug of `text`, the slow Unicode path (NFKD, combining marks dropped). */
function slugifySlow(text) {
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (const ch of plain) {
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  return out === '' ? 'untitled' : out;
}

/**
 * The slug of `text`: NFKD, combining marks dropped, A-Z lowered, every run of
 * characters other than a-z and 0-9 one "-", none at either end, at most 64
 * characters (a "-" left at the cut dropped), and "untitled" when nothing is left.
 * Pure ASCII text takes the fast path (NFKD is the identity on it and it holds
 * no combining marks); anything else falls back to the Unicode path.
 */
function slugify(text) {
  let out = '';
  let gap = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 127) return slugifySlow(text);
    let keep = null;
    if (code >= 65 && code <= 90) keep = String.fromCharCode(code + 32);
    else if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) keep = text[i];
    if (keep === null) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  return out === '' ? 'untitled' : out;
}

/** `slug` made unique against `taken` (and added to it): the first of slug, slug-2, slug-3 ... not taken. */
function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

/** Whether `line` is blank (spaces and tabs only). */
function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** `line` with spaces and tabs at either end dropped. */
function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  return line.slice(a, b);
}

/** `s` with trailing spaces and tabs dropped. */
function trimEndSpaces(s) {
  let e = s.length;
  while (e > 0 && (s.charCodeAt(e - 1) === 32 || s.charCodeAt(e - 1) === 9)) e--;
  return e === s.length ? s : s.slice(0, e);
}

// ---------- front matter ----------

/** The keys a source's front matter may give. */
const FM_KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];
const FM_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FM_NAME = /^[a-z0-9-]+$/;
const FM_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FM_TAG = /^[^"[\]]+$/;

/** The days of month `m` (1-12) of year `y`, by the Gregorian rule. */
function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** A string value: "..." with \" and \\ its only escapes, or bare, the rest of the line (never opening on " or [). */
function fmString(raw) {
  if (raw.startsWith('"')) {
    if (raw.length < 2 || !raw.endsWith('"')) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.startsWith('[')) return { error: 'a bare string opens on [' };
  return { value: raw };
}

/** One key's value, or why it is refused. */
function fmValue(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = fmString(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = FM_DATE.exec(raw);
      const y = m ? Number(m[1]) : 0;
      const mo = m ? Number(m[2]) : 0;
      const d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (!raw.startsWith('[') || !raw.endsWith(']')) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      if (tags.some((t) => t === '' || !FM_TAG.test(t))) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return FM_NAME.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return FM_SLUG.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

/** A front-matter line as { key, raw }, or null when it is not "key: value". */
function fmLine(line) {
  let i = 0;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if ((c >= 97 && c <= 122) || c === 95) i++;
    else break;
  }
  if (i === 0) return null;
  if (line.charCodeAt(i) !== 58) return null;
  const key = line.slice(0, i);
  i++;
  if (i === line.length) return { key, raw: '' };
  if (line.charCodeAt(i) !== 32) return null;
  return { key, raw: line.slice(i + 1) };
}

/**
 * A source's front matter and body: { data, body }, or { error } with the first reason it is refused. `text` has "\n"
 * line ends.
 */
function parseFrontMatter(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return { error: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      close = i;
      break;
    }
  }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    if (isBlank(line) || line.charCodeAt(0) === 35) continue;
    const m = fmLine(line);
    if (!m) return { error: `line ${i + 1} is not "key: value"` };
    const key = m.key;
    const raw = trimEndSpaces(m.raw);
    if (!FM_KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = fmValue(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: lines.slice(close + 1).join('\n') };
}

// ---------- markdown ----------

/** A fence-open line's language, or null when the line opens no fence. */
function fenceOpen(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  let i = 3;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) i++;
    else break;
  }
  const lang = line.slice(3, i);
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return null;
    i++;
  }
  return lang;
}

/** Whether `line` closes a fence. */
function isFenceClose(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** A heading line's level and text, or null (a heading's text is never empty). */
function headingOf(line) {
  let c = 0;
  while (c < line.length && line.charCodeAt(c) === 35) c++;
  if (c === 0 || c > 6) return null;
  if (c >= line.length) return null;
  if (line.charCodeAt(c) !== 32 && line.charCodeAt(c) !== 9) return null;
  let a = c;
  while (a < line.length && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  let b = line.length;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  if (b === a) return null;
  return { depth: c, text: line.slice(a, b) };
}

/** Whether `line` is a thematic break. */
function isHR(line) {
  const dash = line.charCodeAt(0) === 45 && line.charCodeAt(1) === 45 && line.charCodeAt(2) === 45;
  const star = line.charCodeAt(0) === 42 && line.charCodeAt(1) === 42 && line.charCodeAt(2) === 42;
  if (!dash && !star) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** A bullet list item's text after "- " or "* ", or null. */
function bulletMatch(line) {
  const c = line.charCodeAt(0);
  if ((c === 45 || c === 42) && line.charCodeAt(1) === 32) return line.slice(2);
  return null;
}

/** An ordered list item's number and text, or null. */
function orderedMatch(line) {
  let i = 0;
  while (i < line.length && line.charCodeAt(i) >= 48 && line.charCodeAt(i) <= 57) i++;
  if (i === 0 || i > 9) return null;
  if (line.charCodeAt(i) !== 46) return null;
  if (line.charCodeAt(i + 1) !== 32) return null;
  return { num: Number(line.slice(0, i)), text: line.slice(i + 2) };
}

const CONTINUED = /^ {2,}\S/;

/** Whether `line` ends a paragraph: a blank line, a fence, a heading or a thematic break. */
function endsParagraph(line) {
  return isBlank(line) || fenceOpen(line) !== null || headingOf(line) !== null || isHR(line);
}

/** The characters a backslash escapes. */
const ESC_T = new Uint8Array(128);
for (const ch of ['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']) ESC_T[ch.charCodeAt(0)] = 1;

const WS_RE = /\s/;

/** The first index from `from` where `s` holds `what` outside a backslash escape, or -1. */
function findUnescaped(s, what, from) {
  let j = from;
  const end = s.length - what.length;
  while (j <= end) {
    if (s.charCodeAt(j) === 92 && j + 1 < s.length && ESC_T[s.charCodeAt(j + 1)] === 1) {
      j += 2;
      continue;
    }
    if (s.startsWith(what, j)) return j;
    j++;
  }
  return -1;
}

/** The first single * from `from` (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from) {
  let j = from;
  while (j < s.length) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < s.length && ESC_T[s.charCodeAt(j + 1)] === 1) {
      j += 2;
      continue;
    }
    if (c === 42) {
      if (s.charCodeAt(j + 1) === 42) {
        j += 2;
        continue;
      }
      return j;
    }
    j++;
  }
  return -1;
}

/** `s` rendered inline; `env.link(target)` is a link's href. */
function inline(s, env) {
  let out = '';
  const n = s.length;
  let i = 0;
  let run = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 92) {
      // backslash
      if (i + 1 < n && ESC_T[s.charCodeAt(i + 1)] === 1) {
        if (run < i) out += s.slice(run, i);
        out += s[i + 1] === '>' ? ESC_GT : s[i + 1];
        i += 2;
        run = i;
      } else i++;
      continue;
    }
    if (c === 96) {
      // backtick: a code span closed by the next backtick, at least one char between
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        if (run < i) out += s.slice(run, i);
        out += '<code>' + esc(s.slice(i + 1, j)) + '</code>';
        i = j + 1;
        run = i;
      } else i++;
      continue;
    }
    if (c === 42) {
      // star: strong, then emphasis
      if (s.charCodeAt(i + 1) === 42) {
        const j = findUnescaped(s, '**', i + 2);
        if (j > i + 2) {
          if (run < i) out += s.slice(run, i);
          out += '<strong>' + inline(s.slice(i + 2, j), env) + '</strong>';
          i = j + 2;
          run = i;
        } else i += 2;
        continue;
      }
      const j = findSingleStar(s, i + 1);
      if (j > i + 1) {
        if (run < i) out += s.slice(run, i);
        out += '<em>' + inline(s.slice(i + 1, j), env) + '</em>';
        i = j + 1;
        run = i;
      } else i++;
      continue;
    }
    if (c === 91) {
      // [text](target)
      const k = findUnescaped(s, ']', i + 1);
      const m = k !== -1 && s.charCodeAt(k + 1) === 40 ? s.indexOf(')', k + 2) : -1;
      const target = m === -1 ? '' : s.slice(k + 2, m);
      if (target !== '' && !WS_RE.test(target)) {
        if (run < i) out += s.slice(run, i);
        out += '<a href="' + esc(env.link(target)) + '">' + inline(s.slice(i + 1, k), env) + '</a>';
        i = m + 1;
        run = i;
      } else i++;
      continue;
    }
    if (c === 38 || c === 60 || c === 62 || c === 34 || c === 39) {
      if (run < i) out += s.slice(run, i);
      out += c === 38 ? ESC_AMP : c === 60 ? ESC_LT : c === 62 ? ESC_GT : c === 34 ? ESC_QUOT : ESC_APOS;
      i++;
      run = i;
      continue;
    }
    i++;
  }
  if (run < n) out += s.slice(run, n);
  return out;
}

/**
 * `src` rendered: its HTML (each block on its own lines, a "\n" after the last), its table of contents (every level 2
 * and 3 heading: level, id and its inline HTML) and its excerpt (the first paragraph's inline HTML, or "").
 * `slug` is the case's memoised slug function.
 */
function renderMarkdown(src, env, slug) {
  const lines = src.split('\n');
  const ids = new Set();
  const parts = [];
  const toc = [];
  let excerpt = null;
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const fence = fenceOpen(line);
    if (fence !== null) {
      i++;
      const body = [];
      while (i < n && !isFenceClose(lines[i])) body.push(lines[i++]);
      if (i < n) i++;
      let s = '<pre><code' + (fence === '' ? '' : ' class="language-' + esc(fence) + '"') + '>';
      for (let k = 0; k < body.length; k++) {
        s += esc(body[k]);
        s += '\n';
      }
      parts.push(s + '</code></pre>');
      continue;
    }
    const h = headingOf(line);
    if (h !== null) {
      const id = uniqueSlug(slug(h.text), ids);
      const html = inline(h.text, env);
      parts.push('<h' + h.depth + ' id="' + id + '">' + html + '</h' + h.depth + '>');
      if (h.depth === 2 || h.depth === 3) toc.push({ level: h.depth, id, html });
      i++;
      continue;
    }
    if (isHR(line)) {
      parts.push('<hr>');
      i++;
      continue;
    }
    if (line.charCodeAt(0) === 62) {
      const body = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        let l = lines[i++];
        l = l.slice(1);
        if (l.charCodeAt(0) === 32) l = l.slice(1);
        body.push(trimLine(l));
      }
      let kept = '';
      let first = true;
      for (let k = 0; k < body.length; k++) {
        if (body[k] === '') continue;
        if (!first) kept += '\n';
        kept += body[k];
        first = false;
      }
      if (first) parts.push('<blockquote>\n</blockquote>');
      else parts.push('<blockquote>\n<p>' + inline(kept, env) + '</p>\n</blockquote>');
      continue;
    }
    const bullet = bulletMatch(line);
    const ordered = bullet === null ? orderedMatch(line) : null;
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const items = [];
      let start = 1;
      if (isOrdered) start = ordered.num;
      while (i < n) {
        const m = isOrdered ? orderedMatch(lines[i]) : bulletMatch(lines[i]);
        if (m !== null) {
          items.push([trimLine(isOrdered ? m.text : m)]);
          i++;
        } else if (CONTINUED.test(lines[i])) {
          items[items.length - 1].push(trimLine(lines[i]));
          i++;
        } else break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && start !== 1 ? '<ol start="' + start + '">' : '<' + tag + '>';
      let s = open + '\n';
      for (let k = 0; k < items.length; k++) s += '<li>' + inline(items[k].join('\n'), env) + '</li>\n';
      parts.push(s + '</' + tag + '>');
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const html = inline(body.join('\n'), env);
    if (excerpt === null) excerpt = html;
    parts.push('<p>' + html + '</p>');
  }
  return { html: parts.map((b) => b + '\n').join(''), toc, excerpt: excerpt ?? '' };
}

// ---------- links ----------

/** Whether `t` opens on a scheme (`https:`, `mailto:` ...). */
function hasScheme(t) {
  const c0 = t.charCodeAt(0);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return false;
  for (let i = 1; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 58) return true;
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46)) return false;
  }
  return false;
}

/** `rel` (a link's path, "/"-separated) from the directory `dirParts`, or null when it climbs out of the root. */
function resolvePath(dirParts, rel) {
  const parts = dirParts.slice();
  const segs = rel.split('/');
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

/** A link resolver for one source: `target` to its href, recording broken links once. */
function makeLinkFn(dirParts, bySource, staticPaths, base, broken, sourcePath) {
  const cache = new Map();
  return (target) => {
    const hit = cache.get(target);
    if (hit !== undefined) return hit;
    let href;
    if (hasScheme(target) || target.charCodeAt(0) === 47 || target.charCodeAt(0) === 35) {
      href = target;
    } else {
      const hash = target.indexOf('#');
      const rel = hash === -1 ? target : target.slice(0, hash);
      const frag = hash === -1 ? '' : target.slice(hash);
      const path = rel === '' ? null : resolvePath(dirParts, rel);
      if (path !== null && bySource.has(path)) href = bySource.get(path).url + frag;
      else if (path !== null && staticPaths.has(path)) href = base + '/' + path + frag;
      else {
        broken.add('broken-link ' + sourcePath + ' -> ' + target);
        href = target;
      }
    }
    cache.set(target, href);
    return href;
  };
}

// ---------- templates ----------

/** The deepest an include nests: one past it renders nothing. */
const INCLUDE_DEPTH = 8;

const T_PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const T_FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const T_IF = /^if (not )?(\S+)$/;
const T_INCLUDE = /^include "([a-z0-9-]+)"$/;

/** A template that does not parse: its name and why. */
class TemplateError extends Error {}

/** The path `text` names, split at its dots, or a TemplateError. */
function pathOf(name, text) {
  if (!T_PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

/** `src`'s tokens: text, {{ }}, {{{ }}} and {% %}, a standalone tag's line taken with it. */
function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

/** `src` parsed into its tree of nodes (a TemplateError when it does not parse). */
function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = T_FOR.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = T_IF.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = T_INCLUDE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

// Compiled template ops. o: 0 text, 1 var, 2 raw, 3 if, 4 else, 5 for, 6 endfor, 7 include.
// An if's elsePc is the else op's index (-1 when there is no else) and endPc the index past the if;
// a for's pc is its own index and endPc the index past its endfor.
function compileTemplate(nodes) {
  const ops = [];
  const emit = (body) => {
    for (const n of body) {
      if (n.kind === 'text') ops.push({ o: 0, s: n.text });
      else if (n.kind === 'var') ops.push({ o: 1, p: n.path });
      else if (n.kind === 'raw') ops.push({ o: 2, p: n.path });
      else if (n.kind === 'include') ops.push({ o: 7, name: n.name });
      else if (n.kind === 'if') {
        const op = { o: 3, p: n.path, not: n.not, elsePc: -1, endPc: -1 };
        ops.push(op);
        emit(n.then);
        if (n.else !== null) {
          const elseOp = { o: 4, endPc: -1 };
          ops.push(elseOp);
          op.elsePc = ops.length - 1;
          emit(n.else);
        }
        op.endPc = ops.length;
        if (n.else !== null) ops[op.elsePc].endPc = ops.length;
      } else if (n.kind === 'for') {
        const op = { o: 5, name: n.name, p: n.path, endPc: -1, pc: ops.length };
        ops.push(op);
        emit(n.body);
        ops.push({ o: 6 });
        op.endPc = ops.length;
      }
    }
  };
  emit(nodes);
  return ops;
}

/** The value at `path` in the scope array `S` (root first, innermost last). */
function lkp(S, path) {
  let v;
  let found = false;
  for (let i = S.length - 1; i >= 0; i--) {
    const vars = S[i];
    if (Object.hasOwn(vars, path[0])) {
      v = vars[path[0]];
      found = true;
      break;
    }
  }
  if (!found) return undefined;
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

/** A value as text: a string itself, a number in JavaScript's digits, true or false, an array's items joined by ", ", else "". */
function txt(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    let s = '';
    for (let i = 0; i < v.length; i++) {
      if (i > 0) s += ', ';
      s += txt(v[i]);
    }
    return s;
  }
  return '';
}

/** Whether a value counts as true in an if: not undefined, null, false, "", 0 or an empty array. */
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/** `ops` rendered in the scope array `S`, appending to `parts`. `T` holds the compiled templates. */
function renderOps(ops, S, T, depth, parts) {
  let pc = 0;
  const stack = [];
  while (pc < ops.length) {
    const o = ops[pc];
    switch (o.o) {
      case 0:
        parts.push(o.s);
        pc++;
        break;
      case 1:
        parts.push(esc(txt(lkp(S, o.p))));
        pc++;
        break;
      case 2:
        parts.push(txt(lkp(S, o.p)));
        pc++;
        break;
      case 3: {
        const v = truthy(lkp(S, o.p));
        if (v !== o.not) pc++;
        else pc = o.elsePc === -1 ? o.endPc : o.elsePc + 1;
        break;
      }
      case 4:
        pc = o.endPc;
        break;
      case 5: {
        const xs = lkp(S, o.p);
        if (!Array.isArray(xs) || xs.length === 0) {
          pc = o.endPc;
          break;
        }
        const vars = Object.create(null);
        const loop = { index: 1, first: true, last: xs.length === 1, length: xs.length };
        vars[o.name] = xs[0];
        vars.loop = loop;
        S.push(vars);
        stack.push({ op: o, arr: xs, idx: 0, vars, loop });
        pc++;
        break;
      }
      case 6: {
        const f = stack[stack.length - 1];
        const ni = f.idx + 1;
        if (ni < f.arr.length) {
          f.idx = ni;
          f.vars[f.op.name] = f.arr[ni];
          const L = f.loop;
          L.index = ni + 1;
          L.first = false;
          L.last = ni === f.arr.length - 1;
          f.vars.loop = L;
          pc = f.op.pc + 1;
        } else {
          S.pop();
          stack.pop();
          pc++;
        }
        break;
      }
      case 7: {
        const t = T.get(o.name);
        if (t !== undefined && depth < INCLUDE_DEPTH) renderOps(t, S, T, depth + 1, parts);
        pc++;
        break;
      }
    }
  }
}

// ---------- pipeline ----------

/** The top-level directories the generator writes itself, which no page's slug at the root may take. */
const RESERVED = ['posts', 'tags', 'page'];

/** The words of a body: its runs of characters other than whitespace. */
function wordsOf(text) {
  const m = text.match(/\S+/g);
  return m === null ? 0 : m.length;
}

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** One site's output tree: path -> text. */
function build(input) {
  const templates = new Map();
  const report = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      templates.set(name, compileTemplate(parseTemplate(name, input.templates[name])));
    } catch (err) {
      if (err instanceof TemplateError) report.push(err.message);
      else throw err;
    }
  }
  const base = input.site.base_url.replace(/\/+$/, '');
  const slugCache = new Map();
  const slug = (t) => {
    let v = slugCache.get(t);
    if (v === undefined) {
      v = slugify(t);
      slugCache.set(t, v);
    }
    return v;
  };

  // 1. The sources, in code-unit order of their paths, line ends made "\n"; a source that is not .md is static.
  const files = [...input.files].sort((a, b) => byCodeUnits(a.path, b.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      const text = f.content.indexOf('\r') === -1 ? f.content : f.content.replace(/\r\n?/g, '\n');
      sources.push({ path: f.path, text });
    } else statics.push({ path: f.path, content: f.content });
  }

  // 2. Each source's front matter: a refused source is reported and dropped, and so is a draft.
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    let own = undefined;
    if (s.path.startsWith('tags/')) own = 'tags';
    else if (s.path.startsWith('page/')) own = 'page';
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }

  // 3. Each page's output directory and url: its slug made unique in its directory, in source order.
  const taken = new Map();
  const bySource = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : []);
      taken.set(dir, set);
    }
    const sl = uniqueSlug(s.data.slug ?? slug(s.data.title), set);
    s.slug = sl;
    s.outDir = dir === '' ? sl : dir + '/' + sl;
    s.url = base + '/' + s.outDir + '/';
    bySource.set(s.path, s);
  }

  // 4. Each body's Markdown, its links resolved to the pages and static files they name.
  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  for (const s of kept) {
    const dir = dirOf(s.path);
    const dirParts = dir === '' ? [] : dir.split('/');
    const env = { link: makeLinkFn(dirParts, bySource, staticPaths, base, broken, s.path) };
    const md = renderMarkdown(s.body, env, slug);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // 5. The posts, newest first and then by slug; each post's newer and older neighbours.
  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  // 6. The tags: grouped by their slug, each named as first met in the posts' order, ordered by count and then slug.
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of s.data.tags ?? []) {
      const sl = slug(name);
      if (!seen.has(sl)) {
        seen.add(sl);
        out.push(name);
      }
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const sl = slug(name);
      let tag = bySlug.get(sl);
      if (tag === undefined) {
        tag = { name, slug: sl, url: base + '/tags/' + sl + '/', posts: [] };
        bySlug.set(sl, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (s.post) continue;
    s.tagRefs = ownTags(s).map((name) => {
      const sl = slug(name);
      const t = bySlug.get(sl);
      return t !== undefined ? t : { name, slug: sl, url: '', posts: [] };
    });
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // 7. Every page through its layout, the index pages and the tag pages through theirs.
  const cards = new Map();
  const cardOf = (s) => {
    let c = cards.get(s);
    if (c === undefined) {
      c = {
        title: s.data.title,
        url: s.url,
        date: s.data.date ?? '',
        date_long: s.data.date === undefined ? '' : longDate(s.data.date),
        summary: s.data.summary ?? '',
        excerpt: s.excerpt,
        reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
        tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
      };
      cards.set(s, c);
    }
    return c;
  };
  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cardOf(p));
  const output = {};
  const render = (name, vars) => {
    const ops = templates.get(name);
    if (ops === undefined) return null;
    const varsObj = { site, tags: allTags, recent, ...vars };
    const parts = [];
    renderOps(ops, [varsObj], templates, 0, parts);
    return parts.join('');
  };
  for (const s of kept) {
    const page = {
      ...cardOf(s),
      slug: s.slug,
      content: s.html,
      toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
      newer: linkOf(s.newer ?? null),
      older: linkOf(s.older ?? null),
      is_post: s.post,
    };
    output[s.outDir + '/index.html'] = render(s.layout, { page });
  }
  const per = input.site.per_page;
  const indexPages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? base + '/' : base + '/page/' + k + '/');
  for (let k = 1; k <= indexPages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cardOf(p)),
      pager: { number: k, total: indexPages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === indexPages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : 'page/' + k + '/index.html'] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cardOf(p)) } });
    if (html !== null) output['tags/' + t.slug + '/index.html'] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // 8. The report: every refusal, draft, broken link and template that did not parse, sorted, then the counts.
  const lines = [...report, ...broken].sort(byCodeUnits);
  const pageCount = kept.filter((s) => !s.post).length;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output['build-report.txt'] = lines.join('\n') + '\n';
  return output;
}

/** makefun-site 1.0.0's answer for one case's input, faster. */
export function run(input) {
  return build(input);
}
