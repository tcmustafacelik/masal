"use strict";
const APP_VERSION = '1.101.2';
const ICON = { dip: 'i-dip', trend: 'i-trend', grid: 'i-grid', live: 'i-coins' };
const COLORS = { dip: '#2F6FDE', trend: '#7A5AC8', grid: '#178A5B', live: '#7C8696' };
const AMBER = 'var(--acc)';
let S = null, B = null, sel = 'live', view = 'live';
function localStore(k, v) { try {
    if (v === undefined)
        return localStorage.getItem(k);
    localStorage.setItem(k, v);
}
catch (e) {
    return null;
} }
const NF = {};
const nf = (v, d = 2) => (NF[d] || (NF[d] = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }))).format(v);
const tl = (v, d = 2) => nf(v, d) + '\u00a0TL';
const U = (v, d = 2) => nf(v, d) + '\u00a0USDT';
const ut = (x) => x.replace(/([+\-−]?)\$(\d[\d.,]*)/g, '$1$2\u00a0USDT').replace(/(\d[\d.,]*) ?\$/g, '$1\u00a0USDT').replace(/\u00a0USDT USDT/g, '\u00a0USDT');
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v));
const spc = (v, d = 2) => (v > 0 ? '+' : v < 0 ? '−' : '') + '%' + nf(Math.abs(v), d);
const cls = v => v > 0 ? 'up' : v < 0 ? 'dn' : '';
function px(v) { const a = Math.abs(v); return nf(v, a >= 1000 ? 0 : a >= 10 ? 2 : a >= 1 ? 3 : a >= 0.01 || !(a > 0) ? 5 : Math.min(14, 3 - Math.floor(Math.log10(a)))); }
function fv(v, dec) { return dec > 0 ? String(Math.round(+v * 100) / 100).replace('.', ',') : Number(v).toLocaleString('tr-TR'); }
function dt(ts, withYear) {
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + (withYear ? '.' + d.getFullYear() : '') + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function ago(ts) { const m = Math.round((Date.now() - ts) / 60000); if (m < 1)
    return 'az önce'; if (m < 60)
    return m + ' dk önce'; const h = Math.floor(m / 60); return h < 24 ? h + ' sa önce' : Math.floor(h / 24) + ' gün önce'; }
const ic = (id, c = 'i') => `<svg class="${c}"><use href="#${id}"/></svg>`;
const sym = inst => inst.split('-')[0];
const escH = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
let LANG = (localStore('masal_lang') === 'en' ? 'en' : 'tr');
let EN = {};
const I18N_TOK = /[+−-]?%?\d[\d.,:]*%?|\b[A-Z][A-Z0-9]{1,11}\b/g;
const I18N_MISS = new Set();
const I18N_CAPS = { KAPAT: 'CLOSE', KISA: 'SHORT', UZUN: 'LONG' };
function enNum(v) {
    if (I18N_CAPS[v])
        return I18N_CAPS[v];
    if (/^\d+\.$/.test(v))
        return v.slice(0, -1);
    if (/\.(\d{1,2}|\d{4,})(?!\d)/.test(v))
        return v;
    if (!/\d/.test(v) || v.includes(':') || !/^[+−-]?%?[\d.,]+%?$/.test(v))
        return v;
    const pct = v.includes('%');
    let x = v.replace(/%/g, '');
    x = x.replace(/\./g, '\u0001').replace(/,/g, '.').replace(/\u0001/g, ',');
    return pct ? x + '%' : x;
}
function trKey(core) {
    const vals = [];
    let n = 0;
    const key = core.replace(I18N_TOK, m => { vals.push(m); return '{' + (n++) + '}'; });
    return [key, vals];
}
function tx(s) {
    if (LANG === 'tr' || !s)
        return s;
    const core = s.replace(/\s+/g, ' ').trim();
    if (!core)
        return s;
    if (EN[core] != null)
        return s.replace(s.trim(), EN[core]);
    const [key, vals] = trKey(core);
    const e = (vals.some(v => /^\d+\.$/.test(v)) ? EN[key + '#ord'] : null) ?? EN[key];
    if (/^(AL|SAT) [A-Z0-9%]/.test(core) && vals[0])
        vals[0] = vals[0] === 'AL' ? 'BUY' : 'SELL';
    if (e == null) {
        if (!/[a-zçğıöşü]/.test(key)) {
            let n = 0;
            return s.replace(/^(\s*),(?=\d)/, '$1.').replace(I18N_TOK, m => enNum(n++ === 0 && (m === 'AL' || m === 'SAT') && vals[0] !== m ? vals[0] : m));
        }
        I18N_MISS.add(key);
        return s;
    }
    const lead = s.match(/^\s*/)[0], tail = s.match(/\s*$/)[0];
    return lead + e.replace(/\{(\d+)\}/g, (_, i) => enNum(vals[+i] ?? '')) + tail;
}
const I18N_DONE = new WeakMap();
function txNode(root) {
    if (LANG === 'tr')
        return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n = root;
    while (n) {
        if (n.nodeType === 3) {
            const p = n.parentElement?.tagName;
            const t = n;
            if (p !== 'SCRIPT' && p !== 'STYLE' && I18N_DONE.get(t) !== t.data) {
                const v = tx(t.data);
                if (v !== t.data)
                    t.data = v;
                I18N_DONE.set(t, t.data);
            }
        }
        else if (n.nodeType === 1) {
            const el = n;
            for (const a of ['aria-label', 'placeholder', 'title']) {
                const v = el.getAttribute(a);
                if (v) {
                    const nv = tx(v);
                    if (nv !== v)
                        el.setAttribute(a, nv);
                }
            }
        }
        n = w.nextNode();
    }
}
async function initLang() {
    document.documentElement.lang = LANG;
    if (LANG === 'tr')
        return;
    try {
        EN = await tfetch('en.json?v=' + APP_VERSION, { cache: 'no-cache' }).then(r => r.json());
    }
    catch (e) {
        EN = {};
    }
    txNode(document.body);
    new MutationObserver(ms => { for (const m of ms) {
        if (m.type === 'characterData')
            txNode(m.target);
        else
            m.addedNodes.forEach(a => txNode(a));
    } })
        .observe(document.body, { subtree: true, childList: true, characterData: true });
}
window.__miss = I18N_MISS;
function setLang(l) { localStore('masal_lang', l); location.reload(); }
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0)), b64e = u => btoa(String.fromCharCode(...new Uint8Array(u)));
async function deriveKey(pw, salt, iter) {
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const KEYS = new Map();
async function unseal(box, pw) {
    const id = pw + '|' + box.salt + '|' + (box.iter || 150000);
    if (!KEYS.has(id)) {
        if (KEYS.size > 20)
            KEYS.clear();
        KEYS.set(id, deriveKey(pw, b64d(box.salt), box.iter || 150000));
    }
    let k;
    try {
        k = await KEYS.get(id);
    }
    catch (e) {
        KEYS.delete(id);
        throw e;
    }
    let raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(box.iv) }, k, b64d(box.ct)));
    if (box.z)
        raw = await inflate(raw);
    return JSON.parse(new TextDecoder().decode(raw));
}
async function inflate(u) {
    const DS = window.DecompressionStream;
    if (DS) {
        try {
            return new Uint8Array(await new Response(new Blob([u]).stream().pipeThrough(new DS('deflate'))).arrayBuffer());
        }
        catch (e) { }
    }
    return inflateRaw(u.subarray(2));
}
function inflateRaw(src) {
    let pos = 0, bit = 0, out = new Uint8Array(src.length * 6 + 64), n = 0;
    const need = (k) => { if (n + k > out.length) {
        const o = new Uint8Array(Math.max(out.length * 2, n + k));
        o.set(out);
        out = o;
    } };
    const bits = (k) => { let v = 0; for (let i = 0; i < k; i++) {
        if (pos >= src.length)
            throw new Error('inflate');
        v |= ((src[pos] >> bit) & 1) << i;
        if (++bit === 8) {
            bit = 0;
            pos++;
        }
    } return v; };
    const build = (lens) => {
        const count = new Uint16Array(16), offs = new Uint16Array(16), sym = new Uint16Array(lens.length);
        for (let i = 0; i < lens.length; i++)
            count[lens[i]]++;
        count[0] = 0;
        for (let i = 1; i < 16; i++)
            offs[i] = offs[i - 1] + count[i - 1];
        for (let i = 0; i < lens.length; i++)
            if (lens[i])
                sym[offs[lens[i]]++] = i;
        return { count, sym };
    };
    const decode = (h) => {
        let code = 0, first = 0, index = 0;
        for (let len = 1; len < 16; len++) {
            code |= bits(1);
            const c = h.count[len];
            if (code - c < first)
                return h.sym[index + (code - first)];
            index += c;
            first += c;
            first <<= 1;
            code <<= 1;
        }
        throw new Error('inflate');
    };
    const LB = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258], LE = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    const DB = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577], DE = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
    const ORD = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    let last = 0;
    do {
        last = bits(1);
        const type = bits(2);
        if (type === 0) {
            if (bit) {
                bit = 0;
                pos++;
            }
            const len = src[pos] | src[pos + 1] << 8;
            pos += 4;
            need(len);
            out.set(src.subarray(pos, pos + len), n);
            n += len;
            pos += len;
        }
        else if (type === 3)
            throw new Error('inflate');
        else {
            let lh, dh;
            if (type === 1) {
                const l = new Uint8Array(288);
                l.fill(8, 0, 144);
                l.fill(9, 144, 256);
                l.fill(7, 256, 280);
                l.fill(8, 280, 288);
                lh = build(l);
                dh = build(new Uint8Array(30).fill(5));
            }
            else {
                const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4, cl = new Uint8Array(19);
                for (let i = 0; i < hclen; i++)
                    cl[ORD[i]] = bits(3);
                const ch = build(cl), l = new Uint8Array(hlit + hdist);
                let i = 0;
                while (i < hlit + hdist) {
                    const sy = decode(ch);
                    if (sy < 16)
                        l[i++] = sy;
                    else {
                        let v = 0, r = 0;
                        if (sy === 16) {
                            v = l[i - 1];
                            r = 3 + bits(2);
                        }
                        else if (sy === 17)
                            r = 3 + bits(3);
                        else
                            r = 11 + bits(7);
                        while (r--)
                            l[i++] = v;
                    }
                }
                lh = build(l.subarray(0, hlit));
                dh = build(l.subarray(hlit));
            }
            for (;;) {
                const sy = decode(lh);
                if (sy < 256) {
                    need(1);
                    out[n++] = sy;
                }
                else if (sy === 256)
                    break;
                else {
                    const len = LB[sy - 257] + bits(LE[sy - 257]), ds = decode(dh), dist = DB[ds] + bits(DE[ds]);
                    if (dist > n)
                        throw new Error('inflate');
                    need(len);
                    for (let i = 0; i < len; i++, n++)
                        out[n] = out[n - dist];
                }
            }
        }
    } while (!last);
    return out.subarray(0, n);
}
async function seal(obj, pw, iter = 150000) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const k = await deriveKey(pw, salt, iter);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(obj)));
    return { enc: 1, iter, salt: b64e(salt), iv: b64e(iv), ct: b64e(ct) };
}
let pw = localStore('masal_pw') || '';
async function openLive(s) {
    if (!s.live_z)
        return;
    const pub = s.live_public || { armed: false, paused: false };
    s.strategies.live = { locked: true, name: 'Gerçek hesap', live: true, armed: pub.armed, paused: pub.paused, pnl_pct: 0 };
    if (!pw)
        return;
    try {
        const o = await unsealLive(s, pw);
        s.strategies.live = o.strategy;
        s.okx = o.okx;
        s.xfer = o.xfer;
        s.levr = o.levr;
        s.memer = o.memer;
        s.gspotr = o.gspotr;
        if (o.settings)
            s.settings = o.settings;
    }
    catch (e) {
        pw = '';
        localStorage.removeItem('masal_pw');
        toast('Şifre uyuşmadı, gerçek hesap kilitli kaldı');
    }
}
async function unsealLive(s, p) {
    return unseal(s.live_z, p);
}
async function tfetch(url, opt = {}, ms = 8000) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
    try {
        return await fetch(url, { ...opt, signal: c.signal });
    }
    finally {
        clearTimeout(t);
    }
}
const CACHE_KEY = 'masal_cache_';
async function getData(f) {
    const t = Date.now();
    const tries = [];
    if (token)
        tries.push([`https://api.github.com/repos/${REPO.o}/${REPO.r}/contents/docs/data/${f}?ref=data&t=${t}`, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github.raw+json' }, cache: 'no-store' }]);
    tries.push([`https://raw.githubusercontent.com/${REPO.o}/${REPO.r}/data/docs/data/${f}?t=${t}`, { cache: 'no-store' }]);
    for (const [u, o] of tries) {
        try {
            const r = await tfetch(u, o);
            if (r.ok) {
                const t = await r.text(), j = JSON.parse(t);
                try {
                    localStorage.setItem(CACHE_KEY + f, t);
                }
                catch (e) { }
                return j;
            }
        }
        catch (e) { }
    }
    try {
        const c = localStorage.getItem(CACHE_KEY + f);
        if (c) {
            offlineData = true;
            return JSON.parse(c);
        }
    }
    catch (e) { }
    throw new Error('veri alınamadı');
}
let offlineData = false, retryTimer = null;
let lastLoad = 0, dataSha = '', dataTag = '', lastB = 0;
let watching = false, watchHold = 0;
async function watchData() {
    if (document.hidden || !S || watching)
        return;
    watching = true;
    try {
        if (token && Date.now() >= watchHold) {
            try {
                const h = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github.sha' };
                if (dataTag)
                    h['If-None-Match'] = dataTag;
                const r = await tfetch(`https://api.github.com/repos/${REPO.o}/${REPO.r}/commits/data`, { headers: h, cache: 'no-store' });
                if (r.status === 304) {
                    syncMark(true);
                    return;
                }
                if (r.ok) {
                    dataTag = r.headers.get('ETag') || '';
                    const sha = (await r.text()).trim();
                    syncMark(true);
                    if (dataSha && sha !== dataSha)
                        load(true);
                    dataSha = sha;
                    return;
                }
                watchHold = Date.now() + (r.status === 403 || r.status === 429 ? Math.max(60000, (+r.headers.get('Retry-After') || 0) * 1000) : 30000);
            }
            catch (e) {
                watchHold = Date.now() + 30000;
            }
        }
        if (Date.now() - lastLoad > 15000)
            load(true);
    }
    finally {
        watching = false;
    }
}
let fastUntil = 0;
const fastWatch = () => { fastUntil = Date.now() + 40000; };
(function tick() { watchData(); setTimeout(tick, Date.now() < fastUntil ? 1000 : 2000); })();
document.addEventListener('visibilitychange', () => { if (!document.hidden && S)
    load(true); });
let loadP = null;
function load(quiet) { return loadP || (loadP = load_(quiet).finally(() => { loadP = null; })); }
async function load_(quiet) {
    lastLoad = Date.now();
    offlineData = false;
    clearTimeout(retryTimer);
    const btn = document.getElementById('reload');
    if (!quiet)
        btn.classList.add('spin');
    const err = document.getElementById('err');
    err.style.display = 'none';
    try {
        if (!S) {
            try {
                const c = localStorage.getItem(CACHE_KEY + 'summary.json');
                if (c) {
                    const s0 = JSON.parse(c);
                    await openLive(s0);
                    S = s0;
                    B = JSON.parse(localStorage.getItem(CACHE_KEY + 'backtest.json') || 'null');
                    if (S.strategies.live)
                        sel = 'live';
                    if (!S.strategies[sel])
                        sel = Object.keys(S.strategies)[0];
                    render();
                    hideSplash();
                }
            }
            catch (e) {
                S = null;
            }
        }
        const needB = !B || Date.now() - lastB > 6e5;
        const [s, b] = await Promise.all([getData('summary.json'), needB ? getData('backtest.json').catch(() => null) : Promise.resolve(B)]);
        if (needB)
            lastB = Date.now();
        await openLive(s);
        S = s;
        B = b;
        syncMark(!offlineData);
        {
            const st = S.settings, recent = Date.now() - +(localStore('masal_pref_ts') || 0) < 180000;
            if (st && !recent) {
                if (st.theme && st.theme !== themeMode())
                    setTheme(st.theme);
                if (st.lang && st.lang !== LANG) {
                    localStore('masal_pref_ts', String(Date.now()));
                    setLang(st.lang);
                    return;
                }
            }
        }
        nMerge();
        if (offlineData) {
            err.innerHTML = `Bağlantı kurulamadı; <b>${dt(S.updated)}</b> tarihli son veri gösteriliyor. Kendiliğinden yeniden deneniyor…`;
            err.style.display = 'block';
            retryTimer = setTimeout(() => load(true), 15000);
        }
        if (S.strategies.live)
            sel = 'live';
        if (!S.strategies[sel])
            sel = Object.keys(S.strategies)[0];
        render();
        pollMarket();
        startNotes();
        if (token && pw && !window._setChk) {
            window._setChk = 1;
            setTimeout(() => { if (!orig)
                loadSettings(); }, 4000);
        }
    }
    catch (e) {
        syncMark(false);
        console.error(e);
        err.textContent = 'Veriler alınamadı (bağlantı ya da VPN). Kendiliğinden yeniden deneniyor…';
        err.style.display = 'block';
        retryTimer = setTimeout(() => load(true), 10000);
    }
    finally {
        btn.classList.remove('spin');
        hideSplash();
        cloudUI();
    }
}
function deskModes() {
    const st = orig || S?.settings || {}, L = S?.strategies?.live, A = S;
    const one = (on, real) => on === false ? 'off' : real ? 'real' : 'demo';
    const gs = st.gspot || {}, lv = st.lev || {}, mm = st.meme || {};
    return [
        ['spot', 'Spot', 'i-coins', L?.halted ? 'halt' : L?.paused ? 'pause' : L?.armed ? 'real' : 'demo', 'OKX TR · TL'],
        ['gspot', 'Global', 'i-globe', one(gs.on, gs.real != null ? !!gs.real && !!A?.gspotr : !!A?.gspotr), 'OKX Global · USDT spot'],
        ['fut', 'Futures', 'i-layers', one(lv.on, lv.real != null ? !!lv.real && !!A?.levr : !!A?.levr), `OKX Global · en fazla 3x${lv.fast ? ' · al-kaç' : ''}`],
        ['meme', 'Memecoin', 'i-flask', one(mm.on, mm.real != null ? !!mm.real && !!A?.memer : !!A?.memer), 'Solana · ayrı cüzdan']
    ];
}
function openModes() {
    const NM = { real: ['g', 'Gerçek para'], demo: ['m', 'Deneme'], halt: ['r', 'Acil fren'], pause: ['a', 'Beklemede'], off: ['m', 'Kapalı'] };
    const q = document.getElementById('qsh');
    q.dataset.n = '';
    qHead('i-coins', 'Kapat');
    document.getElementById('qTitle').textContent = 'Masaların durumu';
    document.getElementById('qText').innerHTML = `<div class="mdl">${deskModes().map(([v, n, i, st, no]) => `<button type="button" class="mdr ${st}" data-mv="${v}"><span class="mdi">${ic(i)}</span><span class="mdt"><b>${n}</b><small>${no}</small></span><span class="chip ${NM[st][0]}">${NM[st][1]}</span></button>`).join('')}</div>
    <button type="button" class="more" id="mdSet">${ic('i-gear')}Ayarlarda değiştir</button>`;
    q.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { q.hidden = true; showView(b.dataset.mv); });
    document.getElementById('mdSet').onclick = () => { q.hidden = true; document.getElementById('openSet').click(); };
    q.hidden = false;
}
const spotOn = () => VIEW === 'spot' && !document.getElementById('mainv').hidden;
function render() {
    updLine();
    homeChecks();
    renderMasa();
    renderDeck();
    xfRefresh();
    const L = S.strategies.live;
    {
        const m = document.getElementById('mode'), halt = L && L.halted, real = L && L.armed, want = orig ? orig.live : S.settings?.live;
        const pending = L && !halt && want !== undefined && !!want !== !!real;
        {
            const mc = pending ? 'mode' : 'mode' + (halt ? ' halt' : real ? ' real' : '');
            if (m.className !== mc)
                m.className = mc;
        }
        setH(m, pending ? `<span class="mi">${ic('i-refresh')}</span><span><b>${want ? 'Gerçeğe' : 'Denemeye'}</b><small>geçiliyor…</small></span>` : halt ? `<span class="mi">${ic('i-stop')}</span><span><b>Durdu</b><small>Acil fren</small></span>`
            : L && L.paused ? `<span class="mi">${ic('i-pause')}</span><span><b>Beklemede</b><small>Yeni alım yok</small></span>`
                : (() => {
                    const dm = deskModes(), n = dm.filter(d => d[3] === 'real').length;
                    return n ? `<span class="mi">${ic('i-coins')}</span><span><b>Gerçek</b><small>${n}/${dm.length} masa</small></span>`
                        : `<span class="mi">${ic('i-flask')}</span><span><b>Deneme</b><small>Emir gitmez</small></span>`;
                })());
        if (!pending && !halt && !(L && L.paused)) {
            const n = deskModes().some(d => d[3] === 'real');
            const mc = 'mode' + (n ? ' real' : '');
            if (m.className !== mc)
                m.className = mc;
        }
        m.onclick = openModes;
    }
    setH(document.getElementById('foot'), 'Fiyatlar uygulama açıkken OKX TR\'den anlık güncellenir; bot kesintisiz çalışır, saniyede bir kontrol eder.<br>' + (L && L.armed ? 'Ekrandaki rakamlar OKX TR hesabındaki gerçek işlemlerdir.' : 'Gerçek para kullanılmıyor; tüm işlemler sanal.'));
    if (S.strategies.live && sel !== 'live')
        sel = 'live';
    const x = S.strategies[sel];
    const locked = !!x.locked;
    document.getElementById('chartSec').hidden = locked;
    if (locked) {
        document.getElementById('hero').className = 'hero';
        if (setH(document.getElementById('hero'), `<div class="hh"><span class="hn">${ic('i-lock')}Gerçek hesap</span></div><div class="lock" style="margin-top:10px"><b>${ic('i-lock')}Veriler şifreli</b>
      <p>Bakiye ve işlemlerin herkese açık sayfada şifreli duruyor. Görmek için OKX'te API anahtarını oluştururken belirlediğin şifreyi (Passphrase) gir. Şifre sadece bu cihazda saklanır.</p>
      <input class="inp" id="pwIn" type="password" placeholder="OKX şifresi" autocomplete="off"><button class="btn primary" id="pwBtn" style="width:100%">${ic('i-lock')}Kilidi aç</button></div>`))
            document.getElementById('pwBtn').onclick = async () => {
                const v = document.getElementById('pwIn').value;
                if (!v)
                    return toast('Şifreyi gir');
                try {
                    const o = await unsealLive(S, v);
                    pw = v;
                    localStore('masal_pw', v);
                    S.strategies.live = o.strategy;
                    S.okx = o.okx;
                    S.xfer = o.xfer;
                    S.levr = o.levr;
                    S.memer = o.memer;
                    S.gspotr = o.gspotr;
                    if (o.settings)
                        S.settings = o.settings;
                    render();
                    loadSettings();
                    toast('Kilit açıldı');
                }
                catch (e) {
                    toast('Şifre yanlış');
                }
            };
        setH(document.getElementById('alerts'), '');
        ['positions', 'trades', 'coins'].forEach(id => setH(document.getElementById(id), `<div class="empty">${ic('i-lock')}<div>Kilitli</div></div>`));
        document.getElementById('nowSec').hidden = true;
        setH(document.getElementById('kasa'), '');
        document.getElementById('logSec').hidden = true;
        renderBacktest();
        renderRules(x.risk || S.risk, null);
        renderMarket();
        {
            const k = document.getElementById('xfer');
            k.hidden = false;
            setH(k, `<div class="card"><div class="empty">${ic('i-lock')}<div>Kasalar için önce kilidi aç (Spot sekmesi)</div></div></div>`);
        }
        return;
    }
    let al = '';
    if (x.halted)
        al += `<div class="alert red">${ic('i-power')}<div><b>Acil fren devrede.</b> ${x.halt_reason}. Bot bu stratejide yeni işlem açmıyor.</div></div>`;
    setH(document.getElementById('alerts'), al);
    if (VIEW === 'kasa')
        renderXfer();
    if (!spotOn())
        return;
    renderMetrics(x);
    renderNow(x);
    renderKasa(x);
    renderChart();
    renderPositions(x);
    renderCoins(x);
    const tr = x.recent.slice(0, 12);
    setH(document.getElementById('trades'), tr.length ? tr.map(t => {
        const sell = t.side === 'SAT';
        return `<div class="row">${cico(t.inst, t.side, t.pnl < 0)}
      <div class="mid"><b>${sym(t.inst)}${pq(t.inst)} ${sell ? 'satıldı' : 'alındı'}</b><span>${dt(t.ts)} · ${t.reason} · ${px(t.price)}</span></div>
      <div class="end"><b>${tl(t.amount, 0)}</b>${sell ? `<span class="pill ${cls(t.pnl) || 'z'}"><i>${t.pnl >= 0 ? '▲' : '▼'}</i>${nf(Math.abs(t.pnl))} TL<small>${t.pnl >= 0 ? 'kâr' : 'zarar'}</small></span>` : `<span class="pill buy">${ic('i-coins')}Alım</span>`}</div></div>`;
    }).join('')
        : `<div class="empty">${ic('i-list')}<div>Henüz işlem yok. Bot fırsat bekliyor.</div></div>`);
    clipList('trades', 4);
    renderBacktest();
    renderLog(x);
    renderRules(x.risk || S.risk, x.cfg);
    renderMarket();
}
const pp = (v, d = 1) => '%' + nf(v * 100, Math.round(v * 1000) % 10 ? d : 0);
function gloss(k) {
    const L = S?.strategies?.live, c = (L && !L.locked && L.cfg) || null;
    const step = c ? pp(c.step) : '%1,5', tp = c ? pp(c.lot_tp) : '%4', stop = c ? pp(c.stop) : '%12', ml = c ? c.max_lots : 4, mc = c ? c.max_coins : 20, lot = c ? tl(c.lot, 0) : 'bir kademe', use = c ? pp(c.max_use, 0) : '%40', cf = c?.coin_filter ? pp(c.coin_filter) : '%1', qt = S?.settings?.quote || S?.okx?.quote || 'USDT';
    const G = {
        nasil: ['Bot nasıl alıp satar?', `${c?.instant ? '<p>Bot <b>saniyede bir</b> fiyatlara bakar; fiyat alım seviyesine değdiği an alır. Alım seviyesi son kapanan 15 dakikalık mumlara göre hesaplanır.</p>' : '<p>Bot <b>2 saniyede bir</b> piyasaya bakar, kararını <b>15 dakikalık mum</b> kapanınca verir.</p>'}
      <ul><li><b>Alım:</b> Bir coin son ${c?.sma_h || 20} saatin ortalamasından <b>${step}</b> aşağı inince ${lot}'lik bir parça (kademe) alır.</li>
      <li><b>Düşerse:</b> ${step} düşüşte 2. kademeyi${c?.step3 && c.step3 > c.step ? `, ${pp(c.step3)} daha düşüşte 3. kademeyi` : ''} alır; bir coinde en fazla <b>${ml}</b> kademe.${c && ((c.lot2 ?? 1) < 1 || (c.lot3 ?? 1) < 1) ? ` Kademe tutarları: ${tl(c.lot, 0)} → ${tl(c.lot * (c.lot2 ?? 1), 0)} → ${tl(c.lot * (c.lot3 ?? 1), 0)}.` : ''}</li>
      <li><b>Satış:</b> Her kademe kendi alış fiyatının <b>${tp}</b> üstüne çıkınca ayrı satılır.</li>
      <li><b>Zarar kesme:</b> Ortalama maliyetin <b>${stop}</b> altına inerse o coindeki her şey satılır.</li>
      <li><b>Düşüş filtresi:</b> Coin bir günde ${cf}'den fazla geriliyorsa "düşen bıçak" sayılır, yeni alım bekletilir.</li></ul>
      <p>${qt === 'TRY' ? 'Coinler <b>TRY paritesinden</b> alınır.' : `Coinler <b>${qt} paritesinden</b> alınır; TL gerekirse otomatik ${qt}'ye çevrilir.`} Uygulamadaki bütün fiyat ve tutarlar <b>TL karşılığıdır</b>.</p>
      <p>Aynı anda en fazla <b>${mc}</b> coin tutulur ve bütçenin en fazla <b>${use}</b>'ı coine yatırılır; kalanı güvenlik payıdır.</p>`],
        yakin: ['Alıma yakın coinler', `<p>Her satır bir coinin <b>alım fiyatına ne kadar uzak</b> olduğunu gösterir.</p>
      <ul><li><span class="chip m">%0,8 düşerse</span> fiyat bu kadar daha inerse bot alır.</li>
      <li><span class="chip g st"><b>Şartta</b><small>alım hazır</small></span> fiyat alım seviyesinde; ${c?.instant ? 'bot birkaç saniye içinde alır' : '15 dakikalık mum bu seviyede kapanırsa bot alır'}.</li>
      <li><span class="chip a">Düşüş filtresi</span> coin hızlı düşüyor ya da hacmi aniden patladı (panik satışı); sakinleşene kadar alım bekletiliyor.</li>
      <li><span class="chip a st"><b>Şartta</b><small>bütçe dolu</small></span> fiyat uygun ama coinlere ayrılan para dolu; bir kademe satılınca alır.</li>
      <li><span class="chip a st"><b>Şartta</b><small>coin sınırı dolu</small></span> fiyat uygun ama aynı anda tutulabilecek coin sayısı dolu; elindeki bir coin satılınca alır.</li>
      <li><b>Elle almak için</b> satırı sola kaydır ve yeşil <b>Al</b>'a dokun; tutarı seç. Bot birkaç saniye içinde piyasa fiyatından alır ve coini kendi kademesi gibi yönetir (kâr al, zarar durdur). Bütçe ya da coin sınırı dolu olsa da elle alım yapılır.</li>
      <li><b>Alım</b> fiyatı bir eşiktir: fiyat bunun altına inince bot <b>o anki (daha düşük) fiyattan</b> alır.</li>
      <li><i class="kd">1 kademe</i> coin zaten elde; mavi yüzde kadar daha düşerse bir sonraki kademe alınır (<b>2. alım</b> fiyatı).</li></ul>
      <p>Şartta görünüp alınmıyorsa: ${c?.instant ? '' : 'mum henüz kapanmamıştır, ya da '}bütçe sınırı / coin sayısı dolmuştur.</p>`],
        pozisyon: ['Elimdeki coinler', `<ul><li><b>Alış → şimdi:</b> ortalama alış fiyatın ve şu anki fiyat.</li>
      <li><b>Çubuk:</b> solda kırmızı <b>zarar durdur</b>, sağda yeşil <b>kâr al</b> fiyatı. Yuvarlak, fiyatın şu an nerede olduğunu gösterir; ince çizgi alış fiyatın. Yuvarlak sağa gittikçe kâra yaklaşırsın.</li>
      <li><span class="shd">${ic('i-shield')}</span> <b>Borsa korumalı:</b> bu satış emirleri OKX'te bekliyor; bot ya da telefon kapalı olsa bile çalışır.</li>
      <li><b>Sağdaki renkli kutu:</b> şimdi satılsa ne kadar kâr (yeşil) ya da zarar (kırmızı) edeceğin.</li>
      <li><b>Elle satmak için</b> satırı sola kaydır ve kırmızı <b>Sat</b> düğmesine dokun; bot birkaç saniye içinde piyasa fiyatından satar.</li></ul>`],
        coinkz: ['Coin bazında kâr/zarar', `<p>Her coin için şimdiye kadar elde edilen sonuç:</p>
      <ul><li><b>Büyük rakam:</b> satılan kademelerin kesinleşmiş sonucu + elde duran kısmın şu anki sonucu.</li>
      <li><b>Kapandı:</b> coin tamamen satıldı, sonuç kesin. <b>Elde:</b> henüz hiç satılmadı. <b>Açıkta:</b> elde kalan kısmın henüz kesinleşmemiş kâr/zararı.</li></ul>
      <p>Başlıktaki rakam bütün coinlerin toplamıdır.</p>`],
        use: ['Coinlere ayrılan sınır', `<p>Bot bütçenin en fazla <b>${use}</b>'ını aynı anda coine yatırır. Çubuk bunun ne kadarının dolu olduğunu gösterir.</p>
      <p>Çubuk dolunca bot yeni coin almaz; bir kademe kârla satılınca yer açılır ve yeniden alım yapar. Bu sınır sert düşüşte paranın tamamının coinde kalmasını engeller.</p>`],
        kasa: ['Kasa', `<p><b>Kasa</b>, bu iş için ayırdığın toplam para. <b>Botta aktif</b> kısmı bot kullanır, <b>yedek</b> kısmı bekler.</p><p>Bot kâr ettikçe kasadan kademeli ekleme yapar; zarardayken ekleme yapmaz.</p>`]
    };
    return G[k] || ['', ''];
}
let masaOn = false;
function showMasa(on) {
    masaOn = on;
    overlayView(on);
    document.getElementById('mainv').hidden = on;
    document.getElementById('masav').hidden = !on;
    document.querySelector('header').hidden = on;
    scrollTo(0, 0);
    if (on)
        renderMasa();
    else
        pollMarket();
}
function masaClock(ts) { const d = new Date(ts), p = (n) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}`; }
function renderMasa() {
    if (!masaOn || !S)
        return;
    const box = document.getElementById('masaBody'), x = S.strategies.live;
    if (!x || x.locked) {
        setH(box, `<div class="empty">${ic('i-lock')}<div>Gerçek hesabın kilidi açık olmalı</div></div>`);
        return;
    }
    const w = x.watch, c = x.cfg, R = x.risk, pos = x.positions || [], rec = x.recent || [];
    const eq = liveEquity(x), today = x.today_pnl + (eq - x.equity);
    const items = (w?.items || []).map(it => { const cur = livePrice(it.i, it.p); return { ...it, cur, gap: (cur / it.t - 1) * 100 }; });
    const near = items.filter(i => !i.f).sort((a, b) => a.gap - b.gap).slice(0, 3);
    const filtered = items.filter(i => i.f).length, inCond = items.filter(i => !i.f && i.gap <= 0).length;
    const buys = rec.filter(t => t.side === 'AL'), sells = rec.filter(t => t.side === 'SAT');
    const prot = pos.filter(p => p.protected === true).length;
    const kill = R?.kill_switch || 0, dayLim = R?.daily_loss_limit || 0;
    const blocks = [];
    if (x.halted)
        blocks.push('acil fren');
    if (x.paused)
        blocks.push('beklemede');
    if (x.blocked_today)
        blocks.push('günlük sınır');
    if (w && !w.room)
        blocks.push('bütçe dolu');
    if (w && w.coins >= w.max_coins)
        blocks.push('coin sınırı dolu');
    const st = (on, a, b) => `<em class="ast ${on ? 'on' : 'off'}"><i></i>${on ? a : b}</em>`;
    const ln = (k, v) => `<div class="al"><span>${k}</span><b>${v}</b></div>`;
    const agents = [
        ['scan', 'i-eye', 'Gözcü', 'Fırsat arar, alım yapmaz', st(!x.halted, 'TARIYOR', 'DURDU'),
            ln('İzlenen', `${items.length} coin`) + ln('Şartta', `${inCond} coin`) +
                (near.length ? `<div class="ach">${near.map(i => `<span>${sym(i.i)} <b class="${i.gap <= 0 ? 'up' : ''}">${i.gap <= 0 ? 'şartta' : '%' + nf(i.gap, 1)}</b></span>`).join('')}</div>` : '')],
        ['risk', 'i-shield', 'Bekçi', 'Riskli alımı durdurur', st(!blocks.length, 'GEÇİRİYOR', 'ENGELLİYOR'),
            ln('Filtrede', `${filtered} coin`) + ln('Engel', blocks.length ? blocks.join(', ') : 'yok') +
                ln('Acil fren', kill ? `${tl(kill, 0)} altı` : '—')],
        ['buy', 'i-coins', 'Alıcı', 'Şart oluşunca anında alır', st(!blocks.length && !!x.armed, 'HAZIR', x.armed ? 'BEKLİYOR' : 'DENEME'),
            ln('Alım tutarı', c ? tl(c.lot, 0) : '—') + ln('Son alım', buys[0] ? `${sym(buys[0].inst)} · ${ago(buys[0].ts)}` : '—') +
                ln('Kademe aralığı', c ? pp(c.step) : '—')],
        ['exit', 'i-pnl', 'Çıkışçı', 'Kârı borsada toplar, zararı keser', st(prot === pos.length, 'KORUYOR', 'KORUMA BEKLİYOR'),
            ln('Açık coin', `${pos.length}`) + ln('Borsa korumalı', `${prot}/${pos.length}`) +
                ln('Son satış', sells[0] ? `${sym(sells[0].inst)} <span class="${cls(sells[0].pnl || 0)}">${sgn(sells[0].pnl || 0)} TL</span>` : '—')],
        ['log', 'i-list', 'Kâtip', 'Her kararı sebebiyle yazar', st(true, 'YAZIYOR', ''),
            ln('Kayıt', `${(x.log || []).length} satır`) + ln('Kapanan işlem', `${x.trades}`) + ln('Kazanma', x.win_rate == null ? '—' : '%' + nf(x.win_rate, 0))],
        ['cash', 'i-wallet', 'Kasadar', 'Parayı ve hedefi izler', st(today >= 0, 'KÂRDA', 'ZARARDA'),
            ln('Bottaki para', tl(eq, 0)) + ln('Bugün', `<span class="${cls(today)}">${sgn(today)} TL</span>`) + ln('Günlük sınır', dayLim ? tl(dayLim, 0) : '—')],
    ];
    const feed = [];
    for (const t of rec.slice(0, 25))
        feed.push([t.ts, t.side === 'AL' ? 'al' : (t.pnl || 0) >= 0 ? 'sat' : 'zar', t.side === 'AL' ? 'AL' : 'SAT',
            `<b>${sym(t.inst)}</b> ${tl(t.amount, 0)}${t.side === 'SAT' ? ` · <span class="${cls(t.pnl || 0)}">${sgn(t.pnl || 0)} TL</span>` : ''}<small>sebep: ${(t.reason || '—').replace(/</g, '&lt;')}</small>`]);
    for (const [ts, msg] of (x.log || []).slice(0, 20))
        if (!/^(AL|SAT|\[deneme\]) /.test(msg))
            feed.push([ts, /HATA|uyarı|alınamıyor/i.test(msg) ? 'err' : 'not', /HATA/i.test(msg) ? 'HATA' : 'NOT', feedTxt(msg)]);
    feed.sort((a, b) => b[0] - a[0]);
    setH(box, `<div class="mtop"><div><span>Bottaki para</span><b>${tl(eq, 0)}</b></div><div><span>Bugün</span><b class="${cls(today)}">${sgn(today)} TL</b></div>
      <div><span>İşlem</span><b>${x.trades}</b></div><div><span>Kazanma</span><b>${x.win_rate == null ? '—' : '%' + nf(x.win_rate, 0)}</b></div></div>
    <div class="mflow">${['Gözcü', 'Bekçi', 'Alıcı', 'Çıkışçı'].map((n, i) => `<span>${n}</span>${i < 3 ? ic('i-chev') : ''}`).join('')}</div>
    <div class="agrid">${agents.map(([k, i, n, r, s, body]) => `<div class="agent a-${k}"><div class="ah2"><span class="aic">${ic(i)}</span><b>${n}</b></div>${s}<small class="arole">${r}</small>${body}</div>`).join('')}</div>
    <h2 class="mh">${ic('i-list')}Canlı akış<span class="hsum">her işlem sebebiyle</span></h2>
    <div class="card mfeed">${feed.length ? feed.slice(0, 30).map(([ts, k, tag, txt]) => `<div class="fr"><time>${masaClock(ts)}</time><em class="ft ${k}">${tag}</em><div>${txt}</div></div>`).join('') : `<div class="empty">${ic('i-list')}<div>Henüz kayıt yok</div></div>`}</div>`);
}
const usdTL = (v) => { const r = +(S?.xfer?.usdtry || USDTTRY || 0); return r && isFinite(v) ? tl(v * r, 0) : ''; };
const pxTL = (v) => { const r = +(S?.xfer?.usdtry || USDTTRY || 0); return r && isFinite(v) && v > 0 ? px(v * r) + ' TL' : ''; };
const pTL = (v) => { const t = usdTL(Math.abs(+v || 0)); return t ? ` · ${(+v || 0) < 0 ? '−' : '+'}${t}` : ''; };
function deskHero(lbl, val, sub, pnl, base, left, ml, chips) {
    const usd = (v) => U(v, 2), pc = base > 0 ? pnl / base * 100 : 0, r = ml > 0 ? Math.max(0, Math.min(100, left / ml * 100)) : 0;
    const tv = usdTL(val), tp = usdTL(Math.abs(pnl));
    return `<div class="dhero"><div><small>${lbl}</small><strong>${usd(val)}</strong>${tv ? `<em class="dtl">≈ ${tv}</em>` : ''}<span>${sub}</span></div>
    <div class="adf ${cls(pnl)}">${pnl >= 0 ? '▲' : '▼'} %${nf(Math.abs(pc), 1)}<small>${pnl < 0 ? '−' : '+'}${usd(Math.abs(pnl))}</small>${tp ? `<small>${pnl < 0 ? '−' : '+'}${tp}</small>` : ''}</div></div>
    <div class="drisk"><div><span>${ic('i-shield')}Kalan risk</span><b>${usd(left)} / ${U(ml, 0)}</b></div><div class="rb"><i class="${r > 60 ? 'ok' : r > 25 ? 'mid' : 'low'}" style="width:${r.toFixed(1)}%"></i></div></div>
    <div class="dchips">${chips.map(([k, v]) => `<span>${k}<b>${v}</b></span>`).join('')}</div>`;
}
function eqCard(ser, base) {
    const s = (ser || []).filter((p) => p && isFinite(+p[1])).map((p) => [+p[0], +p[1]]).sort((a, b) => a[0] - b[0]);
    if (s.length < 3)
        return '';
    const W = 340, H = 120, pt = 8, pb = 16, pr = 46, b0 = +base || s[0][1];
    const xs = s.map((p) => p[0]), ys = s.map((p) => p[1]).concat([b0]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pad = (y1 - y0) * .12 || 1;
    y0 -= pad;
    y1 += pad;
    const X = (t) => (t - x0) / (x1 - x0 || 1) * (W - pr), Y = (v) => pt + (1 - (v - y0) / (y1 - y0)) * (H - pt - pb);
    const last = s[s.length - 1][1], col = last >= b0 ? '#178A5B' : '#C9473F', ln = s.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ');
    const g = `<line x1="0" x2="${W - pr}" y1="${Y(b0).toFixed(1)}" y2="${Y(b0).toFixed(1)}" stroke="var(--zero)" stroke-dasharray="4 4"/>
    <path d="${ln} L${X(x1).toFixed(1)} ${H - pb} L0 ${H - pb}Z" fill="${col}" opacity=".08"/><path d="${ln}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linejoin="round"/>
    <circle cx="${X(x1).toFixed(1)}" cy="${Y(last).toFixed(1)}" r="3" fill="${col}"/>
    <text x="${W - pr + 4}" y="${(Y(b0) + 3).toFixed(1)}" class="gt">${nf(b0, 2)}</text>
    <text x="0" y="${H - 3}" class="gt">${dt(x0).split(' ')[0]}</text><text x="${W - pr}" y="${H - 3}" text-anchor="end" class="gt">${dt(x1).split(' ')[0]}</text>`;
    return `<h2 class="mh">${ic('i-chart')}Bakiye seyri<span class="hsum ${cls(last - b0)}">${sgnU(last - b0)}</span></h2><div class="card"><svg class="cdc eqc" viewBox="0 0 ${W} ${H}">${g}</svg><p class="hint" style="margin-top:4px">Kesikli çizgi başlangıç (${U(b0, 2)}${usdTL(b0) ? ' · ' + usdTL(b0) : ''}).</p></div>`;
}
const DALL = new Set();
const dMore = (id, n) => n > 5 ? `<button class="more" type="button" data-dall="${id}">${DALL.has(id) ? 'Daha az göster' : `Tümünü göster (${n})`}</button>` : '';
document.addEventListener('click', e => { const b = e.target.closest?.('[data-dall]'); if (!b)
    return; const k = b.dataset.dall; if (DALL.has(k))
    DALL.delete(k);
else
    DALL.add(k); renderDeck(); });
const dCut = (id, a) => (DALL.has(id) ? a : a.slice(0, 5)).join('') + dMore(id, a.length);
function deskCoins(id, coins, open, kind, favs = []) {
    const fv = new Set((favs || []).flatMap((f) => [banKey(f.sym), f.mint].filter(Boolean)));
    const m = {};
    for (const c of coins || [])
        m[c.inst] = { ...c };
    for (const k in open)
        if (!m[k])
            m[k] = { inst: k, buys: 1, sells: 0, realized: 0 };
    const list = Object.values(m).map((c) => ({ ...c, op: open[c.inst], tot: (+c.realized || 0) + (open[c.inst] || 0) })).sort((a, b) => b.tot - a.tot);
    if (!list.length)
        return '';
    const T = list.reduce((a, c) => a + c.tot, 0), ban = new Set((((orig || S?.settings)?.ban || {})[kind] || []).map(banKey));
    const rows = list.map((c) => {
        const parts = [];
        if (kind !== 'gspot')
            parts.push(c.sells ? `${c.sells} işlem · ${c.w || 0} kârlı` : 'ilk işlem');
        else {
            parts.push(c.sells ? `${c.sells} satış` : `${c.buys || 0} alım`);
            if (c.bought)
                parts.push(U(c.bought, 0) + ' alındı');
        }
        const det = c.op != null ? (c.sells ? `açıkta ${sgnU(c.op)}` : (kind === 'gspot' ? 'elde' : 'açık')) : 'kapandı', star = fv.has(banKey(c.inst)) || (c.mint && fv.has(c.mint));
        return `<div class="row">${cico(c.inst)}<div class="mid"><b>${escH(sym(c.inst))}${star ? `<i class="fst" title="Favori: en çok kâr getirenlerden">${ic('i-star')}</i>` : ''}${ban.has(banKey(c.inst)) || (c.mint && ban.has(c.mint)) ? '<em class="lk wn in">KARA LİSTE</em>' : ''}</b><span>${parts.join(' · ')}</span></div>
      <div class="end"><span class="pill lg ${cls(c.tot) || 'z'}"><i>${c.tot >= 0 ? '▲' : '▼'}</i>${U(Math.abs(c.tot), 2)}</span><span class="est">${det}${pTL(c.tot)}</span></div></div>`;
    });
    return `<h2 class="mh">${ic('i-pnl')}${kind === 'meme' ? 'Token' : 'Coin'} bazında kâr/zarar<span class="hsum ${cls(T)}">${sgnU(T)}</span></h2><div class="card list">${dCut(id, rows)}</div>`;
}
function deskTrades(id, trades, kind, empty = '') {
    if (!(trades || []).length)
        return empty ? `<h2 class="mh">${ic('i-list')}Son işlemler<span class="hsum">0 işlem</span></h2><div class="card"><div class="empty">${ic('i-eye')}<div>${empty}</div></div></div>` : '';
    const rows = trades.slice(0, 40).map((t) => {
        const inst = t.inst || `${t.sym}-USDT`, pnl = +t.pnl || 0, buy = t.side === 'AL';
        const what = kind === 'lev' ? `${t.side} kapandı` : buy ? 'alındı' : 'satıldı', why = escH(String(t.reason || ''));
        const end = buy ? `<b>${U(+t.usd || 0, 2)}</b><small class="etl">${usdTL(+t.usd || 0)}</small>`
            : `<span class="pill ${cls(pnl) || 'z'}"><i>${pnl >= 0 ? '▲' : '▼'}</i>${U(Math.abs(pnl), 2)}</span><span class="est ${cls(pnl)}">${t.pct != null ? spc(+t.pct, 1) : ''}${pTL(pnl)}</span>`;
        return `<div class="row${kind === 'meme' ? ' nch' : ''}">${cico(inst, kind === 'lev' ? undefined : (buy ? 'AL' : 'SAT'), !buy && pnl < 0)}<div class="mid"><b>${escH(sym(inst))} ${what}</b><span>${ago(t.ts)}${why ? ' · ' + why : ''}</span></div><div class="end">${end}</div></div>`;
    });
    return `<h2 class="mh">${ic('i-list')}Son işlemler<span class="hsum">${trades.length} işlem</span></h2><div class="card list">${dCut(id, rows)}</div>`;
}
const GMK = { g: { t: 0, l: [] }, sw: { t: 0, l: [] } };
const GSTB = new Set(['USDC', 'DAI', 'FDUSD', 'TUSD', 'PYUSD', 'USDG', 'RLUSD', 'USDE', 'EURT', 'EUR', 'XAUT', 'PAXG', 'BUSD', 'USDP', 'USD1', 'USDQ']);
const GCAT = { g: null, sw: null };
async function gcat(x) {
    if (GCAT[x])
        return GCAT[x];
    const k = 'masal_gcat_' + x;
    try {
        const c = JSON.parse(localStorage.getItem(k) || 'null');
        if (c && Date.now() - c.t < 86400000) {
            GCAT[x] = new Set(c.l);
            return GCAT[x];
        }
    }
    catch (e) { }
    try {
        const j = await tfetch(`https://www.okx.com/api/v5/public/instruments?instType=${x === 'g' ? 'SPOT' : 'SWAP'}`, { cache: 'no-store' }, 12000).then(r => r.json());
        const l = (j?.data || []).filter((i) => (i.instCategory ?? '1') === '1').map((i) => i.instId.split('-')[0]);
        if (l.length) {
            GCAT[x] = new Set(l);
            try {
                localStorage.setItem(k, JSON.stringify({ t: Date.now(), l }));
            }
            catch (e) { }
        }
    }
    catch (e) { }
    return GCAT[x];
}
function deskMarket(x) {
    const M = GMK[x];
    if (Date.now() - M.t > 15000 && !M.busy) {
        M.busy = true;
        gcat(x).then(() => tfetch(`https://www.okx.com/api/v5/market/tickers?instType=${x === 'g' ? 'SPOT' : 'SWAP'}`, { cache: 'no-store' }, 8000).then(r => r.json()).then(j => {
            M.l = (j?.data || []).filter((t) => x === 'g' ? /-USDT$/.test(t.instId) : /-USDT-SWAP$/.test(t.instId)).map((t) => {
                const b = t.instId.split('-')[0], last = +t.last, o = +t.open24h;
                return { inst: b + '-USDT', last, ch: o ? (last / o - 1) * 100 : 0, vol: x === 'g' ? +t.volCcy24h : (+t.volCcy24h || 0) * last };
            }).filter((t) => !GSTB.has(sym(t.inst)) && t.last > 0 && (!GCAT[x] || GCAT[x].has(sym(t.inst)))).sort((a, b) => b.vol - a.vol).slice(0, 60);
            M.t = Date.now();
            M.busy = false;
            renderDeck();
        })).catch(() => { M.busy = false; M.t = Date.now() - 10000; });
    }
    const vt = (v) => v >= 1e9 ? nf(v / 1e9, 1) + ' Mr' : v >= 1e6 ? nf(v / 1e6, 1) + ' Mn' : nf(v / 1e3, 0) + ' B';
    const rows = M.l.map((q) => `<div class="row">${cico(q.inst)}<div class="mid"><b>${sym(q.inst)}</b><span>Hacim ${vt(q.vol)} USDT · 24 sa</span></div>
      <div class="end"><b>${px(q.last)}</b><span class="pill ${cls(q.ch) || 'z'}"><i>${q.ch >= 0 ? '▲' : '▼'}</i>%${nf(Math.abs(q.ch))}</span></div></div>`);
    return `<h2 class="mh">${ic('i-chart')}Piyasa<span class="hsum">OKX Global ${x === 'g' ? 'spot' : 'futures'} · canlı</span></h2><div class="card list mk">${rows.length ? dCut('mk' + x, rows) : `<div class="empty">${ic('i-pnl')}<div>Fiyatlar yükleniyor…</div></div>`}</div><p class="hint" style="margin:6px 2px 0">Grafiği görmek için coine dokun.</p>`;
}
function renderLevR() {
    const R = S?.levr;
    if (!R)
        return S?.live_z && !pw ? `<div class="warn">${ic('i-lock')}<div>Gerçek futures masasını görmek için kilidi aç.</div></div>` : '';
    const usd = (v, d = 2) => U(v, d), esc = escH;
    const pf = (v) => nf(v, v >= 100 ? 2 : v >= 1 ? 4 : Math.min(8, 2 - Math.floor(Math.log10(v || 1))));
    const lv = (orig || S?.settings)?.lev || {}, ml = +lv.max_loss || 10, left = Math.max(0, ml + Math.min(0, R.pnl));
    const pos = (R.positions || []).map((p) => {
        const g = p.margin ? p.pnl / p.margin * 100 : 0, up = p.side === 'UZUN', now = +p.now || +p.entry;
        const k = (v) => Math.max(0, Math.min(100, (v - p.stop) / ((p.tp - p.stop) || 1) * 100)), key = 'lev:' + p.sym, busy = DESK_BUSY[key] && Date.now() - DESK_BUSY[key] < 60000;
        const row = `<div class="row pos swc">${cico(p.sym + '-USDT')}
      <div class="mid"><b><span class="sy">${esc(p.sym)}</span><i class="kd ${up ? 'lu' : 'ls'}">${p.side} ${p.lev || ''}x</i></b><span>Giriş ${pf(p.entry)} → şimdi ${pf(now)}<br>${ago(p.ts)} açıldı · teminat ${usd(p.margin)}</span>
        <div class="rng"><i class="av" style="left:${k(p.entry).toFixed(1)}%"></i><i class="mk ${cls(p.pnl)}" style="left:${k(now).toFixed(1)}%"></i></div>
        <div class="rngl"><em class="dn">Stop ${pf(p.stop)}</em><em class="up">Hedef ${pf(p.tp)}</em></div></div>
      <div class="end"><b>${usd((+p.margin || 0) + (+p.pnl || 0))}</b><small class="etl">${usdTL((+p.margin || 0) + (+p.pnl || 0))}</small>${busy ? `<span class="sellst"><i class="spn"></i>Kapanıyor</span>` : `<span class="pill ${cls(p.pnl) || 'z'}"><i>${p.pnl >= 0 ? '▲' : '▼'}</i>${usd(Math.abs(p.pnl))}</span><span class="est ${cls(p.pnl)}">${spc(g, 1)}${pTL(p.pnl)}</span>`}</div></div>`;
        return `<div class="swr${swOpen === 'f:' + p.sym ? ' open' : ''}${busy ? ' busy' : ''}" data-i="f:${esc(p.sym)}"><button class="swb" type="button" data-desk="lev" data-sym="${esc(p.sym)}">${ic('i-sell')}${busy ? 'Kapanıyor' : 'Kapat'}</button>${row}</div>`;
    }).join('');
    const feed = (R.log || []).filter((l) => l[1] !== 'buy' && l[1] !== 'exit').slice(0, 12).map(([ts, k, t]) => `<div class="fr"><time>${masaClock(ts)}</time><em class="ft ${k === 'buy' ? 'al' : k === 'exit' ? (/\+/.test(t) ? 'sat' : 'zar') : 'not'}">${k === 'buy' ? 'AÇ' : k === 'exit' ? 'KAPAT' : k === 'risk' ? 'ENGEL' : 'BİLGİ'}</em><div>${feedTxt(String(t).replace(/^GERÇEK (?:(?:AÇ|KAPAT|ENGEL) )?/, ''))}</div></div>`).join('');
    const st = R.dead ? `<b class="dn">Durdu: ${esc(R.dead)}. Ayarlar → Futures → Yeniden başlat.</b>` : R.halt ? `<b class="dn">Bugün durduruldu: günlük zarar sınırı.</b>` : !R.on ? '<b>Kapalı.</b> Ayarlar → Futures\'tan açılır.' : '';
    return `<h2 class="mh">${ic('i-layers')}Futures<span class="hsum"><em class="rbadge">GERÇEK</em>OKX Global</span><button class="mset" type="button" data-sett="fut">${ic('i-gear')}Ayarlar</button></h2>
    <div class="card mmeme">
      ${deskHero('Masa', R.equity, `bütçe ${usd(R.funded)} · ${lv.real_lev ?? 2}x izole`, R.pnl, R.funded, left, ml, [['Pozisyon', String((R.positions || []).length)], ['İşlem', String(R.closed ?? (R.trades || []).length)], ['Kazanma', R.win_rate == null ? '—' : '%' + R.win_rate], ...(R.harvest ? [['Fona alınan', usd(R.harvest)]] : [])])}
      <p class="mnote">${ic('i-lock')}Zarar durdur borsada kayıtlı. ${st}</p>
      ${deskReal('levr')}
    </div>
    ${pos ? `<h2 class="mh">${ic('i-coins')}Açık pozisyonlar<span class="hsum ${cls(+R.upl || 0)}">${(R.positions || []).length} pozisyon · ${sgnU(+R.upl || 0)}</span></h2><div class="card list gpos">${pos}</div><p class="hint" style="margin:6px 2px 0">Kapatmak için satırı sola kaydır; grafiği görmek için dokun. Çubuk: soldaki uç stop, sağdaki uç hedef.</p>` : ''}
    ${eqCard(R.equity_series, R.funded)}
    ${deskTrades('ltr', R.trades, 'lev', 'Henüz kapanan gerçek işlem yok; sinyal gelince açılır')}${deskCoins('lco', R.coins, Object.fromEntries((R.positions || []).map((p) => [p.sym + '-USDT', +p.pnl || 0])), 'lev', (R.fav && R.fav.length ? R.fav : S?.lev?.fav) || [])}
    ${feed ? `<h2 class="mh">${ic('i-info')}Bot notları<span class="hsum">engel · bilgi · uyarı</span></h2><div class="card mfeed">${feed}</div>` : ''}${levWatch()}${deskMarket('sw')}`;
}
const banKey = (x) => { x = String(x || '').trim(); return x.length >= 30 ? x : x.replace(/[İıi]/g, 'I').toUpperCase().split(/[-/]/)[0]; };
function levWatch() {
    const L = S?.lev;
    if (!L)
        return '';
    const lv = (orig || S?.settings)?.lev || {};
    const pf = (v) => nf(v, v >= 100 ? 2 : v >= 1 ? 4 : Math.min(8, 2 - Math.floor(Math.log10(v || 1))));
    const pk = (r) => { const v = r.dist || 0; return (r.side === 'UZUN' ? v <= 0 : v >= 0) ? -Math.abs(v) - 1000 : Math.abs(v); };
    const w = (L.watch || []).slice().sort((a, b) => pk(a) - pk(b)).map((r) => {
        const d = Math.abs(r.dist || 0), up = r.side === 'UZUN', past = up ? (r.dist || 0) <= 0 : (r.dist || 0) >= 0, near = Math.max(4, Math.min(100, 100 - d * 12));
        const ps = pf(r.px);
        return `<div class="wr ${up ? 'wu' : 'wd'}" data-lo="${escH(r.sym)}" data-ls="${up ? 1 : -1}" role="button"><div><b>${escH(r.sym)}</b><em>${r.open ? 'AÇIK' : up ? '↑ UZUN' : '↓ KISA'}</em></div><div class="wpx"><span>${ps}</span><small>${pxTL(r.px)}</small></div><div class="wfk"><small class="${past && !r.open ? 'up' : ''}">Fark ${past ? '−' : '+'}%${nf(d, 1)}</small><small>${r.open ? 'pozisyon açık' : past ? 'kırıldı' : 'sinyale'}</small></div><i style="width:${(r.open || past ? 100 : near).toFixed(0)}%"></i></div>`;
    }).join('');
    return `<h2 class="mh">${ic('i-eye')}İzlenen coinler<span class="hsum">sinyale uzaklık · ${lv.fast ? '15 dk' : 'saatlik'}</span></h2>
    <div class="card"><div class="wgrid">${w || `<div class="empty">${ic('i-refresh')}<div>Mumlar yükleniyor</div></div>`}</div>
    <p class="hint">Elle açmak için coine dokun. Çubuk dolu = sinyale yakın. ${lv.fast ? '<b>Al-kaç</b> (15 dk mum). ' : ''}Fiyat son ${lv.brk_h ?? 20} saatin zirvesini aşınca UZUN, dibini kırınca KISA açılır (${lv.trend_on === false ? 'eğilim filtresi kapalı' : `${lv.fast ? Math.min(70, lv.trend_h ?? 200) : lv.trend_h ?? 200} saatlik ortalamanın yönünde`}).</p></div>
`;
}
function openLevOpen(sym, side0) {
    const L = S?.lev, R = S?.levr, lv = (orig || S?.settings)?.lev || {}, r = (L?.watch || []).find((w) => w.sym === sym);
    if (!r)
        return;
    if (r.open) {
        toast(`${sym} zaten açık; kapatmak için Pozisyonlar'daki Kapat'ı kullan`);
        return;
    }
    let side = side0;
    const real = !!(R && +R.funded > 0 && lv.real !== false), lev = +(real ? (lv.real_lev ?? 2) : lv.lev) || 3, eq = real ? (+R.equity || +R.funded || 0) : (+L?.equity || +L?.bank || 0), risk = +lv.risk_pct || 1;
    const q = document.getElementById('qsh');
    q.dataset.n = '';
    qHead('i-layers', 'Vazgeç');
    document.getElementById('qTitle').textContent = `${sym} · futures`;
    const draw = () => {
        const up = side > 0, against = r.up != null && r.up !== up;
        const atr = +r.atr || 0, dist = (+lv.sl_atr || 2) * atr, tpd = (+lv.tp_atr || 4) * atr, qty = atr ? Math.min(eq * risk / 100 / dist, eq / 3 * lev / r.px) : 0, nt = qty * r.px, mg = nt / lev;
        const calc = atr && nt ? `<div class="pavg"><div><span>Teminat</span><b>${U(mg, 2)}</b></div><div><span>İşlem büyüklüğü</span><b>${U(nt, 2)}</b></div><div><span>Kaldıraç</span><b>${lev}x</b></div></div>
      ${pnlCalc({ u: 'USDT', now: 0, size: nt, side, ref: mg, min: -15, max: 15, what: 'Fiyat', marks: [['Kâr al', side * tpd / r.px * 100, tpd * qty], ['Zarar durdur', -side * dist / r.px * 100, -dist * qty]] })}` : '';
        document.getElementById('qText').innerHTML = `<div class="xfs">
      <div class="seg lseg"><button type="button" data-sd="1" class="${up ? 'on up' : ''}">${ic('i-buy')}<b>UZUN</b><small>yükselişe</small></button><button type="button" data-sd="-1" class="${!up ? 'on dn' : ''}">${ic('i-sell')}<b>KISA</b><small>düşüşe</small></button></div>
      ${against ? `<div class="warn">${ic('i-info')}<div>Kısa vadeli eğilim (20/50 ortalaması) şu an <b>${r.up ? 'yukarı' : 'aşağı'}</b>. Ters yönde açarsan eğilim 2 saat böyle kalırsa bot “eğilim döndü” kuralıyla kapatır.</div></div>` : ''}
      <div class="xinfo">
        <div>${ic('i-chart')}<span>Fiyat</span><b>${nf(r.px, r.px >= 100 ? 2 : 4)} USDT</b></div>
        <div>${ic('i-layers')}<span>Kaldıraç</span><b>${lev}x · ${real ? 'gerçek masa' : 'deneme masası'}</b></div>
        <div>${ic('i-shield')}<span>Risk</span><b>en fazla %${nf(risk, 1)} · ≈ ${U(eq * risk / 100, 2)}</b></div>
        <div>${ic('i-stop')}<span>Zarar durdur</span><b>${nf(+lv.sl_atr || 2, 1)} ATR geride (borsada kurulur)</b></div>
        <div>${ic('i-target')}<span>Kâr al</span><b>${nf(+lv.tp_atr || 4, 1)} ATR ileride</b></div>
      </div>
      ${calc}
      <p class="hint">Açtıktan sonra bot kendi kuralıyla yönetir: kâr al, zarar durdur, iz süren stop; eğilim 2 saat ters kalırsa kapatır. İstersen Pozisyonlar'dan elle kapatırsın.</p>
      <button class="btn primary xgo lgo ${up ? 'up' : 'dn'}" id="loGo">${ic(up ? 'i-buy' : 'i-sell')}${up ? 'UZUN' : 'KISA'} aç</button></div>`;
        pcInit();
        document.querySelectorAll('[data-sd]').forEach(b => b.onclick = () => { side = +b.dataset.sd; draw(); });
        const go = document.getElementById('loGo');
        go.onclick = async () => {
            if (!token) {
                toast('Önce Ayarlar\'dan GitHub bağlantısını kur');
                return;
            }
            go.disabled = true;
            fastWatch();
            const req = { id: 'o' + Date.now().toString(36), ts: Date.now(), desk: 'lev', act: 'open', sym, side };
            const ok = await cloudPatch(o => { o.desk_cmd = [...(o.desk_cmd || []).filter((x) => Date.now() - (x.ts || 0) < 600000), req]; }, 'Futures elle aç: ' + sym + ' ' + (side > 0 ? 'UZUN' : 'KISA'));
            if (ok) {
                q.hidden = true;
                toast(`${sym} ${side > 0 ? 'UZUN' : 'KISA'} açma isteği gönderildi; bot birkaç saniyede açar`);
            }
            else {
                go.disabled = false;
                toast('İstek gönderilemedi, tekrar dene', patchWhy());
            }
        };
    };
    draw();
    q.hidden = false;
}
document.addEventListener('click', e => {
    const t = e.target.closest?.('[data-lo]');
    if (!t)
        return;
    const sy = t.dataset.lo, sd = +t.dataset.ls;
    const r = ((S?.lev?.watch) || []).find((w) => w.sym === sy);
    if (r?.open) {
        openLevOpen(sy, sd);
        return;
    }
    openCoin(sy + '-USDT', 'sw', [], r ? [['Sinyal', `${r.side === 'UZUN' ? '↑ UZUN' : '↓ KISA'} · sinyale %${nf(Math.abs(r.dist || 0), 1)}`]] : undefined, ['Elle aç', () => openLevOpen(sy, sd)]);
});
function openGBuy(inst0) {
    const gs = (orig || S?.settings)?.gspot || {}, P = S?.gspot, RR = S?.gspotr;
    const real = !!(RR && gs.real), G = real ? RR : P, desk = real ? 'gspotr' : 'gspot';
    if (!G) {
        toast('Global masası henüz hazır değil');
        return;
    }
    if (gs.on === false) {
        toast('Global masası kapalı; Ayarlar → Global\'den aç');
        return;
    }
    let inst = inst0 || '', amt = 0;
    const q = document.getElementById('qsh');
    q.dataset.n = '';
    qHead('i-globe', 'Vazgeç');
    const base = +G.start || 0, used = (G.positions || []).reduce((a, p) => a + (+p.cost || 0), 0);
    const free = Math.max(0, Math.min(+G.cash || 0, (+(gs.use_pct ?? 90)) / 100 * base - used));
    const draw = () => {
        const sy = inst.replace(/-USDT$/, ''), p = (G.positions || []).find((x) => x.inst === inst), n = p ? +p.lots || 0 : 0;
        const l1 = base * (+(gs.lot_pct ?? 12)) / 100, nxt = n <= 0 ? l1 : l1 * (+(n === 1 ? (gs.lot2_pct ?? 70) : (gs.lot3_pct ?? 100))) / 100;
        if (!amt)
            amt = Math.round(Math.min(nxt, free) * 100) / 100;
        const w = (P?.watch || []).find((x) => x.i === inst), banned = !!sy && ((((orig || S?.settings)?.ban || {}).gspot) || []).map((x) => String(x).toUpperCase()).includes(sy.toUpperCase());
        const full = !p && (G.positions || []).length >= +(gs.max_coins ?? 5), maxl = n >= +(gs.max_lots ?? 5);
        const why = !sy ? '' : banned ? 'Bu coin Global kara listesinde.' : w?.fs ? 'Futures masası bu coinde KISA; ters pozisyon açılmaz.' : full ? `En çok ${gs.max_coins ?? 5} coin tutulur; önce birini sat.` : maxl ? `Bu coinde en çok ${gs.max_lots ?? 5} kademe alınır.` : free < 5 ? 'Kullanılabilir para 5 USDT\'nin altında.' : '';
        document.getElementById('qTitle').textContent = sy ? `${sy} · Global elle al` : 'Global elle al';
        document.getElementById('qText').innerHTML = `<div class="xfs">
      <label class="gbin">${ic('i-coins')}<input id="gbSym" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="Coin (ör. BTC)" value="${escH(sy)}"><span>/USDT</span></label>
      <div class="xinfo">
        ${w ? `<div>${ic('i-chart')}<span>Fiyat</span><b>${nf(w.p, w.p >= 100 ? 2 : w.p >= 1 ? 4 : 6)} USDT</b></div>` : ''}
        <div>${ic('i-layers')}<span>Kademe</span><b>${n + 1}. kademe${p ? ` · elde ${U(+p.val || 0, 2)}` : ''}</b></div>
        <div>${ic('i-wallet')}<span>Kullanılabilir</span><b>${U(free, 2)}${usdTL(free) ? ` · ${usdTL(free)}` : ''}</b></div>
        <div>${ic('i-target')}<span>Kâr al</span><b>alışın %${nf(+(gs.lot_tp_pct ?? 3.5), 1)} üstünde</b></div>
      </div>
      <div class="xq gbq">${[[nxt, 'Kademe'], [10, ''], [20, ''], [free, 'Hepsi']].map(([v, t]) => { const x = Math.round(Math.min(+v, free) * 100) / 100; return `<button type="button" data-ga="${x}"${Math.abs(x - amt) < 0.005 ? ' class="on"' : ''}${x < 5 ? ' disabled' : ''}>${t || nf(x, 0)}<small>${t ? nf(x, 2) : usdTL(x)}</small></button>`; }).join('')}</div>
      <div class="gbam"><span>Tutar</span><b>${U(amt, 2)}</b><small>${usdTL(amt)}</small></div>
      ${why ? `<div class="warn">${ic('i-info')}<div>${why}</div></div>` : ''}
      <p class="hint">${real ? 'Gerçek parayla' : 'Deneme masasında'} piyasa fiyatından alınır. Sonrasını bot kendi kademe kuralıyla yönetir; istersen satırı sola kaydırıp satarsın.</p>
      <button class="btn primary xgo" id="gbGo"${!sy || why || amt < 5 ? ' disabled' : ''}>${ic('i-buy')}${sy ? `${escH(sy)} al · ${U(amt, 2)}` : 'Coin seç'}</button></div>`;
        const inp = document.getElementById('gbSym');
        inp.onchange = () => { const v = inp.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); inst = v ? v + '-USDT' : ''; amt = 0; draw(); };
        document.querySelectorAll('[data-ga]').forEach(b => b.onclick = () => { amt = +b.dataset.ga; draw(); });
        const go = document.getElementById('gbGo');
        go.onclick = async () => {
            if (!token) {
                toast('Önce Ayarlar\'dan GitHub bağlantısını kur');
                return;
            }
            go.disabled = true;
            fastWatch();
            const req = { id: 'b' + Date.now().toString(36), ts: Date.now(), desk, act: 'buy', sym: inst, amt };
            const ok = await cloudPatch(o => { o.desk_cmd = [...(o.desk_cmd || []).filter((x) => Date.now() - (x.ts || 0) < 600000), req]; }, 'Global elle al: ' + sy + ' ' + amt);
            if (ok) {
                q.hidden = true;
                toast(`${sy} alım isteği gönderildi; bot birkaç saniyede alır`);
            }
            else {
                go.disabled = false;
                toast('İstek gönderilemedi, tekrar dene', patchWhy());
            }
        };
    };
    draw();
    q.hidden = false;
}
document.addEventListener('click', e => {
    const t = e.target.closest?.('[data-gb]');
    if (!t)
        return;
    const i = t.dataset.gb;
    if (!i || !t.classList.contains('wr')) {
        openGBuy(i);
        return;
    }
    const w = ((S?.gspot?.watch) || []).find((x) => x.i === i), tg = w && w.g != null ? w.p / (1 + w.g / 100) : 0;
    openCoin(i, 'g', tg ? [[tg, 'Alım seviyesi', '#3B6FD8']] : [], w ? [['Durum', w.fs ? 'Futures kısa · alınmaz' : w.f ? 'Filtrede · bekliyor' : w.g <= 0 ? 'Alım seviyesinde' : 'Alım seviyesine %' + nf(w.g, 1)]] : undefined, ['Elle al', () => openGBuy(i)]);
});
const gReal = (G) => (+G?.phys || 0) + (+G?.fund_res || 0) + (G?.positions || []).reduce((a, p) => a + (+p.val || 0), 0);
const sgnU = (v) => (v < 0 ? '−' : '+') + U(Math.abs(v), 2);
function renderGspot() {
    const gs = (orig || S?.settings)?.gspot || {}, P = S?.gspot, RR = S?.gspotr;
    const real = !!(RR && (gs.real || (RR.positions || []).length)), G = real ? RR : P, desk = real ? 'gspotr' : 'gspot';
    if (gs.on === false && !real)
        return `<h2 class="mh">${ic('i-globe')}Global spot<span class="hsum">kapalı</span><button class="mset" type="button" data-sett="gspot">${ic('i-gear')}Ayarlar</button></h2>
    <div class="card moff"><span class="moi">${ic('i-globe')}</span><b>Global spot masası kapalı</b><p>Ayarlar → Global'den açılır.</p></div>`;
    if (!G)
        return gs.real && !RR && S?.live_z && !pw ? `<div class="warn">${ic('i-lock')}<div>Gerçek Global masasını görmek için kilidi aç.</div></div>`
            : `<div class="empty">${ic('i-globe')}<div>Global spot masası hazırlanıyor; ilk veriler birkaç dakika içinde gelir</div></div>`;
    const usd = (v, d = 2) => U(v, d), esc = escH, tp = +(gs.lot_tp_pct ?? 3.5);
    const pf = (v) => nf(v, v >= 100 ? 2 : v >= 1 ? 4 : Math.min(8, 2 - Math.floor(Math.log10(v || 1))));
    const ml = real ? +(gs.max_loss ?? 15) : 0, left = real ? Math.max(0, ml + Math.min(0, G.pnl)) : 0;
    const tpP = tp / 100, slP = +(gs.stop_pct ?? 50) / 100;
    const pos = (G.positions || []).map((p) => {
        const g = p.cost ? p.pnl / p.cost * 100 : 0, sl = p.avg * (1 - slP), tpx = p.avg * (1 + tpP);
        const k = (v) => Math.max(0, Math.min(100, (v - sl) / (tpx - sl) * 100)), busy = p.pending || (DESK_BUSY[desk + ':' + p.inst] && Date.now() - DESK_BUSY[desk + ':' + p.inst] < 60000);
        const row = `<div class="row pos swc">${cico(p.inst)}
      <div class="mid"><b><span class="sy">${esc(p.sym)}</span>${pq(p.inst)}${p.lots > 1 ? `<i class="kd">${p.lots} kademe</i>` : ''}</b><span>Alış ${pf(p.avg)} → şimdi ${pf(p.px)}<br>${ago(p.ts)} alındı · maliyet ${usd(p.cost)}</span>
        <div class="rng"><i class="av" style="left:${k(p.avg).toFixed(1)}%"></i><i class="mk ${cls(p.pnl)}" style="left:${k(p.px).toFixed(1)}%"></i></div>
        <div class="rngl"><em class="dn">Zarar sınırı ${pf(sl)}</em><em class="up">Kâr al ${pf(tpx)}</em></div></div>
      <div class="end"><b>${usd(p.val)}</b><small class="etl">${usdTL(p.val)}</small>${busy ? `<span class="sellst"><i class="spn"></i>Satılıyor</span>` : `<span class="pill ${cls(p.pnl) || 'z'}"><i>${p.pnl >= 0 ? '▲' : '▼'}</i>${usd(Math.abs(p.pnl))}</span><span class="est ${cls(p.pnl)}">${spc(g, 1)}${pTL(p.pnl)}</span>`}</div></div>`;
        return `<div class="swr${swOpen === 'g:' + p.inst ? ' open' : ''}${busy ? ' busy' : ''}" data-i="g:${esc(p.inst)}"><button class="swb" type="button" data-desk="${desk}" data-sym="${esc(p.inst)}">${ic('i-sell')}${busy ? 'Satılıyor' : 'Sat'}</button>${row}</div>`;
    }).join('');
    const feed = (G.log || []).filter((l) => l[1] !== 'buy' && l[1] !== 'exit').slice(0, 12).map(([ts, k, t]) => `<div class="fr"><time>${masaClock(ts)}</time><em class="ft ${k === 'buy' ? 'al' : k === 'exit' ? (/\+/.test(t) ? 'sat' : 'zar') : /^HATA/.test(t) ? 'err' : 'not'}">${k === 'buy' ? 'AL' : k === 'exit' ? 'SAT' : k === 'risk' ? (/^HATA/.test(t) ? 'HATA' : 'ENGEL') : 'BİLGİ'}</em><div>${feedTxt(String(t).replace(/^(?:AL|SAT|HATA|ENGEL:?|DUR:) ?/, ''))}</div></div>`).join('');
    const full = (G.positions || []).length >= +(gs.max_coins ?? 5);
    const W = (P?.watch || []).slice().sort((a, b) => ((a.f || a.fs) ? 1 : 0) - ((b.f || b.fs) ? 1 : 0) || a.g - b.g).slice(0, 8).map((w) => {
        const d = w.g, ok = d <= 0 && !w.f && !w.fs && (w.h || !full), near = Math.max(4, Math.min(100, 100 - Math.max(0, d) * 12));
        return `<div class="wr ${ok ? 'wu' : 'wd'}" data-gb="${esc(w.i)}" role="button"><div><b>${esc(sym(w.i))}</b><em>${w.fs ? 'FUTURES KISA' : w.f ? 'FİLTRE' : ok ? 'ŞART TAMAM' : d <= 0 && full && !w.h ? 'COİN SINIRI' : w.h ? (w.h + 1) + '. KDM' : 'ADAY'}</em></div><div class="wpx"><span>${pf(w.p)}</span><small>${pxTL(w.p)}</small></div><div class="wfk"><small class="${d <= 0 ? 'up' : ''}">Fark ${d <= 0 ? '−' : '+'}%${nf(Math.abs(d), 1)}</small><small>${d <= 0 ? 'hedefin altında' : 'hedefe'}</small></div><i style="width:${(ok ? 100 : near).toFixed(0)}%"></i></div>`;
    }).join('');
    const warm = P && P.uni && P.warm < P.uni ? `<p class="hint">Mumlar yükleniyor: ${P.warm}/${P.uni} coin hazır. Bir coin, 60 saatlik verisi tamamlanınca alınabilir.</p>` : '';
    const empty = real && gReal(G) < 0.5;
    const ready = Math.min(+G.fund_res || 0, G.start);
    const st = real ? (empty ? `<b class="dn">Henüz para yok.</b> Global fon hesabına USDT gelince ilk alımda en fazla ${usd(G.start)} işlem hesabına geçer (Kasalar'dan Global'e gönder).` : !(G.positions || []).length && !(+G.phys > 0.5) && (+G.fund_res || 0) > 0.5 ? `<b>Alım bekleniyor.</b> Fon hesabında ${usd(ready)} bu masaya ayrıldı; ilk alımda işlem hesabına geçer. Elle aktarımlar ve diğer masalar bu paraya dokunmaz.` : G.halt ? `<b class="dn">Yeni alım durdu: ${esc(G.halt)}.</b>` : !gs.real ? '<b>Gerçek mod kapalı:</b> yeni alım yok, eldeki coinler kurallarıyla satılır.' : 'Para Global fon hesabından alım anında işlem hesabına geçer; futures masasının parasına dokunulmaz.')
        : 'Deneme: gerçek fiyatlarla sanal para. Gerçek işlem için Ayarlar → Global → Gerçek parayla işlem.';
    return `<h2 class="mh">${ic('i-globe')}Global<span class="hsum">${real ? '<em class="rbadge">GERÇEK</em>' : '<em class="rbadge pp">DENEME</em>'}OKX Global</span><button class="mset" type="button" data-sett="gspot">${ic('i-gear')}Ayarlar</button></h2>
    <div class="card mmeme">
      ${((h) => real && !empty ? h : h.replace(/<div class="drisk">[\s\S]*?<\/div><\/div>\s*/, ''))(deskHero(real ? 'Masada gerçek para' : 'Deneme kasası', real ? gReal(G) : G.equity, real ? `bütçe ${usd(G.start)} · coin ${usd((G.positions || []).reduce((a, p) => a + (+p.val || 0), 0))} · USDT ${usd((+G.phys || 0) + (+G.fund_res || 0))}` : `boşta ${usd(G.cash)} · başlangıç ${usd(G.start)}`, G.pnl, G.start, left, ml, [['Coin', String((G.positions || []).length)], ['Satış', String(G.sells || 0)], ['Kazanma', G.win_rate == null ? '—' : '%' + G.win_rate], ['Kâr', '%' + nf(tp, 1)]]))}
      <p class="mnote">${ic(real ? 'i-lock' : 'i-flask')}${st}${G.err ? ` <b class="dn">Uyarı: ${esc(G.err).slice(0, 90)}</b>` : ''}</p>
      ${real ? deskReal('gspotr') : ''}
    </div>
    ${pos ? `<h2 class="mh">${ic('i-coins')}Eldeki coinler<span class="hsum ${cls((G.positions || []).reduce((a, p) => a + (+p.pnl || 0), 0))}">${(G.positions || []).length} coin · ${sgnU((G.positions || []).reduce((a, p) => a + (+p.pnl || 0), 0))}</span></h2><div class="card list gpos">${pos}</div><p class="hint" style="margin:6px 2px 0">Satmak için satırı sola kaydır. Her kademe alışının %${nf(tp, 1)} üstünde satılır; çubuk ortalamaya göre. Grafiği görmek için dokun.</p>` : ''}
    ${eqCard(G.equity_series, G.start)}
    ${deskTrades('gtr', G.trades, 'gspot', 'Henüz işlem yok; fiyat alım hedefine inince alır')}${deskCoins('gco', G.coins, Object.fromEntries((G.positions || []).map((p) => [p.inst, +p.pnl || 0])), 'gspot', (real && G.fav && G.fav.length ? G.fav : P?.fav) || [])}
    ${feed ? `<h2 class="mh">${ic('i-info')}Bot notları<span class="hsum">${real ? 'gerçek masa' : 'deneme masası'} · engel · bilgi</span></h2><div class="card mfeed">${feed}</div>` : ''}
    <h2 class="mh">${ic('i-eye')}Alım adayları<span class="hsum">${P?.uni || 0} coin · 15 dk</span><button class="mset" type="button" data-gb="">${ic('i-buy')}Elle al</button></h2>
    <div class="card"><div class="wgrid">${W || `<div class="empty">${ic('i-refresh')}<div>Mumlar yükleniyor</div></div>`}</div>
    <p class="hint">Hacmi en yüksek ${gs.coins ?? 30} USDT paritesi izlenir. Fiyat son ${gs.sma_hours ?? 72} saatin ortalamasının %${nf(+(gs.step_pct ?? 3.3), 1)} altına inince 1. kademe alınır; her kademe alışının %${nf(tp, 1)} üstünde satılır. Çubuk dolu = hedefe yakın. Grafik ve elle alım için coine dokun.</p>${warm}</div>${deskMarket('g')}`;
}
const DESK_BUSY = {};
function deskBtn(desk, sym, label) {
    const k = desk + ':' + sym, busy = DESK_BUSY[k] && Date.now() - DESK_BUSY[k] < 60000;
    return `<button class="dbtn${busy ? ' busy' : ''}" type="button" data-desk="${desk}" data-sym="${sym}" ${busy ? 'disabled' : ''}>${busy ? 'Gönderildi…' : label}</button>`;
}
document.addEventListener('click', async (e) => {
    const b = e.target.closest?.('[data-desk]');
    if (!b)
        return;
    if (!token) {
        toast('Önce Ayarlar\'dan GitHub bağlantısını kur');
        return;
    }
    const desk = b.dataset.desk, sym = b.dataset.sym, lbl = b.textContent;
    DESK_BUSY[desk + ':' + sym] = Date.now();
    b.disabled = true;
    if (b.classList.contains('swb'))
        b.innerHTML = '<i class="spn"></i>Gönderildi';
    else
        b.textContent = 'Gönderildi…';
    const req = { id: 'c' + Date.now().toString(36), ts: Date.now(), desk, act: desk === 'lev' ? 'close' : 'sell', sym };
    const ok = await cloudPatch(o => { o.desk_cmd = [...(o.desk_cmd || []).filter((r) => r.id !== req.id && Date.now() - (r.ts || 0) < 600000), req]; }, 'Masa komutu: ' + desk + ' ' + sym);
    toast(ok ? 'İstek gönderildi; bot birkaç saniyede piyasa fiyatından kapatır' : 'İstek gönderilemedi, tekrar dene', ok ? '' : patchWhy());
    if (!ok) {
        delete DESK_BUSY[desk + ':' + sym];
        b.disabled = false;
        b.textContent = lbl;
        renderDeck();
    }
});
function openMemeCalc(mint) {
    const p = (S?.memer?.positions || []).find((x) => x.mint === mint);
    if (!p)
        return;
    const m = (orig || S?.settings)?.meme || {}, tp = +m.tp_pct || 30, sl = +m.sl_pct || 15, part = (+m.tp_part || 100) / 100, cost = +p.cost || 0, val = +p.val || 0, g = cost ? val / cost - 1 : 0;
    const q = document.getElementById('qsh');
    q.dataset.n = '';
    qHead('i-flask', 'Kapat');
    document.getElementById('qTitle').textContent = `${p.sym} · memecoin`;
    const toEntry = (x) => ((1 + x / 100) / (1 + g) - 1) * 100;
    document.getElementById('qText').innerHTML = `<div class="xfs">
    <div class="pavg"><div><span>Yatırılan</span><b>${U(cost, 2)}</b></div><div><span>Şimdi</span><b>${U(val, 2)}</b></div><div><span>Durum</span><b class="${cls(g)}">${spc(g * 100, 1)}</b></div></div>
    ${pnlCalc({ u: 'USDT', now: val - cost, size: val, side: 1, ref: cost, min: -60, max: 300, what: 'Token şimdiden',
        marks: [[part < 1 ? `Kâr al (%${nf(part * 100, 0)}'i satılır)` : 'Kâr al', toEntry(tp), cost * tp / 100 * (p.part ? 1 : part)], ['Zarar kes', toEntry(-sl), -cost * sl / 100]] })}
    <p class="hint">Bot yönetir: girişe göre %${nf(tp, 0)} kârda ${part < 1 ? `%${nf(part * 100, 0)}'ini satar, kalanı iz süren stopla taşır` : 'satar'}; %${nf(+m.trail_from || 15, 0)} kârdan sonra zirveden %${nf(+m.trail_pct || 12, 0)} geri çekilirse satar; %${nf(sl, 0)} zararda keser.</p></div>`;
    pcInit();
    q.hidden = false;
}
document.addEventListener('click', e => { const t = e.target; if (t.closest?.('[data-desk]'))
    return; const r = t.closest?.('[data-mc]'); if (r)
    openMemeCalc(r.dataset.mc); });
function memeScan() {
    const M = S?.meme;
    if (!M)
        return '';
    const st = M.stats || {};
    const lg = (M.log || []).slice(0, 10).map(([ts, k, t]) => `<div class="fr"><time>${masaClock(ts)}</time><em class="ft ${k === 'buy' ? 'al' : k === 'exit' ? (/\+/.test(t) ? 'sat' : 'zar') : 'not'}">${k === 'buy' ? 'SİNYAL' : k === 'exit' ? 'ÇIKIŞ' : 'ENGEL'}</em><div>${feedTxt(String(t).replace(/^(AL|SAT|ENGEL) /, ''))}</div></div>`).join('');
    return `<h2 class="mh">${ic('i-eye')}Tarama<span class="hsum">10 sn'de bir · Solana</span></h2>
    <div class="card"><div class="funnel">${[['i-eye', 'Taranan', st.scanned || 0, 'f1'], ['i-shield', 'Engellenen', st.blocked || 0, 'f2'], ['i-flag', 'Sinyal', st.entered || 0, 'f3']]
        .map(([i, n, v, c]) => `<div class="${c}">${ic(i)}<b>${nf(v, 0)}</b><span>${n}</span><i style="width:${Math.max(6, Math.min(100, Math.log10(v + 1) / Math.log10((st.scanned || 0) + 1 || 10) * 100)).toFixed(0)}%"></i></div>`).join('')}</div>
    ${lg ? `<div class="mfeed">${lg}</div>` : ''}</div>`;
}
async function memeToggle(on) {
    const ok = await cloudPatch(o => { const m = o.meme = o.meme || {}; m.on = on; if (!on)
        m.real = false; }, on ? 'Memecoin masası açıldı' : 'Memecoin masası kapatıldı');
    if (ok) {
        const m = ((S?.settings).meme = (S?.settings).meme || {});
        m.on = on;
        if (!on)
            m.real = false;
        for (const o of [orig, draft])
            if (o) {
                const mo = (o.meme = o.meme || {});
                mo.on = on;
                if (!on)
                    mo.real = false;
            }
        toast(on ? 'Memecoin masası açıldı' : 'Memecoin masası kapatıldı');
        renderDeck();
    }
    else
        toast('Kaydedilemedi, tekrar dene');
}
document.addEventListener('click', e => { const b = e.target.closest?.('[data-memeon]'); if (!b)
    return; memeToggle(b.dataset.memeon === '1'); });
function memeOff() {
    const R = S?.memer;
    return `<h2 class="mh">${ic('i-flask')}Memecoin<span class="hsum">kapalı</span><button class="mset" type="button" data-sett="meme">${ic('i-gear')}Ayarlar</button></h2>
    <div class="card moff"><span class="moi">${ic('i-flask')}</span><b>Memecoin masası kapalı</b>
      <p>Token taranmıyor, alım-satım yapılmıyor.${R?.addr ? ` MEME cüzdanında ${U(+R.value || 0, 2)} var.` : ''} Açınca önce deneme olarak tarar; gerçek parayla işlem için Ayarlar → Memecoin → "Gerçek parayla işlem" açılır ve MEME'ye SOL gönderilir.</p>
      <button class="btn primary" type="button" data-memeon="1">${ic('i-power')}Masayı aç</button></div>`;
}
function renderMemeR() {
    if (((orig || S?.settings)?.meme || {}).on === false)
        return memeOff();
    const R = S?.memer;
    if (!R)
        return S?.live_z && !pw ? `<div class="warn">${ic('i-lock')}<div>Gerçek memecoin masasını görmek için kilidi aç.</div></div>` : '';
    const usd = (v, d = 2) => U(v, d), esc = escH;
    const mm = (orig || S?.settings)?.meme || {}, ml = +mm.max_loss || 10, left = Math.max(0, ml + Math.min(0, R.pnl));
    const pos = (R.positions || []).map((p) => {
        const g = p.cost ? (p.val / p.cost - 1) * 100 : 0;
        return `<div class="fr mpc" data-mc="${esc(p.mint)}" role="button"><time>${masaClock(p.ts)}</time><em class="ft al">${p.part ? 'KALAN' : 'AÇIK'}</em><div><span class="fh"><b>${esc(p.sym)}</b> ${usd(p.val)} <span class="${cls(g) || 'up'}">${spc(g, 1)}</span></span><small>≈ ${usdTL(p.val)} · giriş ${usd(p.cost)} · ${esc(p.why)}</small></div>${deskBtn('meme', p.mint, 'Sat')}</div>`;
    }).join('');
    const feed = (R.log || []).filter((l) => l[1] !== 'buy' && l[1] !== 'exit').slice(0, 12).map(([ts, k, t]) => `<div class="fr"><time>${masaClock(ts)}</time><em class="ft ${k === 'buy' ? 'al' : k === 'exit' ? (/\+/.test(t) ? 'sat' : 'zar') : 'not'}">${k === 'buy' ? 'AL' : k === 'exit' ? 'SAT' : k === 'risk' ? 'ENGEL' : 'BİLGİ'}</em><div>${feedTxt(String(t).replace(/^GERÇEK (?:(?:AL|SAT|ENGEL) )?/, ''))}</div></div>`).join('');
    const st = R.dead ? `<b class="dn">Durdu: ${esc(R.dead)}. Ayarlar → Memecoin → Yeniden başlat.</b>` : !R.on ? '<b>Kapalı.</b> Ayarlar → Memecoin\'den açılır.' : '';
    return `<h2 class="mh">${ic('i-flask')}Memecoin<span class="hsum">${mm.real ? '<em class="rbadge">GERÇEK</em>' : '<em class="rbadge pp">DENEME</em>'}</span><button class="mset ico" type="button" data-memeon="0" aria-label="Masayı kapat">${ic('i-power')}</button><button class="mset" type="button" data-sett="meme">${ic('i-gear')}Ayarlar</button></h2>
    <div class="card mmeme">
      ${deskHero('Cüzdan', R.value, `${nf(R.sol, 4)} SOL · başlangıç ${usd(R.start || 0)}`, R.pnl, R.start, left, ml, [['Pozisyon', String((R.positions || []).length)], ['Hedef', mm.tp_pct ? '%' + nf(+mm.tp_pct, 0) : '—'], ['Stop', mm.sl_pct ? '%' + nf(+mm.sl_pct, 0) : '—'], ['Fiyat etkisi', '≤%' + nf(+mm.max_slip || 2, 1)]])}
      <p class="mnote">${ic('i-lock')}Jupiter ile alım-satım · KASA'ya dokunulmaz. ${st}${R.err ? ` <b class="dn">Uyarı: ${esc(R.err).slice(0, 110)}</b>` : ''}</p>
      ${mm.real ? deskReal('memer') : ''}
    </div>
    ${pos ? `<h2 class="mh">${ic('i-coins')}Açık tokenler<span class="hsum">${(R.positions || []).length} token</span></h2><div class="card mfeed">${pos}</div>` : ''}
    ${eqCard(R.equity_series, R.start)}
    ${deskTrades('mtr', R.trades, 'meme', R.sol > 0 ? 'Henüz gerçek işlem yok; şartı tutan token bekleniyor' : 'MEME cüzdanına SOL gönderilince başlar')}${deskCoins('mco', R.coins, Object.fromEntries((R.positions || []).map((p) => [p.sym, (+p.val || 0) - (+p.cost || 0)])), 'meme', (R.fav && R.fav.length ? R.fav : S?.meme?.fav) || [])}
    ${feed ? `<h2 class="mh">${ic('i-info')}Bot notları<span class="hsum">${mm.real ? 'gerçek masa' : 'gerçek mod kapalı'} · engel · bilgi</span></h2><div class="card mfeed">${feed}</div>` : ''}${memeScan()}`;
}
document.getElementById('masaBtn').onclick = () => showMasa(true);
document.getElementById('closeMasa').onclick = () => showMasa(false);
let syncOk = 0, syncBad = false;
function syncMark(ok) { if (ok) {
    syncOk = Date.now();
    syncBad = false;
}
else
    syncBad = true; cloudUI(); }
function cloudUI() {
    const b = document.getElementById('reload');
    if (!b)
        return;
    const off = syncBad || !syncOk || Date.now() - syncOk > 90000;
    b.classList.toggle('cok', !off);
    b.classList.toggle('coff', off);
    b.querySelector('use').setAttribute('href', off ? '#i-cloud-off' : '#i-cloud');
    b.setAttribute('aria-label', off ? 'Bulut: bağlantı yok' : 'Bulut: eşitlendi');
}
setInterval(cloudUI, 5000);
function openCloud() {
    const q = document.getElementById('qsh');
    q.dataset.n = '';
    qHead('i-cloud', 'Kapat');
    const off = syncBad || !syncOk || Date.now() - syncOk > 90000, p = (n) => String(n).padStart(2, '0');
    const tm = (t) => { if (!t)
        return '—'; const d = new Date(t); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
    document.getElementById('qTitle').textContent = 'Bulut eşitleme';
    document.getElementById('qText').innerHTML = `<div class="cld ${off ? 'off' : 'ok'}">${ic(off ? 'i-cloud-off' : 'i-cloud')}<b>${off ? 'Bağlantı yok, son veri gösteriliyor' : 'Eşitlendi'}</b></div>
    <div class="kvl"><span>Son eşitleme</span><b>${tm(syncOk)}</b></div>
    <div class="kvl"><span>Botun son kaydı</span><b>${tm(S?.updated || 0)}</b></div>
    <div class="kvl"><span>Otomatik eşitleme</span><b class="up">Her zaman açık · ${token ? 2 : 15} sn</b></div>
    ${S?.perf?.turn ? `<div class="kvl"><span>Botun tur süresi</span><b>${nf(S.perf.turn, 1)} sn</b></div>` : ''}
    <p class="cldn">Bot her işlemde ve en geç 10 saniyede bir bütün kayıtları buluta (GitHub) yedekler. Uygulama buluta sürekli bakar, değişiklik olunca hemen yeniler; fiyatlar 2 saniyede bir borsadan canlı gelir. Ayarlar <b>Kaydet</b>'e basınca buluta yazılır.</p>
    <button class="btn" id="syncNow" style="width:100%;margin-bottom:10px">${ic('i-refresh')}Şimdi eşitle</button>`;
    q.hidden = false;
    document.getElementById('syncNow').onclick = async () => { q.hidden = true; await load(); toast(syncBad ? 'Eşitlenemedi, bağlantını kontrol et' : 'Eşitlendi'); };
}
const NOTES = [];
let nES = null, nTopic = '', nHours = +(localStore('masal_nh') || 24);
const nSeen = () => +(localStore('masal_nseen') || 0);
const nClr = () => Math.max(+(S?.settings?.notify?.cleared || 0), +(localStore('masal_nclr') || 0));
const nKey = (m) => m.title + '|' + m.message;
function nMerge() {
    const cloud = (S?.strategies?.live?.notifs || []);
    for (const c of cloud) {
        const time = Math.round(c.t / 1000);
        if (NOTES.some(x => nKey(x) === nKey(c) && Math.abs(x.time - time) < 120))
            continue;
        NOTES.push({ id: 'c' + c.t + c.title, time, title: c.title, message: c.message, tags: c.tags });
    }
    NOTES.sort((a, b) => b.time - a.time);
    if (NOTES.length > 200)
        NOTES.length = 200;
    nBadge();
}
const nVisible = () => NOTES.filter(m => m.time > nClr() && m.time > Date.now() / 1000 - 86400);
function nKind(t) {
    const g = t || [];
    if (g.includes('rotating_light') || g.includes('warning'))
        return ['i-info', 'r'];
    if (g.includes('shopping_cart'))
        return ['i-coins', 'b'];
    if (g.includes('moneybag') || g.includes('trophy') || g.includes('white_check_mark'))
        return ['i-check', 'g'];
    return ['i-bell', 'm'];
}
function nBadge() {
    const b = document.getElementById('bellBtn'), n = document.getElementById('bellN');
    if (!b)
        return;
    b.hidden = !nTopic;
    const k = nVisible().filter(m => m.time > nSeen()).length;
    n.hidden = !k;
    n.textContent = k > 9 ? '9+' : String(k);
}
let nBusy = false;
async function startNotes() {
    if (nES || nBusy || !pw)
        return;
    nBusy = true;
    try {
        const st = (S?.settings?.notify ? S.settings : await setOpen(await tfetch('ayarlar.json?t=' + Date.now()).then(r => r.json())));
        const tp = st?.notify?.topic;
        if (!st?.notify?.enabled || !tp)
            return;
        nTopic = typeof tp === 'object' ? await unseal(tp, pw) : String(tp);
    }
    catch (e) {
        return;
    }
    finally {
        nBusy = false;
    }
    if (nES || !nTopic)
        return;
    const t0 = Date.now() / 1000;
    nES = new EventSource(`https://ntfy.sh/${encodeURIComponent(nTopic)}/sse?since=24h`);
    nES.onmessage = ev => {
        let m;
        try {
            m = JSON.parse(ev.data);
        }
        catch (e) {
            return;
        }
        if (m.event !== 'message' || NOTES.some(x => x.id === m.id || (nKey(x) === nKey({ title: m.title || 'Masal', message: m.message || '' }) && Math.abs(x.time - m.time) < 120)))
            return;
        NOTES.push({ id: m.id, time: m.time, title: m.title || 'Masal', message: m.message || '', tags: m.tags });
        NOTES.sort((a, b) => b.time - a.time);
        if (NOTES.length > 200)
            NOTES.length = 200;
        if (m.time >= t0 - 5) {
            toast(`${m.title || 'Masal'} · ${(m.message || '').split('\n')[0]}`);
            setTimeout(() => load(true), 1500);
        }
        nBadge();
        if (!document.getElementById('qsh').hidden && document.getElementById('qsh').dataset.n)
            openNotes();
    };
    nBadge();
}
function qHead(i, b) { document.querySelector('#qIco use').setAttribute('href', '#' + i); const k = document.getElementById('qOk'); k.textContent = b; k.hidden = false; }
function openNotes() {
    const q = document.getElementById('qsh');
    q.dataset.n = '1';
    qHead('i-bell', 'Kapat');
    document.getElementById('qTitle').textContent = 'Bildirimler';
    const from = Date.now() / 1000 - nHours * 3600, list = nVisible().filter(m => m.time > from), p = n => String(n).padStart(2, '0');
    const bar = `<div class="nbar"><div class="seg" id="nRange">${[1, 6, 12, 24].map(h => `<button type="button" data-h="${h}" class="${h === nHours ? 'on' : ''}">${h} sa</button>`).join('')}</div>
    <button type="button" class="nclr" id="nClear"${list.length ? '' : ' disabled'}>${ic('i-trash')}Temizle</button></div>`;
    document.getElementById('qText').innerHTML = bar + (list.length ? `<div class="nlist">${list.map(m => {
        const [i, c] = nKind(m.tags), d = new Date(m.time * 1000);
        return `<div class="nrow${m.time > nSeen() ? ' new' : ''}"><span class="ni ${c}">${ic(i)}</span><div><b>${String(m.title).replace(/</g, '&lt;')}</b><p>${m.message.replace(/</g, '&lt;')}</p>${/^Bot (durdu|stopped)/.test(String(m.title)) && S?.updated && Date.now() - S.updated < 120000 ? `<p class="nok">${ic('i-check')}Bot şu an çalışıyor (son tur ${Math.max(1, Math.round((Date.now() - S.updated) / 1000))} sn önce). Bildirim servisi nabzı alamadığı için bu uyarı yanlış düşmüş olabilir.</p>` : ''}</div><time>${p(d.getHours())}:${p(d.getMinutes())}</time></div>`;
    }).join('')}</div>`
        : `<div class="empty">${ic('i-bell')}<div>Son ${nHours} saatte bildirim yok</div></div>`);
    q.hidden = false;
    document.querySelectorAll('#nRange button').forEach(b => b.onclick = () => { nHours = +b.dataset.h; localStore('masal_nh', String(nHours)); openNotes(); });
    document.getElementById('nClear').onclick = async () => {
        const top = Math.ceil(Date.now() / 1000);
        localStore('masal_nclr', String(top));
        NOTES.length = 0;
        openNotes();
        await cloudPatch(o => { o.notify = { ...(o.notify || {}), cleared: top }; }, 'Bildirim geçmişi temizlendi');
        toast('Bildirim geçmişi temizlendi');
    };
    const v = nVisible();
    if (v.length)
        localStore('masal_nseen', String(v[0].time));
    nBadge();
}
document.getElementById('bellBtn').onclick = openNotes;
function openGloss(k) {
    const [t, h] = gloss(k);
    if (!t)
        return;
    document.getElementById('qsh').dataset.n = '';
    qHead('i-info', 'Anladım');
    document.getElementById('qTitle').textContent = t;
    document.getElementById('qText').innerHTML = h;
    document.getElementById('qsh').hidden = false;
}
document.addEventListener('click', e => { const q = e.target.closest('.qm'); if (q) {
    e.preventDefault();
    e.stopPropagation();
    openGloss(q.dataset.q);
} });
document.getElementById('qOk').onclick = () => document.getElementById('qsh').hidden = true;
new MutationObserver(() => { const q = document.getElementById('qsh'); if (!q.hidden)
    q.firstElementChild.scrollTop = 0; }).observe(document.getElementById('qsh'), { attributes: true, attributeFilter: ['hidden'] });
document.getElementById('qsh').onclick = e => { if (e.target === e.currentTarget)
    e.currentTarget.hidden = true; };
document.querySelectorAll('.adv .acch').forEach(b => b.onclick = () => b.parentElement.classList.toggle('open'));
let nowAll = false;
function nextBar() { const m = 15 * 6e4, t = Math.ceil((Date.now() + 1000) / m) * m, d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
let NOWX = null;
function renderNow(x) {
    NOWX = x;
    const sec = document.getElementById('nowSec'), box = document.getElementById('now');
    if (!x.live) {
        sec.hidden = true;
        return;
    }
    sec.hidden = false;
    if (swDrag)
        return;
    const w = x.watch, c = x.cfg, used = w ? w.used : x.positions.reduce((a, p) => a + p.cost, 0);
    let st;
    if (x.halted)
        st = ['red', 'i-power', 'Durdu: acil fren devrede', `${x.halt_reason || ''}. Yeni işlem açılmıyor.`];
    else if (x.target_done)
        st = ['', 'i-flag', 'Kâr hedefi tuttu', `${tl(parseFloat(x.target_done), 0)} hedefine ulaşıldı; bütün coinler satıldı, bot durdu. Devam etmek için Ayarlar'dan hedefi kapat ya da yükselt.`];
    else if (x.paused)
        st = ['amb', 'i-pause', 'Beklemede: yeni alım yapmıyor', 'Ayarlardan durdurdun. Elindeki coinlerin kâr al / zarar durdur koruması sürüyor.'];
    else if (x.blocked_today)
        st = ['amb', 'i-stop', 'Bugünlük durdu', 'Günlük zarar sınırına ulaşıldı; yarın yeniden alım yapar. Satışlar sürüyor.'];
    else if (w && !w.room)
        st = ['amb', 'i-layers', 'Bütçe sınırı dolu', `Coinlere ayrılan ${tl(w.cap, 0)}'nin ${tl(used, 0)}'si kullanımda. Bir kademe kârla satılınca yeniden alır.`];
    else if (w && w.coins >= w.max_coins)
        st = ['amb', 'i-layers', 'Coin sayısı dolu', `Aynı anda en fazla ${w.max_coins} coin tutuluyor. Biri satılınca yeni coin alır.`];
    else
        st = ['', 'i-target', x.armed ? 'Fırsat kolluyor' : 'Fırsat kolluyor (deneme)',
            c ? `${w ? w.items.length + ' coini' : 'Coinleri'} izliyor. Bir coin ${c.sma_h || 20} saatlik ortalamasının ${pp(c.step)} altına inince ${tl(c.lot, 0)} alır, ${pp(c.lot_tp)} kârda satar.`
                : 'Coinleri izliyor; strateji şartı oluşunca alım yapar.'];
    let h = `<div class="st ${st[0]}"><span class="si">${ic(st[1])}</span><div><b>${st[2]}</b><p>${st[3]}</p></div></div>`;
    if (w && w.items.length) {
        const items = w.items.map(it => { const cur = livePrice(it.i, it.p); return { ...it, cur, gap: (cur / it.t - 1) * 100 }; }).sort((a, b) => (a.f ? 1 : 0) - (b.f ? 1 : 0) || a.gap - b.gap);
        const show = nowAll ? items : items.slice(0, 6);
        const why = (it) => x.halted ? 'acil fren' : x.paused ? 'beklemede' : x.blocked_today ? 'bugünlük durdu' : !w.room ? 'bütçe dolu' : (!it.h && w.coins >= w.max_coins) ? 'coin sınırı dolu' : '';
        h += `<div class="wh">${ic('i-list')}Alıma en yakın coinler<button class="qm" data-q="yakin" aria-label="Açıklama">?</button></div><div class="wgrid swg">`;
        h += show.map(it => {
            const r = it.gap <= 0 && !it.f ? why(it) : '', bz = BUYING[it.i], ok = it.gap <= 0 && !it.f && !r;
            const tag = bz ? 'ALINIYOR' : it.f ? 'FİLTRE' : it.gap <= 0 ? (r ? r.toLocaleUpperCase('tr') : 'ŞART TAMAM') : it.h ? `${it.h + 1}. KDM` : 'ADAY';
            const near = it.f ? 8 : it.gap <= 0 ? 100 : Math.max(4, Math.min(100, 100 - it.gap * 20));
            return `<div class="wr ${ok || bz ? 'wu' : it.gap <= 0 && !it.f ? 'wa' : 'wd'}" data-sb="${it.i}" role="button"><div><b>${sym(it.i)}</b><em>${tag}</em></div><div class="wpx"><span>${px(it.cur)}</span><small>${it.h ? `${it.h + 1}. alım` : 'alım'} ${px(it.t)}</small></div><div class="wfk"><small class="${it.gap <= 0 ? 'up' : ''}">Fark ${it.gap <= 0 ? '−' : '+'}%${nf(Math.abs(it.gap), Math.abs(it.gap) < 10 ? 1 : 0)}</small><small>${it.f ? 'düşüş filtresi' : it.gap <= 0 ? 'şartta' : 'düşerse alır'}</small></div><i style="width:${near.toFixed(0)}%"></i></div>`;
        }).join('');
        h += '</div>';
        if (items.length > 6)
            h += `<button class="more" id="nowMore">${nowAll ? 'Daha az göster' : `Tümünü göster (${items.length} coin)`}</button>`;
    }
    h += c?.instant ? `<div class="nf">${ic('i-clock')}Anlık alım açık: fiyat alım seviyesine değdiği an alır (saniyede bir kontrol)</div>`
        : `<div class="nf">${ic('i-clock')}Sonraki karar ${nextBar()}'te (15 dakikalık mum kapanışı) · fiyatlar saniyede bir kontrol edilir</div>`;
    if (setH(box, h)) {
        const mb = document.getElementById('nowMore');
        if (mb)
            mb.onclick = () => { nowAll = !nowAll; renderNow(x); };
    }
}
function updLine() {
    const p = (n, l = 2) => String(n).padStart(l, '0');
    const live = lastTick ? (() => { const d = new Date(lastTick); return `<b class="up">● Canlı ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}</b> · `; })() : '';
    let bot = 'Bot henüz çalışmadı';
    if (S?.updated) {
        const sec = Math.max(0, Math.round((Date.now() - S.updated) / 1000));
        bot = sec <= 180 ? `Bot çalışıyor · son tur ${sec < 60 ? sec + ' sn' : Math.round(sec / 60) + ' dk'} önce`
            : `<b class="dn">Bot sessiz · ${ago(S.updated)}</b>`;
    }
    setH(document.getElementById('updated'), live + bot);
}
function volTxt(inst) { const v = LP[inst]?.vol; return v == null ? '' : v >= 1e9 ? nf(v / 1e9, 1) + '\u00a0Mr\u00a0TL' : v >= 1e6 ? nf(v / 1e6, 1) + '\u00a0Mn\u00a0TL' : nf(v / 1e3, 0) + '\u00a0B\u00a0TL'; }
function livePrice(inst, fallback) { return LP[inst]?.last ?? fallback; }
function sellPrice(inst, fallback) { return LP[inst]?.bid || LP[inst]?.last || fallback; }
function liveEquity(x) { return x.cash + x.positions.reduce((a, p) => a + p.qty * sellPrice(p.inst, p.price), 0); }
function renderMetrics(x) {
    const eq = liveEquity(x), pnl = eq - x.start_cash, pct = (eq / x.start_cash - 1) * 100, today = x.today_pnl + (eq - x.equity);
    const inCoins = eq - x.cash, live = sel === 'live';
    const hero = document.getElementById('hero');
    hero.className = 'hero' + (live ? '' : ' virt');
    const tag = live ? (x.armed ? `<span class="pill real"><i></i>Gerçek para</span>` : `<span class="pill demo">${ic('i-flask')}Deneme</span>`) : `<span class="pill virt">${ic('i-layers')}Sanal</span>`;
    const big = nf(eq, 2).split(',');
    let h = `<div class="hh"><span class="hn">${ic(live ? 'i-wallet' : ICON[sel])}${live ? 'Gerçek hesap' : x.name}</span>${tag}
    </div>
    <div class="big">${big[0]}<small>,${big[1]} TL</small></div>
    <div class="chg"><span class="${cls(pnl)}"><em>Toplam</em>${sgn(pnl)} TL · ${spc(pct)}</span><span class="${cls(today)}"><em>Bugün</em>${sgn(today)} TL</span></div>
    <div class="hk"><div><span>Boşta nakit</span><b>${tl(x.cash, 0)}</b></div><div><span>Coinlerde</span><b>${tl(inCoins, 0)}</b></div>
      <div><span>Kazanma</span><b>${x.win_rate == null ? '—' : '%' + nf(x.win_rate, 0)}</b></div></div>`;
    const w = x.watch;
    if (live && w && w.cap) {
        const used = x.positions.reduce((a, p) => a + p.cost, 0), r = Math.min(100, used / w.cap * 100);
        h += `<div class="use"><div class="ul">Coinlere ayrılan sınır<button class="qm" data-q="use" aria-label="Açıklama">?</button><b>${tl(used, 0)} / ${tl(w.cap, 0)}</b></div>
      <div class="ub"><i class="${w.room ? '' : 'full'}" style="width:${r.toFixed(1)}%"></i></div>
      <div class="uh">${x.positions.length > w.max_coins ? `${x.positions.length} coin · sınır ${w.max_coins}, yeni coin alınmaz` : `${x.positions.length}/${w.max_coins} coin`} · ${x.trades} kapanan işlem · başlangıç ${tl(x.start_cash, 0)}</div></div>`;
    }
    else
        h += `<div class="use">${live ? '' : `<div class="uh" style="color:var(--text);font-size:12.5px;line-height:1.45">${x.desc}</div>`}<div class="uh">${x.trades} kapanan işlem · başlangıç ${tl(x.start_cash, 0)}${live ? '' : ' (sanal para)'}</div></div>`;
    h += assetsExtra(x, eq);
    if (setH(hero, h)) {
        const sb = document.getElementById('syncBtn');
        if (sb)
            sb.onclick = () => syncReal();
    }
}
function assetsExtra(x, eq) {
    const kasa = +(x.kasa || S?.settings?.kasa || 0);
    if (sel !== 'live' || !kasa)
        return '';
    const reserve = Math.max(0, kasa - x.start_cash), now = eq + reserve;
    const T = S?.settings?.target;
    let h = '<div class="hx">';
    if (reserve >= 1)
        h += `<div class="hres">${ic('i-vault')}<span>Kasada yedek <b>${tl(reserve, 0)}</b></span><span>Kasa dahil toplam <b>${tl(now, 0)}</b></span></div>`;
    h += realLine(x, now);
    if (T?.on && T.amount > 0) {
        const total = T.mode === 'total', cur = total ? now : now - kasa, goal = +T.amount, r = Math.max(0, Math.min(100, cur / goal * 100));
        h += `<div class="atg"><div class="tl">${ic('i-target')}<span>${total ? 'Hedef (kasa dahil)' : 'Kâr hedefi'}</span><b>%${nf(r, 0)}</b></div>
      <div class="tb"><i style="width:${r.toFixed(1)}%"></i></div><div class="th"><span>${tl(cur, 0)}</span><span>${r >= 100 ? 'Hedefe ulaşıldı' : tl(Math.max(0, goal - cur), 0) + ' kaldı'}</span><span>${tl(goal, 0)}</span></div></div>`;
    }
    return h + '</div>';
}
function gFree() {
    const G = S?.gspotr, r = G?.recon;
    if (r?.free != null && Date.now() - (r.ts || 0) < 300000)
        return Math.max(0, +r.free);
    return Math.max(0, +(S?.xfer?.g_fund) || 0);
}
function syncBtnH(desk, st, id = '') {
    return `<button class="btn xsync${st ? ' ' + st : ''}" type="button"${desk ? ` data-dsync="${desk}"` : ''}${id ? ` id="${id}"` : ''}${st === 'sent' ? ' disabled' : ''} aria-label="Borsayla eşleştir">${st === 'sent' ? '<i class="spn"></i>Gönderildi' : st === 'ok' ? ic('i-check') + 'Eşleştirildi' : ic('i-refresh') + 'Eşleştir'}</button>`;
}
function syncDone(desk) { const o = S?.[desk]; return desk === 'gspotr' ? +(o?.recon?.ts || 0) : +(o?.sync || 0); }
function deskReal(desk) {
    const bt = DESK_BUSY['sync:' + desk] || 0, sy = bt && Date.now() - bt < 60000;
    let lbl = '', val = '', small = '', ok = true, warn = '', info = '';
    if (desk === 'memer') {
        const R = S?.memer;
        if (!R)
            return '';
        const age = R.sync ? (Date.now() - R.sync) / 1000 : 1e9;
        lbl = 'MEME cüzdanında gerçek';
        val = U(+R.value || 0, 2);
        small = `${nf(+R.sol || 0, 4)} SOL · ${R.sync ? 'son okuma ' + ago(R.sync) : 'okuma bekleniyor'}`;
        ok = age < 180 && !R.err;
        if (!ok)
            warn = R.err ? `Uyarı: ${escH(String(R.err)).slice(0, 90)}` : 'Cüzdan bir süredir okunmadı; Eşleştir\'e bas.';
    }
    else if (desk === 'levr') {
        const R = S?.levr;
        if (!R)
            return '';
        const age = R.sync ? (Date.now() - R.sync) / 1000 : 1e9;
        lbl = 'Futures hesabında gerçek';
        val = U(+R.equity || 0, 2);
        small = R.sync ? `son eşitleme ${ago(R.sync)}` : 'eşitleme bekleniyor';
        ok = age < 120 && !R.err;
        if (!ok)
            warn = R.err ? `Borsa uyarısı: ${escH(String(R.err)).slice(0, 90)}` : 'Bot bir süredir borsayla eşitlenmedi; Eşleştir\'e bas.';
    }
    else {
        const G = S?.gspotr;
        if (!G)
            return '';
        const r = G.recon || {}, it = r.items || [], bad = it.filter((x) => x.ex < x.bot * .98);
        lbl = 'OKX Global\'de gerçek';
        val = r.ts ? `${it.length - bad.length}/${it.length} coin borsada` : 'kontrol bekleniyor';
        small = r.usdt != null ? `işlem ${nf(+r.usdt, 2)} · fon ${nf(+r.fund, 2)} USDT · ${ago(r.ts)}` : '';
        ok = !bad.length && !r.err;
        if (bad.length)
            warn = `Borsada kayıttakinden az: ${bad.map((x) => escH(x.sym)).join(', ')}. Eşleştir'e basınca kayıt borsadakine iner.`;
        else if (r.err)
            warn = 'Kontrol yapılamadı: ' + escH(r.err);
        const fr = gFree();
        if (fr >= 1)
            info = `Fon hesabında masaya ayrılmamış ${U(fr, 2)} var; Eşleştir'e basınca bütçeye eklenir.`;
    }
    return `<div class="areal${ok ? '' : ' bad'}">${ic('i-bank')}<div><span>${lbl}</span><b>${val}</b>${small ? `<small>${small}</small>` : ''}</div>
    <em>${ok ? ic('i-check') + 'Eşleşik' : 'Tutmuyor'}</em>${syncBtnH(desk, sy ? (syncDone(desk) > bt ? 'ok' : 'sent') : '')}</div>${warn ? `<div class="xw dn">${warn}</div>` : ''}${info ? `<div class="xw">${info}</div>` : ''}`;
}
document.addEventListener('click', async (e) => {
    const b = e.target.closest?.('[data-dsync]');
    if (!b)
        return;
    if (!token) {
        toast('Önce Ayarlar\'dan GitHub bağlantısını kur');
        return;
    }
    const desk = b.dataset.dsync;
    DESK_BUSY['sync:' + desk] = Date.now();
    b.disabled = true;
    fastWatch();
    const req = { id: 's' + Date.now().toString(36), ts: Date.now(), desk, act: 'sync', sym: '' };
    const free = desk === 'gspotr' ? Math.floor(gFree() * 100) / 100 : 0, cur = +(((orig || S?.settings)?.gspot || {}).budget) || 0, nb = Math.round((cur + free) * 100) / 100;
    const ok = await cloudPatch(o => {
        o.desk_cmd = [...(o.desk_cmd || []).filter((x) => Date.now() - (x.ts || 0) < 600000), req];
        if (free >= 1) {
            o.gspot = { ...(o.gspot || {}), budget: nb };
        }
    }, 'Borsayla eşleştir: ' + desk + (free >= 1 ? ` · bütçe ${nb}` : ''));
    toast(ok ? (free >= 1 ? `Eşleştirildi: boştaki ${U(free, 2)} masaya eklendi, bütçe ${U(nb, 2)}. Bot birkaç saniyede uygular` : 'Eşleştirme isteği gönderildi; bot birkaç saniyede borsayla karşılaştırır') : 'İstek gönderilemedi, tekrar dene', ok ? '' : patchWhy());
    if (!ok) {
        delete DESK_BUSY['sync:' + desk];
        b.disabled = false;
    }
});
function realLine(x, now) {
    const o = S?.okx || {}, real = +(o.total_tl || x.real_total || 0);
    if (!real)
        return '';
    const gap = now - real, f = +(o.fund_tl || 0), bad = Math.abs(gap) > Math.max(50, real * .01);
    const warn = bad ? `<div class="xw dn">Uygulamadaki hesap borsadan ${tl(Math.abs(gap), 0)} ${gap > 0 ? 'fazla' : 'az'}. ${gap > 0 ? 'Kasa/bütçe borsadakinden yüksek girilmiş olabilir; bot olmayan parayı kullanmaz.' : 'Borsaya eklenen para henüz bota verilmemiş.'}</div>` : '';
    return `<div class="areal${bad ? ' bad' : ''}">${ic('i-bank')}<div><span>OKX TR'de gerçek</span><b>${tl(real, 0)}</b>${f >= 1 ? `<small>fon hesabında ${tl(f, 0)}</small>` : ''}</div>
    <em>${bad ? 'Tutmuyor' : ic('i-check') + 'Eşleşik'}</em>${syncBtnH('', SYNC_AT && Date.now() - SYNC_AT < 60000 ? (S.updated > SYNC_AT + 5000 ? 'ok' : 'sent') : '', 'syncBtn')}</div>${warn}`;
}
let SYNC_AT = 0, SYNCALL_AT = 0;
function syncAllH() {
    const st = SYNCALL_AT && Date.now() - SYNCALL_AT < 90000 ? (['gspotr', 'levr'].every(d => !S?.[d] || syncDone(d) > SYNCALL_AT) && S.updated > SYNCALL_AT + 5000 ? 'ok' : 'sent') : '';
    return `<button type="button" id="syncAll" class="sall${st ? ' ' + st : ''}"${st === 'sent' ? ' disabled' : ''}>${st === 'sent' ? '<i class="spn"></i>Gönderildi' : st === 'ok' ? ic('i-check') + 'Eşleştirildi' : ic('i-refresh') + 'Tümünü eşleştir'}</button>`;
}
async function syncAll() {
    if (!token) {
        toast('Önce Ayarlar\'dan GitHub bağlantısını kur');
        return;
    }
    const x = S?.strategies?.live, o = S?.okx;
    let b = null, k = null;
    if (x && !x.locked && o && o.try != null && !(x.recent || []).some((t) => t.ts > (o.ts || 0) - 5000)) {
        const free = o.cash_tl != null ? +o.cash_tl : (+o.try || 0) + (+o.usdt_tl || 0), base = +(x.base ?? x.start_cash) || 0;
        b = Math.max(0, Math.round(base + free - (+x.cash || 0) - (+x.cash_gap || 0)));
        k = Math.round(b + (+o.fund_tl || 0));
    }
    const gf = S?.gspotr ? Math.floor(gFree() * 100) / 100 : 0, gb = +(((orig || S?.settings)?.gspot || {}).budget) || 0, nb = Math.round((gb + gf) * 100) / 100;
    const cur = orig || S?.settings || {};
    if (gf < 1 && b != null && Math.abs(b - (+cur.budget || 0)) <= 1 && Math.abs(k - (+cur.kasa || 0)) <= 1) {
        toast('Hepsi zaten eşleşik');
        return;
    }
    const now = Date.now(), desks = ['gspotr', 'levr', 'memer'].filter(d => S?.[d]), reqs = desks.map((d, i) => ({ id: 's' + (now + i).toString(36), ts: now, desk: d, act: 'sync', sym: '' }));
    SYNCALL_AT = now;
    for (const d of desks)
        DESK_BUSY['sync:' + d] = now;
    renderOverview();
    fastWatch();
    const ok = await cloudPatch(c => {
        c.desk_cmd = [...(c.desk_cmd || []).filter((r) => Date.now() - (r.ts || 0) < 600000), ...reqs];
        if (b != null) {
            c.budget = b;
            c.kasa = k;
        }
        if (gf >= 1)
            c.gspot = { ...(c.gspot || {}), budget: nb };
    }, 'Tümünü eşleştir' + (b != null ? ` · bütçe ${b}` : '') + (gf >= 1 ? ` · Global ${nb}` : ''));
    if (ok) {
        if (b != null)
            SYNC_AT = now;
        toast(`Eşleştirme gönderildi${b != null ? `: Spot bütçesi ${tl(b, 0)}` : ''}${gf >= 1 ? ` · Global'e ${U(gf, 2)} eklendi` : ''}. Bot birkaç saniyede karşılaştırır.`);
    }
    else {
        SYNCALL_AT = 0;
        for (const d of desks)
            delete DESK_BUSY['sync:' + d];
        toast('Eşleştirilemedi, tekrar dene', patchWhy());
    }
    renderOverview();
}
async function syncReal() {
    const x = S?.strategies?.live, o = S?.okx;
    if (!x || !o || o.try == null) {
        toast('Borsa bilgisi henüz gelmedi, biraz sonra dene');
        return;
    }
    if (!token) {
        toast('Önce Ayarlar\'dan GitHub bağlantısını kur');
        return;
    }
    if ((x.recent || []).some((t) => t.ts > (o.ts || 0) - 5000)) {
        toast('Az önce işlem oldu; borsa bilgisi yenilensin, 1 dk sonra dene');
        return;
    }
    const free = o.cash_tl != null ? +o.cash_tl : (+o.try || 0) + (+o.usdt_tl || 0), base = +(x.base ?? x.start_cash) || 0, b = Math.max(0, Math.round(base + free - (+x.cash || 0) - (+x.cash_gap || 0))), k = Math.round(b + (+o.fund_tl || 0));
    const btn = document.getElementById('syncBtn');
    if (btn)
        btn.disabled = true;
    const ok = await cloudPatch(o => { o.budget = b; o.kasa = k; }, 'Borsayla eşleştir: bütçe ' + b + ' · kasa ' + k);
    if (ok) {
        SYNC_AT = Date.now();
        render();
    }
    toast(ok ? `Eşleştirildi: botta ${tl(b, 0)}, kasa ${tl(k, 0)}. Bot birkaç saniyede uygular.` : 'Eşleştirilemedi, tekrar dene', ok ? '' : patchWhy());
    if (btn)
        btn.disabled = false;
}
const XEND = { tr: ['OKX TR', 'i-bank', 'e1'], g: ['OKX Global', 'i-globe', 'e2'], k: ['KASA', 'i-vault', 'e3'], m: ['MEME', 'i-flask', 'e4'], f: ['Futures', 'i-layers', 'e6'], gs: ['Global spot', 'i-globe', 'e7'] };
const XDIR = { g2f: ['g', 'f', 'Boştaki paradan'], gs2f: ['gs', 'f', 'Global spot\'tan'], tr2g: ['tr', 'g', 'Uygulamadan'], g2tr: ['g', 'tr', 'TL olur'], tr2k: ['tr', 'k', 'Uygulamadan'], g2k: ['g', 'k', 'Soğuk cüzdan'], g2m: ['g', 'm', 'SOL olarak'], m2g: ['m', 'g', 'USDT olur'], k2g: ['k', 'g', 'Trust Wallet'], k2tr: ['k', 'tr', 'Trust Wallet'],
    tr2m: ['tr', 'm', 'Global ile'], m2k: ['m', 'k', 'USDT olarak'], m2tr: ['m', 'tr', 'TL olur'], k2m: ['k', 'm', 'Global ile'] };
const xName = (d) => `${XEND[XDIR[d][0]][0]} → ${XEND[XDIR[d][1]][0]}`;
const XJ_STEPS = ['İstek', 'Gönderim', 'Onay', 'Ulaştı'];
function xjName(j) { return j.dir === 'm2g' && XEND[j.then] ? `MEME → ${XEND[j.then][0]}` : j.dir === 'g2m' && j.wait && XEND[j.via] ? `${XEND[j.via][0]} → MEME` : XDIR[j.dir] ? xName(j.dir) : escH(j.dir); }
function xjIdx(j) { const m = String(j.msg || ''); return j.stage === 'done' ? 3 : j.stage === 'arriving' || (j.stage === 'sent' && /onay|gönderildi|zincir/i.test(m)) ? 2 : j.stage === 'sent' ? 1 : 0; }
function xjBar(j) {
    const k = xjIdx(j), bad = j.stage === 'failed';
    return `<span class="xpg${bad ? ' bad' : ''}">${XJ_STEPS.map((n, i) => `<i class="${i < k || j.stage === 'done' ? 'ok' : i === k ? (bad ? 'no' : 'on') : ''}"></i>`).join('')}</span>`;
}
function xjTime(t) { const d = new Date(t), n = new Date(); return d.toDateString() === n.toDateString() ? masaClock(t) : d.toLocaleDateString(LANG === 'en' ? 'en-GB' : 'tr-TR', { day: 'numeric', month: 'short' }) + ' ' + masaClock(t); }
function xjSheet(j) {
    const k = xjIdx(j), bad = j.stage === 'failed', sol = /m/.test(String(j.dir).slice(0, 3)) || j.sol;
    const link = j.txId ? `<a class="xtx" href="${sol ? 'https://solscan.io/tx/' : 'https://arbiscan.io/tx/'}${encodeURIComponent(j.txId)}" data-ext="1">${ic('i-link')}Zincirde gör · ${escH(String(j.txId).slice(0, 10))}…</a>` : '';
    const cap = (x) => x ? x.charAt(0).toLocaleUpperCase('tr-TR') + x.slice(1) : x;
    const steps = (j.steps || []).slice().reverse().map(([t, sg, m], i) => `<div class="xst${i === 0 ? ' cur' : ''}${sg === 'failed' ? ' bad' : sg === 'done' ? ' ok' : ''}"><time>${xjTime(t)}</time><i></i><div><b>${escH(cap(m) || (XST[sg] || [sg])[0])}</b>${sg !== 'req' ? `<small>${escH((XST[sg] || [sg])[0])}</small>` : ''}</div></div>`).join('');
    return `<div class="xsh"><div class="xsum"><b>${nf(+j.amt || 0, 2)} USDT</b><span>${xjTime(j.ts)}${j.chain ? ' · ' + escH(j.chain) : ''}${j.fee ? ` · ücret ${nf(+j.fee, 2)}` : ''}${j.got ? ` · ulaşan ${nf(+j.got, 2)}` : ''}</span></div>
    <div class="xbig${bad ? ' bad' : ''}">${XJ_STEPS.map((n, i) => `<div class="${i < k || j.stage === 'done' ? 'ok' : i === k ? (bad ? 'no' : 'on') : ''}"><i>${i < k || j.stage === 'done' ? ic('i-check') : i === k && bad ? ic('i-stop') : i + 1}</i><span>${n}</span></div>`).join('')}</div>
    ${link}<div class="xsteps">${steps || '<p class="hint">Adım kaydı yok (eski aktarım)</p>'}</div>
    <p class="hint">Borsalar arası aktarımda "Ulaştı", karşı borsanın yatırma kaydında para görülünce; KASA'ya aktarımda Arbitrum zincirinde onaylanınca işaretlenir.</p></div>`;
}
function openXJob(id) {
    const X = S?.xfer, j = (X?.jobs || []).find((x) => x.id === id);
    if (!j)
        return;
    const q = document.getElementById('qsh');
    q.dataset.n = '';
    q.dataset.xjob = id;
    qHead('i-refresh', 'Kapat');
    document.getElementById('qTitle').textContent = xjName(j).replace(/<[^>]+>/g, '');
    document.getElementById('qText').innerHTML = xjSheet(j);
    q.hidden = false;
}
document.addEventListener('click', e => { const t = e.target; if (t.closest('.xc'))
    return; const r = t.closest?.('[data-xj]'); if (r)
    openXJob(r.dataset.xj); });
const XST = { new: ['Sırada', 'i-clock', 'w'], sent: ['Yolda', 'i-out', 'w'], arriving: ['Ulaşıyor', 'i-in', 'w'], done: ['Tamam', 'i-check', 'ok'], failed: ['Olmadı', 'i-stop', 'bad'] };
function xEnd(k) { const e = XEND[k]; return `<span class="xe ${e[2]}">${ic(e[1])}</span>`; }
function setH(el, h) { if (el._h === h)
    return false; el.innerHTML = h; el._h = h; return true; }
function setT(el, t, c) { if (el._t !== t) {
    el.textContent = t;
    el._t = t;
} if (c != null && el.className !== c)
    el.className = c; }
function renderXfer() {
    {
        const q = document.getElementById('qsh'), id = q?.dataset.xjob, X0 = S?.xfer, j = id && !q.hidden ? (X0?.jobs || []).find((x) => x.id === id) : null;
        if (j && document.getElementById('qTitle').textContent === xjName(j).replace(/<[^>]+>/g, ''))
            setH(document.getElementById('qText'), xjSheet(j));
    }
    const box = document.getElementById('xfer');
    if (!box)
        return;
    const X = S?.xfer;
    if (sel !== 'live' || !S?.strategies?.live || S.strategies.live.locked) {
        box.hidden = true;
        return;
    }
    box.hidden = false;
    const jobs = (X?.jobs || []).slice(0, 4).map((j) => {
        const st = XST[j.stage] || [j.stage, 'i-info', 'w'];
        return `<div class="xr" data-xj="${escH(j.id)}" role="button"><span class="xs ${st[2]}">${ic(st[1])}</span><div class="xm"><b>${xjName(j)}<i>${U(+j.amt || 0, 2)}</i></b>
      <small>${masaClock(j.ts)} · ${escH(st[0])}${j.stage !== 'done' && j.msg && j.msg !== 'sırada' ? ' · ' + ut(escH(j.msg)) : ''}</small>${xjBar(j)}</div>${j.stage === 'new' ? `<button class="xc" data-xc="${escH(j.id)}">İptal</button>` : ''}</div>`;
    }).join('');
    const grp = [['OKX TR\'den', 'tr', ['tr2g', 'tr2k', 'tr2m']], ['OKX Global\'den', 'g', ['g2tr', 'g2k', 'g2m']], ['MEME\'den', 'm', ['m2g', 'm2k', 'm2tr']], ['KASA\'dan', 'k', ['k2g', 'k2tr', 'k2m']], ['Global içinde · Futures\'a', 'g', ['g2f', 'gs2f']]];
    const tile = (k) => { const [f, t, sub] = XDIR[k]; return `<button data-x="${k}"><span class="xrt">${xEnd(f)}${ic('i-chev')}${xEnd(t)}</span><b>${XEND[t][0]}</b><small>${sub}</small></button>`; };
    const logRows = (X?.log || []).slice(0, 5).map(([t, m]) => {
        const parts = escH(String(m).replace(/^(HATA|İptal:) /, '')).split(' · ');
        const [c, lb] = /^İptal/i.test(m) ? ['wn', 'İPTAL'] : /başarısız|hata|reddetti|yapılamadı|ulaşmadı|çevrilemedi/i.test(m) ? ['dn', 'HATA'] : /alınamadı|edilemedi|edilecek/i.test(m) ? ['wn', 'BEKLE'] : /ulaştı|tamamlandı/i.test(m) ? ['up', 'ULAŞTI'] : /gönderildi|aktarıldı/i.test(m) ? ['b', 'GÖNDER']
            : /çevrildi|satıldı|alındı/i.test(m) ? ['ac', 'ÇEVİR'] : /bekle|sınır|iptal/i.test(m) ? ['wn', 'BEKLE'] : ['z', 'BİLGİ'];
        return `<div class="xl lg"><time>${masaClock(t)}</time><em class="lk ${c}">${lb}</em><div><b>${parts[0]}</b>${parts.length > 1 ? `<small>${parts.slice(1).join(' · ')}</small>` : ''}</div></div>`;
    }).join('');
    if (!setH(box, `<h2 class="mh">${ic('i-wallet')}Kasalar<span class="hsum">15 sn'de bir güncellenir</span></h2>
    <div class="card xf">${xKasalar(X)}</div>
    <h2 class="mh">${ic('i-out')}Para gönder<span class="hsum">bugün ${U(X?.day_sum || 0, 0)} / ${nf(X?.daily_max || 10000, 0)}</span></h2>
    <div class="card xf xsend">${grp.filter(([, , ks]) => ks.some(k => XDIR[k])).map(([n, f, ks]) => `<div class="xg"><div class="xgh">${xEnd(f)}<span>${n}</span></div><div class="xt x3">${ks.filter(k => XDIR[k]).map(tile).join('')}</div></div>`).join('')}
      ${X?.free_tl != null ? `<p class="hint">OKX TR'de boşta ${tl(Math.max(0, X.free_tl), 0)}</p>` : ''}</div>
    ${jobs ? `<h2 class="mh">${ic('i-refresh')}Aktarımlar<span class="hsum">dokun, aşamaları gör</span></h2><div class="card xf"><div class="xj">${jobs}</div></div>` : ''}
    <h2 class="mh">${ic('i-coins')}Küçük bakiyeler<span class="hsum">tek dokunuşla çevir</span></h2>
    <div class="card xf"><div class="xt x3">${DUST.map(([k, f, to]) => {
        const l = (X?.dust || {})[k] || [], u = l.reduce((a, x) => a + (+x.usd || 0), 0);
        return `<button data-dust="${k}"><span class="xrt">${xEnd(f)}${ic('i-chev')}<span class="xe e5">${to}</span></span><b>${XEND[f][0]}</b><small>${l.length ? `${l.length} coin · ${U(u, 2)}` : 'artık yok'}</small></button>`;
    }).join('')}</div></div>
    ${logRows ? `<h2 class="mh">${ic('i-list')}Kayıt<span class="hsum">son olaylar</span></h2><div class="card xf xlogc">${logRows}</div>` : ''}`))
        return;
    box.querySelectorAll('[data-x]').forEach(b => b.onclick = () => openXfer(b.dataset.x));
    box.querySelectorAll('[data-xc]').forEach(b => b.onclick = () => cancelXfer(b.dataset.xc, b));
    box.querySelectorAll('[data-dust]').forEach(b => b.onclick = () => openDust(b.dataset.dust));
}
const DUST = [['tr', 'tr', 'TL'], ['g', 'g', 'USDT'], ['m', 'm', 'SOL']], DUST_MAX = 100;
function openDust(k) {
    const X = S?.xfer || {}, d = DUST.find(x => x[0] === k), list = (X.dust || {})[k] || [], q = document.getElementById('qsh');
    q.dataset.n = '';
    qHead(XEND[d[1]][1], 'Vazgeç');
    document.getElementById('qTitle').textContent = `${XEND[d[1]][0]} · küçük bakiyeler`;
    const pick = new Set(list.map(x => x.ccy));
    let to = k === 'tr' ? (localStore('masal_dust_to') || 'TRY') : k === 'g' ? 'USDT' : 'SOL';
    const TOS = { tr: [['TRY', 'TL'], ['USDT', 'USDT']], g: [['USDT', 'USDT'], ['USDC', 'USDC']], m: [['SOL', 'SOL']] };
    const usd = (v) => v > 0 && v < 0.01 ? '<0,01\u00a0USDT' : U(v, 2);
    const draw = () => {
        const all = list.length && pick.size === list.length, sum = list.filter(x => pick.has(x.ccy)).reduce((a, x) => a + (+x.usd || 0), 0);
        document.getElementById('qText').innerHTML = list.length ? `<div class="dsh">
      <div class="xlab">Neye çevrilsin</div><div class="seg dto">${TOS[k].map(([c, n]) => `<button type="button" data-to="${c}" class="${to === c ? 'on' : ''}"><b>${n}</b></button>`).join('')}</div>
      <div class="dtop"><span>${list.length} coin · ${usd(list.reduce((a, x) => a + (+x.usd || 0), 0))}</span><button class="dall" type="button">${all ? 'Hiçbiri' : 'Tümünü seç'}</button></div>
      <div class="dlist">${list.map(x => `<button type="button" class="drow${pick.has(x.ccy) ? ' on' : ''}" data-dc="${x.ccy}"><span class="dck">${ic('i-check')}</span><b>${String(x.sym || x.ccy).replace(/</g, '&lt;')}</b><small>${nf(+x.amt, +x.amt >= 1 ? 2 : 6)}</small><em>${usd(+x.usd)}</em></button>`).join('')}</div>
      ${pick.size > DUST_MAX ? `<div class="warn">${ic('i-info')}<div>Tek seferde en fazla <b>${DUST_MAX}</b> coin çevrilir. <b>${pick.size}</b> seçtin: ilk ${DUST_MAX} tanesi şimdi, kalan <b>${pick.size - DUST_MAX}</b> tanesi için bir kez daha dokun.</div></div>` : ''}
      ${k !== 'm' ? `<p class="hint">Botun elindeki coinler ve nakit listede yoktur; dokunulmaz. Borsanın en az çevirme tutarının altındaki çok küçük artıklar çevrilemeyebilir; sonuç aşağıda yazar.</p>` : `<p class="hint">Masanın açık tokenleri listede yoktur. Çok küçük artıklarda Jupiter yol bulamayabilir.</p>`}
      <button class="btn primary xgo" id="dGo" ${pick.size ? '' : 'disabled'}>${ic('i-refresh')}${Math.min(pick.size, DUST_MAX)} coini ${(TOS[k].find(x => x[0] === to) || [to, to])[1]}'ye çevir · ${usd(sum)}</button></div>`
            : `<div class="empty">${ic('i-check')}<div>Çevrilecek küçük bakiye yok</div></div>`;
        const t = document.getElementById('qText');
        t.querySelectorAll('[data-dc]').forEach(b => b.onclick = () => { const c = b.dataset.dc; pick.has(c) ? pick.delete(c) : pick.add(c); draw(); });
        t.querySelectorAll('[data-to]').forEach(b => b.onclick = () => { to = b.dataset.to; if (k === 'tr')
            localStore('masal_dust_to', to); draw(); });
        const da = t.querySelector('.dall');
        if (da)
            da.onclick = () => { if (all)
                pick.clear();
            else
                list.forEach(x => pick.add(x.ccy)); draw(); };
        const go = document.getElementById('dGo');
        if (go)
            go.onclick = async () => {
                if (!token) {
                    toast('Önce Ayarlar\'dan GitHub bağlantısını kur');
                    return;
                }
                const ccys = list.map(x => x.ccy).filter(c => pick.has(c)).slice(0, DUST_MAX);
                go.disabled = true;
                const req = { id: 'd' + Date.now().toString(36), ts: Date.now(), ex: k, ccys, to };
                const ok = await cloudPatch(o => { o.dust = [...(o.dust || []).filter((r) => r.id !== req.id && Date.now() - (r.ts || 0) < 3600000), req]; }, 'Küçük bakiye çevirme: ' + k);
                if (ok) {
                    q.hidden = true;
                    toast(`${ccys.length} coin ${to}'ye çevriliyor; sonuç birkaç saniyede Kasalar'da görünür`);
                }
                else {
                    go.disabled = false;
                    toast('İstek gönderilemedi, tekrar dene', patchWhy());
                }
            };
    };
    draw();
    q.hidden = false;
}
let USDTTRY = 0, xfId = '';
function xKasalar(X) {
    const r = +(X?.usdtry || USDTTRY || 0), o = S?.okx || {};
    const trUsd = X?.tr_total != null ? +X.tr_total : (o.total_tl && r ? o.total_tl / r : null), gUsd = X?.g_val != null ? +X.g_val : null, kUsd = X?.kasa?.usd != null ? +X.kasa.usd : null;
    const MR = S?.memer, mUsd = MR?.addr ? +MR.value || 0 : null;
    const all = [trUsd, gUsd, kUsd].every(v => v != null) ? trUsd + gUsd + kUsd + (mUsd || 0) : null;
    const cell = (k, u) => `<div>${xEnd(k)}<span>${XEND[k][0]}</span><b>${u == null ? '—' : U(u, 2)}</b><small>${u != null && r ? tl(u * r, 0) : ''}</small></div>`;
    return `<div class="xk${mUsd != null ? ' x4' : ''}">${cell('tr', trUsd)}${cell('g', gUsd)}${cell('k', kUsd)}${mUsd != null ? cell('m', mUsd) : ''}</div>
    ${all != null ? `<div class="xb"><span>Hepsi birlikte <b>${U(all, 2)}</b>${r ? ` · <b>${tl(all * r, 0)}</b>` : ''}</span>${X?.kasa ? `<span>KASA'da komisyon için <b>${nf(X.kasa.eth || 0, 4)} ETH</b></span>` : ''}</div>` : ''}`;
}
const KDEST = { k2g: ['OKX Global', '0x74877903737257289dc07e7baf1f4b078c2a82a3'], k2m: ['OKX Global', '0x74877903737257289dc07e7baf1f4b078c2a82a3'], k2tr: ['OKX TR', '0x1e194face9b26c78f75d854d741cf6547730b705'] };
function openKasaSend(dir) {
    const X = S?.xfer || {}, [nm, addr] = KDEST[dir], q = document.getElementById('qsh'), have = +(X.kasa?.usd || 0), eth = +(X.kasa?.eth || 0), sh = addr.slice(0, 6) + '…' + addr.slice(-4);
    q.dataset.n = '';
    qHead('i-vault', 'Kapat');
    document.getElementById('qTitle').textContent = dir === 'k2m' ? 'KASA → MEME' : `KASA → ${nm}`;
    const draw = () => {
        const a = document.getElementById('kAmt')?.value || (have ? String(Math.floor(have * 100) / 100) : '');
        const link = `trust://send?asset=c10042221_t0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9&address=${addr}${+a ? `&amount=${+a}` : ''}`;
        document.getElementById('qText').innerHTML = `<div class="xfs">
      <div class="xroute"><div>${xEnd('k')}<b>KASA</b><small>${U(have, 2)}</small></div><span class="xar">${ic('i-chev')}</span><div>${xEnd(dir === 'k2tr' ? 'tr' : dir === 'k2m' ? 'm' : 'g')}<b>${dir === 'k2m' ? 'MEME' : nm}</b><small>${dir === 'k2m' ? 'Solana' : 'Arbitrum'}</small></div></div>
      <p class="xnote">KASA'nın anahtarı güvenlik için sistemde yok; gönderimi <b>Trust Wallet'ta sen onaylarsın</b>. Tutar ve adres hazır gelir.${dir === 'k2m' ? ` Para önce <b>OKX Global</b>'e gider; ulaşınca bot kendiliğinden SOL alıp <b>MEME</b>'ye gönderir (3 saat bekler).` : ''}</p>
      <div class="xlab">Tutar</div><div class="xamt"><input id="kAmt" type="number" inputmode="decimal" min="1" step="1" value="${a}"><span>USDT</span></div>
      <div class="xq">${[5, 10, 25, 50].map(v => `<button data-kq="${v}"${v > have ? ' class="off"' : ''}>${v}</button>`).join('')}<button class="xall" data-kq="${Math.floor(have * 100) / 100}"${have ? '' : ' disabled'}>Tümü<small>${U(have, 2)}</small></button></div>
      <div class="xinfo">
        <div>${ic('i-lock')}<span>Adres</span><b>${sh} <button class="xcp" type="button" data-cp="${addr}">${ic('i-copy')}Kopyala</button></b></div>
        <div>${ic('i-globe')}<span>Ağ</span><b>Arbitrum One · USDT</b></div>
        <div>${ic('i-shield')}<span>Ücret</span><b>~0,01 USDT ETH${eth < 0.00005 ? ' · <span class="dn">ETH yok!</span>' : ''}</b></div>
        <div>${ic('i-info')}<span>Önce</span><b>Trust Wallet'ta üstte KASA seçili olsun</b></div>
      </div>
      <a class="btn primary xgo" href="${link}" target="_blank" rel="noopener">${ic('i-out')}${dir === 'k2m' ? 'Kaydet ve Trust Wallet\'ı aç' : 'Trust Wallet\'ta gönderimi aç'}</a>
      <p class="hint">Açılmazsa: Trust Wallet → KASA → USDT (Arbitrum) → Gönder → adres defterinden ${nm} ARB. Ulaşınca Kasalar'da görünür.</p></div>`;
        const inp = document.getElementById('kAmt'), base = link.replace(/&amount=[^&]*/, '');
        inp.oninput = () => { const v = +inp.value; document.querySelector('#qText a.xgo').href = base + (v > 0 ? `&amount=${v}` : ''); };
        document.querySelectorAll('[data-kq]').forEach(b => b.onclick = () => { inp.value = b.dataset.kq; inp.oninput(null); });
        document.querySelectorAll('[data-cp]').forEach(b => b.onclick = async () => { try {
            await navigator.clipboard.writeText(b.dataset.cp);
            toast('Adres kopyalandı');
        }
        catch (e) {
            toast(b.dataset.cp);
        } });
        if (dir === 'k2m') {
            const a = document.querySelector('#qText a.xgo');
            a.onclick = async (ev) => {
                ev.preventDefault();
                const href = a.href;
                if (await waitMeme('k', +inp.value, a))
                    location.href = href;
            };
        }
    };
    document.getElementById('qText').innerHTML = '';
    draw();
    q.hidden = false;
}
let waitBusy = false;
async function waitMeme(via, amt, btn) {
    if (waitBusy)
        return false;
    amt = Math.round((amt || 0) * 100) / 100;
    if (!(amt >= 1)) {
        toast('Tutarı yaz (en az 1 USDT)');
        return false;
    }
    if (!S?.memer?.addr) {
        toast('MEME cüzdanı bağlı değil');
        return false;
    }
    if (!token) {
        toast('Önce Ayarlar\'dan GitHub bağlantısını kur');
        return false;
    }
    waitBusy = true;
    if (btn)
        btn.classList.add('off');
    const req = { id: 'w' + Date.now().toString(36), ts: Date.now(), dir: 'g2m', amt, src: 'bos', wait: true, via };
    let ok = false;
    try {
        ok = await cloudPatch((o) => { const l = o.xfer_req || []; if (!l.some(r => r.id === req.id))
            o.xfer_req = [...l.filter(r => Date.now() - (r.ts || 0) < 3600000), req]; }, 'Aktarım: ' + via + ' → MEME ' + amt + ' USDT');
    }
    finally {
        waitBusy = false;
        if (btn)
            btn.classList.remove('off');
    }
    if (ok) {
        toast(`Kaydedildi: ${nf(amt, 2)} USDT Global'e ulaşınca MEME'ye geçecek`);
        fastWatch();
    }
    else
        toast('İstek gönderilemedi, tekrar dene', patchWhy());
    return ok;
}
function openExt(url) {
    {
        const id = S?.xfer?.g_uid;
        if (id && /tr\.okx\.com\/balance\/withdrawal/.test(url))
            try {
                navigator.clipboard?.writeText(String(id));
            }
            catch (e) { }
    }
    if (/Android/i.test(navigator.userAgent)) {
        const u = new URL(url);
        location.href = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
        return;
    }
    if (!window.open(url, '_blank', 'noopener'))
        location.href = url;
}
document.addEventListener('click', e => { const a = e.target.closest?.('a[data-ext]'); if (!a)
    return; e.preventDefault(); openExt(a.href); });
function uidBox(k = 'g') { const id = S?.xfer?.[k === 'g' ? 'g_uid' : 'tr_uid']; return id ? `<div class="xuid"><span>${k === 'g' ? 'OKX Global' : 'OKX TR'} UID<b>${escH(id)}</b></span><button type="button" data-cp="${escH(id)}">${ic('i-copy')}Kopyala</button></div>` : ''; }
document.addEventListener('click', e => { const b = e.target.closest?.('[data-cp]'); if (!b)
    return; navigator.clipboard?.writeText(b.dataset.cp).then(() => toast('UID kopyalandı'), () => toast('Kopyalanamadı')); });
const OKX_TR_WD = 'https://tr.okx.com/balance/withdrawal/usdt';
function xPending(dir) {
    const X = S?.xfer;
    const j = (X?.jobs || []).find((j) => j.dir === dir && !['done', 'failed'].includes(j.stage) && Date.now() - (+j.ts || 0) < 3 * 3600_000);
    if (j) {
        toast(`Bekleyen bir ${xjName(j).replace(/<[^>]+>/g, '')} aktarımı var (${U(+j.amt || 0, 2)}). Önce o bitsin; Aktarımlar'dan takip et.`);
        return true;
    }
    return false;
}
function openXfer(dir) {
    if (dir.startsWith('k')) {
        openKasaSend(dir);
        return;
    }
    if (dir === 'g2f' || dir === 'gs2f') {
        openFutFund(dir);
        return;
    }
    if (dir === 'tr2m') {
        const q = document.getElementById('qsh');
        q.dataset.n = '';
        qHead('i-bank', 'Kapat');
        document.getElementById('qTitle').textContent = 'OKX TR → MEME';
        document.getElementById('qText').innerHTML = `<div class="xfs">
      <div class="xroute"><div>${xEnd('tr')}<b>OKX TR</b><small>uygulamadan</small></div><span class="xar">${ic('i-chev')}</span><div>${xEnd('m')}<b>MEME</b><small>Solana</small></div></div>
      <p class="xnote">OKX TR bottan para çıkışına izin vermiyor. USDT'yi <b>OKX TR uygulamasından OKX Global</b>'e gönder (ücretsiz, anında); ulaşınca bot kendiliğinden SOL alıp <b>MEME</b>'ye gönderir.</p>
      <div class="xlab">Tutar</div><div class="xamt"><input id="tmAmt" type="number" inputmode="decimal" min="1" step="1" placeholder="0"><span>USDT</span></div>
      <div class="xq">${[5, 10, 25, 50].map(v => `<button data-tq="${v}">${v}</button>`).join('')}</div>
      <div class="xinfo"><div>${ic('i-bank')}<span>1</span><b>Alıcı'da <u>OKX Global ve OKX TR Kullanıcıları</u> sekmesine dokun</b></div><div>${ic('i-globe')}<span>2</span><b>"Telefon Numarası" yerine UID seç, yapıştır (UID kopyalandı)</b></div><div>${ic('i-flask')}<span>3</span><b>Gelince bot SOL alıp MEME'ye gönderir</b></div></div>${uidBox()}
      <button class="btn primary xgo" id="tmGo">${ic('i-out')}Kaydet ve OKX TR'yi aç</button></div>`;
        const inp = document.getElementById('tmAmt');
        document.querySelectorAll('[data-tq]').forEach(b => b.onclick = () => { inp.value = b.dataset.tq; });
        document.getElementById('tmGo').onclick = async () => {
            if (waitBusy)
                return;
            if (await waitMeme('tr', +inp.value, document.getElementById('tmGo'))) {
                q.hidden = true;
                openExt(OKX_TR_WD);
            }
        };
        q.hidden = false;
        return;
    }
    if (dir === 'tr2k') {
        const q = document.getElementById('qsh');
        q.dataset.n = '';
        qHead('i-bank', 'Anladım');
        document.getElementById('qTitle').textContent = xName(dir);
        document.getElementById('qText').innerHTML = `<div class="xfs"><p class="xnote">Bu yönü <b>OKX TR uygulamasından</b> yap:</p>
      <div class="xinfo"><div>${ic('i-bank')}<span>1</span><b>Çek → USDT → Zincir üstü · Arbitrum One</b></div><div>${ic('i-vault')}<span>2</span><b>Adres defterinden KASA (Arbitrum)</b></div><div>${ic('i-check')}<span>3</span><b>Gelince bot kasalarda gösterir</b></div></div>
      <a class="btn primary xgo" href="${OKX_TR_WD}" data-ext="1">${ic('i-out')}OKX TR'yi aç</a></div>`;
        q.hidden = false;
        return;
    }
    const X = S?.xfer || {}, [f, t] = XDIR[dir], q = document.getElementById('qsh'), r = +(X.usdtry || USDTTRY || 0);
    q.dataset.n = '';
    qHead(XEND[t][1], 'Vazgeç');
    document.getElementById('qTitle').textContent = 'Para gönder';
    xfId = 'x' + Date.now().toString(36);
    const bal = (k) => { const o = S?.okx || {}; const u = k === 'tr' ? (X.tr_total ?? (o.total_tl && r ? o.total_tl / r : null)) : k === 'g' ? X.g_val : k === 'm' ? S?.memer?.value : X.kasa?.usd; return u == null ? '—' : U(u, 2); };
    if (XF_BOT == null || XF_BOT_DIR !== dir) {
        XF_BOT = !!(((orig || S?.settings)?.xfer) || {}).use_bot;
        XF_BOT_DIR = dir;
    }
    const useBot = XF_BOT, canBot = f === 'tr' || f === 'g', GR = S?.gspotr;
    const MR = S?.memer, maxOf = () => {
        let v = null;
        if (f === 'm' && MR)
            v = Math.max(0, (+MR.sol - 0.02) * (+MR.solpx || 0) * 0.98);
        else if (f === 'g' && X.g_fund != null)
            v = Math.max(0, +X.g_fund + (useBot ? Math.max(0, +GR?.fund_res || 0) : 0) - (t === 'tr' ? 0 : t === 'k' ? 0.2 : 0.1));
        else if (f === 'tr' && r && X.free_tl != null)
            v = Math.max(0, (+X.free_tl + (useBot ? Math.max(0, +S?.strategies?.live?.cash || 0) : 0)) / r * 0.99);
        if (v != null)
            v = Math.min(v, Math.max(0, (+X.daily_max || 10000) - (+X.day_sum || 0)));
        return v == null ? null : Math.floor(v * 100) / 100;
    };
    const mx = maxOf();
    const mm = f === 'm' || t === 'm', fee = dir === 'm2k' ? '~0,03 USDT ağ + satış ücreti' : mm ? '~0,02 USDT ağ ücreti + alım-satım ücreti' : t === 'k' ? '~0,003 USDT ağ ücreti' : 'Ücretsiz · OKX iç transfer', time_ = mm || t === 'k' ? 'Birkaç dakika' : 'Birkaç saniye – birkaç dakika';
    const draw = () => {
        const tx = document.getElementById('qText'), cur = document.getElementById('xfAmt')?.value || '';
        tx.innerHTML = `<div class="xfs">
      <div class="xroute"><div>${xEnd(f)}<b>${XEND[f][0]}</b><small>${bal(f)}</small></div><span class="xar">${ic('i-chev')}</span><div>${xEnd(t)}<b>${XEND[t][0]}</b><small>${bal(t)}</small></div></div>
      <div class="xlab">Tutar</div>
      <div class="xamt"><input id="xfAmt" type="number" inputmode="decimal" min="1" step="1" placeholder="0" value="${cur}"><span>USDT</span></div>
      <div class="xeq" id="xfEq">${r && +cur ? '≈ ' + tl(+cur * r, 0) : '&nbsp;'}</div>
      <div class="xq">${[5, 10, 25, 50].map(v => `<button data-q="${v}"${mx != null && v > mx ? ' class="off"' : ''}>${v}</button>`).join('')}<button class="xall" data-q="${mx ?? ''}"${mx ? '' : ' disabled'}>Tümü<small>${mx != null ? U(mx, 2) : '—'}</small></button></div>
      <div class="xinfo">
        <div>${ic('i-shield')}<span>Ücret</span><b>${fee}</b></div>
        <div>${ic('i-clock')}<span>Süre</span><b>${time_}</b></div>
        <div>${ic('i-flag')}<span>Günlük sınır</span><b>${U(X.day_sum || 0, 0)} / ${nf(X.daily_max || 10000, 0)}</b></div>
        ${dir === 'g2tr' ? `<div>${ic('i-info')}<span>Varınca</span><b>TL'ye çevrilip Nakit'e konur</b></div>` : ''}
        ${t === 'k' ? `<div>${ic('i-lock')}<span>Adres</span><b>0x0113…7db7 (sabit)</b></div>` : ''}
        ${dir === 'g2m' ? `<div>${ic('i-info')}<span>Nasıl</span><b>Global fonundaki USDT ile SOL alınır, MEME'ye gider</b></div><div>${ic('i-lock')}<span>Adres</span><b>7Ymj…EKwN (sabit)</b></div>` : ''}
        ${dir === 'm2g' ? `<div>${ic('i-info')}<span>Nasıl</span><b>SOL Global'e gider, satılıp USDT olur</b></div>` : ''}
        ${dir === 'm2k' ? `<div>${ic('i-info')}<span>Nasıl</span><b>SOL Global'de USDT olur, oradan KASA'ya gider</b></div>` : ''}
        ${dir === 'm2tr' ? `<div>${ic('i-info')}<span>Nasıl</span><b>SOL Global'de USDT olur, OKX TR'de TL'ye çevrilip Nakit'e konur</b></div>` : ''}
      </div>
      ${canBot ? `<div class="xbot">${swRow('xfBot', useBot, 'Masaların parasını da kullan', useBot ? (f === 'tr' ? 'Boş para yetmezse Spot botunun nakdinden; botun bütçesi o kadar düşer' : 'Boş para yetmezse Global spot\'un parasından; masanın bütçesi o kadar düşer. Futures teminatına dokunulmaz') : 'Yalnız boştaki para gider; masaların parasına dokunulmaz')}</div>` : ''}
      <button class="btn primary xgo" id="xfGo">${ic('i-out')}Gönder</button></div>`;
        tx.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { document.getElementById('xfAmt').value = b.dataset.q; upd(); });
        const inp = document.getElementById('xfAmt'), upd = () => { document.getElementById('xfEq').innerHTML = r && +inp.value ? '≈ ' + tl(+inp.value * r, 0) : '&nbsp;'; };
        inp.oninput = upd;
        document.getElementById('xfGo').onclick = () => sendXfer(dir);
        const sw = document.getElementById('xfBot');
        if (sw)
            sw.onclick = () => { const v = document.getElementById('xfAmt').value; XF_BOT = !XF_BOT; const keep = xfId; openXfer(dir); xfId = keep; const a = document.getElementById('xfAmt'); if (a) {
                a.value = v;
                a.dispatchEvent(new Event('input'));
            } };
    };
    document.getElementById('qText').innerHTML = '';
    draw();
    q.hidden = false;
    XF_OPEN = { dir, ts: Date.now() };
}
function openFutFund(dir) {
    const R = S?.levr, G = S?.gspotr, st = orig || S?.settings || {}, lv = st.lev || {}, gs = st.gspot || {};
    const fromGs = dir === 'gs2f', max = Math.floor((fromGs ? Math.max(0, +G?.fund_res || 0) : Math.max(0, +gFree() || 0)) * 100) / 100, cur = +lv.real_budget || 0;
    const q = document.getElementById('qsh');
    q.dataset.n = '';
    qHead('i-layers', 'Vazgeç');
    document.getElementById('qTitle').textContent = 'Futures\'a para';
    const draw = (v) => {
        const a = +v || 0;
        document.getElementById('qText').innerHTML = `<div class="xfs">
      <div class="xroute"><div>${xEnd(fromGs ? 'gs' : 'g')}<b>${fromGs ? 'Global spot' : 'OKX Global'}</b><small>${fromGs ? 'boşta ' + U(+G?.fund_res || 0, 2) : 'boşta ' + U(gFree(), 2)}</small></div><span class="xar">${ic('i-chev')}</span><div>${xEnd('f')}<b>Futures</b><small>${U(+R?.equity || 0, 2)}</small></div></div>
      <div class="xlab">Tutar</div>
      <div class="xamt"><input id="ffAmt" type="number" inputmode="decimal" min="1" step="1" placeholder="0" value="${v}"><span>USDT</span></div>
      <div class="xq">${[5, 10, 20, 50].map(n => `<button data-fq="${n}"${n > max ? ' class="off"' : ''}>${n}</button>`).join('')}<button class="xall" data-fq="${max}"${max >= 1 ? '' : ' disabled'}>Tümü<small>${U(max, 2)}</small></button></div>
      <div class="xinfo">
        <div>${ic('i-layers')}<span>Futures bütçesi</span><b id="ffB">${U(cur, 0)} → ${U(cur + a, 0)}</b></div>
        ${fromGs ? `<div>${ic('i-globe')}<span>Global spot bütçesi</span><b id="ffG">${U(+gs.budget || 0, 0)} → ${U(Math.max(0, (+gs.budget || 0) - a), 0)}</b></div>` : ''}
        <div>${ic('i-shield')}<span>Ücret</span><b>Ücretsiz · hesap içi</b></div>
        <div>${ic('i-clock')}<span>Süre</span><b>Birkaç saniye</b></div>
      </div>
      <p class="hint" style="margin:8px 2px 0">Bot parayı Global fon hesabından futures işlem hesabına geçirir. Zarar sınırı (${U(+lv.max_loss || 0, 0)}) aynı kalır.</p>
      <button class="btn primary xgo" id="ffGo">${ic('i-out')}Futures'a aktar</button></div>`;
        const inp = document.getElementById('ffAmt'), upd = () => {
            const a = +inp.value || 0;
            document.getElementById('ffB').textContent = `${U(cur, 0)} → ${U(cur + a, 0)}`;
            const g = document.getElementById('ffG');
            if (g)
                g.textContent = `${U(+gs.budget || 0, 0)} → ${U(Math.max(0, (+gs.budget || 0) - a), 0)}`;
        };
        inp.oninput = upd;
        document.querySelectorAll('[data-fq]').forEach(b => b.onclick = () => { inp.value = b.dataset.fq; upd(); });
        document.getElementById('ffGo').onclick = async () => {
            const amt = Math.floor((+inp.value || 0) * 100) / 100;
            if (!(amt >= 1)) {
                toast('Tutarı yaz (en az 1 USDT)');
                return;
            }
            if (amt > max + 0.005) {
                toast(max < 1 ? (fromGs ? 'Global spot\'un boşta parası yok (coinlerde)' : 'Global\'de boşta para yok; Global spot\'tan aktarmayı dene') : `En fazla ${U(max, 2)} aktarılabilir`);
                return;
            }
            if (!lv.real) {
                toast('Futures gerçek modda değil; Ayarlar → Futures → Gerçek parayla işlem');
                return;
            }
            if (!token) {
                toast('Önce Ayarlar\'dan GitHub bağlantısını kur');
                return;
            }
            const b = document.getElementById('ffGo');
            b.disabled = true;
            const ok = await cloudPatch(o => {
                const l = o.lev = o.lev || {};
                l.real_budget = Math.round(((+l.real_budget || 0) + amt) * 100) / 100;
                if (fromGs) {
                    const g = o.gspot = o.gspot || {};
                    g.budget = Math.max(0, Math.round(((+g.budget || 0) - amt) * 100) / 100);
                }
            }, `Futures'a ${amt} USDT (${fromGs ? 'Global spot\'tan' : 'boştaki paradan'})`);
            if (ok) {
                q.hidden = true;
                fastWatch();
                toast(`${U(amt, 2)} futures'a aktarılıyor; bot birkaç saniyede geçirir`);
            }
            else {
                b.disabled = false;
                toast('Aktarılamadı, tekrar dene', patchWhy());
            }
        };
    };
    draw('');
    q.hidden = false;
}
let XF_OPEN = null, XF_BOT = null, XF_BOT_DIR = '';
function xfRefresh() {
    const q = document.getElementById('qsh');
    if (!XF_OPEN || q.hidden || !document.getElementById('xfAmt')) {
        XF_OPEN = null;
        return;
    }
    if (document.activeElement === document.getElementById('xfAmt') || document.getElementById('xfGo')?.disabled)
        return;
    const v = document.getElementById('xfAmt').value, keep = xfId;
    openXfer(XF_OPEN.dir);
    xfId = keep;
    document.getElementById('xfAmt').value = v;
    document.getElementById('xfAmt').dispatchEvent(new Event('input'));
}
async function cancelXfer(id, btn) {
    if (!token) {
        toast('Önce Ayarlar\'dan GitHub bağlantısını kur');
        return;
    }
    if (btn) {
        btn.disabled = true;
        btn.textContent = '…';
    }
    const ok = await cloudPatch((o) => { o.xfer_cancel = [...(o.xfer_cancel || []).filter((x) => x !== id).slice(-20), id]; }, 'Aktarım iptali: ' + id);
    if (ok)
        toast('İptal isteği gönderildi; para alım-satım hesabına geri konacak.');
    else {
        toast('İptal gönderilemedi', patchWhy());
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'İptal';
        }
    }
}
async function sendXfer(dir) {
    fastWatch();
    if (xPending(dir.startsWith('m') ? 'm2g' : dir))
        return;
    const amt = Math.round((+document.getElementById('xfAmt')?.value || 0) * 100) / 100;
    if (!(amt >= 1)) {
        toast('Tutarı yaz (en az 1 USDT)');
        return;
    }
    {
        const X = S?.xfer || {}, MR = S?.memer;
        if (dir.startsWith('m') && MR && amt > Math.max(0, (MR.sol - 0.02) * (MR.solpx || 0))) {
            toast(`MEME'de boşta ~${U(Math.max(0, (MR.sol - 0.02) * (MR.solpx || 0)), 2)} SOL var (tokenler hariç)`);
            return;
        }
        if (dir === 'g2m' && !MR?.addr) {
            toast('MEME cüzdanı bağlı değil');
            return;
        }
        const gMax = X.g_fund == null ? null : +X.g_fund + (XF_BOT ? Math.max(0, +S?.gspotr?.fund_res || 0) : 0);
        if (dir.startsWith('g') && gMax != null && amt > gMax + 0.005) {
            toast(gMax < 1 ? `OKX Global'de boşta gönderilecek para yok${XF_BOT ? '' : '. Masaların parasını kullanmak için alttaki düğmeyi aç'}` : `OKX Global'den en fazla ${U(gMax, 2)} gönderilebilir${XF_BOT ? ' (futures teminatı hariç)' : ' (masaların parası hariç)'}`);
            return;
        }
        if (dir.startsWith('tr') && X.free_tl != null) {
            const r = +(X.usdtry || USDTTRY || 0), tMax = r ? (+X.free_tl + (XF_BOT ? Math.max(0, +S?.strategies?.live?.cash || 0) : 0)) / r : null;
            if (tMax != null && amt > tMax + 0.005) {
                toast(tMax < 1 ? `OKX TR'de boşta gönderilecek para yok${XF_BOT ? '' : '. Botun parasını kullanmak için alttaki düğmeyi aç'}` : `OKX TR'den en fazla ${U(tMax, 2)} gönderilebilir`);
                return;
            }
        }
        if (dir.startsWith('g') && X.g_fund == null && X.g_val != null && amt > +X.g_val) {
            toast(`OKX Global'de ~${U(+X.g_val, 2)} var; daha fazlası gönderilemez`);
            return;
        }
    }
    if (!token) {
        toast('Önce Ayarlar\'dan GitHub bağlantısını kur');
        return;
    }
    const btn = document.getElementById('xfGo');
    if (btn?.disabled)
        return;
    if (btn) {
        btn.disabled = true;
        btn.lastChild.textContent = 'Gönderiliyor…';
    }
    const req = { id: xfId, ts: Date.now(), dir: dir.startsWith('m') ? 'm2g' : dir, amt, src: XF_BOT && (dir.startsWith('tr') || dir.startsWith('g')) ? 'bot' : 'bos', ...(dir === 'm2k' ? { then: 'k' } : dir === 'm2tr' ? { then: 'tr' } : {}) };
    const ok = await cloudPatch((o) => { const l = o.xfer_req || []; if (!l.some(r => r.id === req.id))
        o.xfer_req = [...l.filter(r => Date.now() - (r.ts || 0) < 3600000), req]; }, 'Uygulamadan aktarım: ' + dir + ' ' + amt + ' USDT');
    if (ok) {
        document.getElementById('qsh').hidden = true;
        toast(`${xName(dir)}: ${nf(amt, 2)} USDT isteği gönderildi; bot birkaç saniye içinde başlar.`);
    }
    else {
        toast('İstek gönderilemedi, tekrar dene', patchWhy());
        if (btn) {
            btn.disabled = false;
            btn.lastChild.textContent = 'Gönder';
        }
    }
}
let CD = null;
const CQ = ['TRY', 'USDT', 'USDC', 'EUR'], CBAR = [['15m', '15 dk'], ['1H', '1 sa'], ['4H', '4 sa'], ['1D', '1 gün']];
function openCoin(inst, x = 'tr', mk, info, act) {
    if (CD)
        clearTimeout(CD.t);
    const [base, q0] = String(inst).split('-');
    CD = { base, q: x === 'tr' ? (q0 || 'USDT') : 'USDT', bar: x === 'tr' ? '1H' : '15m', t: null, x, mk, info, act };
    const q = document.getElementById('qsh');
    q.dataset.n = '';
    qHead('i-chart', 'Kapat');
    document.getElementById('qTitle').textContent = base + (x === 'g' ? ' · Global' : x === 'sw' ? ' · Futures' : '');
    document.getElementById('qText').innerHTML = `<div class="cdv" id="cdv"><div class="empty">${ic('i-refresh')}<div>Yükleniyor…</div></div></div>`;
    q.hidden = false;
    drawCoin();
    const me = CD, tick = () => { if (CD !== me)
        return; if (q.hidden) {
        CD = null;
        return;
    } if (!document.hidden)
        drawCoin(true); me.t = setTimeout(tick, 5000); };
    me.t = setTimeout(tick, 5000);
}
async function drawCoin(live = false) {
    if (!CD)
        return;
    const { base, q, bar } = CD, X = CD.x || 'tr', inst = `${base}-${q}` + (X === 'sw' ? '-SWAP' : ''), host = X === 'tr' ? 'tr.okx.com' : 'www.okx.com', box = document.getElementById('cdv');
    if (!box)
        return;
    try {
        const [tk, cd] = await Promise.all([
            tfetch(`https://${host}/api/v5/market/ticker?instId=${inst}`, { cache: 'no-store' }, 6000).then(r => r.json()),
            live ? Promise.resolve(null) : tfetch(`https://${host}/api/v5/market/candles?instId=${inst}&bar=${bar}&limit=120`, { cache: 'no-store' }, 6000).then(r => r.json())
        ]);
        if (!CD || CD.base !== base || CD.q !== q || CD.bar !== bar)
            return;
        const t = tk?.data?.[0];
        if (!live) {
            CD.rows = (cd?.data || []).slice(0, 80).map((r) => [+r[0], +r[1], +r[2], +r[3], +r[4], +r[5]]).reverse();
            {
                const h = CQ.filter(x => LP[base + '-' + x]);
                CD.has = new Set(h.length ? h : CQ);
            }
        }
        const rows = CD.rows || [], has = CD.has || new Set(CQ);
        if (t && rows.length) {
            const r = rows[rows.length - 1], v = +t.last;
            r[4] = v;
            r[2] = Math.max(r[2], v);
            r[3] = Math.min(r[3], v);
        }
        const QP = X === 'tr' ? `<div class="qpair">${CQ.map(x => `<button data-cq="${x}" class="${x === q ? 'on' : ''}" ${has.has(x) ? '' : 'disabled'}>${x}</button>`).join('')}</div>` : '';
        if (!t && X !== 'tr') {
            box.innerHTML = `<div class="empty">${ic('i-info')}<div>${inst} OKX Global'de bulunamadı</div></div>${cdActH()}`;
            cdActB();
            return;
        }
        if (!t) {
            box.innerHTML = `<div class="qpair">${CQ.map(x => `<button data-cq="${x}" class="${x === q ? 'on' : ''}" ${has.has(x) ? '' : 'disabled'}>${x}</button>`).join('')}</div><div class="empty">${ic('i-info')}<div>${inst} paritesi OKX TR'de yok</div></div>${cdActH()}`;
            bindCoin();
            cdActB();
            return;
        }
        const VOL = X === 'sw' ? (+t.volCcy24h || 0) * (+t.last || 0) : +t.volCcy24h, last = +t.last, open = +t.sodUtc8 || +t.open24h, ch = open ? (last / open - 1) * 100 : 0, dec = last >= 100 ? 2 : last >= 1 ? 4 : Math.min(8, 2 - Math.floor(Math.log10(last || 1)));
        const L = S?.strategies?.live, pos = (L?.positions || []).find((p) => p.inst.split('-')[0] === base), coin = (L?.coins || []).find((c) => c.inst.split('-')[0] === base);
        box.innerHTML = `${QP}
      <div class="cdp"><b>${nf(last, dec)} <small>${q}</small></b><span class="${cls(ch)}">${ch >= 0 ? '+' : ''}${nf(ch, 2)}% · 24 sa</span></div>
      <div class="cdk"><div><span>En yüksek</span><b>${nf(+t.high24h, dec)}</b></div><div><span>En düşük</span><b>${nf(+t.low24h, dec)}</b></div><div><span>Hacim · ${q}</span><b>${VOL >= 1e6 ? nf(VOL / 1e6, 1) + ' Mn' : VOL >= 1e3 ? nf(VOL / 1e3, 1) + ' B' : nf(VOL, 0)}</b></div></div>
      ${coinSvg(rows, CD.mk)}
      <div class="qpair sm">${CBAR.map(([b, l]) => `<button data-cb="${b}" class="${b === bar ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${CD.info ? `<div class="cdb">${CD.info.map(([k, v]) => `<div>${ic('i-coins')}<span>${k}</span><b>${v}</b></div>`).join('')}</div>` : ''}
      ${X === 'tr' && pos ? `<div class="cdb"><div>${ic('i-coins')}<span>Botta</span><b>${pos.lots || 1} kademe · ${tl(pos.cost || 0, 0)} · ${sgn(pos.pnl || 0)} TL</b></div><div>${ic('i-pnl')}<span>Ortalama alış</span><b>${tl(pos.avg || 0, dec)}</b></div></div>` : ''}
      ${X === 'tr' && coin ? `<div class="cdb"><div>${ic('i-chart')}<span>Bu coinden toplam</span><b class="${cls(coin.realized)}">${sgn(coin.realized)} TL · ${coin.sells} satış</b></div></div>` : ''}
      <div class="cdn">Canlı · 5 sn'de bir · ${X === 'tr' ? 'OKX TR' : X === 'sw' ? 'OKX Global futures' : 'OKX Global'}</div>
      ${cdActH()}`;
        cdActB();
        bindCoin();
    }
    catch (e) {
        if (!live) {
            box.innerHTML = `<div class="empty">${ic('i-info')}<div>Grafik verisi alınamadı</div></div>${cdActH()}`;
            cdActB();
        }
    }
}
const cdActH = () => CD?.act ? `<button class="btn primary xgo" type="button" id="cdAct">${ic('i-buy')}${CD.act[0]}</button>` : '';
function cdActB() { const a = document.getElementById('cdAct'); if (a && CD?.act) {
    const f = CD.act[1];
    a.onclick = () => { clearTimeout(CD?.t); CD = null; f(); };
} }
function bindCoin() {
    document.querySelectorAll('#cdv [data-cq]').forEach(b => b.onclick = () => { if (CD && !b.disabled) {
        CD.q = b.dataset.cq;
        drawCoin();
    } });
    document.querySelectorAll('#cdv [data-cb]').forEach(b => b.onclick = () => { if (CD) {
        CD.bar = b.dataset.cb;
        drawCoin();
    } });
}
function coinSvg(rows, mk = []) {
    if (rows.length < 2)
        return '';
    const rh = Math.max(...rows.map(r => r[2])), rl = Math.min(...rows.map(r => r[3])), rs = (rh - rl) || rh * .01 || 1;
    const mv = (mk || []).map(m => m[0]).filter(v => v > 0 && isFinite(v) && v <= rh + rs * 1.5 && v >= rl - rs * 1.5);
    const W = 340, H = 170, VH = 26, PW = W - 44, n = rows.length, hi = Math.max(rh, ...mv), lo = Math.min(rl, ...mv), sp = (hi - lo) || 1, vmax = Math.max(...rows.map(r => r[5])) || 1;
    const cw = PW / n, y = (v) => 4 + (hi - v) / sp * (H - VH - 12), dec = hi >= 100 ? 2 : hi >= 1 ? 4 : Math.min(8, 3 - Math.floor(Math.log10(hi || 1)));
    let g = '';
    const ly0 = y(rows[n - 1][4]);
    for (let k = 0; k <= 3; k++) {
        const v = lo + sp * k / 3, yy = y(v);
        if (Math.abs(yy - ly0) < 11) {
            g += `<line x1="0" x2="${PW}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" class="gl"/>`;
            continue;
        }
        g += `<line x1="0" x2="${PW}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" class="gl"/><text x="${PW + 4}" y="${(yy + 3).toFixed(1)}" class="gt">${nf(v, dec)}</text>`;
    }
    const c = rows.map((r, i) => {
        const [, o, h, l, cl, v] = r, up = cl >= o, x = i * cw + cw / 2, bw = Math.max(1.2, cw * .62), t = y(Math.max(o, cl)), bh = Math.max(1, Math.abs(y(o) - y(cl))), col = up ? '#178A5B' : '#C9473F', vh = v / vmax * VH;
        return `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${y(h).toFixed(1)}" y2="${y(l).toFixed(1)}" stroke="${col}" stroke-width="1"/><rect x="${(x - bw / 2).toFixed(1)}" y="${t.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${col}" rx=".6"/><rect x="${(x - bw / 2).toFixed(1)}" y="${(H - vh).toFixed(1)}" width="${bw.toFixed(1)}" height="${vh.toFixed(1)}" fill="${col}" opacity=".25"/>`;
    }).join('');
    const last = rows[n - 1][4], ly = y(last), lc = last >= rows[n - 1][1] ? '#178A5B' : '#C9473F';
    const mm = (mk || []).filter(m => m[0] > 0 && isFinite(m[0])).map(([v, l, col], i) => {
        const out = v > hi ? '↑' : v < lo ? '↓' : '', yy = Math.max(4, Math.min(H - VH - 8, y(v))).toFixed(1), tx = 3 + i * 98;
        return `<line x1="0" x2="${PW}" y1="${yy}" y2="${yy}" stroke="${col}" stroke-dasharray="5 3" stroke-width="1"${out ? ' opacity=".5"' : ''}/><text x="${tx}" y="${(+yy + (+yy < 14 ? 10 : -3)).toFixed(1)}" class="gm" fill="${col}">${out}${l} ${nf(v, dec)}</text>`;
    }).join('');
    return `<svg class="cdc" viewBox="0 0 ${W} ${H}">${g}${c}${mm}<line x1="0" x2="${PW}" y1="${ly.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${lc}" stroke-dasharray="3 3" stroke-width=".8"/><rect x="${PW + 1}" y="${(ly - 7).toFixed(1)}" width="43" height="14" rx="3" fill="${lc}"/><text x="${PW + 4}" y="${(ly + 3.5).toFixed(1)}" class="gp">${nf(last, dec)}</text></svg>`;
}
document.addEventListener('click', e => {
    const el = e.target.closest('.row');
    if (!el || Date.now() - swJust < 400 || e.target.closest('button,a,.swb'))
        return;
    if (el.closest('.swr.open'))
        return;
    const c = el.querySelector('[data-coin]');
    if (!c || el.closest('#memeBody'))
        return;
    const pf = (v) => nf(v, v >= 100 ? 2 : v >= 1 ? 4 : Math.min(8, 2 - Math.floor(Math.log10(v || 1))));
    if (el.closest('#futBody')) {
        const b = sym(c.dataset.coin), p = ((S?.levr?.positions) || []).find((x) => x.sym === b);
        openCoin(c.dataset.coin, 'sw', p ? [[+p.entry, 'Giriş', '#3B6FD8'], [+p.stop, 'Stop', '#C9473F'], [+p.tp, 'Hedef', '#178A5B']] : [], p ? [['Pozisyon', `${p.side} ${p.lev || ''}x · teminat ${U(+p.margin || 0, 2)}`], ['Kâr/zarar', `${p.pnl < 0 ? '−' : '+'}${U(Math.abs(+p.pnl || 0), 2)}`]] : undefined);
        return;
    }
    if (el.closest('#gspotBody')) {
        const gs = (orig || S?.settings)?.gspot || {}, G = S?.gspotr && gs.real ? S.gspotr : S?.gspot;
        const p = ((G?.positions) || []).find((x) => x.inst === c.dataset.coin), tp = +(gs.lot_tp_pct ?? 3.5) / 100;
        openCoin(c.dataset.coin, 'g', p ? [[+p.avg, 'Alış ort.', '#3B6FD8'], [+p.avg * (1 + tp), 'Kâr al', '#178A5B']] : [], p ? [['Botta', `${p.lots || 1} kademe · maliyet ${U(+p.cost || 0, 2)}`], ['Kâr/zarar', `${p.pnl < 0 ? '−' : '+'}${U(Math.abs(+p.pnl || 0), 2)} · ort. ${pf(+p.avg || 0)}`]] : undefined);
        return;
    }
    openCoin(c.dataset.coin);
});
let VIEW = 'home';
function overlayView(on) {
    document.getElementById('deck').hidden = on;
    if (on)
        document.getElementById('ovw').hidden = true;
    else
        setTimeout(renderOverview, 0);
    for (const id of ['futv', 'memev', 'kasav', 'homev', 'gspotv'])
        document.getElementById(id).hidden = true;
    if (!on)
        setTimeout(() => showView(VIEW), 0);
}
function showView(v) {
    VIEW = v;
    const m = { home: 'homev', spot: 'mainv', gspot: 'gspotv', fut: 'futv', meme: 'memev', kasa: 'kasav' };
    for (const [k, id] of Object.entries(m))
        document.getElementById(id).hidden = k !== v;
    document.querySelectorAll('#deck button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    scrollTo(0, 0);
    if (S)
        render();
    navSave();
}
document.querySelectorAll('#deck button').forEach(b => b.onclick = () => showView(b.dataset.v));
document.addEventListener('click', e => { const b = e.target.closest?.('[data-sett]'); if (b)
    openSettingsTab(b.dataset.sett); });
function renderDeck() {
    if (!S)
        return;
    const X = S.xfer, sp = S.strategies?.live;
    const set = (id, t) => { const e = document.getElementById(id); if (e && e._t !== t) {
        e.textContent = t;
        e._t = t;
    } };
    if (sp && !sp.locked) {
        const p = liveEquity(sp) - sp.start_cash;
        set('dkSpot', Math.abs(p) < 0.5 ? '0 TL' : (p >= 0 ? '+' : '−') + nf(Math.abs(p), 0) + ' TL');
    }
    {
        const R2 = S.levr;
        set('dkFut', R2?.on ? U(R2.equity, 0) : 'kapalı');
    }
    {
        const G2 = S.gspotr, P2 = S.gspot, gs2 = (S?.settings?.gspot) || {};
        set('dkG', gs2.on === false && !G2 ? 'kapalı' : G2 && gs2.real ? (gReal(G2) > 0.005 ? U(gReal(G2), 0) : 'para yok') : P2 ? 'deneme' : '—');
    }
    {
        const R3 = S.memer, on3 = (S?.settings?.meme || {}).on !== false;
        set('dkMeme', on3 && R3?.on ? U(R3.value, 0) : on3 ? 'deneme' : 'kapalı');
    }
    if (X) {
        const a = [X.tr_total, X.g_val, X.kasa?.usd];
        if (a.every((v) => v != null))
            set('dkKasa', U(a.reduce((x, y) => x + y, 0) + (+S.memer?.value || 0), 0));
    }
    renderOverview();
    if (VIEW === 'home')
        renderHome();
    if (VIEW === 'fut' && !swDrag) {
        const b = document.getElementById('futBody');
        setH(b, renderLevR() || `<div class="empty">${ic('i-layers')}<div>Kaldıraç masası verisi bekleniyor</div></div>`);
    }
    if (VIEW === 'gspot' && !swDrag) {
        const b = document.getElementById('gspotBody');
        setH(b, renderGspot());
    }
    if (VIEW === 'meme') {
        const b = document.getElementById('memeBody');
        setH(b, renderMemeR() || `<div class="empty">${ic('i-flask')}<div>Memecoin masası verisi bekleniyor</div></div>`);
    }
}
function hcut(t) { if (t.length <= 60)
    return t; const c = t.slice(0, 60), i = c.lastIndexOf(' · '); return i > 12 ? c.slice(0, i) : c.trimEnd() + '…'; }
function renderHome() {
    const box = document.getElementById('homeBody');
    if (!box || !S)
        return;
    const sp = S.strategies?.live, X = S.xfer, R = S.levr, M = S.memer;
    if (!sp || sp.locked) {
        setH(box, `<div class="empty">${ic('i-lock')}<div>Özeti görmek için Spot sekmesinden kilidi aç</div></div>`);
        return;
    }
    const ms = (S.settings?.meme) || {}, usd = (v) => U(v, 2), uh = (v) => U(v, 2) + (usdTL(v) ? `<small class="htl">≈ ${usdTL(v)}</small>` : '');
    const pill = (v, t) => `<span class="hp ${Math.abs(v) < 0.005 ? 'z' : cls(v)}">${v >= 0 ? '▲' : '▼'} ${t}</span>`;
    const spP = liveEquity(sp) - sp.start_cash, spT = sp.today_pnl ?? 0;
    const desks = [
        ['spot', 'h1', 'i-coins', 'Spot', tl(liveEquity(sp), 0), pill(spP, nf(Math.abs(spP), 0) + ' TL'), sp.halted ? ['', 'durdu'] : sp.paused ? ['pp', 'beklemede'] : ['on', `${(sp.positions || []).length} coin · bugün ${sgn(spT)} TL`]],
        ['gspot', 'h5', 'i-globe', 'Global', (() => { const G = S.gspotr, P = S.gspot, gs = ms && S.settings?.gspot || {}; return G && gs.real ? uh(gReal(G)) : P ? 'Deneme' : '—'; })(),
            (() => { const G = S.gspotr, gs = S.settings?.gspot || {}; return G && gs.real ? pill(+G.pnl || 0, usd(Math.abs(+G.pnl || 0))) : ''; })(),
            (() => { const G = S.gspotr, P = S.gspot, gs = S.settings?.gspot || {}, X = G && gs.real ? G : P; return gs.on === false && !G ? ['', 'kapalı'] : X ? [G && gs.real ? 'on' : 'pp', `${(X.positions || []).length} coin · ${G && gs.real ? 'gerçek' : 'deneme'}`] : ['', 'hazırlanıyor']; })()],
        ['fut', 'h2', 'i-layers', 'Futures', R?.on || R?.funded ? uh(+R.equity || 0) : '—', R?.funded ? pill(+R.pnl || 0, usd(Math.abs(+R.pnl || 0))) : '', R?.dead ? ['', 'durdu'] : R?.on ? ['on', `${(R.positions || []).length} pozisyon · ${S.lev?.watch?.length || 0} coin izleniyor`] : ['', 'kapalı']],
        ['meme', 'h3', 'i-flask', 'Memecoin', ms.on === false ? 'Kapalı' : M?.on ? uh(+M.value || 0) : 'Deneme', M?.on && M?.start ? pill(+M.pnl || 0, usd(Math.abs(+M.pnl || 0))) : '', ms.on === false ? ['', 'kapalı'] : M?.on ? ['on', `${(M.positions || []).length} token`] : ['pp', 'yalnız deneme taraması']],
        ['kasa', 'h4', 'i-vault', 'Kasalar', X?.kasa?.usd != null ? uh(+X.kasa.usd) : '—', '', ['on', X?.g_val != null ? `Global ${usd(+X.g_val)} · TR ${usd(+X.tr_total || 0)}` : 'aktarım']]
    ];
    let h = `<h2 class="mh">${ic('i-layers')}Masalar<span class="hsum">dokun, aç</span></h2><div class="hdesk">${desks.map(([v, c, i, n, val, p, [d, st]]) => `<button type="button" data-goto="${v}"><span class="hi ${c}">${ic(i)}</span>${p}<span class="hn">${n}</span><span class="hv">${val}</span><span class="hs"><i class="${d}"></i>${st}</span></button>`).join('')}</div>`;
    const fd = [];
    for (const t of (sp.recent || []).slice(0, 10)) {
        const sell = t.side === 'SAT';
        fd.push([t.ts, 'h1', 'i-coins', `${sym(t.inst)} ${sell ? 'satıldı' : 'alındı'}`, `Spot · ${t.reason || ''}`, sell ? `<span class="hx ${cls(t.pnl) || 'z'}">${sgn(t.pnl)} TL</span>` : `<span class="hx b">${tl(t.amount, 0)}</span>`]);
    }
    for (const [ts, k, t] of ((R?.log) || []).slice(0, 10)) {
        if (k !== 'buy' && k !== 'exit')
            continue;
        const m = /([+-]?\d+\.\d+)\$/.exec(t), v = m ? +m[1] : 0;
        fd.push([ts, 'h2', 'i-layers', ut(t).replace(/^GERÇEK\s+/, '').split(' · ')[0], 'Futures', k === 'exit' ? `<span class="hx ${cls(v) || 'z'}">${v >= 0 ? '+' : '−'}${U(Math.abs(v), 2)}</span>` : `<span class="hx b">açıldı</span>`]);
    }
    for (const [ts, k, t] of ((M?.log) || []).slice(0, 10)) {
        if (k !== 'buy' && k !== 'exit')
            continue;
        const m = /([+-]?\d+\.\d+)\$/.exec(t), v = m ? +m[1] : 0;
        fd.push([ts, 'h3', 'i-flask', ut(t).replace(/^GERÇEK\s+/, '').split(' · ')[0], 'Memecoin', k === 'exit' ? `<span class="hx ${cls(v) || 'z'}">${v >= 0 ? '+' : '−'}${U(Math.abs(v), 2)}</span>` : `<span class="hx b">alındı</span>`]);
    }
    {
        const G = S.gspotr;
        for (const [ts, k, t] of ((G?.log) || []).slice(0, 10)) {
            if (k !== 'buy' && k !== 'exit')
                continue;
            const m = /([+-]?\d+\.\d+)\$ ·/.exec(t), v = m ? +m[1] : 0;
            fd.push([ts, 'h5', 'i-globe', t.split(' · ')[0].replace(/ \$[\d.]+$/, '').replace(/^AL /, '').replace(/^SAT /, '') + (k === 'buy' ? ' alındı' : ' satıldı'), 'Global', k === 'exit' ? `<span class="hx ${cls(v) || 'z'}">${v >= 0 ? '+' : '−'}${U(Math.abs(v), 2)}</span>` : `<span class="hx b">alındı</span>`]);
        }
    }
    fd.sort((a, b) => b[0] - a[0]);
    h += `<h2 class="mh">${ic('i-list')}Son hareketler<span class="hsum">bütün masalar</span></h2><div class="card hfeed">${fd.length ? fd.slice(0, 8).map(([ts, c, i, t, sub, x]) => `<div class="hr"><span class="hk hi ${c}">${ic(i)}</span><div class="hm"><b>${String(t).replace(/</g, '&lt;')}</b><small>${ago(ts)} · ${hcut(String(sub)).replace(/</g, '&lt;')}</small></div>${x}</div>`).join('') : `<div class="empty">${ic('i-clock')}<div>Henüz hareket yok</div></div>`}</div>`;
    {
        const nw = !!(remoteVer && vcmp(remoteVer.version, APP_VERSION) > 0);
        h += `<button type="button" class="fv2${nw ? ' nw' : ''}" data-sett="app"><svg class="fm" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="12" fill="#18233C"/><polygon points="11,35 11,13 17,13 17,35" fill="#fff"/><polygon points="11,13 17,13 24,21.5 24,29.5" fill="#C7D3E8"/><polygon points="37,13 31,13 24,21.5 24,29.5" fill="#F4BE6A"/><polygon points="31,13 37,13 37,35 31,35" fill="#E39A2E"/></svg><span class="ft2"><b>Masal</b><small>${nw ? 'yeni sürüm hazır: ' + remoteVer.version : 'güncel · ' + (remoteVer?.date ? remoteVer.date.split('-').reverse().join('.') : 'canlı')}</small></span><span class="fvc">v${APP_VERSION}</span><i class="fdot"></i></button>`;
    }
    setH(box, h);
}
document.addEventListener('click', e => { const b = e.target.closest?.('[data-goto]'); if (b)
    showView(b.dataset.goto); });
let OV_CUR = localStore('masal-ovcur') || 'usd', OV_HIDE = localStore('masal-ovhide') === '1';
document.addEventListener('click', e => {
    const t = e.target.closest?.('[data-ovc],[data-ovh]');
    if (!t)
        return;
    if (t.dataset.ovc) {
        OV_CUR = t.dataset.ovc;
        localStore('masal-ovcur', OV_CUR);
    }
    else {
        OV_HIDE = !OV_HIDE;
        localStore('masal-ovhide', OV_HIDE ? '1' : '0');
    }
    renderOverview();
});
function renderOverview() {
    const el = document.getElementById('ovw');
    if (!el || !S)
        return;
    const X = S.xfer, sp = S.strategies?.live, R = S.levr, M = S.memer, r = +(X?.usdtry || USDTTRY || 0);
    if (VIEW !== 'home' || document.getElementById('deck')?.hidden || !X || !sp || sp.locked || !r) {
        el.hidden = true;
        return;
    }
    const btcTL = +(LP['BTC-USDT']?.last || LP['BTC-TRY']?.last || 0), btcUsd = btcTL && r ? btcTL / r : +((S.lev?.watch || []).find((w) => w.sym === 'BTC')?.px || 0);
    const cur = OV_CUR === 'btc' && !btcUsd ? 'usd' : OV_CUR;
    const cv = (usd, d) => OV_HIDE ? '••••' : cur === 'try' ? tl(usd * r, d ?? 0) : cur === 'btc' ? '₿' + nf(usd / btcUsd, d ?? (Math.abs(usd / btcUsd) < 0.01 ? 6 : 4)) : U(usd, d ?? 2);
    const GS = S.gspotr, gE = GS ? gReal(GS) : 0;
    const fE = R?.funded ? Math.max(0, +R.equity || 0) : 0, gFree = Math.max(0, (+X.g_val || 0) - gE - fE);
    const parts = [['tr', 'Spot · OKX TR', 'i-bank', +X.tr_total || 0], ['g', 'Futures · Global', 'i-layers', R?.funded ? fE : Math.max(0, (+X.g_val || 0) - gE)], ...(gE ? [['gs', 'Global spot', 'i-globe', gE]] : []), ...(R?.funded && gFree >= 0.5 ? [['gb', 'Global boşta', 'i-globe', gFree]] : []), ['m', 'Memecoin', 'i-flask', +M?.value || 0], ['k', 'Kasa', 'i-vault', +X.kasa?.usd || 0]];
    const tot = [X.tr_total, X.g_val, X.kasa?.usd].every((v) => v != null) ? parts.reduce((a, p) => a + p[3], 0) : null;
    const sP = (liveEquity(sp) - sp.start_cash) / r, fP = R?.funded ? +R.pnl || 0 : 0, mP = M?.start ? +M.pnl || 0 : 0, gP = GS?.funded ? +GS.pnl || 0 : 0, all = sP + fP + mP + gP;
    const sum = Math.max(1, tot || 0), bar = parts.filter(p => p[3] > 0).map(p => `<i class="p${p[0]}" style="width:${(p[3] / sum * 100).toFixed(2)}%"></i>`).join('');
    const second = OV_HIDE || tot == null ? '' : cur === 'try' ? U(tot, 2) : tl(tot * r, 0);
    setH(el, `<div class="ob"><div class="oh">${ic('i-wallet')}<b>Toplam varlık</b>
      <div class="ocur">${[['usd', 'USDT'], ['btc', 'BTC'], ['try', 'TRY']].map(([k, n]) => `<button type="button" data-ovc="${k}" class="${cur === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <button type="button" class="oeye" data-ovh="1" aria-label="${OV_HIDE ? 'Tutarları göster' : 'Tutarları gizle'}">${ic(OV_HIDE ? 'i-lock' : 'i-eye')}</button></div>
    <div class="obig"><div><strong>${tot != null ? cv(tot) : '—'}</strong><small>${second}</small></div>
      <div class="adf ${OV_HIDE ? '' : cls(all)}">${OV_HIDE ? '••••' : (all >= 0 ? '▲ ' : '▼ ') + cv(Math.abs(all), cur === 'try' ? 0 : undefined)}<small>toplam kâr/zarar</small></div></div>
    <div class="abar">${bar}</div>
    <div class="oleg">${parts.map(([k, n, , v]) => `<span class="p${k}"><em></em>${n.split(' · ')[0]}<b>%${nf(v / sum * 100, 0)}</b></span>`).join('')}</div>
    ${syncAllH()}</div>`);
    {
        const b = document.getElementById('syncAll');
        if (b)
            b.onclick = () => syncAll();
    }
    el.hidden = false;
}
const ICON_BAD = new Set(), ICON_OK = new Set();
function pq(inst) { const q = String(inst).split('-')[1] || ''; return q ? `<span class="pq q-${q}">${q}</span>` : ''; }
function cico(inst, side, loss) {
    const b = sym(inst), t = b.slice(0, 4), lc = b.toLowerCase();
    const img = ICON_BAD.has(lc) ? '' : `<img class="${ICON_OK.has(lc) ? 'ok' : ''}" src="https://static.okx.com/cdn/oksupport/asset/currency/icon/${lc}.png" alt="" onload="ICON_OK.add('${lc}');this.classList.add('ok')" onerror="ICON_BAD.add('${lc}');this.remove()">`;
    const sd = side ? `<i class="sd ${side === 'SAT' ? 'sat' + (loss ? ' l' : '') : 'al'}">${side}</i>` : '';
    return `<div class="coin${t.length > 3 ? ' sm' : ''}" data-coin="${inst}">${t}${img}${sd}</div>`;
}
const spotFav = (x) => (x?.coins || []).filter((c) => c.realized > 0.005).sort((a, b) => b.realized - a.realized).slice(0, 5).map((c) => c.inst);
function renderCoins(x) {
    const box = document.getElementById('coins'), sumEl = document.getElementById('coinSum');
    const list = (x.coins || []).map(c => { const cur = c.open_qty ? sellPrice(c.inst, c.price) : 0, op = c.open_qty ? c.open_qty * cur - c.open_cost : 0; return { ...c, op, tot: c.realized + op }; }).sort((a, b) => b.tot - a.tot);
    if (!list.length) {
        setH(box, `<div class="empty">${ic('i-coins')}<div>Henüz işlem yok; ilk alımdan sonra her coin burada ayrı görünür.</div></div>`);
        setT(sumEl, '');
        return;
    }
    const T = list.reduce((a, c) => a + c.tot, 0);
    setT(sumEl, sgn(T) + ' TL', 'hsum ' + cls(T));
    const fav = new Set(spotFav(x)), ban = new Set(((orig || S?.settings)?.ban?.spot || []).map(banKey));
    setH(box, list.map(c => {
        const parts = [];
        if (c.sells)
            parts.push(`${c.sells} satış`);
        else
            parts.push(`${c.buys} alım`);
        if (c.bought)
            parts.push(tl(c.bought, 0) + ' alındı');
        const det = c.open_qty ? (c.sells ? `açıkta ${sgn(c.op)}` : 'elde') : 'kapandı';
        return `<div class="row">${cico(c.inst)}
      <div class="mid"><b>${sym(c.inst)}${pq(c.inst)}${fav.has(c.inst) ? `<i class="fst" title="Favori">${ic('i-star')}</i>` : ''}${ban.has(banKey(c.inst)) ? '<em class="lk wn in">KARA LİSTE</em>' : ''}</b><span>${parts.join(' · ')}</span></div>
      <div class="end"><span class="pill lg ${cls(c.tot) || 'z'}"><i>${c.tot >= 0 ? '▲' : '▼'}</i>${nf(Math.abs(c.tot))} TL</span><span class="est">${det}</span></div></div>`;
    }).join(''));
    clipList('coins', 5);
}
let swOpen = '', swDrag = false, swJust = 0;
const SELLING = {}, BUYING = {};
function renderPositions(x) {
    if (swDrag)
        return;
    const pos = x.positions, ps = document.getElementById('posSum'), canSell = sel === 'live' && !!x.armed;
    for (const k in SELLING)
        if (!pos.some(p => p.inst === k))
            delete SELLING[k];
    for (const k in BUYING) {
        const p0 = pos.find(p => p.inst === k);
        if (p0 && (p0.lots || 1) > BUYING[k].n)
            delete BUYING[k];
    }
    {
        const T = pos.reduce((a, p) => a + p.qty * sellPrice(p.inst, p.price) - p.cost, 0);
        setT(ps, pos.length ? `${pos.length} coin · ${sgn(T)} TL` : '', 'hsum ' + cls(T));
    }
    setH(document.getElementById('positions'), pos.length ? pos.map(p => {
        const cur = sellPrice(p.inst, p.price), val = p.qty * cur, pl = val - p.cost, plp = (val / p.cost - 1) * 100;
        const prot = p.protected === true ? `<span class="shd" title="Borsa korumalı">${ic('i-shield')}</span>` : p.protected === false ? `<span class="shd no" title="Koruma bekliyor">${ic('i-shield')}</span>` : '';
        let rng = '';
        if (p.tp && p.sl && p.tp > p.sl) {
            const lg = (px(p.sl) + px(p.tp)).length > 14, k = v => Math.max(0, Math.min(100, (v - p.sl) / (p.tp - p.sl) * 100));
            rng = `<div class="rng"><i class="av" style="left:${k(p.avg).toFixed(1)}%"></i><i class="mk ${cls(pl)}" style="left:${k(cur).toFixed(1)}%"></i></div>
        <div class="rngl"><em class="dn">${lg ? 'Zarar' : 'Zarar durdur'} ${px(p.sl)}</em><em class="up">${lg ? 'Kâr' : 'Kâr al'} ${px(p.tp)}</em></div>`;
        }
        const row = `<div class="row pos${canSell ? ' swc' : ''}">${cico(p.inst)}
      <div class="mid"><b><span class="sy">${sym(p.inst)}</span>${pq(p.inst)}${prot}${p.lots > 1 ? `<i class="kd">${p.lots} kademe</i>` : ''}</b><span>Alış ${px(p.avg)} → satış ${px(cur)}<br>${ago(p.since)} alındı${volTxt(p.inst) ? ` · hacim ${volTxt(p.inst)}` : ''}</span>${rng}</div>
      <div class="end"><b>${tl(val, 0)}</b>${SELLING[p.inst] ? `<span class="sellst"><i class="spn"></i>Satılıyor</span>` : `<span class="pill ${cls(pl) || 'z'}"><i>${pl >= 0 ? '▲' : '▼'}</i>${nf(Math.abs(pl))} TL</span><span class="est ${cls(pl)}">${spc(plp)}</span>`}</div></div>`;
        return canSell ? `<div class="swr${swOpen === p.inst ? ' open' : ''}${SELLING[p.inst] ? ' busy' : ''}" data-i="${p.inst}"><button class="swb" data-sell="${p.inst}">${ic('i-sell')}${SELLING[p.inst] ? 'Satılıyor' : 'Sat'}</button>${row}</div>` : row;
    }).join('')
        : `<div class="empty">${ic('i-box')}<div>Şu an açık pozisyon yok</div></div>`);
}
function swipeBox(box, act) {
    let sx = 0, sy = 0, el = null, dx = 0, lock = '';
    const start = (x, y, t) => { const w = t.closest('.swr'); if (!w)
        return; el = w; sx = x; sy = y; dx = 0; lock = ''; swDrag = true; w.classList.add('drag'); };
    const move = (x, y, ev) => {
        if (!el)
            return;
        const ddx = x - sx, ddy = y - sy;
        if (!lock)
            lock = Math.abs(ddx) > 8 && Math.abs(ddx) > Math.abs(ddy) ? 'x' : (Math.abs(ddy) > 8 ? 'y' : '');
        if (lock !== 'x')
            return;
        ev.preventDefault?.();
        swDrag = true;
        const base = el.classList.contains('open') ? -88 : 0;
        dx = Math.min(0, Math.max(-110, base + ddx));
        el.querySelector('.swc').style.transform = `translateX(${dx}px)`;
    };
    const end = () => {
        if (!el) {
            swDrag = false;
            return;
        }
        const c = el.querySelector('.swc');
        c.style.transform = '';
        el.classList.remove('drag');
        if (lock === 'x') {
            swOpen = dx < -44 ? el.dataset.i : '';
            box.querySelectorAll('.swr').forEach(w => w.classList.toggle('open', w.dataset.i === swOpen));
        }
        if (lock === 'x')
            swJust = Date.now();
        el = null;
        swDrag = false;
        lock = '';
    };
    box.addEventListener('touchstart', e => start(e.touches[0].clientX, e.touches[0].clientY, e.target), { passive: true });
    box.addEventListener('touchmove', e => move(e.touches[0].clientX, e.touches[0].clientY, e), { passive: false });
    box.addEventListener('touchend', end);
    box.addEventListener('touchcancel', end);
    box.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse')
        start(e.clientX, e.clientY, e.target); });
    box.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && e.buttons)
        move(e.clientX, e.clientY, e); });
    window.addEventListener('pointerup', e => { if (e.pointerType === 'mouse')
        end(); });
    box.addEventListener('click', e => {
        const b = e.target.closest('.swb');
        if (b) {
            act(b);
            return;
        }
        if (Date.now() - swJust < 400)
            return;
        if (swOpen && !e.target.closest('.swr.open .swb')) {
            swOpen = '';
            box.querySelectorAll('.swr.open').forEach(w => w.classList.remove('open'));
        }
    });
}
swipeBox(document.getElementById('positions'), b => sellCoin(b.dataset.sell));
document.getElementById('now').addEventListener('click', e => {
    const t = e.target.closest('[data-sb]');
    if (!t)
        return;
    const i = t.dataset.sb, w = NOWX?.watch, it = (w?.items || []).find((x) => x.i === i);
    const cur = it ? livePrice(i, it.p) : 0, g = it ? (cur / it.t - 1) * 100 : 0;
    openCoin(i, 'tr', [], it ? [['Alım seviyesi', `${px(+it.t)} TL`], ['Durum', it.f ? 'Düşüş filtresinde · bekliyor' : g <= 0 ? `Alım seviyesinin %${nf(-g, 1)} altında` : `Alım seviyesine %${nf(g, 1)}`]] : undefined, ['Elle al', () => openBuy(i)]);
});
swipeBox(document.getElementById('gspotBody'), () => { });
swipeBox(document.getElementById('futBody'), () => { });
swipeBox(document.getElementById('setForm'), b => { const d = BAN_DESK[STAB], v = b.dataset.unban; if (!d || v == null)
    return; const l = banList(d), i = l.indexOf(v); if (i >= 0)
    l.splice(i, 1); swOpen = ''; renderForm(); });
async function sellCoin(inst) {
    if (SELLING[inst])
        return;
    fastWatch();
    if (!token) {
        toast('Satmak için önce Ayarlar\'dan GitHub bağlantısını kur');
        return;
    }
    SELLING[inst] = Date.now();
    swOpen = '';
    if (S)
        render();
    let req = null;
    const ok = await cloudPatch((o, remote) => {
        if (remote) {
            const p = o.sell, keep = p && Date.now() - (p.ts || 0) < 90000 ? (p.insts || []) : [];
            req = { ts: Date.now(), insts: [...new Set([...keep, inst])] };
        }
        if (req)
            o.sell = req;
    }, 'Uygulamadan satış: ' + inst);
    if (!ok) {
        delete SELLING[inst];
        if (S)
            render();
        toast('Satış isteği gönderilemedi, tekrar dene', patchWhy());
        return;
    }
    toast(`${sym(inst)} satış isteği gönderildi; bot birkaç saniye içinde satar.`);
    const t0 = SELLING[inst];
    setTimeout(() => { if (SELLING[inst] === t0) {
        delete SELLING[inst];
        if (S)
            render();
    } }, 120000);
}
function openBuy(inst) {
    const x = S?.strategies?.live;
    if (!x)
        return;
    swOpen = '';
    document.querySelectorAll('.swr.open').forEach(w => w.classList.remove('open'));
    const w = x.watch || {}, it = (w.items || []).find((i) => i.i === inst) || { i: inst, p: 0, t: 0, h: 0 }, c = x.cfg || {};
    const h = +it.h || 0, lot = h <= 0 ? +c.lot : +c.lot * (h === 1 ? (c.lot2 ?? 1) : (c.lot3 ?? 1)), cash = +x.cash || 0;
    const cur = livePrice(inst, it.p), gap = it.t ? (cur / it.t - 1) * 100 : 0;
    const q = document.getElementById('qsh');
    q.dataset.n = '';
    qHead('i-buy', 'Vazgeç');
    document.getElementById('qTitle').textContent = `${sym(inst)} al`;
    const quick = [...new Set([Math.round(lot / 2), Math.round(lot), Math.round(lot * 2)].filter(v => v >= 10))], bid = 'b' + Date.now().toString(36);
    const P = (x.positions || []).find((p) => p.inst === inst), pq0 = P ? +P.qty || 0 : 0, pc0 = P ? +P.cost || 0 : 0, tp = +c.lot_tp || 0.04, stp = +c.stop || 0.5;
    const calc = (a) => {
        const q = pq0 + a / cur, cost = pc0 + a, avg = q ? cost / q : cur, val = q * cur;
        return `${P ? `<div class="pavg"><div><span>Şimdiki ortalama</span><b>${px(+P.avg || pc0 / pq0)}</b></div>${ic('i-chev')}<div><span>Alımdan sonra</span><b>${px(avg)}</b></div><div><span>Toplam</span><b>${tl(cost, 0)}</b></div></div>` : ''}
    ${pnlCalc({ u: 'TL', now: val - cost, size: val, side: 1, ref: cost, min: -50, max: 100, what: 'Fiyat şimdiden',
            marks: [['Kâr al (bu kademe)', tp * 100, a * tp * 0.996], ['Zarar durdur (hepsi)', (avg * (1 - stp) / cur - 1) * 100, -(cost * stp)]] })}`;
    };
    document.getElementById('qText').innerHTML = `<div class="xfs">
    <div class="xroute"><div>${cico(inst)}<b>${sym(inst)}</b><small>şimdi ${px(cur)}</small></div><span class="xar">${ic('i-chev')}</span><div><span class="xe e1">${ic('i-layers')}</span><b>${h + 1}. kademe</b><small>${it.t ? 'bot hedefi ' + px(it.t) : 'elle'}</small></div></div>
    ${it.t ? `<p class="xnote">${gap <= 0 ? `Fiyat botun alım hedefinin <b>altında</b>; şart oluşmuş.` : `Fiyat botun alım hedefinin <b>%${nf(gap, 1)} üstünde</b>. Bot bu fiyattan almazdı; karar senin.`}</p>` : ''}
    <div class="xlab">Tutar</div>
    <div class="xamt"><input id="bAmt" type="number" inputmode="decimal" min="10" step="1" value="${Math.round(Math.min(lot, cash)) || ''}"><span>TL</span></div>
    <div class="xq">${quick.map(v => `<button data-bq="${v}"${v > cash ? ' class="off"' : ''}>${tl(v, 0)}</button>`).join('')}<button class="xall" data-bq="${Math.floor(cash)}"${cash >= 10 ? '' : ' disabled'}>Tümü<small>${tl(cash, 0)}</small></button></div>
    <div class="xinfo">
      <div>${ic('i-coins')}<span>Boşta nakit</span><b>${tl(cash, 0)}</b></div>
      <div>${ic('i-target')}<span>Sonra</span><b>Bot yönetir: ${pp(+c.lot_tp || 0)} kârda satar, zarar durdur korur</b></div>
      ${w.room === false ? `<div>${ic('i-info')}<span>Not</span><b class="dn">Coinlere ayrılan sınır dolu; bu alım sınırı aşar</b></div>` : ''}
    </div>
    <div id="bCalc">${calc(Math.round(Math.min(lot, cash)) || lot)}</div>
    <button class="btn primary xgo" id="bGo">${ic('i-buy')}Al</button></div>`;
    const inp = document.getElementById('bAmt'), go = document.getElementById('bGo');
    const upd = () => { go.lastChild.textContent = +inp.value >= 10 ? `${tl(+inp.value, 0)} al` : 'Al'; if (+inp.value >= 1) {
        document.getElementById('bCalc').innerHTML = calc(+inp.value);
        pcInit();
    } };
    inp.oninput = upd;
    upd();
    document.querySelectorAll('[data-bq]').forEach(b => b.onclick = () => { inp.value = b.dataset.bq; upd(); });
    go.onclick = () => {
        const a = Math.round(+inp.value || 0);
        if (a < 10) {
            toast('Tutarı yaz (en az 10 TL)');
            return;
        }
        if (a > cash + 0.5) {
            toast(`Botta boşta ${tl(cash, 0)} var`);
            return;
        }
        buyCoin(inst, a, h, go, bid);
    };
    q.hidden = false;
}
async function buyCoin(inst, amt, h, btn, id) {
    if (!token) {
        toast('Almak için önce Ayarlar\'dan GitHub bağlantısını kur');
        return;
    }
    if (btn?.disabled)
        return;
    if (btn)
        btn.disabled = true;
    fastWatch();
    const req = { id: id || 'b' + Date.now().toString(36), ts: Date.now(), inst, amt };
    const ok = await cloudPatch(o => { const p = o.buy, l = Array.isArray(p) ? p : []; if (!l.some(r => r.id === req.id))
        o.buy = [...l.filter((r) => Date.now() - (r.ts || 0) < 600000), req]; }, 'Uygulamadan alım: ' + inst + ' ' + amt + ' TL');
    if (!ok) {
        if (btn)
            btn.disabled = false;
        toast('Alım isteği gönderilemedi, tekrar dene', patchWhy());
        return;
    }
    document.getElementById('qsh').hidden = true;
    BUYING[inst] = { t: Date.now(), n: h };
    if (S)
        render();
    toast(`${sym(inst)} alım isteği gönderildi; bot birkaç saniye içinde ${tl(amt, 0)} alır.`);
    const t0 = BUYING[inst].t;
    setTimeout(() => { if (BUYING[inst]?.t === t0) {
        delete BUYING[inst];
        if (S)
            render();
    } }, 120000);
}
function pnlCalc(o) {
    const f = (v) => pcFmt(v, o.u);
    return `<div class="pcs" data-now="${o.now}" data-size="${o.size}" data-side="${o.side}" data-ref="${o.ref}" data-u="${o.u}">
    <div class="xlab">Ne kazanırım, ne kaybederim</div>
    <div class="pcm">${o.marks.map(([l, mv, v]) => `<div class="${v >= 0 ? 'up' : 'dn'}"><span>${l}</span><b>${f(v)}</b><small>fiyat ${mv >= 0 ? '+' : '−'}%${nf(Math.abs(mv), 1)}</small></div>`).join('')}</div>
    <div class="pcr"><span>${o.what || 'Fiyat'} değişirse</span><b class="pcp">%0</b></div>
    <input type="range" min="${o.min}" max="${o.max}" step="1" value="0">
    <div class="pco"></div></div>`;
}
function pcFmt(v, u) { const a = Math.abs(v), s = a < 0.005 ? '' : v < 0 ? '−' : '+'; return u === 'TL' ? `${s}${nf(a, a >= 100 ? 0 : 2)} TL` : `${s}${U(a, 2)}`; }
function pcUpd(el) {
    const r = el.querySelector('input'), p = +r.value, d = el.dataset, v = +d.now + (+d.side) * (+d.size) * p / 100, ref = +d.ref;
    el.querySelector('.pcp').textContent = (p > 0 ? '+' : p < 0 ? '−' : '') + '%' + Math.abs(p);
    const o = el.querySelector('.pco');
    o.className = 'pco ' + (v >= 0.005 ? 'up' : v <= -0.005 ? 'dn' : 'z');
    o.innerHTML = `<b>${pcFmt(v, d.u)}</b><span>${Math.abs(v) < 0.005 ? 'kâr da zarar da yok' : ref > 0 ? `yatırdığının %${nf(Math.abs(v / ref * 100), 1)}'i ${v >= 0 ? 'kâr' : 'zarar'}` : ''}</span>`;
    const pc = (p - +r.min) / (+r.max - +r.min) * 100;
    r.style.setProperty('--pc', pc.toFixed(1) + '%');
}
document.addEventListener('input', e => { const el = e.target.closest?.('.pcs'); if (el)
    pcUpd(el); });
function pcInit() { document.querySelectorAll('#qText .pcs').forEach(pcUpd); }
function feedTxt(raw) {
    const parts = escH(String(raw).replace(/^kapatma emri (\S+)/, '$1 kapatma emri')).split(' · ');
    let head = parts.shift() || '';
    head = head.replace(/^((?:%\d+\s+)?[^\s:]+)(:?)/, '<b>$1</b>$2');
    const m = parts.length ? /^([+\-−]\$?\d[\d.,]*\$?|\$?\d[\d.,]*\$)(?:\s+\((.+)\))?$/.exec(parts[0].trim()) : null;
    if (m) {
        parts.shift();
        if (m[2])
            parts.unshift(m[2]);
        head += ` <span class="${/^[-−]/.test(m[1]) ? 'dn' : 'up'}">${m[1].replace(/^-/, '−')}</span>`;
    }
    return `<span class="fh">${ut(head)}</span>${parts.length ? `<small>${ut(parts.join(' · '))}</small>` : ''}`;
}
function renderRules(R, c) {
    const rows = c ? [
        ['i-coins', (c.lot2 ?? 1) === 1 && (c.lot3 ?? 1) === 1 ? tl(c.lot, 0) : `${nf(c.lot, 0)}·${nf(c.lot * (c.lot2 ?? 1), 0)}·${tl(c.lot * (c.lot3 ?? 1), 0)}`, '1., 2. ve 3. kademe tutarı'],
        ['i-layers', c.max_coins + ' coin', 'Aynı anda en fazla'],
        ['i-grid', c.max_lots + ' kademe', 'Bir coinde en fazla'],
        ['i-pnl', pp(c.lot_tp) + ' kâr', 'Her kademe ayrı satılır'],
        ['i-stop', pp(c.stop) + ' zarar', 'Ortalamanın altına inerse hepsini satar'],
        ['i-wallet', pp(c.max_use, 0) + ' bütçe', 'Aynı anda coinde en fazla'],
        ['i-calx', tl(R.daily_loss_limit, 0), 'Günlük kayıp sınırı'],
        ['i-power', tl(R.kill_switch, 0), 'Altına inerse acil fren']
    ] : [
        ['i-coins', tl(R.trade_size, 0), 'İşlem başına en fazla'],
        ['i-layers', R.max_positions + ' pozisyon', 'Aynı anda en fazla'],
        ['i-stop', '%' + nf(R.stop_loss * 100, 1) + ' zarar', 'Bu noktada otomatik satar'],
        ['i-calx', tl(R.daily_loss_limit, 0), 'Günlük kayıp sınırı'],
        ['i-power', tl(R.kill_switch, 0), 'Altına inerse acil fren']
    ];
    rows.push(['i-info', '%' + nf((S.fee + S.slippage) * 100, 2), 'Komisyon + kayma (tek yön)']);
    setH(document.getElementById('rules'), rows.map(([i, b, s]) => `<div class="rule"><div class="ic">${ic(i)}</div><div><b>${b}</b><span>${s}</span></div></div>`).join(''));
    setT(document.getElementById('rulesSum'), c ? `Zarar kes ${pp(c.stop)} · acil fren ${tl(R.kill_switch, 0)} · günlük sınır ${tl(R.daily_loss_limit, 0)}` : `Zarar kes %${nf(R.stop_loss * 100, 1)} · acil fren ${tl(R.kill_switch, 0)}`);
}
const LP = {};
let mkTimer = null, mkBusy = false, lastTick = 0;
function marketList() {
    const x = S?.strategies?.[sel];
    const held = x && !x.locked ? x.positions.map(p => p.inst) : [];
    return [...new Set([...held, ...(S?.universe || [])])];
}
async function pollMarket() {
    clearTimeout(mkTimer);
    if (!S)
        return;
    if (document.hidden) {
        mkTimer = setTimeout(pollMarket, 3000);
        return;
    }
    if (!mkBusy) {
        mkBusy = true;
        try {
            const list = new Set(marketList());
            const r = await tfetch('https://tr.okx.com/api/v5/market/tickers?instType=SPOT', { cache: 'no-store' }, 6000).then(r => r.json()).catch(() => null);
            const all = r?.data || [], byId = new Map(all.map(t => [t.instId, t])), L_ = i => +(byId.get(i)?.last || 0), usd = L_('USDT-TRY');
            if (usd)
                USDTTRY = usd;
            const K = { TRY: 1, USDT: usd, USDC: usd * L_('USDC-USDT'), EUR: L_('USDT-EUR') ? usd / L_('USDT-EUR') : 0 };
            const rows = all.filter(t => K[String(t.instId).split('-')[1]]);
            okxDown = !rows.length;
            if (okxDown && !lastTick) {
                const tg = document.getElementById('liveTag');
                setH(tg, '<i></i>Erişilemiyor');
                tg.classList.remove('on');
            }
            rows.forEach(t => {
                const inst = t.instId, k = K[inst.split('-')[1]], last = +t.last * k;
                if (!last)
                    return;
                const prev = LP[inst]?.last;
                LP[inst] = { last, bid: +t.bidPx * k || 0, vol: +t.volCcy24h * k, ch: (+t.last / (+t.open24h) - 1) * 100, dir: prev == null ? 0 : Math.sign(last - prev), ts: +t.ts };
                if (list.has(inst))
                    lastTick = Math.max(lastTick, +t.ts);
            });
            const tag = document.getElementById('liveTag');
            if (lastTick) {
                const d = new Date(lastTick), p = (n, l = 2) => String(n).padStart(l, '0');
                setH(tag, `<i></i>Canlı · ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`);
                tag.classList.add('on');
            }
            const x = S.strategies[sel];
            if (spotOn()) {
                if (x && !x.locked) {
                    renderMetrics(x);
                    renderPositions(x);
                    renderCoins(x);
                    renderNow(x);
                }
                renderMarket();
            }
            else if (VIEW === 'kasa' && x && !x.locked)
                renderXfer();
            updLine();
            renderDeck();
        }
        catch (e) {
            document.getElementById('liveTag').classList.remove('on');
        }
        mkBusy = false;
    }
    mkTimer = setTimeout(pollMarket, document.getElementById('mainv').hidden ? 8000 : 2000);
}
let okxDown = false;
function renderMarket() {
    const list = marketList(), box = document.getElementById('market');
    if (okxDown && !list.some(i => LP[i])) {
        box.className = 'card list mk';
        setH(box, `<div class="empty">${ic('i-info')}<div>OKX TR'ye ulaşılamıyor. VPN açıksa OKX TR yurt dışı bağlantıyı engelliyor olabilir; VPN'i kapatınca canlı fiyatlar gelir. Bot bundan etkilenmez.</div></div>`);
        return;
    }
    const all = list.filter(i => LP[i]).sort((a, b) => LP[b].vol - LP[a].vol), rows = mkAll ? all : all.slice(0, 6);
    box.className = 'card list mk';
    const mkH = rows.length ? rows.map(i => {
        const q = LP[i];
        return `<div class="row">${cico(i)}<div class="mid"><b>${sym(i)}${pq(i)}</b><span>Hacim ${volTxt(i)} · 24 sa</span></div>
      <div class="end"><b class="pxv ${q.dir > 0 ? 'flash-up' : q.dir < 0 ? 'flash-dn' : ''}">${px(q.last)}</b><span class="pill ${cls(q.ch) || 'z'}"><i>${q.ch >= 0 ? '▲' : '▼'}</i>%${nf(Math.abs(q.ch))}</span></div></div>`;
    }).join('')
        + (all.length > 6 ? `<button class="more" id="mkMore">${mkAll ? 'Daha az göster' : `Tümünü göster (${all.length} coin)`}</button>` : '')
        : `<div class="empty">${ic('i-pnl')}<div>Fiyatlar yükleniyor…</div></div>`;
    if (setH(box, mkH)) {
        const mb = document.getElementById('mkMore');
        if (mb)
            mb.onclick = () => { mkAll = !mkAll; renderMarket(); };
    }
}
let mkAll = false;
document.addEventListener('visibilitychange', () => { if (!document.hidden)
    pollMarket(); });
function okxLine() {
    const o = S.okx;
    if (!o)
        return '';
    return `<div class="okx ${o.ok ? 'ok' : 'bad'}">${ic(o.ok ? 'i-check' : 'i-info')}<span>OKX TR: ${o.status || (o.ok ? 'bağlı' : 'bağlanamadı')}${o.ok ? ` · boşta ${tl(o.try)}${o.usdt_tl ? ` + ${tl(o.usdt_tl)} (${o.quote || 'USDT'})` : ''}` : ''}</span></div>`;
}
function renderKasa(x) {
    const box = document.getElementById('kasa');
    if (!x.live || !x.kasa) {
        setH(box, '');
        return;
    }
    const active = x.start_cash, reserve = Math.max(0, x.kasa - active), aw = Math.min(100, active / x.kasa * 100);
    const T = S?.settings?.topup || { amount: 600, profit_pct: 5, days: 1 }, amt = +T.amount || 0;
    const target = x.checkpoint * (1 + (+T.profit_pct || 5) / 100), prog = Math.max(0, Math.min(1, (liveEquity(x) - x.checkpoint) / (target - x.checkpoint || 1)));
    const waitMs = x.last_topup ? Math.max(0, x.last_topup + (+T.days || 0) * 864e5 - Date.now()) : 0, waitD = Math.ceil(waitMs / 864e5);
    const full = amt <= 0 || reserve < amt;
    setH(box, `<div class="card kasa">
    <div class="top"><b>${ic('i-wallet')}Kasa<button class="qm" data-q="kasa" aria-label="Açıklama">?</button></b><span>${tl(x.kasa, 0)}</span></div>
    ${okxLine()}
    <div class="split"><i style="width:${aw}%;background:var(--amber)"></i></div>
    <div class="kv"><div>Botta aktif<b>${tl(active, 0)}</b></div><div>Kasada yedek<b>${tl(reserve, 0)}</b></div><div>Eklemeler<b>${x.topups} kez</b></div></div>
    <div class="prog">${full ? `<div class="lbl"><span>${amt <= 0 ? 'Kasadan ekleme kapalı.' : 'Kasada ekleme için yeterli yedek yok; yeni ekleme yapılmayacak.'}</span></div>`
        : `<div class="lbl"><span>Sonraki +${tl(amt, 0)} için kâr hedefi</span><b>${tl(liveEquity(x), 0)} / ${tl(target, 0)}</b></div>
      <div class="bar2"><i style="width:${(prog * 100).toFixed(1)}%"></i></div>
      <div class="hint">Aktif para son eklemeden beri %${nf(+T.profit_pct || 5, (+T.profit_pct || 5) % 1 ? 1 : 0)} kâra ulaşınca${waitD ? ` ve ${waitD} gün daha geçince` : ''} kasadan +${tl(amt, 0)} eklenir. Zarardayken ekleme yapılmaz. Başlangıç parası ve kurallar Ayarlar ekranından değiştirilebilir.</div>`}
    </div></div>`);
}
function renderLog(x) {
    const sec = document.getElementById('logSec');
    if (!x.live) {
        sec.hidden = true;
        return;
    }
    sec.hidden = false;
    setT(document.getElementById('logSum'), x.log.length ? 'Son not: ' + x.log[0][1] : 'Henüz kayıt yok');
    const kind = (t) => /^AL /.test(t) ? ['b', 'AL'] : /^SAT /.test(t) ? (/sonuç −|sonuç -/.test(t) ? ['dn', 'SAT'] : ['up', 'SAT'])
        : /koruma/i.test(t) ? ['sh', 'KORUMA'] : /HATA|uyarı|alınamad|yapılamad/i.test(t) ? ['dn', 'UYARI'] : ['z', 'BİLGİ'];
    setH(document.getElementById('log'), x.log.length ? x.log.map(([ts, t]) => {
        const s = String(t).replace(/</g, '&lt;').replace(/^\[deneme\] /, ''), [c, lb] = kind(s), parts = s.split(' · ');
        return `<div class="xl lg"><time>${dt(ts).split(' ')[1]}<small>${dt(ts).split(' ')[0]}</small></time><em class="lk ${c}">${lb}</em><div><b>${parts[0].replace(/^(AL|SAT) /, '')}</b>${parts.length > 1 ? `<small>${parts.slice(1).join(' · ')}</small>` : ''}</div></div>`;
    }).join('')
        : `<div class="empty">${ic('i-info')}<div>Henüz kayıt yok</div></div>`);
}
function renderBacktest() {
    const box = document.getElementById('backtest');
    if (!B) {
        setH(box, `<div class="empty">${ic('i-flag')}<div>Geçmiş test sonucu henüz yok</div></div>`);
        return;
    }
    const rows = Object.entries(B.results).sort((a, b) => b[1].pnl_pct - a[1].pnl_pct);
    setH(box, rows.map(([k, r], i) => `<div class="row ${i === 0 ? 'best' : ''}"><div class="rank">${i + 1}</div>
      <div class="mid"><b>${r.name}${k === sel ? ' · seçili' : ''}</b><span>${r.trades} işlem · kazanma %${nf(r.win_rate, 0)} · en büyük düşüş %${nf(r.max_drawdown, 1)}</span></div>
      <div class="end"><b class="${cls(r.pnl_pct)}">${spc(r.pnl_pct)}</b><span>${tl(r.final, 0)}</span></div></div>`).join('')
        + `<div class="note">${B.custom ? `<b>Senin istediğin ayarlarla</b> (${dt(B.generated)}). ` : ''}Son ${B.days} gün, ${B.symbols.length} coin, gerçek OKX TR fiyatları, komisyon dahil. Aynı coinleri alıp hiç dokunmamak (al-tut): <b class="${cls(B.hold_pct)}">${spc(B.hold_pct)}</b>. Geçmiş sonuç geleceği garanti etmez.</div>`);
}
function renderChart() {
    const box = document.getElementById('chartBox'), leg = document.getElementById('legend'), note = document.getElementById('chartNote');
    const src = view === 'live' ? Object.fromEntries(Object.entries(S.strategies).filter(([k, v]) => v.equity_series && (k === 'live' || !S.strategies.live || S.strategies.live.locked)).map(([k, v]) => [k, v.equity_series]))
        : (B ? Object.fromEntries(Object.entries(B.results).map(([k, v]) => [k, v.equity])) : {});
    setT(note, view === 'live' ? (S.created ? 'Başlangıç ' + dt(S.created).split(' ')[0] : '') : (B ? 'Son ' + B.days + ' gün' : ''));
    for (const k in src) {
        const st = view === 'live' ? (S.strategies[k]?.start_cash || S.start_cash) : S.start_cash;
        src[k] = [...src[k]].sort((a, b) => a[0] - b[0]).map(([t, v, b0]) => [t, (v / (b0 || st) - 1) * 100]);
    }
    const pts = Object.values(src).flat();
    if (pts.length < 4 || Object.values(src).every(s => s.length < 2)) {
        setH(box, `<div class="empty">${ic('i-chart')}<div>${view === 'live' ? 'Grafik için veri birikiyor. Bot saatte bir nokta ekler.' : 'Geçmiş test verisi yok'}</div></div>`);
        setH(leg, '');
        return;
    }
    const W = 520, H = 170, pl = 4, pr = 4, pt = 10, pb = 18;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]).concat([0]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pad = (y1 - y0) * .12 || 1;
    y0 -= pad;
    y1 += pad;
    const X = t => pl + (t - x0) / (x1 - x0 || 1) * (W - pl - pr), Y = v => pt + (1 - (v - y0) / (y1 - y0)) * (H - pt - pb);
    const path = s => s.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ');
    let g = `<line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--zero)" stroke-dasharray="4 4" stroke-width="1"/>`;
    {
        const z = Y(0), zl = z + 12 > H - pb - 16 ? z - 5 : z + 12;
        g += `<text x="2" y="${zl}" font-size="10" fill="var(--faint)">Başlangıç %0</text>`;
        if (pt + 8 < zl - 14)
            g += `<text x="2" y="${pt + 8}" font-size="10" fill="var(--faint)">${spc(y1, 1)}</text>`;
        if (H - pb - 3 > zl + 14)
            g += `<text x="2" y="${H - pb - 3}" font-size="10" fill="var(--faint)">${spc(y0, 1)}</text>`;
    }
    const order = Object.keys(src).filter(k => k !== sel).concat(src[sel] ? [sel] : []);
    for (const k of order) {
        const s = src[k];
        if (s.length < 2)
            continue;
        const on = k === sel;
        g += `<path d="${path(s)}" fill="none" stroke="${on ? AMBER : COLORS[k]}" stroke-width="${on ? 2.4 : 1.3}" stroke-opacity="${on ? 1 : .45}" stroke-linejoin="round"/>`;
        if (on) {
            const l = s[s.length - 1];
            g += `<circle cx="${X(l[0])}" cy="${Y(l[1])}" r="3.5" fill="${AMBER}" stroke="var(--surface)" stroke-width="1.5"/>`;
        }
    }
    g += `<text x="2" y="${H - 4}" font-size="10" fill="#9AA1AC">${dt(x0).split(' ')[0]}</text><text x="${W - 2}" y="${H - 4}" text-anchor="end" font-size="10" fill="#9AA1AC">${dt(x1).split(' ')[0]}</text>`;
    setH(box, `<svg id="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>`);
    setH(leg, Object.keys(src).map(k => `<span><i style="background:${k === sel ? AMBER : COLORS[k]};opacity:${k === sel ? 1 : .6}"></i>${S.strategies[k]?.name || k}</span>`).join(''));
}
document.getElementById('seg').onclick = e => {
    const b = e.target.closest('button');
    if (!b)
        return;
    view = b.dataset.v;
    document.querySelectorAll('#seg button').forEach(x => x.classList.toggle('on', x === b));
    renderChart();
};
document.getElementById('reload').onclick = openCloud;
const REPO = (() => {
    const h = location.hostname, m = h.match(/^([^.]+)\.github\.io$/);
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return m && seg ? { o: m[1], r: seg } : { o: 'tcmustafacelik', r: 'masal' };
})();
const API = `https://api.github.com/repos/${REPO.o}/${REPO.r}/contents/docs/ayarlar.json`;
let token = localStore('masal_token') || '', orig = null, draft = null, sellArm = 0;
const SNAMES = { grid: 'Kademeli', dip: 'Düşüşte al', trend: 'Trend takibi' };
const P = (o, k) => k.split('.').reduce((a, x) => a?.[x], o);
const SETP = (o, k, v) => { const ks = k.split('.'); const last = ks.pop(); ks.reduce((a, x) => a[x], o)[last] = v; };
const MIN_ORDER = 10;
const pctTL = (p) => tl((draft.budget || 0) * p / 100, 0);
const sizeTL = (p) => { const v = (draft.budget || 0) * p / 100; return v < MIN_ORDER ? `${tl(v, 2)} (${MIN_ORDER} TL altı, alım yapılamaz)` : tl(v, 0); };
function checks(d = draft, o = orig || {}, diff = true) {
    const out = [], T = (v, dd = 0) => tl(v, dd);
    const b = +d.budget || 0, k = +d.kasa || 0, st = d.strategy, fee = ((S?.fee || .0025) + (S?.slippage || .001)) * 100;
    const per = st === 'grid' ? b * d.grid.lot_pct / 100 : b * d.risk.trade_pct / 100;
    const maxUse = st === 'grid' ? Math.min(per * d.grid.max_lots * d.grid.max_coins, b * (d.grid.use_pct ?? 40) / 100) : per * d.risk.max_positions;
    const add = (lv, t, dsc) => out.push({ lv, t, dsc });
    if (per < MIN_ORDER)
        add('bad', 'Hiç alım yapılmaz', `Her alım ${T(per, 2)} çıkıyor; bot ${MIN_ORDER} TL'nin altındaki emirleri göndermez. ${st === 'grid' ? 'Kademe büyüklüğünü' : 'İşlem büyüklüğünü'} en az %${Math.ceil(MIN_ORDER * 100 / Math.max(b, 1))} yap ya da bottaki parayı artır.`);
    const L = S?.strategies?.live, inv = L && !L.locked ? (L.positions || []).reduce((a, p) => a + (p.cost || 0), 0) : 0;
    if (d.live && S?.okx && S.okx.try != null) {
        const free = S.okx.try + (S.okx.usdt_tl || 0);
        if (free < per)
            add('bad', 'OKX\'te para yetmiyor', `Alım-satım hesabında ${T(free, 2)} var; bir alım için ${T(per)} gerekir. Fonlama'dan Alım-satım'a aktar.`);
        else if (free + inv < b * 0.97)
            add('warn2', 'OKX\'te para az', `Bot ${T(b)} ile çalışacak ama alım-satım hesabında ${T(free)} boşta${inv ? ` ve ${T(inv)} coinde` : ''} var.`);
    }
    if (maxUse > b * 1.001 && per >= MIN_ORDER)
        add('warn2', 'Para bütün kademelere yetmez', `Hepsi dolarsa ${T(maxUse)} gerekir, botta ${T(b)} var; son alımlar yapılamaz. ${st === 'grid' ? 'Kademe ya da coin sayısını' : 'Pozisyon sayısını'} azalt veya parayı artır.`);
    if (k < b)
        add('warn2', 'Kasa bottaki paradan küçük', `Kasa ${T(k)}, botta ${T(b)}. Kasadan ekleme hiç çalışmaz; kasayı en az ${T(b)} yap.`);
    else if (d.topup.amount > 0 && k - b < d.topup.amount)
        add('info', 'Kasadan ekleme yapılamaz', `Kasada eklenecek ${T(k - b)} kalıyor; ${T(d.topup.amount)}'lik ekleme için yetmez.`);
    const tp = st === 'grid' ? d.grid.lot_tp_pct : st === 'dip' ? d.dip.take_profit_pct : null;
    if (tp != null && tp <= fee * 2)
        add('warn2', 'Kâr hedefi masrafı karşılamıyor', `Alış ve satışta toplam ~%${nf(fee * 2, 2)} komisyon ve kayma gidiyor; %${nf(tp, 1)} kâr hedefi neredeyse hiç kazandırmaz.`);
    if (diff && orig && JSON.stringify(o) !== JSON.stringify(clean(d))) {
        const ch = [];
        if (o.budget !== d.budget)
            ch.push(`Bottaki para ${T(o.budget)} → <b>${T(b)}</b>; fark ${b > o.budget ? 'kullanılabilir paraya eklenir' : 'kullanılabilir paradan düşülür'}, coinler satılmaz`);
        const oper = o.strategy === 'grid' ? o.budget * o.grid.lot_pct / 100 : o.budget * o.risk.trade_pct / 100;
        if (Math.abs(oper - per) > .005)
            ch.push(`Her alım ${T(oper, oper < 10 ? 2 : 0)} → <b>${T(per, per < 10 ? 2 : 0)}</b>`);
        const ok_ = o.budget * (1 - o.risk.kill_pct / 100), nk = b * (1 - d.risk.kill_pct / 100);
        if (Math.abs(ok_ - nk) > .5)
            ch.push(`Acil fren ${T(ok_)} altı → <b>${T(nk)} altı</b>`);
        const od = o.budget * o.risk.daily_loss_pct / 100, nd = b * d.risk.daily_loss_pct / 100;
        if (Math.abs(od - nd) > .5)
            ch.push(`Günlük kayıp sınırı ${T(od)} → <b>${T(nd)}</b>`);
        if (o.live !== d.live)
            ch.push(d.live ? '<b>Gerçek emir</b> başlar' : 'Deneme moduna geçilir; elde kalan coinler satılmaz');
        if (o.strategy !== d.strategy)
            ch.push(`Strateji ${SNAMES[o.strategy]} → <b>${SNAMES[d.strategy]}</b>${o.live ? '; eski stratejinin coinleri satılır' : ''}`);
        if ((o.quote || 'USDT') !== (d.quote || 'USDT'))
            ch.push(`Yeni alımlar <b>${d.quote}</b> paritesinden yapılır; eldeki coinler kendi paritesinde satılır`);
        if (!!o.target?.on !== !!d.target?.on || (d.target?.on && (o.target?.amount !== d.target?.amount || o.target?.mode !== d.target?.mode)))
            ch.push(d.target?.on ? (d.target.mode === 'total' ? `Kasa dahil toplam para <b>${T(d.target.amount)}</b> olunca` : `Toplam kâr <b>${T(d.target.amount)}</b> olunca`) + ' bütün coinler satılır ve bot durur' : 'Kâr hedefi kapanır; bot olduğu gibi devam eder');
        if (!!o.grid?.instant !== !!d.grid?.instant)
            ch.push(d.grid?.instant ? '<b>Anlık alım</b> açılır: fiyat alım seviyesine değince hemen alır' : 'Anlık alım kapanır: 15 dakikalık mum kapanışı beklenir');
        if (o.paused !== d.paused)
            ch.push(d.paused ? 'Yeni alım <b>durur</b>; korumalar çalışmaya devam eder' : 'Bot yeniden alım yapmaya başlar');
        if (ch.length)
            add('info', 'Kaydedince ne olacak', ch.join('<br>'));
    }
    if (diff && L && !L.locked && d.budget < (o.budget || 0)) {
        const cash = L.cash || 0, cut = (o.budget || 0) - d.budget;
        if (cut > cash)
            add('info', 'Bütçe yatırılmış paranın altına iniyor', `Boşta ${T(cash)} var; kalan ${T(cut - cash)} coinler satıldıkça düşülür. Hiçbir coin zorla satılmaz.`);
    }
    if (!out.some(x => x.lv === 'bad' || x.lv === 'warn2'))
        out.unshift({ lv: 'ok', t: 'Ayarlar uyumlu', dsc: `Her alım ${T(per, per < 10 ? 2 : 0)} · en çok ${T(Math.min(maxUse, b))} kullanılır · acil fren ${T(b * (1 - d.risk.kill_pct / 100))} altında · günlük kayıp sınırı ${T(b * d.risk.daily_loss_pct / 100)}` });
    return out;
}
function homeChecks() {
    const el = document.getElementById('homeChk');
    if (!el)
        return;
    const st = S?.settings;
    if (!st || !st.grid) {
        setH(el, '');
        return;
    }
    let list = [];
    try {
        list = checks(st, st, false).filter(c => c.lv === 'bad' || c.lv === 'warn2');
    }
    catch (e) { }
    setH(el, list.length ? `<section style="margin-top:12px"><div class="card chk">${list.map(c => `<div class="ck ${c.lv}"><span class="ci">${ic(c.lv === 'bad' ? 'i-stop' : 'i-info')}</span><div><b class="t">${c.t}</b><span class="d">${c.dsc}</span></div></div>`).join('')}
    <button class="btn sm" style="margin:2px 0 10px" onclick="document.getElementById('openSet').click()">${ic('i-gear')}Ayarlara git</button></div></section>` : '');
}
function testInfo() {
    const req = orig?.test_req, cu = B?.custom;
    if (req && (!cu || cu.ts !== req.ts))
        return `<div class="ck info"><span class="ci">${ic('i-refresh')}</span><div><b class="t">Test çalışıyor…</b><span class="d">Son 30 günün 15 dakikalık fiyatlarıyla deneniyor; 3–4 dakika sürer. Bot bu sırada çalışmaya devam eder.</span></div></div>`;
    if (cu && B?.results) {
        const r = B.results[cu.strategy] || Object.values(B.results)[0];
        return `<div class="ck ${r.pnl_pct >= 0 ? 'ok' : 'warn2'}"><span class="ci">${ic('i-flag')}</span><div><b class="t">Test sonucu: ${r.name} ${spc(r.pnl_pct)}</b><span class="d">${dt(B.generated)} · istediğin ayarlarla son ${B.days} gün · ${r.trades} satış · kazanma %${nf(r.win_rate, 0)} · en büyük düşüş %${nf(r.max_drawdown, 1)} · hiç dokunmasan %${nf(B.hold_pct)}</span></div></div>`;
    }
    return '';
}
function updateChecks() {
    const el = document.getElementById('checks');
    if (!el || !draft)
        return;
    const IC = { bad: 'i-stop', warn2: 'i-info', info: 'i-refresh', ok: 'i-check' };
    el.innerHTML = checks().map(c => `<div class="ck ${c.lv}"><span class="ci">${ic(IC[c.lv])}</span><div><b class="t">${c.t}</b><span class="d">${c.dsc}</span></div></div>`).join('') + testInfo()
        + `<button class="btn sm" id="runTest" style="margin:2px 0 10px">${ic('i-flag')}Bu ayarlarla son 30 günü test et</button>`;
    const b = document.getElementById('runTest');
    if (b)
        b.onclick = () => {
            const s0 = clean(draft);
            delete s0.test_req;
            delete s0._bad;
            const keep = JSON.parse(JSON.stringify(orig));
            keep.test_req = { ts: Date.now(), s: s0 };
            save(keep, 'Test istendi; sonuç 3–4 dakikada burada görünür. Ayarların değişmedi.', true);
        };
}
const SECTIONS = [
    { t: 'Kasa', i: 'i-wallet', f: [
            ['budget', 'Bottaki başlangıç parası', 'Botun işlem yaptığı para', 'TL', 100, 100, 1e7, 0],
            ['kasa', 'Kasa', 'Hesaptaki toplam; bot aşmaz', 'TL', 500, 500, 1e8, 0]
        ] },
    { t: 'Kasadan ekleme', i: 'i-plus', f: [
            ['topup.amount', 'Ekleme tutarı', 'Her kâr hedefinde kasadan', 'TL', 100, 0, 1e7, 0],
            ['topup.profit_pct', 'Kâr hedefi', 'Son eklemeden beri', '%', .5, .5, 100, 1],
            ['topup.days', 'Bekleme süresi', 'İki ekleme arasında en az', 'gün', 1, 0, 365, 0]
        ] },
    { t: 'Koruma', i: 'i-shield', f: [
            ['risk.stop_pct', 'Zarar sınırı', 'Bu zararda otomatik satılır', '%', .5, .5, 50, 1],
            ['risk.daily_loss_pct', 'Günlük kayıp sınırı', () => `Şu an ${pctTL(draft.risk.daily_loss_pct)}; aşılırsa o gün alım yok`, '%', .5, .5, 50, 1],
            ['risk.kill_pct', 'Acil fren', () => `${tl(draft.budget * (1 - draft.risk.kill_pct / 100), 0)} altında her şey satılır`, '%', 1, 1, 90, 0],
            ['risk.max_positions', 'En fazla pozisyon', 'Aynı anda tutulan coin', 'adet', 1, 1, 30, 0],
            ['risk.trade_pct', 'İşlem büyüklüğü', () => `Bottaki paranın; şu an ${sizeTL(draft.risk.trade_pct)}`, '%', 1, 1, 100, 0]
        ] },
    { t: 'Kâr hedefi', i: 'i-flag', f: [
            ['target.amount', 'Hedef kâr', () => `Bu kârda her şey satılır, bot durur`, 'TL', 500, 100, 1e8, 0]
        ] },
    { t: 'Futures', i: 'i-layers', sw: [['lev.real', 'Gerçek parayla işlem', 'Kararlar OKX Global\'de gerçek parayla uygulanır'], ['lev.fast', 'Al-kaç modu', '15 dakikalık mumlarla karar verir: 4 kat daha sık işlem, kâr 1 ATR\'yi geçince stop peşine düşer. Zarar sınırları aynı kalır'], ['lev.trend_on', 'Eğilim filtresi', 'Kapalıysa yalnız kırılım yönü karar verir (daha çok işlem, daha riskli)'], ['lev.cross_ok', 'Global spot ile ters pozisyon', 'Açık: Global spot\'ta elde olan coinde futures kısa açabilir (ve tersi); masalar kendi kuralını tam uygular. Kapalı: açılmaz, ücret iki kez ödenmez']], f: [
            ['lev.real_budget', 'Bütçe', 'Global fon hesabından futures\'a geçecek para', 'USDT', 5, 5, 10000, 0],
            ['lev.max_loss', 'En fazla kayıp', 'Toplam zarar buna ulaşınca masa tamamen durur', 'USDT', 5, 1, 10000, 0],
            ['lev.real_lev', 'Kaldıraç', 'İzole marjin; güvenlik için en fazla 3x', 'x', 1, 1, 3, 0],
            ['lev.risk_pct', 'İşlem başına risk', 'Zarar durdurmaya kadar kaybedilecek; kasanın', '%', .5, .5, 5, 1],
            ['lev.max_pos', 'En fazla pozisyon', 'Aynı anda açık', 'adet', 1, 1, 10, 0],
            ['lev.brk_h', 'Kırılım süresi', 'Fiyat son bu kadar saatin zirvesini/dibini kırınca işlem açılır; kısa = daha sık işlem', 'saat', 1, 4, 48, 0],
            ['lev.trend_h', 'Eğilim ortalaması', 'İşlem bu ortalamanın yönünde açılır', 'saat', 10, 50, 280, 0],
            ['lev.daily_loss_pct', 'Günlük zarar sınırı', 'Aşılırsa pozisyonlar kapanır, o gün işlem yok', '%', 1, 1, 20, 0],
            ['lev.sl_atr', 'Zarar durdur mesafesi', 'Saatlik oynaklığın (ATR) katı', 'kat', .5, 1, 5, 1],
            ['lev.tp_atr', 'Kâr al mesafesi', 'Saatlik oynaklığın (ATR) katı', 'kat', .5, 1, 10, 1]
        ] },
    { t: 'Memecoin', i: 'i-flask', sw: [['meme.on', 'Memecoin masası açık', 'Kapalıyken token taranmaz, alım yapılmaz'], ['meme.real', 'Gerçek parayla işlem', 'Kararlar MEME cüzdanında gerçek parayla uygulanır']], f: [
            ['meme.max_loss', 'En fazla kayıp', 'Toplam zarar buna ulaşınca masa durur, tokenler satılır', 'USDT', 5, 1, 10000, 0],
            ['meme.max_slip', 'En fazla fiyat etkisi', 'Bunu aşan alım reddedilir', '%', .5, .5, 10, 1],
            ['meme.size_pct', 'İşlem büyüklüğü', 'Kasanın', '%', 1, 1, 50, 0],
            ['meme.max_pos', 'En fazla pozisyon', 'Aynı anda tutulan token', 'adet', 1, 1, 10, 0],
            ['meme.min_liq', 'En az likidite', 'Havuzu bundan küçük token alınmaz', 'USDT', 5000, 5000, 1e7, 0],
            ['meme.tp_pct', 'Kâr al', 'Bu kâra ulaşınca satış başlar', '%', 5, 5, 1000, 0],
            ['meme.tp_part', 'Kâr alda satılan kısım', 'Kalanı iz süren stopla yükselişte tutulur; 100 = hepsi satılır', '%', 10, 10, 100, 0],
            ['meme.sl_pct', 'Zarar durdur', 'Bu zararda satılır', '%', 1, 3, 50, 0],
            ['meme.trail_from', 'İz süren stop başlangıcı', 'Bu kâra ulaşınca devreye girer', '%', 5, 5, 200, 0],
            ['meme.trail_pct', 'İz süren stop', 'Zirveden bu kadar düşünce satılır', '%', 1, 3, 50, 0],
            ['meme.max_m5', 'Kovalamama sınırı', 'Son 5 dk\'da bundan fazla yükselmişse alınmaz', '%', 1, 2, 30, 0],
            ['meme.min_ratio', 'Alıcı baskısı', 'Son 5 dk\'da alıcı sayısı satıcının en az bu katı olmalı', 'kat', .5, 1, 10, 1],
            ['meme.min_buys', 'En az alıcı', 'Son 5 dk\'da en az bu kadar alıcı', 'adet', 5, 5, 500, 0],
            ['meme.max_h1', 'Tepe sınırı', 'Son 1 saatte bundan fazla uçmuşsa alınmaz; 0 kapalı', '%', 50, 0, 5000, 0],
            ['meme.max_hold_h', 'En uzun tutma', 'Bu süre dolunca satılır', 'saat', 1, 1, 72, 0]
        ] },
    { t: 'Global spot', i: 'i-globe', sw: [['gspot.on', 'Global spot masası açık', 'Kapalıyken tarama ve alım yapılmaz'], ['gspot.real', 'Gerçek parayla işlem', 'Kararlar OKX Global işlem hesabında gerçek emirle uygulanır'], ['gspot.instant', 'Anlık alım', 'Açık: fiyat değince hemen alır · kapalı: 15 dk mum kapanışını bekler. Satış her zaman anlık']], f: [
            ['gspot.budget', 'Bütçe', 'Gerçek masanın kullanacağı en fazla para; alım anında Global fon hesabından işlem hesabına geçer', 'USDT', 10, 0, 100000, 0],
            ['gspot.max_loss', 'En fazla kayıp', 'Toplam zarar buna ulaşınca yeni alım durur; eldeki coinler kurallarıyla satılır', 'USDT', 5, 1, 100000, 0],
            ['gspot.lot_pct', '1. kademe', 'Bütçenin; en az 5 USDT olmalı', '%', 1, 1, 100, 0],
            ['gspot.lot2_pct', '2. kademe büyüklüğü', '1. kademenin', '%', 5, 10, 100, 0],
            ['gspot.lot3_pct', '3. ve sonraki kademeler', '1. kademenin', '%', 5, 10, 100, 0],
            ['gspot.sma_hours', 'Ortalama süresi', '1. kademe bu kadar saatin ortalamasına göre alınır', 'saat', 4, 4, 72, 0],
            ['gspot.step_pct', 'Kademe aralığı', 'Ortalamanın / son kademenin bu kadar altında alır', '%', .1, .5, 30, 1],
            ['gspot.step3_pct', 'Geniş kademe aralığı', '3. kademeden sonra', '%', .1, .5, 40, 1],
            ['gspot.lot_tp_pct', 'Kademe kârı', 'Her kademe kendi alışının bu kadar üstünde satılır', '%', .1, .3, 50, 1],
            ['gspot.stop_pct', 'Zarar sınırı', 'Ortalamanın bu kadar altında hepsi satılır', '%', 1, 1, 90, 0],
            ['gspot.max_lots', 'En fazla kademe', 'Coin başına', 'adet', 1, 1, 10, 0],
            ['gspot.max_coins', 'En fazla coin', 'Aynı anda', 'adet', 1, 1, 20, 0],
            ['gspot.use_pct', 'Kullanım sınırı', 'Coinlere yatırılan toplam, bütçenin bu kadarını aşmaz', '%', 5, 5, 100, 0],
            ['gspot.trend_filter_pct', 'Düşüş süzgeci', '48 saatlik ortalama bundan fazla düşüyorsa yeni coin alınmaz; 0 kapalı', '%', .5, 0, 50, 1],
            ['gspot.vol_filter', 'Hacim süzgeci', 'Son mumun hacmi 24 saat ortalamasının bu katını aşarsa beklenir; 0 kapalı', 'kat', .5, 0, 50, 1],
            ['gspot.coins', 'İzlenen coin', 'Hacmi en yüksek USDT pariteleri', 'adet', 5, 5, 60, 0],
            ['gspot.bank', 'Deneme kasası', 'Deneme masasının sanal parası (değişince deneme masası yeniden başlamaz)', 'USDT', 10, 10, 1000000, 0]
        ] },
    { t: 'Aktarım ve KASA', i: 'i-vault', sw: [['xfer.use_bot', 'Aktarımda botun parasını kullan', 'Açık: OKX TR\'de boş para yetmezse eksik kısım Spot botunun nakdinden gönderilir; botun bütçesi o kadar düşer (kâr/zarar sayılmaz). Kapalı: yalnız boştaki para gider']], f: [
            ['xfer.daily_max', 'Günlük aktarım sınırı', 'Bir günde borsalardan en fazla gönderilecek', 'USDT', 500, 10, 10000, 0],
            ['xfer.sweep_pct', 'Kâr süpürme oranı', 'Futures ve memecoin kârının bu kadarı KASA\'ya gider; 0 kapalı', '%', 5, 0, 100, 0],
            ['xfer.sweep_days', 'Süpürme aralığı', 'Bu kadar günde bir', 'gün', 1, 1, 90, 0],
            ['xfer.sweep_min', 'En az süpürme kârı', 'Kâr bundan azsa gönderilmez', 'USDT', 5, 1, 10000, 0]
        ] },
];
const TGT_TOTAL = ['target.amount', 'Hedef toplam para', () => `Bot + kasa bu tutara ulaşınca her şey satılır`, 'TL', 500, 100, 1e8, 0];
const GRID_HIDE = new Set(['risk.stop_pct', 'risk.max_positions', 'risk.trade_pct']);
function secFields(sec) { return draft?.strategy === 'grid' ? sec.f.filter(f => !GRID_HIDE.has(f[0])) : sec.f; }
const STRAT_F = {
    grid: [['grid.sma_hours', 'Ortalama süresi', '1. alım bu ortalamanın altında yapılır', 'saat', 2, 4, 72, 0],
        ['grid.step_pct', '1. ve 2. kademe aralığı', '1. alım ortalamadan, 2. alım 1. alımdan bu kadar aşağıda', '%', .5, .5, 20, 1],
        ['grid.step3_pct', '3. ve sonraki kademe aralığı', 'Her yeni kademe bir öncekinden bu kadar aşağıda', '%', .5, .5, 30, 1],
        ['grid.lot_pct', '1. kademe tutarı', () => `Bottaki paranın; şu an ${sizeTL(draft.grid.lot_pct)}`, '%', .5, .5, 50, 1],
        ['grid.lot2_pct', '2. kademe tutarı', () => `1. kademenin; ${tl(draft.budget * draft.grid.lot_pct / 100 * (draft.grid.lot2_pct ?? 100) / 100, 0)}`, '%', 5, 10, 100, 0],
        ['grid.lot3_pct', '3. ve sonraki kademe tutarı', () => `1. kademenin; her biri ${tl(draft.budget * draft.grid.lot_pct / 100 * (draft.grid.lot3_pct ?? 100) / 100, 0)}`, '%', 5, 10, 100, 0],
        ['grid.lot_tp_pct', 'Kademe kârı', 'Her kademe kendi alış fiyatının bu kadar üstünde ayrı satılır', '%', .5, .5, 50, 1],
        ['grid.pos_tp_pct', 'Toplu kâr al', 'Açıkken kademeler tek tek satılmaz; fiyat bütün kademelerin alış ortalamasının bu kadar üstüne çıkınca hepsi birden satılır. 0 kapalı', '%', .1, 0, 30, 1],
        ['grid.max_lots', 'En fazla kademe', 'Bir coinde en çok kaç alım', 'adet', 1, 1, 10, 0],
        ['grid.max_coins', 'En fazla coin', 'Aynı anda tutulan coin', 'adet', 1, 1, 100, 0],
        ['grid.use_pct', 'Toplam kullanım sınırı', () => `Coinlere en fazla; şu an ${pctTL(draft.grid.use_pct ?? 40)}`, '%', 1, 5, 100, 2],
        ['grid.stop_pct', 'Toplu zarar sınırı', 'Fiyat alış ortalamasının bu kadar altına inerse bütün kademeler satılır', '%', .5, 1, 50, 1],
        ['grid.trend_filter_pct', 'Düşüş filtresi', 'Günde bu kadar düşen beklenir; 0 kapalı', '%', .5, 0, 10, 1],
        ['grid.vol_filter', 'Hacim patlaması filtresi', 'Hacim ortalamanın bu katını aşarsa alım beklenir; 0 kapalı', 'kat', .5, 0, 10, 1]],
    dip: [['dip.dip_pct', 'Düşüş eşiği', 'Ortalamanın bu kadar altında alır', '%', .5, .5, 30, 1],
        ['dip.rsi_max', 'Aşırı satım eşiği', 'RSI bu değerin altındayken alınır', '', 1, 5, 60, 0],
        ['dip.take_profit_pct', 'Kâr hedefi', 'Bu kâra ulaşınca satılır', '%', .5, .5, 50, 1],
        ['dip.max_hold_hours', 'En uzun bekleme', 'Bu süre dolunca satılır', 'saat', 1, 1, 500, 0]],
    trend: [['trend.trailing_pct', 'İz süren stop', 'Fiyat zirveden bu kadar geri çekilince satılır', '%', .5, .5, 30, 1]],
};
let OPEN = new Set();
function accOpen(id, title, icon, color, sum, dirty) { return `<section class="acc c-${color}${OPEN.has(id) ? ' open' : ''}" data-acc="${id}"><button class="acch" type="button"><span class="aic">${ic(icon)}</span><span class="att"><b>${title}</b><small>${sum}</small></span>${dirty ? '<i class="dot"></i>' : ''}<svg class="i chev"><use href="#i-back"/></svg></button><div class="accb">`; }
const ACC_END = '</div></section>';
function secDirty(keys) { return keys.some(k => JSON.stringify(P(draft, k)) !== JSON.stringify(P(orig, k))); }
const pc = v => '%' + String(v).replace('.', ',');
const SUMS = {
    'Kasa': () => `${tl(draft.budget, 0)} botta · kasa ${tl(draft.kasa, 0)}`,
    'Kasadan ekleme': () => `+${tl(draft.topup.amount, 0)} · ${pc(draft.topup.profit_pct)} kârda · ${draft.topup.days} gün arayla`,
    'Kâr hedefi': () => {
        const t = draft.target || { on: false, amount: 20000 }, tot = t.mode === 'total', a = tl(t.amount, 0);
        return t.on ? (tot ? `Açık · kasa dahil ${a} olunca her şey satılır` : `Açık · +${a} kârda her şey satılır`) : `Kapalı · ${tot ? 'kasa dahil ' : 'kâr '}${a}`;
    },
    'Koruma': () => draft.strategy === 'grid' ? `Günlük ${pc(draft.risk.daily_loss_pct)} · acil fren ${pc(draft.risk.kill_pct)}` : `Zarar ${pc(draft.risk.stop_pct)} · günlük ${pc(draft.risk.daily_loss_pct)} · acil fren ${pc(draft.risk.kill_pct)}`,
    grid: () => `${(() => { const l = draft.budget * draft.grid.lot_pct / 100, a = (draft.grid.lot2_pct ?? 100) / 100, c = (draft.grid.lot3_pct ?? 100) / 100; return a === 1 && c === 1 ? tl(l, 0) + ' kademe' : `${nf(l, 0)} → ${nf(l * a, 0)} → ${tl(l * c, 0)}`; })()} · ${draft.grid.max_coins} coine kadar · en çok ${tl(draft.budget * (draft.grid.use_pct ?? 40) / 100, 0)}${draft.grid.instant ? ' · anlık alım' : ''}`,
    dip: () => `Düşüş ${pc(draft.dip.dip_pct)} · kâr ${pc(draft.dip.take_profit_pct)} · en çok ${draft.dip.max_hold_hours} saat`,
    trend: () => `İz süren stop ${pc(draft.trend.trailing_pct)}`,
    'Futures': () => { const l = draft.lev || {}; return `${l.real ? 'Gerçek açık' : 'Gerçek kapalı'} · bütçe ${U(l.real_budget ?? 30, 0)} · en fazla ${U(l.max_loss ?? 10, 0)} kayıp · ${l.real_lev ?? 2}x`; },
    'Memecoin': () => { const m = draft.meme || {}; return `${m.real ? 'Gerçek açık' : 'Gerçek kapalı'} · kasanın ${pc(m.size_pct ?? 10)}'u · kâr ${pc(m.tp_pct ?? 30)}${(m.tp_part ?? 100) < 100 ? ` (${pc(m.tp_part)}'i)` : ''} · zarar ${pc(m.sl_pct ?? 15)}`; },
    'Global spot': () => { const g = draft.gspot || {}; return g.on === false ? 'Kapalı' : `${g.real ? 'Gerçek açık' : 'Deneme'} · bütçe ${U(g.budget ?? 50, 0)} · kademe kârı ${pc(g.lot_tp_pct ?? 3.5)} · ${g.max_coins ?? 5} coin`; },
    'Aktarım ve KASA': () => { const x = draft.xfer || {}; return `Günde en çok ${U(x.daily_max || 10000, 0)} · ${+x.sweep_pct > 0 ? `kârın ${pc(x.sweep_pct)}'i ${x.sweep_days} günde bir KASA'ya` : 'kâr süpürme kapalı'}`; }
};
const SEC_C = { 'Global spot': 'teal', 'Futures': 'red', 'Memecoin': 'violet', 'Kasa': 'teal', 'Kasadan ekleme': 'teal', 'Koruma': 'red', 'Kâr hedefi': 'green', 'Aktarım ve KASA': 'amber' };
function field([k, label, hint, u, step, min, max, dec]) {
    const v = P(draft, k), h = typeof hint === 'function' ? hint() : hint;
    return `<div class="field" data-k="${k}"><div class="lb"><b>${label}</b><span class="h">${h}</span><em></em></div>
   <div class="step"><button data-d="-1" aria-label="Azalt">${ic('i-minus')}</button>
   <label class="sv"><input inputmode="decimal" value="${fv(v, dec)}" data-step="${step}" data-min="${min}" data-max="${max}" data-dec="${dec}">
   ${u ? `<span class="u">${u}</span>` : ''}</label><button data-d="1" aria-label="Artır">${ic('i-plus')}</button></div></div>`;
}
const QUOTES = [['USDT', '₮', 'Önerilen'], ['USDC', '$', 'Düşük fark'], ['EUR', '€', 'Düşük fark'], ['TRY', '₺', 'Fark yüksek']];
function tile(on, key, icon, name, sub) { return `<button class="tile ${on ? 'on' : ''}" data-t="${key}"><span class="ic">${ic(icon)}</span><span class="nm">${name}</span>${sub ? `<span class="pc" style="color:var(--muted);font-weight:500">${sub}</span>` : ''}</button>`; }
function pinPad(o) {
    return new Promise(res => {
        const v = document.createElement('div');
        v.className = 'pinv';
        const logo = document.querySelector('#logo .lg')?.outerHTML.replace(/id="h/g, 'id="p').replace(/url\(#h/g, 'url(#p') || '';
        v.innerHTML = `<div class="plg">${logo}</div><h3>${o.title}</h3><p>${o.sub || ''}</p>
    <div class="pbox">${'<i></i>'.repeat(6)}</div><div class="perr">${o.err || ''}</div>
    <div class="pkeys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
    <button class="ghost" data-k="x">${o.cancel === false ? '' : 'Vazgeç'}</button><button data-k="0">0</button><button class="ghost" data-k="b" aria-label="Sil">${ic('i-del')}</button></div>`;
        document.body.appendChild(v);
        let val = '', busy = false;
        const box = v.querySelector('.pbox'), err = v.querySelector('.perr');
        const draw = () => box.querySelectorAll('i').forEach((e, i) => { e.className = (i < val.length ? 'f' : '') + (i === val.length ? ' cur' : ''); });
        draw();
        const close = r => { document.removeEventListener('keydown', kd); v.classList.add('out'); setTimeout(() => v.remove(), 250); res(r); };
        const press = async (k) => {
            if (busy)
                return;
            if (k === 'x') {
                if (o.cancel !== false)
                    close(null);
                return;
            }
            if (k === 'b') {
                val = val.slice(0, -1);
                box.classList.remove('bad');
                err.textContent = '';
                draw();
                return;
            }
            if (val.length >= 6)
                return;
            val += k;
            box.classList.remove('bad');
            err.textContent = '';
            draw();
            navigator.vibrate?.(8);
            if (val.length < 6)
                return;
            busy = true;
            const r = o.check ? await o.check(val) : true;
            if (r === true) {
                box.classList.add('ok');
                setTimeout(() => close(val), 380);
            }
            else {
                box.classList.add('bad', 'shake');
                err.textContent = typeof r === 'string' ? r : 'Tekrar dene';
                navigator.vibrate?.([30, 40, 30]);
                setTimeout(() => { box.classList.remove('shake'); val = ''; draw(); busy = false; if (r === null)
                    close(null); }, 450);
            }
        };
        v.querySelectorAll('.pkeys button').forEach(b => b.onclick = () => press(b.dataset.k));
        const kd = e => { if (/^[0-9]$/.test(e.key))
            press(e.key);
        else if (e.key === 'Backspace')
            press('b');
        else if (e.key === 'Escape')
            press('x'); };
        document.addEventListener('keydown', kd);
    });
}
const b64u = s => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uD = s => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
async function makeLink() {
    const p1 = await pinPad({ title: 'PIN belirle', sub: 'Bağlantı linkini korumak için 6 haneli bir PIN seç. Linki açınca bu PIN sorulacak.' });
    if (!p1)
        return;
    const p2 = await pinPad({ title: 'PIN\'i tekrar gir', sub: 'Aynı 6 haneyi bir kez daha gir.', check: v => v === p1 || 'PIN\'ler aynı değil' });
    if (!p2)
        return;
    const rnd = crypto.getRandomValues(new Uint8Array(16)), key = b64u(String.fromCharCode(...rnd)), id = await bagId(key);
    const box = await seal({ t: token, p: pw || '' }, key + ':' + p1, 300000);
    try {
        await ghPut(`docs/bag/${id}.json`, JSON.stringify(box), 'Bağlantı linki');
        const old = localStore('masal_bag');
        if (old && old !== id)
            ghDel(`docs/bag/${old}.json`).catch(() => { });
        localStore('masal_bag', id);
    }
    catch (e) {
        return toast('Link kaydedilemedi, bağlantını kontrol et');
    }
    const link = location.origin + location.pathname + '#' + key;
    const v = document.createElement('div');
    v.className = 'pinv';
    v.innerHTML = `<div class="plg">${document.querySelector('#logo .lg')?.outerHTML.replace(/id="h/g, 'id="q').replace(/url\(#h/g, 'url(#q') || ''}</div><h3>Bağlantı linkin hazır</h3>
    <p>Notlar'a kaydet ya da kendine gönder. Dokununca Masal açılır, PIN'i girince GitHub'a bağlanır${pw ? ' ve gerçek hesabın kilidi açılır' : ''}. Linki kimseyle paylaşma.</p>
    <div class="lnk" style="text-align:center">${link.replace(/^https?:\/\//, '')}</div>
    <div class="pact"><button class="btn" id="lkCopy">${ic('i-copy')}Kopyala</button><button class="btn" id="lkShare">${ic('i-link')}Paylaş</button></div>
    <button class="btn primary pdone" id="lkOk">Tamam</button>`;
    document.body.appendChild(v);
    v.querySelector('#lkCopy').onclick = () => navigator.clipboard?.writeText(link).then(() => toast('Link kopyalandı'), () => toast('Kopyalanamadı'));
    v.querySelector('#lkShare').onclick = () => navigator.share ? navigator.share({ title: 'Masal bağlantı linki', url: link }).catch(() => { }) : navigator.clipboard?.writeText(link).then(() => toast('Paylaşım yok; link kopyalandı'));
    v.querySelector('#lkOk').onclick = () => { v.classList.add('out'); setTimeout(() => v.remove(), 250); };
}
async function bagId(key) { const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))); return [...h.slice(0, 6)].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function ghPut(path, text, msg) {
    const url = `https://api.github.com/repos/${REPO.o}/${REPO.r}/contents/${path}`;
    const r = await tfetch(url, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, body: JSON.stringify({ message: msg, content: btoa(unescape(encodeURIComponent(text))) }) });
    if (!r.ok)
        throw r.status;
}
async function ghDel(path) {
    const url = `https://api.github.com/repos/${REPO.o}/${REPO.r}/contents/${path}`, h = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
    const g = await tfetch(url, { headers: h });
    if (!g.ok)
        return;
    const sha = (await g.json()).sha;
    await tfetch(url, { method: 'DELETE', headers: h, body: JSON.stringify({ message: 'Eski bağlantı linki silindi', sha }) });
}
async function openLink() {
    const short = location.hash.match(/^#([\w-]{22})$/), m = location.hash.match(/^#bag=([\w-]+)/);
    if (!short && !m)
        return;
    history.replaceState(null, '', location.pathname + location.search);
    let box, pre = '';
    if (short) {
        pre = short[1] + ':';
        const id = await bagId(short[1]);
        for (const u of [`https://raw.githubusercontent.com/${REPO.o}/${REPO.r}/main/docs/bag/${id}.json`, `bag/${id}.json`]) {
            try {
                const r = await tfetch(u + '?t=' + Date.now(), { cache: 'no-store' });
                if (r.ok) {
                    box = await r.json();
                    break;
                }
            }
            catch (e) { }
        }
        if (!box)
            return toast('Bu link geçersiz ya da yenisi oluşturulmuş');
    }
    else {
        try {
            box = JSON.parse(b64uD(m[1]));
        }
        catch (e) {
            return toast('Bağlantı linki bozuk');
        }
    }
    let tries = 0, got = null;
    const ok = await pinPad({ title: 'PIN\'ini gir', sub: 'Bağlantı linkini oluştururken seçtiğin 6 haneli PIN.', check: async (v) => {
            try {
                got = await unseal(box, pre + v);
                return true;
            }
            catch (e) {
                tries++;
                return tries >= 5 ? null : `PIN yanlış · ${5 - tries} hakkın kaldı`;
            }
        } });
    if (!ok || !got) {
        if (tries >= 5)
            toast('Çok fazla yanlış deneme; link kullanılamadı');
        return;
    }
    token = got.t;
    localStore('masal_token', token);
    if (got.p) {
        pw = got.p;
        localStore('masal_pw', pw);
    }
    toast('Bağlandı');
}
function renderConn() {
    const c = document.getElementById('conn');
    c.innerHTML = token ? `<div class="conn1"><div class="lb"><b>${ic('i-check')}Bağlı</b><span>${REPO.o}/${REPO.r}</span></div>
    <button class="btn sm" id="mkLink">${ic('i-lock')}Link</button><button class="btn sm" id="unlink">Kaldır</button></div>`
        : `<div style="font-size:13px">Ayarları kaydedebilmek için bir kereye mahsus GitHub erişim anahtarı gir. Anahtar sadece bu telefonda saklanır.</div>
    <input class="inp" id="tok" type="password" placeholder="github_pat_…" autocomplete="off">
    <button class="btn primary" id="link" style="width:100%">${ic('i-link')}Bağlan</button>
    <ol class="steps"><li>GitHub'da <b>Settings → Developer settings → Fine-grained tokens → Generate new token</b></li>
    <li><b>Repository access:</b> Only select repositories → <b>${REPO.r}</b></li><li><b>Permissions → Contents:</b> Read and write</li><li>Oluşan anahtarı kopyalayıp yukarıya yapıştır</li></ol>`;
    const mk = document.getElementById('mkLink');
    if (mk)
        mk.onclick = makeLink;
    const u = document.getElementById('unlink');
    if (u)
        u.onclick = () => { token = ''; localStorage.removeItem('masal_token'); renderConn(); };
    const l = document.getElementById('link');
    if (l)
        l.onclick = async () => {
            const t = document.getElementById('tok').value.trim();
            if (!t)
                return toast('Anahtarı yapıştır');
            l.textContent = 'Kontrol ediliyor…';
            try {
                const r = await tfetch(API, { headers: { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json' } });
                if (!r.ok)
                    throw r.status;
                token = t;
                localStore('masal_token', t);
                await loadSettings();
                toast('Bağlandı');
            }
            catch (e) {
                toast(e === 404 ? 'Depo ya da dosya bulunamadı: izinleri kontrol et' : 'Anahtar geçersiz ya da yetkisi yok');
                renderConn();
            }
        };
}
let STAB = 'spot';
const STABS = [['spot', 'i-coins', 'Spot'], ['gspot', 'i-globe', 'Global'], ['fut', 'i-layers', 'Futures'], ['meme', 'i-flask', 'Meme'], ['kasa', 'i-vault', 'Kasalar'], ['app', 'i-phone', 'Uygulama']];
const AUTO_OPEN = new Set();
const SEC_TAB = { 'Global spot': 'gspot', 'Kasa': 'spot', 'Kasadan ekleme': 'spot', 'Koruma': 'spot', 'Kâr hedefi': 'spot', 'Futures': 'fut', 'Memecoin': 'meme', 'Aktarım ve KASA': 'kasa' };
function openSettingsTab(t) { STAB = t; document.getElementById('openSet').click(); }
function renderForm() {
    delete draft._bad;
    const live = draft.live;
    const dirtyTab = (t) => (BAN_DESK[t] && secDirty(['ban.' + BAN_DESK[t]])) || (t === 'spot' && secDirty(['live', 'paused', 'quote', 'strategy', 'target', 'grid', 'dip', 'trend'])) || (t === 'app' && secDirty(['notify'])) || SECTIONS.some(sec => SEC_TAB[sec.t] === t && secDirty([...sec.f.map(x => x[0]), ...(sec.sw || []).map(x => x[0])]));
    for (const id of ['linkSec', 'connSec']) {
        const e = document.getElementById(id);
        if (e)
            e.hidden = STAB !== 'app';
    }
    let h = `<div class="tiles stabs">${STABS.map(([k, i, n]) => `<button class="tile ${STAB === k ? 'on' : ''}" data-stab="${k}"><span class="ic">${ic(i)}</span><span class="nm">${n}</span>${dirtyTab(k) ? '<i class="dot"></i>' : ''}</button>`).join('')}</div>`;
    if (STAB === 'spot') {
        h += `<section><h2><span class="hb c-green">${ic('i-power')}</span>Çalışma</h2>
   <div class="tiles two" data-g="mode">${tile(!live, 'demo', 'i-flask', 'Deneme', 'Emir gönderilmez')}${tile(live, 'real', 'i-coins', 'Gerçek', 'OKX TR hesabında')}</div>
   ${live && !orig.live ? `<div class="warn">${ic('i-info')}<div>Kaydedince bot OKX TR hesabında <b>gerçek emir</b> vermeye başlar. API anahtarı GitHub Secrets'ta olmalı.</div></div>` : ''}
   ${!live && orig.live ? `<div class="warn">${ic('i-info')}<div>Denemeye geçince hesaptaki coinler bot tarafından satılmaz. Gerekirse önce aşağıdan <b>Hepsini sat</b>.</div></div>` : ''}
   <div class="card" style="margin-top:8px"><div class="sw ${draft.paused ? 'on' : ''}" id="pauseSw"><div class="lb"><b>Botu durdur</b><span>Yeni alım yapılmaz; açık pozisyonların zarar sınırı çalışmaya devam eder</span></div><div class="track"><i></i></div></div>
   <div class="field" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line2)"><div class="lb"><b>Hepsini sat ve dur</b><span>Gerçek hesaptaki tüm coinleri hemen satar, botu durdurur</span></div>
   <button class="btn danger ${sellArm ? 'arm' : ''}" id="sellAll">${ic('i-sell')}${sellArm ? 'Emin misin? Dokun' : 'Hepsini sat'}</button></div></div></section>
   <div class="hint" style="margin:8px 2px 4px">Bot kesintisiz çalışır: saniyede bir piyasayı, borsadaki korumaları ve para hareketlerini kontrol eder. Uygulama kapalı olsa da çalışır.</div>
   <section><h2><span class="hb c-amber">${ic('i-coins')}</span>İşlem paritesi</h2><div class="tiles qtiles" data-g="quote">${QUOTES.map(([q, g, sub]) => `<button class="tile ${(draft.quote || 'USDT') === q ? 'on' : ''}" data-t="${q}"><span class="ic"><b class="qg">${g}</b></span><span class="nm">${q}</span><span class="pc" style="color:var(--muted);font-weight:500">${sub}</span></button>`).join('')}</div>
   <div class="hint" style="margin:8px 2px 0">Yeni alımlar bu paritede yapılır; gereken para TL'den otomatik çevrilir. Eldeki coinler kendi paritesinde satılır. Bütün tutarlar TL karşılığıyla görünür.</div></section>
   <section><h2><span class="hb c-blue">${ic('i-target')}</span>Strateji</h2><div class="tiles" data-g="strat">${['grid', 'dip', 'trend'].map(k => tile(draft.strategy === k, k, ICON[k], SNAMES[k])).join('')}</div>
   ${draft.strategy !== orig.strategy && orig.live ? `<div class="warn">${ic('i-info')}<div>Gerçek modda strateji değişince eski stratejinin açık coinleri satılır, yeni strateji temiz başlar.</div></div>` : ''}</section>
   <section><h2><span class="hb c-violet">${ic('i-shield')}</span>Kontrol<span class="hsum" style="font-weight:500;color:var(--faint);font-size:11px">değiştirdikçe güncellenir</span></h2><div class="card chk" id="checks"></div></section>`;
        h += '<section style="margin-bottom:-2px"><h2><span class="hb c-gray">' + ic('i-layers') + '</span>Ayrıntılı ayarlar<span class="hsum" style="font-weight:500;color:var(--faint);font-size:11px">dokununca açılır</span></h2></section>';
    }
    if (STAB === 'app')
        h += notifySection();
    if (!draft.target)
        draft.target = { on: false, amount: 20000, mode: 'profit' };
    for (const sec of SECTIONS) {
        if (SEC_TAB[sec.t] !== STAB)
            continue;
        if (STAB !== 'spot' && !AUTO_OPEN.has(sec.t)) {
            AUTO_OPEN.add(sec.t);
            OPEN.add(sec.t);
        }
        const tg = sec.t === 'Kâr hedefi', ff = tg && draft.target.mode === 'total' ? [TGT_TOTAL] : secFields(sec);
        h += accOpen(sec.t, sec.t, sec.i, SEC_C[sec.t], SUMS[sec.t](), secDirty([...ff.map(x => x[0]), ...(tg ? ['target.on', 'target.mode'] : []), ...(sec.sw || []).map(x => x[0])])) + `<div class="card">`
            + (sec.sw || []).map(([k, a, b]) => `<div style="margin-bottom:8px">${swRow('sw_' + k.replace('.', '_'), !!P(draft, k), a, b)}</div>`).join('')
            + (sec.t === 'Futures' ? futExtra() : '')
            + (sec.t === 'Memecoin' ? memeExtra() : '')
            + (sec.t === 'Global spot' ? gspotExtra() : '')
            + (tg ? `<div style="margin-bottom:4px">${swRow('tgtSw', !!draft.target.on, 'Hedefte dur', 'Hedefte her şey satılır, bot durur')}</div>
        <div class="field"><div class="lb"><b>Hedef türü</b><span>${draft.target.mode === 'total' ? 'Bot + kasadaki yedek para toplamı' : 'Sadece kâr (başlangıç parasının üstü)'}</span></div>
        <div class="seg" id="tgtMode"><button type="button" data-m="profit" class="${draft.target.mode !== 'total' ? 'on' : ''}">Kâr</button><button type="button" data-m="total" class="${draft.target.mode === 'total' ? 'on' : ''}">Kasa dahil</button></div></div>` : '')
            + `${ff.map(field).join('')}</div>` + ACC_END;
    }
    if (STAB === 'fut' || STAB === 'meme' || STAB === 'gspot')
        h += banSec(STAB);
    const sf = STRAT_F[draft.strategy];
    const grid = draft.strategy === 'grid';
    const GG = [['i-coins', 'Alım', ['grid.sma_hours', 'grid.step_pct', 'grid.step3_pct', 'grid.lot_pct', 'grid.lot2_pct', 'grid.lot3_pct']], ['i-pnl', 'Satış', ['grid.lot_tp_pct', 'grid.pos_tp_pct', 'grid.stop_pct']], ['i-shield', 'Sınırlar', ['grid.max_lots', 'grid.max_coins', 'grid.use_pct']], ['i-eye', 'Filtreler', ['grid.trend_filter_pct', 'grid.vol_filter']]];
    const sfH = grid ? GG.map(([i, t, ks]) => `<div class="fgrp"><div class="fgh">${ic(i)}${t}</div>${ks.map(k => sf.find(f => f[0] === k)).filter(Boolean).map(field).join('')}${t === 'Alım' ? '<div id="ladder"></div>' : ''}</div>`).join('') : sf.map(field).join('');
    if (STAB === 'spot')
        h += accOpen('strat', SNAMES[draft.strategy] + ' ayarları', ICON[draft.strategy], 'blue', SUMS[draft.strategy](), secDirty([...sf.map(x => x[0]), ...(grid ? ['grid.instant'] : [])])) + `<div class="card">${sfH}`
            + (grid ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line2)">${swRow('instSw', !!draft.grid.instant, 'Anlık alım', 'Fiyat değince hemen alır · satış her zaman anlık (borsadaki kâr al / zarar durdur emriyle)')}</div>` : '') + `</div>` + ACC_END;
    if (STAB === 'spot')
        h += banSec('spot');
    if (STAB === 'app') {
        h += installSection();
        h += `<section class="clr"><button class="btn xsync" type="button" id="clrOld">${ic('i-trash')}Eski kayıtları temizle</button><p class="hint">Canlı akış, aktarım geçmişi, masa günlükleri ve bildirimler silinir; işlem geçmişi ve kâr/zarar hesabı korunur.</p></section>`;
    }
    const f = document.getElementById('setForm');
    f.innerHTML = h;
    f.querySelectorAll('[data-stab]').forEach(b => b.onclick = () => { STAB = b.dataset.stab; renderForm(); window.scrollTo(0, 0); navSave(); });
    const on = (id, fn) => { const e = document.getElementById(id); if (e)
        e.onclick = fn; };
    if (document.getElementById('clrOld'))
        document.getElementById('clrOld').onclick = async () => {
            if (!token) {
                toast('Önce GitHub bağlantısını kur');
                return;
            }
            const t = Date.now(), top = Math.ceil(t / 1000);
            const ok = await cloudPatch(o => { o.clear = t; o.notify = { ...(o.notify || {}), cleared: top }; }, 'Eski kayıtlar temizlendi');
            if (ok) {
                localStore('masal_nclr', String(top));
                NOTES.length = 0;
                nBadge();
            }
            toast(ok ? 'Eski kayıtlar temizleniyor; bot birkaç saniyede uygular' : 'Temizleme isteği gönderilemedi, tekrar dene', ok ? '' : patchWhy());
        };
    f.querySelectorAll('.acch').forEach(b => b.onclick = () => {
        const sec = b.parentElement, id = sec.dataset.acc;
        sec.classList.toggle('open');
        if (sec.classList.contains('open'))
            OPEN.add(id);
        else {
            OPEN.delete(id);
            renderForm();
        }
    });
    f.querySelectorAll('[data-g=mode] .tile').forEach(b => b.onclick = () => { draft.live = b.dataset.t === 'real'; renderForm(); });
    f.querySelectorAll('[data-g=quote] .tile').forEach(b => b.onclick = () => { draft.quote = b.dataset.t; renderForm(); });
    f.querySelectorAll('[data-g=strat] .tile').forEach(b => b.onclick = () => { draft.strategy = b.dataset.t; renderForm(); });
    on('pauseSw', () => { draft.paused = !draft.paused; renderForm(); });
    on('tgtSw', () => { draft.target.on = !draft.target.on; renderForm(); });
    document.querySelectorAll('#tgtMode button').forEach(b => b.onclick = () => { draft.target.mode = b.dataset.m; renderForm(); });
    for (const sec of SECTIONS)
        for (const [k] of (sec.sw || [])) {
            const b = document.getElementById('sw_' + k.replace('.', '_'));
            if (b)
                b.onclick = () => { SETP(draft, k, !P(draft, k)); renderForm(); };
        }
    const mrs = document.getElementById('memeReset');
    if (mrs)
        mrs.onclick = () => { SETP(draft, 'meme.real_reset', Date.now()); renderForm(); };
    const rst = document.getElementById('levReset');
    if (rst)
        rst.onclick = () => { SETP(draft, 'lev.real_reset', Date.now()); renderForm(); };
    const isw = document.getElementById('instSw');
    if (isw)
        isw.onclick = () => { draft.grid.instant = !draft.grid.instant; renderForm(); };
    bindNotify();
    bindInstall();
    bindBan();
    if (document.getElementById('sellAll'))
        document.getElementById('sellAll').onclick = () => {
            if (!sellArm) {
                sellArm = setTimeout(() => { sellArm = 0; renderForm(); }, 4000);
                return renderForm();
            }
            clearTimeout(sellArm);
            sellArm = 0;
            const keep = JSON.parse(JSON.stringify(orig));
            keep.liquidate = Date.now();
            keep.paused = true;
            save(keep, 'Hepsini sat isteği gönderildi; bot birkaç saniye içinde satar ve durur.');
        };
    f.querySelectorAll('.field[data-k]').forEach(el => {
        const k = el.dataset.k, inp = el.querySelector('input');
        const set = (raw, fromBtn) => {
            const mn = +inp.dataset.min, mx = +inp.dataset.max, dc = +inp.dataset.dec;
            const r0 = String(raw).trim();
            let v = dc > 0 ? parseFloat(r0.replace(',', '.')) : parseFloat(r0.replace(/[.,\s]/g, ''));
            const em = el.querySelector('em');
            if (isNaN(v) || v < mn || v > mx) {
                el.querySelector('.step').classList.add('bad');
                em.textContent = `${nf(mn, dc)} ile ${nf(mx, dc)} arasında olmalı`;
                draft._bad = (draft._bad || new Set()).add(k);
            }
            else {
                el.querySelector('.step').classList.remove('bad');
                em.textContent = '';
                draft._bad?.delete(k);
                v = +v.toFixed(dc);
                SETP(draft, k, v);
                if (fromBtn)
                    inp.value = fv(v, dc);
            }
            refresh();
        };
        inp.oninput = () => set(inp.value);
        inp.onblur = () => { if (!draft._bad?.has(k))
            inp.value = fv(P(draft, k), +inp.dataset.dec); };
        el.querySelectorAll('button[data-d]').forEach(b => b.onclick = () => {
            const st = +inp.dataset.step;
            let v = P(draft, k) + (+b.dataset.d) * st;
            v = Math.min(+inp.dataset.max, Math.max(+inp.dataset.min, v));
            set(String(+v.toFixed(+inp.dataset.dec)).replace('.', ','), true);
        });
    });
    refresh();
}
const BAN_DESK = { spot: 'spot', gspot: 'gspot', fut: 'lev', meme: 'meme' };
function banList(d) { const b = (draft.ban = draft.ban || {}); return (b[d] = Array.isArray(b[d]) ? b[d] : []); }
function banSugg(d) {
    const L = S?.strategies?.live, have = new Set(banList(d).map(banKey));
    let c = [];
    if (d === 'spot')
        c = [...(L?.positions || []).map((p) => sym(p.inst)), ...(L?.coins || []).filter((x) => x.realized + x.open_pnl < 0).map((x) => sym(x.inst))];
    else if (d === 'lev')
        c = (draft.lev?.coins || []);
    else if (d === 'gspot')
        c = [...((S?.gspotr?.positions) || []), ...((S?.gspot?.positions) || [])].map((p) => p.sym);
    else
        c = [...((S?.memer?.positions) || []), ...((S?.meme?.positions) || [])].map((p) => p.sym);
    return [...new Set(c.map(banKey))].filter(x => x && !have.has(x)).slice(0, 16);
}
function banSec(tab) {
    const d = BAN_DESK[tab];
    if (!d)
        return '';
    const list = banList(d), sg = banSugg(d);
    const nm = (x) => x.length >= 30 ? x.slice(0, 4) + '…' + x.slice(-4) : x;
    const rows = list.map(x => `<div class="swr${swOpen === 'ban:' + d + ':' + x ? ' open' : ''}" data-i="ban:${d}:${escH(x)}"><button class="swb" type="button" data-unban="${escH(x)}">${ic('i-trash')}Sil</button>
    <div class="row swc">${d === 'meme' ? `<div class="coin sm">${escH(nm(x).slice(0, 4))}</div>` : cico(x + '-USDT')}<div class="mid"><b>${escH(nm(x))}</b><span>${d === 'spot' ? 'Yeni alım ve kademe yok' : d === 'lev' ? 'Yeni pozisyon açılmaz' : 'Bu token alınmaz'}</span></div><div class="end"><em class="lk wn">LİSTEDE</em></div></div></div>`).join('');
    return accOpen('ban_' + d, 'Kara liste', 'i-ban', 'red', list.length ? `${list.length} ${d === 'meme' ? 'token' : 'coin'} · yeni işlem yok` : 'boş', secDirty(['ban.' + d])) + `<div class="card">
    ${rows ? `<div class="list banl" id="banList">${rows}</div>` : `<div class="empty">${ic('i-ban')}<div>Liste boş. Eklediğin ${d === 'meme' ? 'tokende' : 'coinde'} bot bir daha işlem açmaz.</div></div>`}
    <div class="banadd"><input class="inp" id="banIn" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${d === 'meme' ? 'Token adı ya da adresi' : 'Coin adı, ör. IRYS'}"><button class="btn primary" type="button" id="banAdd">${ic('i-plus')}Ekle</button></div>
    <div class="bant" id="banSug" hidden style="margin-top:8px"></div>
    ${sg.length ? `<div class="fgh" style="margin-top:12px">${ic('i-plus')}${d === 'lev' ? 'İzlenen coinler' : d === 'spot' ? 'Elindekiler ve zarar ettirenler' : 'Elindekiler'} · dokun, ekle</div><div class="bant">${sg.map(x => `<button type="button" class="tile" data-ban="${escH(x)}"><span class="nm">${escH(nm(x))}</span></button>`).join('')}</div>` : ''}
    <p class="hint" style="margin:10px 2px 0">Listedeki ${d === 'meme' ? 'tokende' : 'coinde'} yeni işlem açılmaz${d === 'spot' ? ' (otomatik alım, yeni kademe, elle alım)' : d === 'lev' ? ' (sinyal ya da elle açma)' : ''}. Elinde varsa kendi kurallarıyla, kârda ya da zarar sınırında satılır. Silmek için satırı sola kaydır. Kaydet'e basınca geçerli olur.</p></div>` + ACC_END;
}
function bindBan() {
    const d = BAN_DESK[STAB];
    if (!d)
        return;
    const add = (v) => {
        v = banKey(v);
        if (!v || v.length > 64) {
            toast('Geçerli bir ad yaz');
            return;
        }
        const l = banList(d);
        if (l.map(banKey).includes(v)) {
            toast(v + ' zaten listede');
            return;
        }
        l.push(v);
        OPEN.add('ban_' + d);
        renderForm();
    };
    const i = document.getElementById('banIn'), b = document.getElementById('banAdd');
    if (b)
        b.onclick = () => add(i.value);
    if (i)
        i.onkeydown = e => { if (e.key === 'Enter') {
            e.preventDefault();
            add(i.value);
        } };
    document.querySelectorAll('[data-ban]').forEach(t => t.onclick = () => add(t.dataset.ban));
    if (i) {
        const box = document.getElementById('banSug');
        let pool = null;
        const draw = () => {
            const v = banKey(i.value);
            if (!box)
                return;
            if (!v) {
                box.innerHTML = '';
                box.hidden = true;
                return;
            }
            const have = new Set(banList(d).map(banKey)), src = pool || [];
            const m = [...src.filter(x => x.startsWith(v)), ...src.filter(x => !x.startsWith(v) && x.includes(v))].filter(x => !have.has(x)).slice(0, 8);
            box.hidden = false;
            box.innerHTML = m.length ? m.map(x => `<button type="button" class="tile" data-bs="${escH(x)}"><span class="nm">${escH(x)}</span></button>`).join('')
                : `<div class="hint" style="grid-column:1/-1;margin:0">${pool ? `"${escH(v)}" bulunamadı; yine de Ekle ile eklenebilir` : 'Coin listesi yükleniyor…'}</div>`;
            box.querySelectorAll('[data-bs]').forEach(t => t.onclick = () => add(t.dataset.bs));
        };
        i.oninput = () => { draw(); if (!pool)
            banPool(d).then(l => { pool = l; draw(); }); };
    }
}
async function banPool(d) {
    let l = [];
    if (d === 'spot') {
        l = Object.keys(LP).map(sym);
        if (!l.length)
            try {
                const j = await tfetch('https://tr.okx.com/api/v5/market/tickers?instType=SPOT', { cache: 'no-store' }, 8000).then(r => r.json());
                l = (j?.data || []).map((t) => t.instId.split('-')[0]);
            }
            catch (e) { }
    }
    else if (d === 'lev' || d === 'gspot') {
        const c = await gcat(d === 'lev' ? 'sw' : 'g');
        l = c ? [...c] : [];
    }
    else
        l = [...((S?.memer?.positions) || []), ...((S?.meme?.positions) || []), ...((S?.meme?.scan) || [])].map((p) => p.sym).filter(Boolean);
    return [...new Set(l.map(banKey))].sort();
}
function gspotExtra() {
    const g = draft.gspot || {}, o = orig?.gspot || {};
    let h = '';
    if (g.real && !o.real)
        h += `<div class="warn">${ic('i-info')}<div>Kaydedince bot OKX Global'de <b>gerçek emir</b> verir. Para, alım anında Global <b>fon hesabından</b> işlem hesabına geçer (en fazla ${U(+g.budget || 0, 0)}); önce Kasalar'dan Global'e USDT gönder. Futures masasının parasına dokunulmaz.</div></div>`;
    if (!g.real && o.real)
        h += `<div class="warn">${ic('i-info')}<div>Gerçek mod kapanınca yeni alım yapılmaz; eldeki coinler kurallarıyla (kademe kârı, zarar sınırı) satılmaya devam eder.</div></div>`;
    const l1 = (+g.budget || 0) * (+g.lot_pct || 0) / 100;
    if (g.real && l1 < 5)
        h += `<div class="warn">${ic('i-info')}<div>1. kademe ${U(l1, 2)}; 5 USDT'nin altındaki kademe alınmaz. Bütçeyi ya da 1. kademe yüzdesini artır.</div></div>`;
    return h;
}
function futExtra() {
    const R = S?.levr, l = draft.lev || {};
    let h = '';
    if (l.real && !orig?.lev?.real)
        h += `<div class="warn">${ic('i-info')}<div>Kaydedince Global fon hesabından ${U(l.real_budget, 0)} futures'a geçer ve sinyal gelince gerçek pozisyon açılır. Kaybedebileceğin en fazla ${U(l.max_loss, 0)}.</div></div>`;
    if (+l.max_loss > +l.real_budget)
        h += `<div class="warn">${ic('i-info')}<div>En fazla kayıp bütçeden büyük; bütçeden fazlası zaten kaybedilemez.</div></div>`;
    if (R?.dead)
        h += `<div style="margin:4px 0 8px"><button class="btn xsync" type="button" id="levReset">${ic('i-refresh')}Yeniden başlat</button><p class="hint">Masa durdu: ${String(R.dead).replace(/</g, '&lt;')}. Yeniden başlatınca kayıp sayacı sıfırlanır ve bütçe fon hesabından yeniden tamamlanır.</p></div>`;
    return h;
}
function memeExtra() {
    const R = S?.memer, m = draft.meme || {};
    let h = '';
    if (!m.wallet)
        h += `<div class="hint" style="margin:2px 2px 10px">MEME cüzdanı tanımlı değil; gerçek mod çalışmaz.</div>`;
    else if (R && !R.addr && R.err)
        h += `<div class="warn">${ic('i-info')}<div>${String(R.err).replace(/</g, '&lt;')}</div></div>`;
    else
        h += `<div class="hint" style="margin:2px 2px 10px">MEME cüzdanı <b>${m.wallet.slice(0, 4)}…${m.wallet.slice(-4)}</b>${R?.addr ? ' · bağlı' : ''}. Yalnız bu cüzdandaki parayla işlem yapılır; KASA'ya dokunulmaz.</div>`;
    if (m.real && !orig?.meme?.real)
        h += `<div class="warn">${ic('i-info')}<div>Kaydedince MEME cüzdanındaki SOL ile gerçek alım-satım başlar. Her girişte boş SOL'un %${m.size_pct}'i kullanılır; en fazla ${U(m.max_loss, 0)} kayıpta durur.</div></div>`;
    if (R?.dead)
        h += `<div style="margin:4px 0 8px"><button class="btn xsync" type="button" id="memeReset">${ic('i-refresh')}Yeniden başlat</button><p class="hint">Masa durdu: ${String(R.dead).replace(/</g, '&lt;')}. Yeniden başlatınca kayıp sayacı sıfırlanır.</p></div>`;
    return h;
}
function ladder() {
    const el = document.getElementById('ladder');
    if (!el || !draft || draft.strategy !== 'grid')
        return;
    const g = draft.grid, b = +draft.budget || 0, l1 = b * g.lot_pct / 100, n = Math.max(1, Math.min(10, +g.max_lots || 1));
    let px = 1, cost = 0, qty = 0, rows = '', stopAt = 0;
    for (let i = 0; i < n; i++) {
        px *= 1 - (i < 2 ? g.step_pct : Math.max(g.step_pct, g.step3_pct || g.step_pct)) / 100;
        const amt = l1 * (i === 0 ? 1 : i === 1 ? (g.lot2_pct ?? 100) / 100 : (g.lot3_pct ?? 100) / 100);
        const avg = cost ? cost / qty : 0, dead = i > 0 && px <= avg * (1 - g.stop_pct / 100);
        if (dead && !stopAt)
            stopAt = i + 1;
        cost += amt;
        qty += amt / px;
        const drop = (1 - px) * 100, pt = +g.pos_tp_pct || 0, hep = (cost / qty * (1 + pt / 100) - 1) * 100;
        rows += `<div class="lr${dead ? ' off' : ''}"><em>${i + 1}</em><span><b>−%${nf(drop, 1)}</b><small>ortalamadan</small></span><span><b>${tl(amt, 0)}</b><small>alım</small></span><span>${pt > 0 ? `<b class="up">${hep < 0 ? '−' : '+'}%${nf(Math.abs(hep), 1)}</b><small>${dead ? 'ulaşılmaz' : 'hepsi satılır'}</small>` : `<b class="up">+%${nf(g.lot_tp_pct, 1)}</b><small>${dead ? 'ulaşılmaz' : 'kârla satılır'}</small>`}</span><i style="width:${Math.min(100, drop * 2.2).toFixed(1)}%"></i></div>`;
    }
    const avg = cost / qty, stopPx = (1 - avg * (1 - g.stop_pct / 100)) * 100;
    setH(el, `<div class="ldh">Kademe merdiveni<span>${n} kademe · hepsi dolarsa ${tl(cost, 0)}</span></div>${rows}
    <p class="hint">Fiyat düştükçe sırayla alır; ${+g.pos_tp_pct > 0 ? `kademeler tek tek satılmaz: fiyat o ana kadar alınan bütün kademelerin alış ortalamasının %${nf(g.pos_tp_pct, 1)} üstüne çıkınca hepsi birden kârla satılır (son sütun: ortalamaya göre satış yeri). ` : `her kademe kendi fiyatından %${nf(g.lot_tp_pct, 1)} yükselince ayrı satılır. `}Fiyat alış ortalamasının %${nf(g.stop_pct, 1)} altına (ortalamadan −%${nf(stopPx, 1)}) inerse hepsi satılır.${stopAt ? ` <b class="dn">${stopAt}. kademeden itibaren zarar sınırına önce ulaşılır; bu kademeler hiç alınmaz.</b>` : ''}</p>`);
}
function clean(o) { const c = JSON.parse(JSON.stringify(o, (k, v) => k === '_bad' ? undefined : v)); return c; }
function refresh() {
    const d = clean(draft), ch = JSON.stringify(orig) !== JSON.stringify(d);
    document.getElementById('savebar').hidden = !ch;
    document.getElementById('dirtyTag').hidden = !ch;
    updateChecks();
    ladder();
    document.querySelectorAll('.field[data-k]').forEach(el => {
        const k = el.dataset.k;
        el.querySelector('.step').classList.toggle('changed', P(orig, k) !== P(d, k));
        const all = [...(k === 'target.amount' && draft.target?.mode === 'total' ? [TGT_TOTAL] : []), ...SECTIONS.flatMap(s => s.f), ...Object.values(STRAT_F).flat()].find(f => f[0] === k);
        if (all && typeof all[2] === 'function')
            el.querySelector('.h').textContent = all[2]();
    });
}
async function loadSettings() {
    try {
        if (token) {
            const r = await tfetch(API + '?t=' + Date.now(), { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, cache: 'no-store' });
            if (!r.ok)
                throw r.status;
            const j = await r.json(), raw = JSON.parse(utf8d(j.content));
            orig = await setOpen(raw);
            if (pw && !(raw.sec && raw.sec.enc === 1))
                cloudPatch(() => { }, 'Ayarlar şifrelendi');
        }
        else {
            orig = await setOpen(await tfetch('ayarlar.json?t=' + Date.now()).then(r => r.json()));
        }
    }
    catch (e) {
        if (e === 'kilit') {
            orig = null;
            document.getElementById('setForm').innerHTML = `<div class="empty">${ic('i-lock')}<div>Ayarlar şifreli. Görmek ve değiştirmek için önce gerçek hesabın kilidini aç (OKX şifren).</div></div>`;
            return;
        }
        orig = S?.settings || null;
        if (e === 401) {
            token = '';
            localStorage.removeItem('masal_token');
            toast('GitHub anahtarının süresi dolmuş, yeniden bağlan');
        }
    }
    if (!orig) {
        document.getElementById('setForm').innerHTML = `<div class="empty">${ic('i-info')}<div>Ayarlar yüklenemedi</div></div>`;
        return;
    }
    if (orig && orig.grid && orig.grid.use_pct == null)
        orig.grid.use_pct = 40;
    if (orig && orig.grid && orig.grid.vol_filter == null)
        orig.grid.vol_filter = 2;
    if (orig)
        orig.lev = { on: true, bank: 100, lev: 3, risk_pct: 1, max_pos: 3, sl_atr: 2, tp_atr: 4, daily_loss_pct: 5, fee_pct: .05, slip_pct: .05, coins: ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'HYPE', 'ZEC', 'PEPE'], real: false, real_budget: 30, real_lev: 2, max_loss: 10, real_reset: 0, brk_h: 20, trend_h: 200, trend_on: true, fast: false, ...(orig.lev || {}) };
    if (orig)
        orig.meme = { on: true, bank: 100, size_pct: 10, max_pos: 5, min_liq: 20000, max_fdv: 5000000, min_age_min: 10, max_age_h: 72, tp_pct: 30, tp_part: 100, trail_from: 15, trail_pct: 12, sl_pct: 15, max_hold_h: 4, slip_pct: 1, fee_pct: .5, max_m5: 8, min_ratio: 1.2, min_buys: 5, max_h1: 0, wallet: '', real: false, max_loss: 10, max_slip: 2, real_reset: 0, ...(orig.meme || {}) };
    if (orig)
        orig.xfer = { daily_max: 1000, sweep_on: true, sweep_pct: 50, sweep_days: 7, sweep_min: 10, ...(orig.xfer || {}) };
    if (orig && orig.grid && orig.grid.trend_filter_pct == null)
        orig.grid.trend_filter_pct = 1;
    if (orig && !orig.notify)
        orig.notify = { enabled: false, topic: '', trades: true, alerts: true, daily: true, money: true };
    if (orig?.notify && orig.notify.daily_hour == null)
        orig.notify.daily_hour = 21;
    if (orig) {
        const b = orig.ban || {}, A = (x) => Array.isArray(x) ? x : [];
        orig.ban = { spot: A(b.spot), lev: A(b.lev), meme: A(b.meme), gspot: A(b.gspot) };
    }
    if (orig)
        orig.gspot = { on: true, real: false, bank: 100, budget: 50, max_loss: 15, lot_pct: 10, lot2_pct: 45, lot3_pct: 77, step_pct: 3.3, step3_pct: 6.6, lot_tp_pct: 3.5, stop_pct: 50, max_lots: 5, max_coins: 5, use_pct: 85, sma_hours: 72, trend_filter_pct: 5, vol_filter: 4, coins: 30, ...(orig.gspot || {}) };
    topicPlain = '';
    if (pw && typeof orig.notify?.topic === 'object') {
        try {
            topicPlain = await unseal(orig.notify.topic, pw);
        }
        catch (e) { }
    }
    else if (typeof orig.notify?.topic === 'string')
        topicPlain = orig.notify.topic;
    draft = JSON.parse(JSON.stringify(orig));
    renderConn();
    renderForm();
}
let patchQ = Promise.resolve(), patchErr = '';
function patchWhy() { const e = patchErr; return e === 'kilit' ? '(önce gerçek hesabın kilidini aç)' : e === 'yok' ? '(GitHub bağlantısı kurulmamış)' : e === 401 ? '(GitHub anahtarının süresi dolmuş)' : e === 403 || e === 404 ? '(GitHub anahtarının yazma izni yok)' : '(bağlantı kurulamadı)'; }
function cloudPatch(fn, msg) { const p = patchQ.then(() => cloudPatch_(fn, msg)); patchQ = p.catch(() => { }); return p; }
const ghHead = (json) => ({ Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', ...(json ? { 'Content-Type': 'application/json' } : {}) });
const utf8d = (t) => decodeURIComponent(escape(atob(t.replace(/\n/g, '')))), utf8e = (t) => btoa(unescape(encodeURIComponent(t)));
const SET_PUB = ['lang', 'theme', 'accent'];
async function setOpen(raw) {
    if (!raw || !raw.sec || raw.sec.enc !== 1)
        return raw;
    if (!pw)
        throw 'kilit';
    const sec = await unseal(raw.sec, pw), plain = { ...raw };
    delete plain.sec;
    const deep = (b, o) => { const r = { ...b }; for (const k in o)
        r[k] = o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) && r[k] && typeof r[k] === 'object' && !Array.isArray(r[k]) ? deep(r[k], o[k]) : o[k]; return r; };
    return deep(sec, plain);
}
async function setSeal(o) {
    if (!pw)
        throw 'kilit';
    const pub = {}, rest = {};
    for (const k in o)
        (SET_PUB.includes(k) ? pub : rest)[k] = o[k];
    return { ...pub, sec: await seal(rest, pw) };
}
async function cloudGet() {
    const cur = await tfetch(API + '?t=' + Date.now(), { headers: ghHead(), cache: 'no-store' }).then(r => { if (!r.ok)
        throw r.status; return r.json(); });
    return [await setOpen(JSON.parse(utf8d(cur.content))), cur.sha];
}
async function cloudPut(o, msg, sha0) {
    const enc = await setSeal(o);
    return tfetch(API, { method: 'PUT', headers: ghHead(true), body: JSON.stringify({ message: msg, content: utf8e(JSON.stringify(enc, null, 2) + '\n'), sha: sha0, branch: 'main' }) });
}
async function cloudPatch_(fn, msg, retry = true) {
    if (!token) {
        patchErr = 'yok';
        return false;
    }
    fastWatch();
    try {
        const [o, sha0] = await cloudGet();
        fn(o, true);
        const r = await cloudPut(o, msg, sha0);
        if (r.status === 409 && retry)
            return cloudPatch_(fn, msg, false);
        if (!r.ok)
            throw r.status;
        if (orig)
            fn(orig, false);
        if (draft)
            fn(draft, false);
        if (S?.settings)
            fn(S.settings, false);
        return true;
    }
    catch (e) {
        patchErr = e;
        return false;
    }
}
function save(obj, msg, keepDraft) { const p = patchQ.then(() => save_(obj, msg, keepDraft)); patchQ = p.catch(() => { }); return p; }
async function save_(obj, msg, keepDraft, retry = true) {
    fastWatch();
    if (!token) {
        toast('Kaydetmek için önce GitHub bağlantısını kur');
        STAB = 'app';
        renderForm();
        document.getElementById('connSec').scrollIntoView({ behavior: 'smooth' });
        return;
    }
    if (draft._bad && draft._bad.size && obj === undefined) {
        toast('Kırmızı alanları düzelt');
        return;
    }
    const data = obj || clean(draft), btn = document.getElementById('save');
    btn.textContent = 'Kaydediliyor…';
    try {
        const [fr, sha0] = await cloudGet();
        {
            const d = data;
            for (const k of ['sell', 'convert'])
                if ((fr[k]?.ts || 0) > (d[k]?.ts || 0))
                    d[k] = fr[k];
            if ((+fr.liquidate || 0) > (+d.liquidate || 0))
                d.liquidate = fr.liquidate;
            if (fr.notify && d.notify && (fr.notify.cleared || 0) > (d.notify.cleared || 0))
                d.notify.cleared = fr.notify.cleared;
            for (const k of ['xfer_req', 'xfer_cancel', 'dust', 'desk_cmd', 'buy'])
                d[k] = fr[k] || [];
            if ((+fr.clear || 0) > (+d.clear || 0))
                d.clear = fr.clear;
            for (const k of ['lang', 'theme', 'accent'])
                if (fr[k])
                    d[k] = fr[k];
        }
        const r = await cloudPut(data, 'Ayarlar uygulamadan güncellendi', sha0);
        if (r.status === 409 && retry) {
            btn.innerHTML = ic('i-check') + 'Kaydet';
            return save_(obj || data, msg, keepDraft, false);
        }
        if (!r.ok)
            throw r.status;
        const prev = keepDraft ? clean(draft) : null;
        orig = JSON.parse(JSON.stringify(data));
        draft = JSON.parse(JSON.stringify(data));
        if (prev)
            for (const k in prev)
                if (!['test_req', 'sell', 'convert', 'liquidate', 'xfer_req', 'xfer_cancel', 'dust', 'desk_cmd', 'buy', 'clear'].includes(k))
                    draft[k] = prev[k];
        renderForm();
        if (S)
            render();
        toast(msg || 'Kaydedildi. Bot birkaç saniye içinde yeni ayarlarla çalışır.');
    }
    catch (e) {
        toast(e === 'kilit' ? 'Ayarlar şifreli: kaydetmek için önce gerçek hesabın kilidini aç' : e === 401 ? 'GitHub anahtarının süresi dolmuş ya da silinmiş; Ayarlar → Uygulama bölümünden yeniden bağlan' : e === 403 ? 'Yetki hatası: anahtarın Contents yazma izni olmalı' : 'Kaydedilemedi, tekrar dene (' + e + ')');
    }
    finally {
        btn.innerHTML = ic('i-check') + 'Kaydet';
    }
}
let toastT;
function toast(t, why) {
    const el = document.getElementById('toast');
    const s = String(t);
    const k = /yanlış|hata|yapılamadı|kaydedilemedi|edilemedi|gönderilemez|alınamadı|bulunamadı|başarısız|yetmez|olmalı|gir$|bağlı değil|süresi dolmuş/i.test(s) ? 'er' : /gönderildi|kaydedildi|açıldı|kapatıldı|kopyalandı|eşitlendi|tamam|silindi|güncellendi|başlatıldı|değişti/i.test(s) ? 'ok' : 'in';
    el.className = 'toast t-' + k;
    el.innerHTML = `<span class="ti">${ic(k === 'er' ? 'i-info' : k === 'ok' ? 'i-check' : 'i-bell')}</span><span class="tt"><span></span><span></span></span><i class="tbar"></i>`;
    {
        const [a, b] = el.querySelectorAll('.tt span');
        let i = s.length > 70 ? s.indexOf(' · ') : -1;
        if (i > 0 && i < 14) {
            const j = s.indexOf(' · ', i + 3);
            if (j > 0 && j < 48)
                i = j;
        }
        if (i > 0) {
            a.textContent = s.slice(0, i);
            b.className = 'tb';
            b.textContent = s.slice(i + 3).replace(/\s+·\s+/g, ' · ') + (why ? ' ' + why : '');
        }
        else {
            a.textContent = s;
            b.textContent = why ? ' ' + why : '';
        }
    }
    el.classList.toggle('long', s.length > 70);
    el.hidden = false;
    el.onclick = () => { if (el.classList.contains('long') && !el.classList.contains('full')) {
        el.classList.add('full');
        clearTimeout(toastT);
        toastT = setTimeout(() => el.hidden = true, 12000);
    }
    else
        el.hidden = true; };
    clearTimeout(toastT);
    toastT = setTimeout(() => el.hidden = true, Math.min(9000, 3800 + Math.max(0, s.length - 70) * 25));
}
let HIST = null, hCoin = '', hSide = '';
function showHist(on) {
    overlayView(on);
    document.getElementById('mainv').hidden = on;
    document.getElementById('histv').hidden = !on;
    document.querySelector('header').hidden = on;
    scrollTo(0, 0);
    if (!on)
        pollMarket();
}
async function openHistory() {
    hCoin = '';
    hSide = '';
    showHist(true);
    const body = document.getElementById('histBody');
    body.innerHTML = `<div class="empty">${ic('i-refresh')}<div>Yükleniyor…</div></div>`;
    const x = S.strategies[sel];
    document.getElementById('histTitle').textContent = 'İşlem geçmişi · ' + (x?.name || '');
    try {
        const d = await getData('trades.json');
        let list = d.strategies?.[sel];
        if (!list && sel === 'live' && d.live_enc && pw)
            list = await unseal(d.live_enc, pw);
        HIST = (list || x?.recent || []).slice().sort((a, b) => b.ts - a.ts);
    }
    catch (e) {
        HIST = (x?.recent || []).slice();
    }
    renderHist();
}
function renderHist() {
    const body = document.getElementById('histBody');
    const all = HIST || [];
    if (!all.length) {
        body.innerHTML = `<div class="card"><div class="empty">${ic('i-list')}<div>Bu hesapta henüz işlem yok.</div></div></div>`;
        return;
    }
    const coins = [...new Set(all.map(t => t.inst))].sort();
    const rows = all.filter(t => (!hCoin || t.inst === hCoin) && (!hSide || t.side === hSide));
    const sells = rows.filter(t => t.side === 'SAT'), pnl = sells.reduce((a, t) => a + (t.pnl || 0), 0);
    let h = `<section style="margin-top:6px"><div class="hsumk"><div><b>${rows.length}</b><span>işlem</span></div><div><b>${rows.length - sells.length}</b><span>alım</span></div><div><b>${sells.length}</b><span>satış</span></div><div><b class="${cls(pnl)}">${sgn(pnl)}</b><span>TL kâr/zarar</span></div></div></section>
  <section><h2>${ic('i-coins')}Coin</h2><div class="coins4" id="hCoins"><button class="tile ${!hCoin ? 'on' : ''}" data-c=""><span class="ic">${ic('i-layers')}</span><span class="nm">Tümü</span></button>
    ${coins.map(c => `<button class="tile ${hCoin === c ? 'on' : ''}" data-c="${c}">${cico(c)}<span class="nm">${sym(c)}</span>${pq(c)}</button>`).join('')}</div></section>
  <section><h2>${ic('i-list')}İşlemler<span class="hsum"><span class="seg" id="hSide">${[['', 'Tümü'], ['AL', 'Alım'], ['SAT', 'Satış']].map(([k, n]) => `<button class="${hSide === k ? 'on' : ''}" data-s="${k}">${n}</button>`).join('')}</span></span></h2>`;
    if (!rows.length)
        h += `<div class="card"><div class="empty">${ic('i-list')}<div>Bu süzgeçte işlem yok.</div></div></div>`;
    let day = '';
    for (const t of rows) {
        const d = new Date(t.ts), dk = d.toDateString();
        if (dk !== day) {
            if (day)
                h += '</div>';
            day = dk;
            const dp = rows.filter(r => new Date(r.ts).toDateString() === dk && r.side === 'SAT').reduce((a, r) => a + (r.pnl || 0), 0);
            h += `<div class="dayh"><span>${d.toLocaleDateString(LANG === 'en' ? 'en-GB' : 'tr-TR', { day: 'numeric', month: 'long', weekday: 'long' })}</span>${dp ? `<b class="${cls(dp)}">${sgn(dp)} TL</b>` : ''}</div><div class="card list">`;
        }
        const sell = t.side === 'SAT', hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        h += `<div class="row">${cico(t.inst, t.side, t.pnl < 0)}<div class="mid"><b>${sym(t.inst)}${pq(t.inst)} ${sell ? 'satıldı' : 'alındı'}</b><span>${hm} · ${t.reason} · ${px(t.price)}</span></div>
      <div class="end"><b>${tl(t.amount, 0)}</b>${sell ? `<span class="pill ${cls(t.pnl) || 'z'}"><i>${t.pnl >= 0 ? '▲' : '▼'}</i>${nf(Math.abs(t.pnl))} TL<small>${t.pnl >= 0 ? 'kâr' : 'zarar'}</small></span>` : `<span class="pill buy">${ic('i-coins')}Alım</span>`}</div></div>`;
    }
    if (day)
        h += '</div>';
    h += '</section>';
    body.innerHTML = h;
    body.querySelectorAll('#hCoins .tile').forEach(b => b.onclick = () => { hCoin = b.dataset.c; renderHist(); });
    body.querySelectorAll('#hSide button').forEach(b => b.onclick = () => { hSide = b.dataset.s; renderHist(); });
}
document.getElementById('histBtn').onclick = openHistory;
document.getElementById('closeHist').onclick = () => showHist(false);
function showSettings(on) {
    overlayView(on);
    document.getElementById('mainv').hidden = on;
    document.getElementById('setv').hidden = !on;
    document.querySelector('header').hidden = on;
    scrollTo(0, 0);
    if (on)
        loadSettings();
    else
        pollMarket();
    navSave();
}
document.getElementById('openSet').onclick = () => showSettings(true);
document.getElementById('closeSet').onclick = () => { if (draft && JSON.stringify(orig) !== JSON.stringify(clean(draft)) && !confirmLeave())
    return; showSettings(false); };
let leaveArm = 0;
function confirmLeave() { if (leaveArm)
    return true; leaveArm = 1; toast('Kaydedilmemiş değişiklik var. Çıkmak için geri tuşuna tekrar dokun.'); setTimeout(() => leaveArm = 0, 3500); return false; }
let topicPlain = '';
const swRow = (id, on, title, sub) => `<div class="sw ${on ? 'on' : ''}" id="${id}"><div class="lb"><b>${title}</b><span>${sub}</span></div><div class="track"><i></i></div></div>`;
function notifySection() {
    const N = draft.notify || (draft.notify = { enabled: false, topic: '', trades: true, alerts: true, daily: true, money: true });
    const nOn = [N.money !== false, N.trades, N.alerts, N.daily].filter(Boolean).length;
    let h = accOpen('bild', 'Bildirimler', 'i-bell', 'violet', !pw ? 'Kilitli: önce gerçek hesabın kilidini aç' : N.enabled ? `Açık · ${nOn} tür bildirim` : 'Kapalı', secDirty(['notify'])) + `<div class="card">`;
    if (!pw)
        return h + `<div style="font-size:13px;color:var(--muted)">${ic('i-lock')} Bildirimleri açmak için önce ana ekranda <b>Gerçek hesap</b> kutusuna dokunup kilidi aç.</div></div>` + ACC_END;
    h += swRow('nOn', N.enabled, 'Telefona bildirim gönder', 'Olaylar anında telefonuna ve uygulamadaki zile düşer');
    if (N.enabled) {
        const T = [['nMo', N.money !== false, 'i-wallet', 'Para', 'Yatırma, çekme'], ['nTr', !!N.trades, 'i-coins', 'Al-sat', 'Alım, satım'],
            ['nAl', !!N.alerts, 'i-shield', 'Uyarılar', 'Hata, acil fren'], ['nDy', !!N.daily, 'i-day', 'Günlük özet', `Saat ${String(N.daily_hour ?? 21).padStart(2, '0')}:00`]];
        const mask = topicPlain ? topicPlain.slice(0, 9) + '•'.repeat(Math.max(4, topicPlain.length - 9)) : '—';
        h += `<div class="nsub">Hangi bildirimler gelsin</div>
      <div class="tiles ntiles">${T.map(([id, on, i, t, d]) => `<button type="button" class="tile ${on ? 'on' : ''}" id="${id}"><span class="ic">${ic(i)}</span><span class="nm">${t}</span><span class="pc">${d}</span><em class="ck">${ic(on ? 'i-check' : 'i-minus')}</em></button>`).join('')}</div>
      ${N.daily ? `<div class="nhour">${field(['notify.daily_hour', 'Özet saati', 'Günlük özet bu saatte gelir', ':00', 1, 0, 23, 0])}</div>` : ''}
      <div class="nsub">Bildirim kanalı</div>
      <div class="nchan"><span class="nci">${ic('i-lock')}</span><div class="nct"><b id="nTopic" data-m="1">${mask}</b><span>Gizli tut; bu adı bilen bildirimleri görür</span></div></div>
      <div class="nbtns"><button type="button" class="btn sm" id="nShow">${ic('i-eye')}Göster</button><button type="button" class="btn sm" id="nCopy">${ic('i-copy')}Kopyala</button><button type="button" class="btn sm" id="nTest">${ic('i-bell')}Test</button></div>
      <details class="setup"${N.topic ? '' : ' open'}><summary>${ic('i-phone')}Telefona kurulum (ntfy)</summary>
      <ol class="steps"><li><b>ntfy</b> uygulamasını kur: <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">Android</a> · <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener">iPhone</a></li>
      <li>ntfy'de <b>+</b> düğmesine dokun, <b>Kopyala</b> ile aldığın kanal adını yapıştır, <b>Abone ol</b>.</li>
      <li>Burada <b>Kaydet</b>'e bas, sonra <b>Test</b>'e dokun.</li></ol></details>`;
    }
    return h + '</div>' + ACC_END;
}
function bindNotify() {
    const N = draft.notify;
    if (!N || !pw)
        return;
    const t = (id, f) => { const e = document.getElementById(id); if (e)
        e.onclick = f; };
    t('nOn', async () => {
        N.enabled = !N.enabled;
        if (N.enabled && !topicPlain) {
            topicPlain = 'masal-' + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => (b % 36).toString(36)).join('');
            N.topic = await seal(topicPlain, pw);
        }
        renderForm();
    });
    t('nTr', () => { N.trades = !N.trades; renderForm(); });
    t('nAl', () => { N.alerts = !N.alerts; renderForm(); });
    t('nDy', () => { N.daily = !N.daily; renderForm(); });
    t('nMo', () => { N.money = N.money === false; renderForm(); });
    t('nShow', () => { const e = document.getElementById('nTopic'), b = document.getElementById('nShow'); if (!e || !topicPlain)
        return; const m = e.dataset.m === '1'; e.dataset.m = m ? '0' : '1'; e.textContent = m ? topicPlain : topicPlain.slice(0, 9) + '•'.repeat(Math.max(4, topicPlain.length - 9)); b.lastChild.textContent = m ? 'Gizle' : 'Göster'; });
    t('nCopy', () => { navigator.clipboard?.writeText(topicPlain).then(() => toast('Konu adı kopyalandı'), () => toast('Kopyalanamadı, elle seç')); });
    t('nTest', async () => {
        try {
            const r = await tfetch('https://ntfy.sh/', { method: 'POST', body: JSON.stringify({ topic: topicPlain, title: 'Masal', message: 'Test bildirimi: bağlantı çalışıyor.', tags: ['white_check_mark'] }) });
            toast(r.ok ? 'Test bildirimi gönderildi' : 'Gönderilemedi (' + r.status + ')');
        }
        catch (e) {
            toast('Gönderilemedi, bağlantını kontrol et');
        }
    });
}
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (!document.getElementById('setv').hidden && draft)
    renderForm(); });
window.addEventListener('appinstalled', () => { installEvt = null; toast('Masal ana ekrana eklendi'); if (draft)
    renderForm(); });
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
function themeMode() { try {
    return localStorage.getItem('masal-tema') || 'auto';
}
catch (e) {
    return 'auto';
} }
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
    const m = themeMode(), d = m === 'dark' || (m === 'auto' && darkMQ.matches);
    document.documentElement.dataset.theme = d ? 'dark' : 'light';
    document.querySelector('meta[name=theme-color]').content = d ? '#13110D' : '#FBF8F2';
}
delete document.documentElement.dataset.accent;
function setTheme(m) { try {
    localStorage.setItem('masal-tema', m);
}
catch (e) { } applyTheme(); }
darkMQ.addEventListener?.('change', applyTheme);
applyTheme();
function installSection() {
    const tmn = { light: 'Açık', dark: 'Koyu', auto: 'Otomatik' }[themeMode()];
    let h = accOpen('app', 'Uygulama', 'i-phone', 'gray', `Sürüm ${APP_VERSION} · tema ${tmn} · ${LANG === 'en' ? 'English' : 'Türkçe'}${remoteVer && vcmp(remoteVer.version, APP_VERSION) > 0 ? ' · yeni sürüm var' : ''}`, false) + `<div class="card">`;
    if (standalone())
        h += `<div style="display:flex;gap:8px;align-items:center;color:var(--green);font-weight:600;font-size:13.5px">${ic('i-check')}Masal ana ekranında uygulama olarak yüklü</div>`;
    else if (installEvt)
        h += `<div style="font-size:13px;margin-bottom:10px">Masal'ı ana ekrana ekle; kendi simgesiyle uygulama gibi açılır, internet yokken de son verileri gösterir.</div><button class="btn primary" id="instBtn" style="width:100%">${ic('i-phone')}Ana ekrana ekle</button>`;
    else
        h += `<ol class="steps" style="margin-top:0"><li><b>Android (Chrome):</b> sağ üstteki ⋮ → <b>Ana ekrana ekle</b></li><li><b>iPhone (Safari):</b> Paylaş → <b>Ana Ekrana Ekle</b></li><li><b>Bilgisayar (Chrome/Edge):</b> adres çubuğundaki <b>Yükle</b> simgesi</li></ol>`;
    const tm = themeMode();
    h += `<div class="prf"><b>Tema</b><div class="seg mini" id="themeTiles">${[['light', 'i-sun', 'Açık'], ['dark', 'i-moon', 'Koyu'], ['auto', 'i-auto', 'Otomatik']].map(([k, i, n]) => `<button type="button" class="${tm === k ? 'on' : ''}" data-th="${k}">${ic(i)}${n}</button>`).join('')}</div></div>`;
    h += `<div class="prf"><b>Dil</b><div class="seg mini" id="langTiles">${[['tr', 'Türkçe'], ['en', 'English']].map(([k, n]) => `<button type="button" class="${LANG === k ? 'on' : ''}" data-lg="${k}">${n}</button>`).join('')}</div></div>`;
    const newer = remoteVer && vcmp(remoteVer.version, APP_VERSION) > 0;
    h += `<div class="ver"><div><b>Sürüm ${APP_VERSION}</b><span>${newer ? 'Yeni sürüm hazır: ' + remoteVer.version : 'Güncel'}${remoteVer?.date ? ' · ' + remoteVer.date.split('-').reverse().join('.') : ''}</span></div>
    <button class="btn ${newer ? 'primary' : ''}" id="verBtn">${ic('i-refresh')}${newer ? 'Güncelle' : 'Denetle'}</button></div>`;
    return h + '</div>' + ACC_END;
}
function bindInstall() {
    document.querySelectorAll('#langTiles button').forEach(t => t.onclick = async () => {
        const l = t.dataset.lg;
        if (l === LANG)
            return;
        localStore('masal_pref_ts', String(Date.now()));
        await cloudPatch(o => { o.lang = l; }, 'Dil değişti');
        setLang(l);
    });
    document.querySelectorAll('#themeTiles button').forEach(t => t.onclick = () => { setTheme(t.dataset.th); localStore('masal_pref_ts', String(Date.now())); cloudPatch(o => { o.theme = t.dataset.th; }, 'Tema değişti'); document.querySelectorAll('#themeTiles button').forEach(x => x.classList.toggle('on', x === t)); });
    const v = document.getElementById('verBtn');
    if (v)
        v.onclick = () => { if (remoteVer && vcmp(remoteVer.version, APP_VERSION) > 0)
            applyUpdate();
        else
            checkVersion(true); };
    const b = document.getElementById('instBtn');
    if (b)
        b.onclick = async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; renderForm(); };
}
let remoteVer = null;
const vcmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0))
        return (x[i] || 0) - (y[i] || 0);
} return 0; };
async function checkVersion(manual) {
    const was = remoteVer?.version;
    try {
        remoteVer = await tfetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json());
    }
    catch (e) {
        if (manual)
            toast('Sürüm bilgisi alınamadı');
        return;
    }
    const bar = document.getElementById('upbar');
    if (vcmp(remoteVer.version, APP_VERSION) > 0) {
        bar.innerHTML = `<div class="in">${ic('i-refresh')}<div><b>Yeni sürüm algılandı: ${remoteVer.version}</b><small>${(remoteVer.notes || []).slice(0, 2).join(' · ')}</small></div><button class="btn" id="upBtn">Güncelle</button></div>`;
        bar.hidden = false;
        document.getElementById('upBtn').onclick = applyUpdate;
    }
    else {
        bar.hidden = true;
        if (manual)
            toast('Masal güncel: sürüm ' + APP_VERSION);
    }
    showNews();
    if (remoteVer.version !== was && !document.getElementById('setv').hidden && draft)
        renderForm();
}
function showNews() {
    const seen = localStore('masal_seen_ver') || '1.51.1';
    if (!remoteVer || remoteVer.version !== APP_VERSION)
        return;
    if (vcmp(APP_VERSION, seen) <= 0)
        return;
    const list = (remoteVer.history || [{ version: remoteVer.version, notes: remoteVer.notes }]).filter((h) => vcmp(h.version, seen) > 0).slice(0, 6);
    if (!list.length) {
        localStore('masal_seen_ver', APP_VERSION);
        return;
    }
    const q = document.getElementById('qsh');
    if (!q.hidden)
        return;
    localStore('masal_seen_ver', APP_VERSION);
    q.dataset.n = '';
    qHead('i-spark', 'Tamam');
    document.getElementById('qTitle').textContent = 'Yenilikler';
    document.getElementById('qText').innerHTML = `<div class="news">${list.map((h) => `<div><b>Sürüm ${h.version}</b><ul>${(h.notes || []).map((n) => `<li>${String(n).replace(/</g, '&lt;')}</li>`).join('')}</ul></div>`).join('')}</div>`;
    q.hidden = false;
}
async function applyUpdate() {
    try {
        const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
        for (const r of regs)
            await r.update();
        const ks = await caches?.keys?.() || [];
        for (const k of ks)
            await caches.delete(k);
    }
    catch (e) { }
    location.replace(location.pathname + '?v=' + (remoteVer?.version || Date.now()));
}
setInterval(() => { if (!document.hidden)
    checkVersion(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden)
    checkVersion(); });
checkVersion();
let splashT0 = Date.now();
function hideSplash() {
    const sp = document.getElementById('splash');
    if (!sp || sp.classList.contains('out'))
        return;
    setTimeout(() => { sp.classList.add('out'); setTimeout(() => sp.remove(), 400); }, Math.max(0, 2000 - (Date.now() - splashT0)));
}
setTimeout(hideSplash, 4000);
document.getElementById('logo').onclick = () => { const l = document.querySelector('#logo .lg'); const c = l.cloneNode(true); c.classList.remove('done'); l.replaceWith(c); setTimeout(() => c.classList.add('done'), 1600); };
if ('serviceWorker' in navigator && location.protocol === 'https:')
    navigator.serviceWorker.register('sw.js').catch(() => { });
document.getElementById('save').onclick = () => save();
document.getElementById('undo').onclick = () => { draft = JSON.parse(JSON.stringify(orig)); renderForm(); };
(async () => { await initLang(); await openLink(); load(); })();
let backExit = 0;
function backLayer() {
    const pin = document.querySelector('.pinv:not(.out) [data-k="x"]');
    if (document.querySelector('.pinv:not(.out)')) {
        if (pin && pin.textContent)
            pin.click();
        return true;
    }
    const q = document.getElementById('qsh');
    if (!q.hidden) {
        q.hidden = true;
        return true;
    }
    const sw = document.querySelectorAll('.swr.open');
    if (sw.length) {
        swOpen = '';
        sw.forEach(w => w.classList.remove('open'));
        return true;
    }
    if (!document.getElementById('setv').hidden) {
        document.getElementById('closeSet').click();
        return true;
    }
    if (!document.getElementById('histv').hidden) {
        showHist(false);
        return true;
    }
    if (!document.getElementById('masav').hidden) {
        showMasa(false);
        return true;
    }
    if (VIEW !== 'home') {
        showView('home');
        return true;
    }
    return false;
}
history.pushState({ masal: 1 }, '');
addEventListener('popstate', () => {
    if (backLayer()) {
        history.pushState({ masal: 1 }, '');
        return;
    }
    if (Date.now() - backExit < 2000) {
        history.back();
        return;
    }
    backExit = Date.now();
    toast('Çıkmak için geri tuşuna tekrar bas');
    history.pushState({ masal: 1 }, '');
});
let navReady = false;
function navSave() { if (!navReady)
    return; try {
    sessionStorage.setItem('masal_nav', JSON.stringify({ v: VIEW, set: !document.getElementById('setv').hidden, stab: STAB, y: Math.round(scrollY) }));
}
catch (e) { } }
{
    let t = 0;
    addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(navSave, 250); }, { passive: true });
}
(function navRestore() {
    let n = null;
    try {
        n = JSON.parse(sessionStorage.getItem('masal_nav') || 'null');
    }
    catch (e) { }
    if (!n) {
        navReady = true;
        return;
    }
    setTimeout(() => {
        if (n.set) {
            STAB = n.stab || 'spot';
            showSettings(true);
        }
        else if (n.v && n.v !== 'home')
            showView(n.v);
        navReady = true;
        let k = 0;
        const go = () => { scrollTo(0, n.y || 0); if (++k < 6 && Math.abs(scrollY - (n.y || 0)) > 4)
            setTimeout(go, 400); };
        setTimeout(go, 300);
    }, 60);
})();
const CLIP_OPEN = new Set();
function clipList(id, n) {
    const el = document.getElementById(id);
    if (!el)
        return;
    const rows = [...el.children].filter(c => c.classList.contains('row'));
    let b = el.querySelector(':scope>.clipb');
    const open = CLIP_OPEN.has(id);
    rows.forEach((r, i) => { const h = !open && i >= n; if (r.hidden !== h)
        r.hidden = h; });
    if (rows.length <= n) {
        b?.remove();
        return;
    }
    if (!b) {
        b = document.createElement('button');
        b.type = 'button';
        b.className = 'clipb';
    }
    if (b !== el.lastElementChild)
        el.appendChild(b);
    const h = open ? `${ic('i-chev')}Daha az göster` : `${ic('i-chev')}${rows.length - n} tane daha göster`;
    if (b._h !== h) {
        b.innerHTML = h;
        b._h = h;
    }
    b.onclick = () => { open ? CLIP_OPEN.delete(id) : CLIP_OPEN.add(id); clipList(id, n); };
}
