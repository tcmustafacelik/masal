"use strict";
const APP_VERSION = '1.70.0';
const ICON = { dip: 'i-dip', trend: 'i-trend', grid: 'i-grid', live: 'i-coins' };
const COLORS = { dip: '#2F6FDE', trend: '#7A5AC8', grid: '#178A5B', live: '#7C8696' };
const AMBER = '#D9861A';
let S = null, B = null, sel = 'live', view = 'live';
function localStore(k, v) { try {
    if (v === undefined)
        return localStorage.getItem(k);
    localStorage.setItem(k, v);
}
catch (e) {
    return null;
} }
const nf = (v, d = 2) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const tl = (v, d = 2) => nf(v, d) + '\u00a0TL'; // bölünmez boşluk: "TL" satır sonunda tek başına kalmasın
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v));
const spc = (v, d = 2) => (v > 0 ? '+' : v < 0 ? '−' : '') + '%' + nf(Math.abs(v), d); // işaretli yüzde: +%0,14 / −%1,86
const cls = v => v > 0 ? 'up' : v < 0 ? 'dn' : '';
function px(v) { const a = Math.abs(v); return nf(v, a >= 1000 ? 0 : a >= 10 ? 2 : a >= 1 ? 3 : 5); }
function fv(v, dec) { return dec > 0 ? String(Math.round(+v * 100) / 100).replace('.', ',') : Number(v).toLocaleString('tr-TR'); } // en fazla 2 ondalık: kutudan taşmasın
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
/* ---------- dil: varsayılan Türkçe; İngilizce seçilince ekrandaki yazılar sözlükle (docs/en.json) çevrilir ----------
   Kodda bütün yazılar Türkçe kalır. Çeviri, ekrana gelen her yazıya uygulanır: sayılar ve coin adları yer tutucu
   olur ({0}, {1}…), kalıp sözlükte aranır, sayılar İngilizce biçime (1,234.5 · 1.5%) çevrilerek geri konur. */
let LANG = (localStore('masal_lang') === 'en' ? 'en' : 'tr');
let EN = {};
const I18N_TOK = /[+−-]?%?\d[\d.,:]*%?|\b[A-Z][A-Z0-9]{1,11}\b/g;
const I18N_MISS = new Set();
function enNum(v) {
    if (/^\d+\.$/.test(v))
        return v.slice(0, -1); // sıra sayısı: "2." → "2"
    if (/\.(\d{1,2}|\d{4,})(?!\d)/.test(v))
        return v; // nokta 3 haneyi ayırmıyorsa tarih (19.11), sayı değil
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
    const e = EN[key];
    if (e == null) {
        // sadece sayı/kısaltma olan yazılar (15.644 · %73 · ,04 TL): sayılar İngilizce biçime çevrilir
        if (!/[a-zçğıöşü]/.test(key))
            return s.replace(/^(\s*),(?=\d)/, '$1.').replace(I18N_TOK, m => enNum(m));
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
/* ---------- şifreleme (bot ile aynı: PBKDF2-SHA256 + AES-GCM) ---------- */
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0)), b64e = u => btoa(String.fromCharCode(...new Uint8Array(u)));
async function deriveKey(pw, salt, iter) {
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const KEYS = new Map(); // aynı tuz için anahtar bir kez türetilir (bot oturum boyunca aynı tuzu kullanır)
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
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(box.iv) }, k, b64d(box.ct))));
}
async function seal(obj, pw, iter = 150000) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const k = await deriveKey(pw, salt, iter);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(obj)));
    return { enc: 1, iter, salt: b64e(salt), iv: b64e(iv), ct: b64e(ct) };
}
let pw = localStore('masal_pw') || '';
async function openLive() {
    if (!S.live_enc)
        return;
    const pub = S.live_public || { armed: false, paused: false };
    S.strategies.live = { locked: true, name: 'Gerçek hesap', live: true, armed: pub.armed, paused: pub.paused, pnl_pct: 0 };
    if (!pw)
        return;
    try {
        const o = await unseal(S.live_enc, pw);
        S.strategies.live = o.strategy;
        S.okx = o.okx;
        S.xfer = o.xfer;
        S.levr = o.levr;
        S.memer = o.memer;
    }
    catch (e) {
        pw = '';
        localStorage.removeItem('masal_pw');
        toast('Şifre uyuşmadı, gerçek hesap kilitli kaldı');
    }
}
// Bot kayıtları ayrı "data" dalında tutulur (site her turda yeniden yayınlanmasın diye)
/** Süre sınırlı istek: VPN ya da zayıf bağlantıda askıda kalan istek sonsuza kadar beklenmez. */
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
/** Bot kayıtları sırayla üç kaynaktan denenir; hepsi başarısızsa telefonda saklanan son veri kullanılır. */
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
                const j = await r.json();
                try {
                    localStorage.setItem(CACHE_KEY + f, JSON.stringify(j));
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
// Botun her kaydı "data" dalında yeni bir sürüm oluşturur; uygulama 2 saniyede bir bakar, değiştiyse hemen yeniler
let watching = false, watchHold = 0;
async function watchData() {
    if (document.hidden || !S || watching)
        return;
    watching = true;
    try {
        // ETag ile sorulur: değişiklik yoksa GitHub 304 döner ve bu, saatlik istek hakkından düşmez (2 sn'de bir bakmak güvenli)
        // GitHub isteği başarısızsa (anahtar süresi doldu, sınır, sunucu hatası) veriler yine 15 sn'de bir doğrudan yenilenir
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
                if (r.status === 403 || r.status === 429)
                    watchHold = Date.now() + Math.max(60000, (+r.headers.get('Retry-After') || 0) * 1000);
            }
            catch (e) { }
        }
        if (Date.now() - lastLoad > 15000)
            load(true);
    }
    finally {
        watching = false;
    }
}
// otomatik eşitleme her zaman açık: 2 sn'de bir buluta bakılır; bir istek gönderildikten sonraki 40 sn boyunca saniyede bir
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
        // açılışta son kayıtlı veri hemen gösterilir (bekleme yok), taze veri gelince yerine yazılır
        if (!S) {
            try {
                const c = localStorage.getItem(CACHE_KEY + 'summary.json');
                if (c) {
                    S = JSON.parse(c);
                    B = JSON.parse(localStorage.getItem(CACHE_KEY + 'backtest.json') || 'null');
                    await openLive();
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
        // geçmiş test haftada bir değişir: 10 dakikada bir yeterli
        const needB = !B || Date.now() - lastB > 6e5;
        const [s, b] = await Promise.all([getData('summary.json'), needB ? getData('backtest.json').catch(() => null) : Promise.resolve(B)]);
        if (needB)
            lastB = Date.now();
        S = s;
        B = b;
        await openLive();
        syncMark(!offlineData);
        // dil ve tema buluttan: başka cihazda değiştirildiyse bu cihaz da uyar (az önce burada değiştirildiyse bekler)
        {
            const st = S.settings, recent = Date.now() - +(localStore('masal_pref_ts') || 0) < 180000;
            if (st && !recent) {
                if (st.theme && st.theme !== themeMode())
                    setTheme(st.theme);
                if (st.accent && st.accent !== (localStore('masal-renk') || 'amber'))
                    setAccent(st.accent);
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
function render() {
    updLine();
    homeChecks();
    renderMasa();
    renderDeck();
    const L = S.strategies.live;
    {
        const m = document.getElementById('mode'), halt = L && L.halted, real = L && L.armed, want = orig ? orig.live : S.settings?.live;
        const pending = L && !halt && want !== undefined && !!want !== !!real;
        m.className = 'mode' + (halt ? ' halt' : real ? ' real' : '');
        if (pending)
            m.className = 'mode';
        m.innerHTML = pending ? `<span class="mi">${ic('i-refresh')}</span><span><b>${want ? 'Gerçeğe' : 'Denemeye'}</b><small>geçiliyor…</small></span>` : halt ? `<span class="mi">${ic('i-stop')}</span><span><b>Durdu</b><small>Acil fren</small></span>`
            : L && L.paused ? `<span class="mi">${ic('i-pause')}</span><span><b>Beklemede</b><small>Yeni alım yok</small></span>`
                : real ? `<span class="mi">${ic('i-coins')}</span><span><b>Gerçek</b><small>OKX TR'de</small></span>`
                    : `<span class="mi">${ic('i-flask')}</span><span><b>Deneme</b><small>Emir gitmez</small></span>`;
        m.onclick = () => document.getElementById('openSet').click();
    }
    document.getElementById('foot').innerHTML = 'Fiyatlar uygulama açıkken OKX TR\'den anlık güncellenir; bot kesintisiz çalışır, yaklaşık 5 saniyede bir kontrol eder.<br>' + (L && L.armed ? 'Ekrandaki rakamlar OKX TR hesabındaki gerçek işlemlerdir.' : 'Gerçek para kullanılmıyor; tüm işlemler sanal.');
    if (S.strategies.live && sel !== 'live')
        sel = 'live'; // sanal stratejiler kapalı: her zaman gerçek hesap
    const x = S.strategies[sel];
    const locked = !!x.locked;
    document.getElementById('chartSec').hidden = locked;
    if (locked) {
        document.getElementById('hero').className = 'hero';
        document.getElementById('hero').innerHTML = `<div class="hh"><span class="hn">${ic('i-lock')}Gerçek hesap</span></div><div class="lock" style="margin-top:10px"><b>${ic('i-lock')}Veriler şifreli</b>
      <p>Bakiye ve işlemlerin herkese açık sayfada şifreli duruyor. Görmek için OKX'te API anahtarını oluştururken belirlediğin şifreyi (Passphrase) gir. Şifre sadece bu cihazda saklanır.</p>
      <input class="inp" id="pwIn" type="password" placeholder="OKX şifresi" autocomplete="off"><button class="btn primary" id="pwBtn" style="width:100%">${ic('i-lock')}Kilidi aç</button></div>`;
        document.getElementById('alerts').innerHTML = '';
        document.getElementById('pwBtn').onclick = async () => {
            const v = document.getElementById('pwIn').value;
            if (!v)
                return toast('Şifreyi gir');
            try {
                const o = await unseal(S.live_enc, v);
                pw = v;
                localStore('masal_pw', v);
                S.strategies.live = o.strategy;
                S.okx = o.okx;
                S.xfer = o.xfer;
                S.levr = o.levr;
                S.memer = o.memer;
                render();
                toast('Kilit açıldı');
            }
            catch (e) {
                toast('Şifre yanlış');
            }
        };
        ['positions', 'trades', 'coins'].forEach(id => document.getElementById(id).innerHTML = `<div class="empty">${ic('i-lock')}<div>Kilitli</div></div>`);
        document.getElementById('nowSec').hidden = true;
        document.getElementById('kasa').innerHTML = '';
        document.getElementById('logSec').hidden = true;
        renderBacktest();
        renderRules(x.risk || S.risk, null);
        renderMarket();
        {
            const k = document.getElementById('xfer');
            k.hidden = false;
            setH(k, `<div class="empty">${ic('i-lock')}<div>Kasalar için önce kilidi aç (Spot sekmesi)</div></div>`);
        }
        return;
    }
    let al = '';
    if (x.halted)
        al += `<div class="alert red">${ic('i-power')}<div><b>Acil fren devrede.</b> ${x.halt_reason}. Bot bu stratejide yeni işlem açmıyor.</div></div>`;
    document.getElementById('alerts').innerHTML = al;
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
      <div class="end"><b>${tl(t.amount, 0)}</b>${sell ? `<span class="plc ${cls(t.pnl) || 'z'}">${sgn(t.pnl)} TL ${t.pnl >= 0 ? 'kâr' : 'zarar'}</span>` : `<span>harcandı</span>`}</div></div>`;
    }).join('')
        : `<div class="empty">${ic('i-list')}<div>Henüz işlem yok. Bot fırsat bekliyor.</div></div>`);
    clipList('trades', 4);
    renderBacktest();
    renderLog(x);
    renderRules(x.risk || S.risk, x.cfg);
    renderMarket();
}
/* ---------- açıklamalar ("?" düğmeleri) ---------- */
const pp = (v, d = 1) => '%' + nf(v * 100, Math.round(v * 1000) % 10 ? d : 0);
function gloss(k) {
    const L = S?.strategies?.live, c = (L && !L.locked && L.cfg) || null;
    const step = c ? pp(c.step) : '%1,5', tp = c ? pp(c.lot_tp) : '%4', stop = c ? pp(c.stop) : '%12', ml = c ? c.max_lots : 4, mc = c ? c.max_coins : 20, lot = c ? tl(c.lot, 0) : 'bir kademe', use = c ? pp(c.max_use, 0) : '%40', cf = c?.coin_filter ? pp(c.coin_filter) : '%1', qt = S?.settings?.quote || S?.okx?.quote || 'USDT';
    const G = {
        nasil: ['Bot nasıl alıp satar?', `${c?.instant ? '<p>Bot <b>5 saniyede bir</b> fiyatlara bakar; fiyat alım seviyesine değdiği an alır. Alım seviyesi son kapanan 15 dakikalık mumlara göre hesaplanır.</p>' : '<p>Bot <b>5 saniyede bir</b> piyasaya bakar, kararını <b>15 dakikalık mum</b> kapanınca verir.</p>'}
      <ul><li><b>Alım:</b> Bir coin son ${c?.sma_h || 20} saatin ortalamasından <b>${step}</b> aşağı inince ${lot}'lik bir parça (kademe) alır.</li>
      <li><b>Düşerse:</b> ${step} düşüşte 2. kademeyi${c?.step3 && c.step3 > c.step ? `, ${pp(c.step3)} daha düşüşte 3. kademeyi` : ''} alır; bir coinde en fazla <b>${ml}</b> kademe.${c && ((c.lot2 ?? 1) < 1 || (c.lot3 ?? 1) < 1) ? ` Kademe tutarları: ${tl(c.lot, 0)} → ${tl(c.lot * (c.lot2 ?? 1), 0)} → ${tl(c.lot * (c.lot3 ?? 1), 0)}.` : ''}</li>
      <li><b>Satış:</b> Her kademe kendi alış fiyatının <b>${tp}</b> üstüne çıkınca ayrı satılır.</li>
      <li><b>Zarar kesme:</b> Ortalama maliyetin <b>${stop}</b> altına inerse o coindeki her şey satılır.</li>
      <li><b>Düşüş filtresi:</b> Coin bir günde ${cf}'den fazla geriliyorsa "düşen bıçak" sayılır, yeni alım bekletilir.</li></ul>
      <p>${qt === 'TRY' ? 'Coinler <b>TRY paritesinden</b> alınır.' : `Coinler <b>${qt} paritesinden</b> alınır; TL gerekirse otomatik ${qt}'ye çevrilir.`} Uygulamadaki bütün fiyat ve tutarlar <b>TL karşılığıdır</b>.</p>
      <p>Aynı anda en fazla <b>${mc}</b> coin tutulur ve bütçenin en fazla <b>${use}</b>'ı coine yatırılır; kalanı güvenlik payıdır.</p>`],
        yakin: ['Alıma yakın coinler', `<p>Her satır bir coinin <b>alım fiyatına ne kadar uzak</b> olduğunu gösterir.</p>
      <ul><li><span class="chip m">%0,8 düşerse</span> fiyat bu kadar daha inerse bot alır.</li>
      <li><span class="chip g">Alım şartında</span> fiyat alım seviyesinde; ${c?.instant ? 'bot birkaç saniye içinde alır' : '15 dakikalık mum bu seviyede kapanırsa bot alır'}.</li>
      <li><span class="chip a">Düşüş filtresi</span> coin hızlı düşüyor ya da hacmi aniden patladı (panik satışı); sakinleşene kadar alım bekletiliyor.</li>
      <li><span class="chip a">Şartta · bütçe dolu</span> fiyat uygun ama coinlere ayrılan para dolu; bir kademe satılınca alır.</li>
      <li><span class="chip a">Şartta · coin sınırı dolu</span> fiyat uygun ama aynı anda tutulabilecek coin sayısı dolu; elindeki bir coin satılınca alır.</li>
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
/* ---------- Ajan masası: botun her parçası bir "ajan" kartı; ne yaptığı ve neden yaptığı canlı görünür ----------
   Veriler botun gerçek kaydından gelir (izlenen coinler, koruma durumu, işlemler, bot kayıtları); uydurma rakam yok. */
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
        box.innerHTML = `<div class="empty">${ic('i-lock')}<div>Gerçek hesabın kilidi açık olmalı</div></div>`;
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
    // canlı akış: işlemler (sebebiyle) + bot notları, zamana göre
    const feed = [];
    for (const t of rec.slice(0, 25))
        feed.push([t.ts, t.side === 'AL' ? 'al' : (t.pnl || 0) >= 0 ? 'sat' : 'zar', t.side === 'AL' ? 'AL' : 'SAT',
            `<b>${sym(t.inst)}</b> ${tl(t.amount, 0)}${t.side === 'SAT' ? ` · <span class="${cls(t.pnl || 0)}">${sgn(t.pnl || 0)} TL</span>` : ''}<small>sebep: ${(t.reason || '—').replace(/</g, '&lt;')}</small>`]);
    for (const [ts, msg] of (x.log || []).slice(0, 20))
        if (!/^(AL|SAT|\[deneme\]) /.test(msg))
            feed.push([ts, /HATA|uyarı|alınamıyor/i.test(msg) ? 'err' : 'not', /HATA/i.test(msg) ? 'HATA' : 'NOT', msg.replace(/</g, '&lt;')]);
    feed.sort((a, b) => b[0] - a[0]);
    box.innerHTML = `<div class="mtop"><div><span>Bottaki para</span><b>${tl(eq, 0)}</b></div><div><span>Bugün</span><b class="${cls(today)}">${sgn(today)} TL</b></div>
      <div><span>İşlem</span><b>${x.trades}</b></div><div><span>Kazanma</span><b>${x.win_rate == null ? '—' : '%' + nf(x.win_rate, 0)}</b></div></div>
    <div class="mflow">${['Gözcü', 'Bekçi', 'Alıcı', 'Çıkışçı'].map((n, i) => `<span>${n}</span>${i < 3 ? ic('i-chev') : ''}`).join('')}</div>
    <div class="agrid">${agents.map(([k, i, n, r, s, body]) => `<div class="agent a-${k}"><div class="ah2"><span class="aic">${ic(i)}</span><b>${n}</b></div>${s}<small class="arole">${r}</small>${body}</div>`).join('')}</div>
    <h2 class="mh">${ic('i-list')}Canlı akış<span class="hsum">her işlem sebebiyle</span></h2>
    <div class="card mfeed">${feed.length ? feed.slice(0, 30).map(([ts, k, tag, txt]) => `<div class="fr"><time>${masaClock(ts)}</time><em class="ft ${k}">${tag}</em><div>${txt}</div></div>`).join('') : `<div class="empty">${ic('i-list')}<div>Henüz kayıt yok</div></div>`}</div>`;
}
/** Masa kartı üst kısmı (Varlık özetiyle aynı dil): büyük değer + kâr/zarar rozeti + kalan risk çubuğu + küçük bilgiler */
function deskHero(lbl, val, sub, pnl, base, left, ml, chips) {
    const usd = (v) => '$' + nf(v, 2), pc = base > 0 ? pnl / base * 100 : 0, r = ml > 0 ? Math.max(0, Math.min(100, left / ml * 100)) : 0;
    return `<div class="dhero"><div><small>${lbl}</small><strong>${usd(val)}</strong><span>${sub}</span></div>
    <div class="adf ${cls(pnl)}">${pnl >= 0 ? '▲' : '▼'} %${nf(Math.abs(pc), 1)}<small>${pnl < 0 ? '−' : '+'}${usd(Math.abs(pnl))}</small></div></div>
    <div class="drisk"><div><span>${ic('i-shield')}Kalan risk</span><b>${usd(left)} / $${nf(ml, 0)}</b></div><div class="rb"><i class="${r > 60 ? 'ok' : r > 25 ? 'mid' : 'low'}" style="width:${r.toFixed(1)}%"></i></div></div>
    <div class="dchips">${chips.map(([k, v]) => `<span>${k}<b>${v}</b></span>`).join('')}</div>`;
}
function renderLevR() {
    const R = S?.levr;
    if (!R)
        return S?.live_enc && !pw ? `<div class="warn">${ic('i-lock')}<div>Gerçek futures masasını görmek için kilidi aç.</div></div>` : '';
    const usd = (v, d = 2) => '$' + nf(v, d), esc = (t) => String(t).replace(/</g, '&lt;');
    const pf = (v) => nf(v, v >= 100 ? 2 : v >= 1 ? 4 : Math.min(8, 2 - Math.floor(Math.log10(v || 1))));
    const lv = (orig || S?.settings)?.lev || {}, ml = +lv.max_loss || 10, left = Math.max(0, ml + Math.min(0, R.pnl));
    const pos = (R.positions || []).map((p) => {
        const g = p.margin ? p.pnl / p.margin * 100 : 0;
        return `<div class="fr"><time>${masaClock(p.ts)}</time><em class="ft ${p.side === 'UZUN' ? 'al' : 'zar'}">${p.side}</em><div><b>${p.sym}</b> ${p.lev || ''}x · teminat ${usd(p.margin)} · <span class="${cls(p.pnl)}">${p.pnl < 0 ? '−' : '+'}${usd(Math.abs(p.pnl))} (${spc(g, 0)})</span><small>giriş ${pf(p.entry)} · borsada stop ${pf(p.stop)} · hedef ${pf(p.tp)}</small></div>${deskBtn('lev', p.sym, 'Kapat')}</div>`;
    }).join('');
    const feed = (R.log || []).slice(0, 15).map(([ts, k, t]) => `<div class="fr"><time>${masaClock(ts)}</time><em class="ft ${k === 'buy' ? 'al' : k === 'exit' ? (/\+/.test(t) ? 'sat' : 'zar') : 'not'}">${k === 'buy' ? 'AÇ' : k === 'exit' ? 'KAPAT' : k === 'risk' ? 'ENGEL' : 'BİLGİ'}</em><div>${esc(t).replace(/^GERÇEK (AÇ|KAPAT|ENGEL) ?/, '')}</div></div>`).join('');
    const st = R.dead ? `<b class="dn">Durdu: ${esc(R.dead)}. Ayarlar → Futures → Yeniden başlat.</b>` : R.halt ? `<b class="dn">Bugün durduruldu: günlük zarar sınırı.</b>` : !R.on ? '<b>Kapalı.</b> Ayarlar → Futures\'tan açılır.' : '';
    return `<h2 class="mh">${ic('i-layers')}Futures<span class="hsum"><em class="rbadge">GERÇEK</em>OKX Global</span><button class="mset" type="button" data-sett="fut">${ic('i-gear')}Ayarlar</button></h2>
    <div class="card mmeme">
      ${deskHero('Masa', R.equity, `bütçe ${usd(R.funded)} · ${lv.real_lev ?? 2}x izole`, R.pnl, R.funded, left, ml, [['Açık', String((R.positions || []).length)], ['İşlem', String(R.closed ?? (R.trades || []).length)], ['Kazanma', R.win_rate == null ? '—' : '%' + R.win_rate], ...(R.harvest ? [['Fona alınan', usd(R.harvest)]] : [])])}
      <p class="mnote">${ic('i-lock')}Zarar durdur borsada kayıtlı. ${st}${R.err ? ` <b class="dn">Uyarı: ${esc(R.err).slice(0, 90)}</b>` : ''}</p>
      ${pos ? `<div class="mfeed">${pos}</div>` : ''}
      ${feed ? `<div class="mfeed">${feed}</div>` : `<div class="empty">${ic('i-eye')}<div>Henüz gerçek işlem yok; sinyal gelince açılır</div></div>`}
    </div>${levWatch()}`;
}
/** Futures: izlenen coinler ve sinyale uzaklık; deneme masasının son kararları */
function levWatch() {
    const L = S?.lev;
    if (!L)
        return '';
    const pf = (v) => nf(v, v >= 100 ? 2 : v >= 1 ? 4 : Math.min(8, 2 - Math.floor(Math.log10(v || 1))));
    const w = (L.watch || []).map((r) => {
        const d = Math.abs(r.dist || 0), up = r.side === 'UZUN', near = Math.max(4, Math.min(100, 100 - d * 12));
        return `<div class="wr ${up ? 'wu' : 'wd'}"><div><b>${r.sym}</b><em>${r.open ? 'AÇIK' : up ? '↑ UZUN' : '↓ KISA'}</em></div><div><span>${pf(r.px)}</span><small>${r.open ? 'pozisyon açık' : `sinyale %${nf(d, 1)}`}</small></div><i style="width:${(r.open ? 100 : near).toFixed(0)}%"></i></div>`;
    }).join('');
    const lg = (L.log || []).slice(0, 8).map(([ts, k, t]) => `<div class="fr"><time>${masaClock(ts)}</time><em class="ft ${k === 'buy' ? 'al' : k === 'exit' ? (/\+/.test(t) ? 'sat' : 'zar') : 'not'}">${k === 'buy' ? 'SİNYAL' : k === 'exit' ? 'ÇIKIŞ' : 'ENGEL'}</em><div>${String(t).replace(/^(AÇ|KAPAT|ENGEL) /, '').replace(/</g, '&lt;')}</div></div>`).join('');
    return `<h2 class="mh">${ic('i-eye')}İzlenen coinler<span class="hsum">sinyale uzaklık · saatlik</span></h2>
    <div class="card"><div class="wgrid">${w || `<div class="empty">${ic('i-refresh')}<div>Mumlar yükleniyor</div></div>`}</div>
    <p class="hint">Çubuk dolu = sinyale yakın. Fiyat son 20 saatin zirvesini aşınca UZUN, dibini kırınca KISA açılır (200 saatlik ortalamanın yönünde).</p></div>
    ${lg ? `<h2 class="mh">${ic('i-list')}Son kararlar<span class="hsum">${L.stats?.signals || 0} sinyal · ${L.stats?.entered || 0} giriş</span></h2><div class="card mfeed">${lg}</div>` : ''}`;
}
/** Futures/Memecoin pozisyonunu elle kapatma düğmesi: istek ayarlara yazılır, bot birkaç saniyede uygular */
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
    b.textContent = 'Gönderildi…';
    const req = { id: 'c' + Date.now().toString(36), ts: Date.now(), desk, act: desk === 'lev' ? 'close' : 'sell', sym };
    const ok = await cloudPatch(o => { o.desk_cmd = [...(o.desk_cmd || []).filter((r) => r.id !== req.id && Date.now() - (r.ts || 0) < 600000), req]; }, 'Masa komutu: ' + desk + ' ' + sym);
    toast(ok ? 'İstek gönderildi; bot birkaç saniyede piyasa fiyatından kapatır' : 'İstek gönderilemedi, tekrar dene');
    if (!ok) {
        delete DESK_BUSY[desk + ':' + sym];
        b.disabled = false;
        b.textContent = lbl;
    }
});
/** Memecoin: tarama özeti ve son kararlar (hangi token neden alındı / engellendi) */
function memeScan() {
    const M = S?.meme;
    if (!M)
        return '';
    const st = M.stats || {}, esc = (t) => String(t).replace(/</g, '&lt;');
    const lg = (M.log || []).slice(0, 10).map(([ts, k, t]) => `<div class="fr"><time>${masaClock(ts)}</time><em class="ft ${k === 'buy' ? 'al' : k === 'exit' ? (/\+/.test(t) ? 'sat' : 'zar') : 'not'}">${k === 'buy' ? 'SİNYAL' : k === 'exit' ? 'ÇIKIŞ' : 'ENGEL'}</em><div>${esc(t).replace(/^(AL|SAT|ENGEL) /, '')}</div></div>`).join('');
    return `<h2 class="mh">${ic('i-eye')}Tarama<span class="hsum">10 sn'de bir · Solana</span></h2>
    <div class="card"><div class="funnel">${[['i-eye', 'Taranan', st.scanned || 0, 'f1'], ['i-shield', 'Engellenen', st.blocked || 0, 'f2'], ['i-flag', 'Sinyal', st.entered || 0, 'f3']]
        .map(([i, n, v, c]) => `<div class="${c}">${ic(i)}<b>${nf(v, 0)}</b><span>${n}</span><i style="width:${Math.max(6, Math.min(100, Math.log10(v + 1) / Math.log10((st.scanned || 0) + 1 || 10) * 100)).toFixed(0)}%"></i></div>`).join('')}</div>
    ${lg ? `<div class="mfeed">${lg}</div>` : ''}</div>`;
}
function renderMemeR() {
    const R = S?.memer;
    if (!R)
        return S?.live_enc && !pw ? `<div class="warn">${ic('i-lock')}<div>Gerçek memecoin masasını görmek için kilidi aç.</div></div>` : '';
    const usd = (v, d = 2) => '$' + nf(v, d), esc = (t) => String(t).replace(/</g, '&lt;');
    const mm = (orig || S?.settings)?.meme || {}, ml = +mm.max_loss || 10, left = Math.max(0, ml + Math.min(0, R.pnl));
    const pos = (R.positions || []).map((p) => {
        const g = p.cost ? (p.val / p.cost - 1) * 100 : 0;
        return `<div class="fr"><time>${masaClock(p.ts)}</time><em class="ft al">${p.part ? 'KALAN' : 'AÇIK'}</em><div><b>${esc(p.sym)}</b> ${usd(p.val)} · <span class="${cls(g)}">${spc(g, 1)}</span><small>giriş ${usd(p.cost)} · ${esc(p.why)}</small></div>${deskBtn('meme', p.mint, 'Sat')}</div>`;
    }).join('');
    const feed = (R.log || []).slice(0, 15).map(([ts, k, t]) => `<div class="fr"><time>${masaClock(ts)}</time><em class="ft ${k === 'buy' ? 'al' : k === 'exit' ? (/\+/.test(t) ? 'sat' : 'zar') : 'not'}">${k === 'buy' ? 'AL' : k === 'exit' ? 'SAT' : k === 'risk' ? 'ENGEL' : 'BİLGİ'}</em><div>${esc(t).replace(/^GERÇEK (AL|SAT|ENGEL) ?/, '')}</div></div>`).join('');
    const st = R.dead ? `<b class="dn">Durdu: ${esc(R.dead)}. Ayarlar → Memecoin → Yeniden başlat.</b>` : !R.on ? '<b>Kapalı.</b> Ayarlar → Memecoin\'den açılır.' : '';
    const ad = R.addr ? `${R.addr.slice(0, 4)}…${R.addr.slice(-4)}` : '';
    return `<h2 class="mh">${ic('i-flask')}Memecoin<span class="hsum"><em class="rbadge">GERÇEK</em>${ad}</span><button class="mset" type="button" data-sett="meme">${ic('i-gear')}Ayarlar</button></h2>
    <div class="card mmeme">
      ${deskHero('Cüzdan', R.value, `${nf(R.sol, 4)} SOL · başlangıç ${usd(R.start || 0)}`, R.pnl, R.start, left, ml, [['Açık', String((R.positions || []).length)], ['Hedef', mm.tp_pct ? '%' + nf(+mm.tp_pct, 0) : '—'], ['Stop', mm.sl_pct ? '%' + nf(+mm.sl_pct, 0) : '—'], ['Fiyat etkisi', '≤%' + nf(+mm.max_slip || 2, 1)]])}
      <p class="mnote">${ic('i-lock')}Jupiter ile alım-satım · KASA'ya dokunulmaz. ${st}${R.err ? ` <b class="dn">Uyarı: ${esc(R.err).slice(0, 110)}</b>` : ''}</p>
      ${pos ? `<div class="mfeed">${pos}</div>` : ''}
      ${feed ? `<div class="mfeed">${feed}</div>` : `<div class="empty">${ic('i-eye')}<div>${R.sol > 0 ? 'Henüz gerçek işlem yok; şartı tutan token bekleniyor' : 'MEME cüzdanına SOL gönderilince başlar'}</div></div>`}
    </div>${memeScan()}`;
}
document.getElementById('masaBtn').onclick = () => showMasa(true);
document.getElementById('closeMasa').onclick = () => showMasa(false);
/* ---------- bulut: verilerin GitHub'la eşitlenme durumu (üst çubuktaki bulut simgesi) ----------
   Bot her değişiklikte (en geç 30 sn'de bir) kayıtları buluta yedekler; uygulama birkaç saniyede bir kontrol eder. */
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
    <p class="cldn">Bot her işlemde ve en geç 30 saniyede bir bütün kayıtları buluta (GitHub) yedekler. Uygulama buluta sürekli bakar, değişiklik olunca hemen yeniler; fiyatlar 2 saniyede bir borsadan canlı gelir. Ayarlar <b>Kaydet</b>'e basınca buluta yazılır.</p>
    <button class="btn" id="syncNow" style="width:100%;margin-bottom:10px">${ic('i-refresh')}Şimdi eşitle</button>`;
    q.hidden = false;
    document.getElementById('syncNow').onclick = async () => { q.hidden = true; await load(); toast(syncBad ? 'Eşitlenemedi, bağlantını kontrol et' : 'Eşitlendi'); };
}
/* Bildirimler buluttan gelir: bot gönderdiği her bildirimi gerçek hesabın şifreli kaydına yazar (her cihaz aynı listeyi görür).
   Uygulama açıkken ntfy canlı akışından gelenler de anında eklenir. Süre seçimi 1/6/12/24 saat. */
const NOTES = [];
let nES = null, nTopic = '', nHours = +(localStore('masal_nh') || 24);
const nSeen = () => +(localStore('masal_nseen') || 0);
const nClr = () => Math.max(+(S?.settings?.notify?.cleared || 0), +(localStore('masal_nclr') || 0)); // temizleme zamanı bulutta (ayarlarda)
const nKey = (m) => m.title + '|' + m.message;
/** Buluttaki listeyi (bot kaydı) canlı akıştan gelenlerle birleştirir; aynı bildirim iki kez görünmez. */
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
async function startNotes() {
    if (nES || !pw)
        return;
    try {
        const st = (await tfetch('ayarlar.json?t=' + Date.now()).then(r => r.json()));
        const tp = st?.notify?.topic;
        if (!st?.notify?.enabled || !tp)
            return;
        nTopic = typeof tp === 'object' ? await unseal(tp, pw) : String(tp);
    }
    catch (e) {
        return;
    }
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
        return `<div class="nrow${m.time > nSeen() ? ' new' : ''}"><span class="ni ${c}">${ic(i)}</span><div><b>${m.title}</b><p>${m.message.replace(/</g, '&lt;')}</p></div><time>${p(d.getHours())}:${p(d.getMinutes())}</time></div>`;
    }).join('')}</div>`
        : `<div class="empty">${ic('i-bell')}<div>Son ${nHours} saatte bildirim yok</div></div>`);
    q.hidden = false;
    document.querySelectorAll('#nRange button').forEach(b => b.onclick = () => { nHours = +b.dataset.h; localStore('masal_nh', String(nHours)); openNotes(); });
    document.getElementById('nClear').onclick = async () => {
        const top = Math.ceil(Date.now() / 1000);
        localStore('masal_nclr', String(top));
        NOTES.length = 0;
        openNotes();
        // temizleme bütün cihazlarda geçerli olsun: zaman ayarlara (buluta) yazılır
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
document.getElementById('qsh').onclick = e => { if (e.target === e.currentTarget)
    e.currentTarget.hidden = true; };
document.querySelectorAll('.adv .acch').forEach(b => b.onclick = () => b.parentElement.classList.toggle('open'));
/* ---------- "Bot şimdi ne yapıyor" ---------- */
let nowAll = false;
function nextBar() { const m = 15 * 6e4, t = Math.ceil((Date.now() + 1000) / m) * m, d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function renderNow(x) {
    const sec = document.getElementById('nowSec'), box = document.getElementById('now');
    if (!x.live) {
        sec.hidden = true;
        return;
    }
    sec.hidden = false;
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
        const show = nowAll ? items : items.slice(0, 5);
        // alım şartı var ama alım yapılamıyorsa gerçek sebep yazılır (elde olan coine kademe eklemeyi coin sınırı engellemez)
        const why = (it) => x.halted ? 'acil fren' : x.paused ? 'beklemede' : x.blocked_today ? 'bugünlük durdu' : !w.room ? 'bütçe dolu' : (!it.h && w.coins >= w.max_coins) ? 'coin sınırı dolu' : '';
        h += `<div class="wh">${ic('i-list')}Alıma en yakın coinler<button class="qm" data-q="yakin" aria-label="Açıklama">?</button></div><div class="list">`;
        h += show.map(it => {
            let chip;
            if (it.f)
                chip = `<span class="chip a">${ic('i-pause')}Düşüş filtresi</span>`;
            else if (it.gap <= 0) {
                const r = why(it);
                chip = r ? `<span class="chip a">${ic('i-layers')}Şartta · ${r}</span>` : `<span class="chip g">${ic('i-check')}Alım şartında</span>`;
            }
            else
                chip = `<span class="chip ${it.h ? 'b' : 'm'}">%${nf(it.gap, it.gap < 10 ? 1 : 0)} düşerse</span>`;
            const near = it.f || it.gap <= 0 ? '' : `<div class="near"><i style="width:${Math.max(4, Math.min(100, 100 - it.gap * 20)).toFixed(0)}%"></i></div>`;
            return `<div class="row wrow">${cico(it.i)}<div class="mid"><b>${sym(it.i)}${pq(it.i)}${it.h ? `<i class="kd">${it.h} kademe</i>` : ''}</b>
        <div class="pv"><span><em>Şimdi</em>${px(it.cur)}</span><span><em>${it.h ? `${it.h + 1}. alım` : 'Alım'}</em>${px(it.t)}</span></div></div><div class="end">${chip}${near}</div></div>`;
        }).join('');
        h += '</div>';
        if (items.length > 5)
            h += `<button class="more" id="nowMore">${nowAll ? 'Daha az göster' : `Tümünü göster (${items.length} coin)`}</button>`;
    }
    h += c?.instant ? `<div class="nf">${ic('i-clock')}Anlık alım açık: fiyat alım seviyesine değdiği an alır (5 sn'de bir kontrol)</div>`
        : `<div class="nf">${ic('i-clock')}Sonraki karar ${nextBar()}'te (15 dakikalık mum kapanışı) · fiyatlar 5 sn'de bir kontrol edilir</div>`;
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
    document.getElementById('updated').innerHTML = live + bot;
}
function volTxt(inst) { const v = LP[inst]?.vol; return v == null ? '' : v >= 1e9 ? nf(v / 1e9, 1) + '\u00a0Mr\u00a0TL' : v >= 1e6 ? nf(v / 1e6, 1) + '\u00a0Mn\u00a0TL' : nf(v / 1e3, 0) + '\u00a0B\u00a0TL'; }
function livePrice(inst, fallback) { return LP[inst]?.last ?? fallback; }
// Elde tutulan coinin değeri: şimdi satılsa alınacak fiyat (alıcıların en iyi teklifi). Az işlem gören TL paritelerinde son işlem fiyatı yanıltır.
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
      <div class="uh">${x.positions.length}/${w.max_coins} coin · ${x.trades} kapanan işlem · başlangıç ${tl(x.start_cash, 0)}</div></div>`;
    }
    else
        h += `<div class="use">${live ? '' : `<div class="uh" style="color:var(--text);font-size:12.5px;line-height:1.45">${x.desc}</div>`}<div class="uh">${x.trades} kapanan işlem · başlangıç ${tl(x.start_cash, 0)}${live ? '' : ' (sanal para)'}</div></div>`;
    setH(hero, h);
    renderAssets(x, eq);
    renderXfer();
}
/** Varlık özeti: büyük toplam + yatırdığına göre fark, renkli dağılım çubuğu, borsa eşleşmesi ve hedef. */
function renderAssets(x, eq) {
    const box = document.getElementById('assets');
    if (!box)
        return;
    const kasa = +(x.kasa || S?.settings?.kasa || 0);
    if (sel !== 'live' || !kasa) {
        box.hidden = true;
        return;
    }
    const reserve = Math.max(0, kasa - x.start_cash), now = eq + reserve, net = now - kasa, inCoins = Math.max(0, eq - x.cash), cash = Math.max(0, x.cash);
    const pc = kasa ? net / kasa * 100 : 0, tot = Math.max(1, cash + inCoins + reserve);
    const parts = [['c', 'Botta nakit', cash, 'i-wallet'], ['k', 'Coinlerde', inCoins, 'i-coins'], ['r', 'Kasada yedek', reserve, 'i-vault']];
    const bar = parts.filter(p => p[2] > 0).map(p => `<i class="s${p[0]}" style="width:${(p[2] / tot * 100).toFixed(2)}%"></i>`).join('');
    const leg = parts.map(p => `<div class="vl-${p[0]}"><em></em><span>${ic(p[3])}${p[1]}</span><b>${tl(p[2], 0)}</b><small>payı %${nf(p[2] / tot * 100, 0)}</small></div>`).join('');
    const T = S?.settings?.target;
    let tgt = '';
    if (T?.on && T.amount > 0) {
        const total = T.mode === 'total', cur = total ? now : now - kasa, goal = +T.amount, r = Math.max(0, Math.min(100, cur / goal * 100));
        tgt = `<div class="atg"><div class="tl">${ic('i-target')}<span>${total ? 'Hedef (kasa dahil)' : 'Kâr hedefi'}</span><b>%${nf(r, 0)}</b></div>
      <div class="tb"><i style="width:${r.toFixed(1)}%"></i></div><div class="th"><span>${tl(cur, 0)}</span><span>${r >= 100 ? 'Hedefe ulaşıldı' : tl(Math.max(0, goal - cur), 0) + ' kaldı'}</span><span>${tl(goal, 0)}</span></div></div>`;
    }
    box.hidden = false;
    const changed = setH(box, `<div class="ah">${ic('i-wallet')}<b>Varlık özeti</b><span>bütün paran</span></div>
    <div class="abig"><div><small>Şu an hepsi</small><strong>${tl(now, 0)}</strong></div>
      <div class="adf ${cls(net)}">${net >= 0 ? '▲' : '▼'} %${nf(Math.abs(pc), 1)}<small>${(net > 0 ? "+" : net < 0 ? "−" : "") + nf(Math.abs(net), 0)} TL</small></div></div>
    <div class="ainv">Yatırdığın <b>${tl(kasa, 0)}</b></div>
    <div class="abar">${bar}</div><div class="aleg">${leg}</div>${realLine(x, now)}${tgt}`);
    const sb = document.getElementById('syncBtn');
    if (changed && sb)
        sb.onclick = () => syncReal();
}
/** Borsadaki gerçek toplam: uygulamadaki kayıtla tutmuyorsa açıkça gösterilir (bot fazlasını kullanmaz). */
function realLine(x, now) {
    const o = S?.okx || {}, real = +(o.total_tl || x.real_total || 0);
    if (!real)
        return '';
    const gap = now - real, f = +(o.fund_tl || 0), bad = Math.abs(gap) > Math.max(50, real * .01);
    const warn = bad ? `<div class="xw dn">Uygulamadaki hesap borsadan ${tl(Math.abs(gap), 0)} ${gap > 0 ? 'fazla' : 'az'}. ${gap > 0 ? 'Kasa/bütçe borsadakinden yüksek girilmiş olabilir; bot olmayan parayı kullanmaz.' : 'Borsaya eklenen para henüz bota verilmemiş.'}</div>` : '';
    return `<div class="areal${bad ? ' bad' : ''}">${ic('i-bank')}<div><span>OKX TR'de gerçek</span><b>${tl(real, 0)}</b>${f >= 1 ? `<small>fon hesabında ${tl(f, 0)}</small>` : ''}</div>
    <em>${bad ? 'Tutmuyor' : ic('i-check') + 'Eşleşik'}</em><button class="btn xsync" id="syncBtn" aria-label="Borsayla eşleştir">${ic('i-refresh')}Eşleştir</button></div>${warn}`;
}
/** "Borsayla eşleştir": bütçe ve kasa borsadaki gerçek paraya göre ayarlanır.
 *  Bütçe öyle seçilir ki bottaki nakit = alım-satım hesabındaki gerçek boş para olur (kâr/zarar geçmişi bozulmaz);
 *  kasa = bütçe + fon hesabındaki nakit (yedek). */
async function syncReal(retry = true) {
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
    try {
        const cur = await tfetch(API + '?t=' + Date.now(), { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, cache: 'no-store' }).then(r => { if (!r.ok)
            throw r.status; return r.json(); });
        const data = JSON.parse(decodeURIComponent(escape(atob(cur.content.replace(/\n/g, '')))));
        data.budget = b;
        data.kasa = k;
        const body = { message: 'Borsayla eşleştir: bütçe ' + b + ' · kasa ' + k, content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2) + '\n'))), sha: cur.sha, branch: 'main' };
        const r = await tfetch(API, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (r.status === 409 && retry)
            return syncReal(false);
        if (!r.ok)
            throw r.status;
        sha = (await r.json()).content.sha;
        for (const s0 of [orig, draft])
            if (s0) {
                s0.budget = b;
                s0.kasa = k;
            }
        toast(`Eşleştirildi: botta ${tl(b, 0)}, kasa ${tl(k, 0)}. Bot birkaç saniyede uygular.`);
    }
    catch (e) {
        toast('Eşleştirilemedi (' + e + '), tekrar dene');
    }
    if (btn)
        btn.disabled = false;
}
/* ---------- Para aktarımı: TR ↔ Global ↔ KASA (USDT, Arbitrum One). İstek bulut ayar dosyasına yazılır, bot gönderir. ---------- */
/* Uçlar: her kasanın simgesi, rengi ve kısa adı (kartlarda ve pencerede aynı standart) */
const XEND = { tr: ['OKX TR', 'i-bank', 'e1'], g: ['OKX Global', 'i-globe', 'e2'], k: ['KASA', 'i-vault', 'e3'], m: ['MEME', 'i-flask', 'e4'] };
const XDIR = { tr2g: ['tr', 'g', 'OKX TR uygulamasından'], g2tr: ['g', 'tr', 'TL\'ye çevrilir'], tr2k: ['tr', 'k', 'OKX TR uygulamasından'], g2k: ['g', 'k', 'Soğuk cüzdana'], g2m: ['g', 'm', 'SOL alınıp gönderilir'], m2g: ['m', 'g', 'SOL satılıp USDT olur'], k2g: ['k', 'g', 'Trust Wallet\'tan'], k2tr: ['k', 'tr', 'Trust Wallet\'tan'] };
const xName = (d) => `${XEND[XDIR[d][0]][0]} → ${XEND[XDIR[d][1]][0]}`;
const XST = { new: ['Sırada', 'i-clock', 'w'], sent: ['Yolda', 'i-out', 'w'], arriving: ['Ulaşıyor', 'i-in', 'w'], done: ['Tamam', 'i-check', 'ok'], failed: ['Olmadı', 'i-stop', 'bad'] };
function xEnd(k) { const e = XEND[k]; return `<span class="xe ${e[2]}">${ic(e[1])}</span>`; }
/** innerHTML sadece içerik değiştiyse yazılır (2 sn'lik yenilemede düğmeler sıfırlanmasın, dokunuş kaybolmasın) */
function setH(el, h) { if (el._h === h)
    return false; el.innerHTML = h; el._h = h; return true; }
function renderXfer() {
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
        return `<div class="xr"><span class="xs ${st[2]}">${ic(st[1])}</span><div class="xm"><b>${XDIR[j.dir] ? xName(j.dir) : j.dir}<i>${nf(j.amt, 2)} $</i></b>
      <small>${masaClock(j.ts)} · ${st[0]}${j.stage !== 'done' && j.msg && j.msg !== 'sırada' ? ' · ' + j.msg : ''}</small></div>${j.stage === 'new' ? `<button class="xc" data-xc="${j.id}">İptal</button>` : ''}</div>`;
    }).join('');
    if (!setH(box, `<div class="ah">${ic('i-wallet')}<b>Kasalar ve aktarım</b><span>dakikada bir</span></div>
    ${xKasalar(X)}
    <div class="xt">${Object.keys(XDIR).map(k => { const [f, t, sub] = XDIR[k]; return `<button data-x="${k}"><span class="xrt">${xEnd(f)}${ic('i-chev')}${xEnd(t)}</span><b>${xName(k)}</b><small>${sub}</small></button>`; }).join('')}</div>
    <div class="xb"><span>TR'de boşta <b>${X?.free_tl != null ? tl(Math.max(0, X.free_tl), 0) : '—'}</b></span><span>Bugün gönderilen <b>$${nf(X?.day_sum || 0, 0)} / ${nf(X?.daily_max || 1000, 0)}</b></span></div>
    ${jobs ? `<div class="xj">${jobs}</div>` : ''}
    <div class="xdh">${ic('i-coins')}<b>Küçük bakiyeleri çevir</b><span>tek dokunuş</span></div>
    <div class="xt x3">${DUST.map(([k, f, to]) => {
        const l = (X?.dust || {})[k] || [], u = l.reduce((a, x) => a + (+x.usd || 0), 0);
        return `<button data-dust="${k}"><span class="xrt">${xEnd(f)}${ic('i-chev')}<span class="xe e5">${to}</span></span><b>${XEND[f][0]}</b><small>${l.length ? `${l.length} coin · $${nf(u, 2)}` : 'artık yok'}</small></button>`;
    }).join('')}</div>
    ${(X?.log || []).length ? `<div class="xlog">${X.log.slice(0, 3).map(([t, m]) => `<div><time>${masaClock(t)}</time><span>${String(m).replace(/</g, '&lt;')}</span></div>`).join('')}</div>` : ''}`))
        return;
    box.querySelectorAll('[data-x]').forEach(b => b.onclick = () => openXfer(b.dataset.x));
    box.querySelectorAll('[data-xc]').forEach(b => b.onclick = () => cancelXfer(b.dataset.xc, b));
    box.querySelectorAll('[data-dust]').forEach(b => b.onclick = () => openDust(b.dataset.dust));
}
const DUST = [['tr', 'tr', 'TL'], ['g', 'g', 'USDT'], ['m', 'm', 'SOL']], DUST_MAX = 100;
/** Küçük bakiyeler: tek tek ya da hepsi seçilir; tek seferde en fazla DUST_MAX coin çevrilir (fazlası uyarılır). */
function openDust(k) {
    const X = S?.xfer || {}, d = DUST.find(x => x[0] === k), list = (X.dust || {})[k] || [], q = document.getElementById('qsh');
    q.dataset.n = '';
    qHead(XEND[d[1]][1], 'Vazgeç');
    document.getElementById('qTitle').textContent = `${XEND[d[1]][0]} · küçük bakiyeler`;
    const pick = new Set(list.map(x => x.ccy));
    let to = k === 'tr' ? (localStore('masal_dust_to') || 'TRY') : k === 'g' ? 'USDT' : 'SOL';
    const TOS = { tr: [['TRY', 'TL'], ['USDT', 'USDT']], g: [['USDT', 'USDT'], ['USDC', 'USDC']], m: [['SOL', 'SOL']] };
    const usd = (v) => v > 0 && v < 0.01 ? '<$0,01' : '$' + nf(v, 2);
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
                    toast('İstek gönderilemedi, tekrar dene');
                }
            };
    };
    draw();
    q.hidden = false;
}
let xfSrc = 'bos', USDTTRY = 0, xfId = '';
/** Üç kasa yan yana: OKX TR, OKX Global, KASA (soğuk cüzdan); dolar ve TL karşılığı, dakikada bir borsadan/zincirden. */
function xKasalar(X) {
    const r = +(X?.usdtry || USDTTRY || 0), o = S?.okx || {};
    const trUsd = X?.tr_total != null ? +X.tr_total : (o.total_tl && r ? o.total_tl / r : null), gUsd = X?.g_val != null ? +X.g_val : null, kUsd = X?.kasa?.usd != null ? +X.kasa.usd : null;
    const MR = S?.memer, mUsd = MR?.addr ? +MR.value || 0 : null;
    const all = [trUsd, gUsd, kUsd].every(v => v != null) ? trUsd + gUsd + kUsd + (mUsd || 0) : null;
    const cell = (k, u) => `<div>${xEnd(k)}<span>${XEND[k][0]}</span><b>${u == null ? '—' : '$' + nf(u, 2)}</b><small>${u != null && r ? tl(u * r, 0) : ''}</small></div>`;
    return `<div class="xk${mUsd != null ? ' x4' : ''}">${cell('tr', trUsd)}${cell('g', gUsd)}${cell('k', kUsd)}${mUsd != null ? cell('m', mUsd) : ''}</div>
    ${all != null ? `<div class="xb"><span>Hepsi birlikte <b>$${nf(all, 2)}</b>${r ? ` · <b>${tl(all * r, 0)}</b>` : ''}</span>${X?.kasa ? `<span>KASA'da komisyon için <b>${nf(X.kasa.eth || 0, 4)} ETH</b></span>` : ''}</div>` : ''}`;
}
/** KASA'nın anahtarı sistemde yok: gönderimi Trust Wallet'ta sen onaylarsın. Bu sayfa tutarı ve adresi hazırlar. */
const KDEST = { k2g: ['OKX Global', '0x74877903737257289dc07e7baf1f4b078c2a82a3'], k2tr: ['OKX TR', '0x1e194face9b26c78f75d854d741cf6547730b705'] };
function openKasaSend(dir) {
    const X = S?.xfer || {}, [nm, addr] = KDEST[dir], q = document.getElementById('qsh'), have = +(X.kasa?.usd || 0), eth = +(X.kasa?.eth || 0), sh = addr.slice(0, 6) + '…' + addr.slice(-4);
    q.dataset.n = '';
    qHead('i-vault', 'Kapat');
    document.getElementById('qTitle').textContent = `KASA → ${nm}`;
    const draw = () => {
        const a = document.getElementById('kAmt')?.value || (have ? String(Math.floor(have * 100) / 100) : '');
        const link = `trust://send?asset=c10042221_t0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9&address=${addr}${+a ? `&amount=${+a}` : ''}`;
        document.getElementById('qText').innerHTML = `<div class="xfs">
      <div class="xroute"><div>${xEnd('k')}<b>KASA</b><small>$${nf(have, 2)}</small></div><span class="xar">${ic('i-chev')}</span><div>${xEnd(dir === 'k2g' ? 'g' : 'tr')}<b>${nm}</b><small>Arbitrum</small></div></div>
      <p class="xnote">KASA'nın anahtarı güvenlik için sistemde yok; gönderimi <b>Trust Wallet'ta sen onaylarsın</b>. Tutar ve adres hazır gelir.</p>
      <div class="xlab">Tutar</div><div class="xamt"><input id="kAmt" type="number" inputmode="decimal" min="1" step="1" value="${a}"><span>USDT</span></div>
      <div class="xinfo">
        <div>${ic('i-lock')}<span>Adres</span><b>${sh} <button class="xcp" type="button" data-cp="${addr}">${ic('i-copy')}Kopyala</button></b></div>
        <div>${ic('i-globe')}<span>Ağ</span><b>Arbitrum One · USDT</b></div>
        <div>${ic('i-shield')}<span>Ücret</span><b>~0,01 $ ETH${eth < 0.00005 ? ' · <span class="dn">ETH yok!</span>' : ''}</b></div>
        <div>${ic('i-info')}<span>Önce</span><b>Trust Wallet'ta üstte KASA seçili olsun</b></div>
      </div>
      <a class="btn primary xgo" href="${link}" target="_blank" rel="noopener">${ic('i-out')}Trust Wallet'ta gönderimi aç</a>
      <p class="hint">Açılmazsa: Trust Wallet → KASA → USDT (Arbitrum) → Gönder → adres defterinden ${nm} ARB. Ulaşınca Kasalar'da görünür.</p></div>`;
        const inp = document.getElementById('kAmt'), base = link.replace(/&amount=[^&]*/, '');
        inp.oninput = () => { const v = +inp.value; document.querySelector('#qText a.xgo').href = base + (v > 0 ? `&amount=${v}` : ''); };
        document.querySelectorAll('[data-cp]').forEach(b => b.onclick = async () => { try {
            await navigator.clipboard.writeText(b.dataset.cp);
            toast('Adres kopyalandı');
        }
        catch (e) {
            toast(b.dataset.cp);
        } });
    };
    document.getElementById('qText').innerHTML = '';
    draw();
    q.hidden = false;
}
function openXfer(dir) {
    if (dir.startsWith('k')) {
        openKasaSend(dir);
        return;
    }
    if (dir.startsWith('tr')) {
        const q = document.getElementById('qsh');
        q.dataset.n = '';
        qHead('i-bank', 'Anladım');
        document.getElementById('qTitle').textContent = xName(dir);
        document.getElementById('qText').innerHTML = `<div class="xfs"><p class="xnote">OKX TR, Türkiye kuralı gereği API'den (bottan) yapılan para çıkışlarını kabul etmiyor (hata 58380). Bu yönü <b>OKX TR uygulamasından</b> yap; ücretsiz ve anında:</p>
      <div class="xinfo"><div>${ic('i-bank')}<span>1</span><b>OKX TR → Varlıklar → Çek → USDT</b></div><div>${ic(dir === 'tr2g' ? 'i-globe' : 'i-vault')}<span>2</span><b>${dir === 'tr2g' ? 'OKX kullanıcıları → OKX Global hesabın' : 'Adres defterinden KASA (Arbitrum)'}</b></div><div>${ic('i-check')}<span>3</span><b>Gelince bot kasalarda gösterir</b></div></div>
      <a class="btn primary xgo" href="https://tr.okx.com/balance/withdrawal" target="_blank" rel="noopener">${ic('i-out')}OKX TR'yi aç</a></div>`;
        q.hidden = false;
        return;
    }
    const X = S?.xfer || {}, [f, t] = XDIR[dir], q = document.getElementById('qsh'), r = +(X.usdtry || USDTTRY || 0);
    q.dataset.n = '';
    qHead(XEND[t][1], 'Vazgeç');
    document.getElementById('qTitle').textContent = 'Para gönder';
    xfSrc = 'bos';
    xfId = 'x' + Date.now().toString(36);
    const bal = (k) => { const o = S?.okx || {}; const u = k === 'tr' ? (X.tr_total ?? (o.total_tl && r ? o.total_tl / r : null)) : k === 'g' ? X.g_val : k === 'm' ? S?.memer?.value : X.kasa?.usd; return u == null ? '—' : '$' + nf(u, 2); };
    const mm = f === 'm' || t === 'm', fee = mm ? '~0,02 $ ağ ücreti + alım-satım ücreti' : t === 'k' ? '~0,003 $ ağ ücreti' : 'Ücretsiz (yedek yol ~0,003 $)', time_ = mm || t === 'k' ? 'Birkaç dakika' : 'Birkaç saniye – birkaç dakika';
    const draw = () => {
        const tx = document.getElementById('qText'), cur = document.getElementById('xfAmt')?.value || '';
        tx.innerHTML = `<div class="xfs">
      <div class="xroute"><div>${xEnd(f)}<b>${XEND[f][0]}</b><small>${bal(f)}</small></div><span class="xar">${ic('i-chev')}</span><div>${xEnd(t)}<b>${XEND[t][0]}</b><small>${bal(t)}</small></div></div>
      <div class="xlab">Tutar</div>
      <div class="xamt"><input id="xfAmt" type="number" inputmode="decimal" min="1" step="1" placeholder="0" value="${cur}"><span>USDT</span></div>
      <div class="xeq" id="xfEq">${r && +cur ? '≈ ' + tl(+cur * r, 0) : '&nbsp;'}</div>
      <div class="xq">${[5, 10, 25, 50, 100].map(v => `<button data-q="${v}">${v} $</button>`).join('')}</div>
      <div class="xinfo">
        <div>${ic('i-shield')}<span>Ücret</span><b>${fee}</b></div>
        <div>${ic('i-clock')}<span>Süre</span><b>${time_}</b></div>
        <div>${ic('i-flag')}<span>Günlük sınır</span><b>$${nf(X.day_sum || 0, 0)} / ${nf(X.daily_max || 1000, 0)}</b></div>
        ${dir === 'g2tr' ? `<div>${ic('i-info')}<span>Varınca</span><b>TL'ye çevrilip Nakit'e konur</b></div>` : ''}
        ${t === 'k' ? `<div>${ic('i-lock')}<span>Adres</span><b>0x0113…7db7 (sabit)</b></div>` : ''}
        ${dir === 'g2m' ? `<div>${ic('i-info')}<span>Nasıl</span><b>Global fonundaki USDT ile SOL alınır, MEME'ye gider</b></div><div>${ic('i-lock')}<span>Adres</span><b>7Ymj…EKwN (sabit)</b></div>` : ''}
        ${dir === 'm2g' ? `<div>${ic('i-info')}<span>Nasıl</span><b>SOL Global'e gider, satılıp USDT olur</b></div>` : ''}
      </div>
      <button class="btn primary xgo" id="xfGo">${ic('i-out')}Gönder</button></div>`;
        tx.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { document.getElementById('xfAmt').value = b.dataset.q; upd(); });
        const inp = document.getElementById('xfAmt'), upd = () => { document.getElementById('xfEq').innerHTML = r && +inp.value ? '≈ ' + tl(+inp.value * r, 0) : '&nbsp;'; };
        inp.oninput = upd;
        document.getElementById('xfGo').onclick = () => sendXfer(dir);
    };
    document.getElementById('qText').innerHTML = '';
    draw();
    q.hidden = false;
}
async function cancelXfer(id, btn, retry = true) {
    if (!token) {
        toast('Önce Ayarlar\'dan GitHub bağlantısını kur');
        return;
    }
    if (btn) {
        btn.disabled = true;
        btn.textContent = '…';
    }
    try {
        const cur = await tfetch(API + '?t=' + Date.now(), { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, cache: 'no-store' }).then(r => { if (!r.ok)
            throw r.status; return r.json(); });
        const data = JSON.parse(decodeURIComponent(escape(atob(cur.content.replace(/\n/g, '')))));
        data.xfer_cancel = [...(data.xfer_cancel || []).slice(-20), id];
        const body = { message: 'Aktarım iptali: ' + id, content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2) + '\n'))), sha: cur.sha, branch: 'main' };
        const r = await tfetch(API, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (r.status === 409 && retry)
            return cancelXfer(id, btn, false);
        if (!r.ok)
            throw r.status;
        sha = (await r.json()).content.sha;
        for (const o of [orig, draft])
            if (o)
                o.xfer_cancel = data.xfer_cancel;
        toast('İptal isteği gönderildi; para alım-satım hesabına geri konacak.');
    }
    catch (e) {
        toast('İptal gönderilemedi (' + e + ')');
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'İptal';
        }
    }
}
async function sendXfer(dir, retry = true) {
    fastWatch();
    const amt = Math.round((+document.getElementById('xfAmt')?.value || 0) * 100) / 100;
    if (!(amt >= 1)) {
        toast('Tutarı yaz (en az 1 USDT)');
        return;
    }
    {
        const X = S?.xfer || {}, freeUsd = X.free_tl != null && USDTTRY ? Math.max(0, X.free_tl) / USDTTRY : null;
        const MR = S?.memer;
        if (dir === 'm2g' && MR && amt > Math.max(0, (MR.sol - 0.02) * (MR.solpx || 0))) {
            toast(`MEME'de boşta ~$${nf(Math.max(0, (MR.sol - 0.02) * (MR.solpx || 0)), 2)} SOL var (tokenler hariç)`);
            return;
        }
        if (dir === 'g2m' && !MR?.addr) {
            toast('MEME cüzdanı bağlı değil');
            return;
        }
        if (dir.startsWith('g') && X.g_val != null && amt > +X.g_val) {
            toast(`OKX Global'de ~$${nf(+X.g_val, 2)} var; daha fazlası gönderilemez`);
            return;
        }
        if (dir.startsWith('tr') && xfSrc === 'bot' && USDTTRY && amt * USDTTRY * 1.01 > +(S?.strategies?.live?.cash || 0)) {
            toast('Botta bu kadar boş nakit yok; önce bazı coinler satılmalı');
            return;
        }
        if (dir.startsWith('tr') && xfSrc === 'bos' && freeUsd != null && freeUsd < amt) {
            toast(`TR'de boşta sadece ~${nf(freeUsd, 2)} USDT var. "Bottan al"ı seç ya da önce bankadan TL yatır.`);
            return;
        }
    }
    if (!token) {
        toast('Önce Ayarlar\'dan GitHub bağlantısını kur');
        return;
    }
    const btn = document.getElementById('xfGo');
    if (btn) {
        btn.disabled = true;
        btn.lastChild.textContent = 'Gönderiliyor…';
    }
    try {
        const cur = await tfetch(API + '?t=' + Date.now(), { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, cache: 'no-store' }).then(r => { if (!r.ok)
            throw r.status; return r.json(); });
        const data = JSON.parse(decodeURIComponent(escape(atob(cur.content.replace(/\n/g, '')))));
        const src = dir.startsWith('tr') ? xfSrc : 'bos';
        const dup = (data.xfer_req || []).some((r) => r.id === xfId); // önceki deneme aslında kaydedildiyse ikinci kez eklenmez
        if (!dup) {
            data.xfer_req = [...(data.xfer_req || []).filter((r) => Date.now() - (r.ts || 0) < 3600000), { id: xfId, ts: Date.now(), dir, amt, src }];
            if (src === 'bot') {
                const tlv = Math.ceil(amt * (USDTTRY || 0) * 1.01);
                if (!tlv)
                    throw 'kur yok';
                data.budget = Math.max(0, (+data.budget || 0) - tlv);
                data.kasa = Math.max(0, (+data.kasa || 0) - tlv);
            }
        }
        const body = { message: 'Uygulamadan aktarım: ' + dir + ' ' + amt + ' USDT', content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2) + '\n'))), sha: cur.sha, branch: 'main' };
        const r = await tfetch(API, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (r.status === 409 && retry)
            return sendXfer(dir, false);
        if (!r.ok)
            throw r.status;
        sha = (await r.json()).content.sha;
        for (const o of [orig, draft])
            if (o) {
                o.xfer_req = data.xfer_req;
                if (src === 'bot') {
                    o.budget = data.budget;
                    o.kasa = data.kasa;
                }
            }
        document.getElementById('qsh').hidden = true;
        toast(`${xName(dir)}: ${nf(amt, 2)} USDT isteği gönderildi; bot birkaç saniye içinde başlar.`);
    }
    catch (e) {
        toast('İstek gönderilemedi (' + e + '), tekrar dene');
        if (btn) {
            btn.disabled = false;
            btn.lastChild.textContent = 'Gönder';
        }
    }
}
/* ---------- Coin ayrıntısı: dokununca canlı fiyat, grafik ve parite seçimi (OKX TR herkese açık verisi) ---------- */
let CD = null;
const CQ = ['TRY', 'USDT', 'USDC', 'EUR'], CBAR = [['15m', '15 dk'], ['1H', '1 sa'], ['4H', '4 sa'], ['1D', '1 gün']];
function openCoin(inst) {
    if (CD)
        clearTimeout(CD.t);
    const [base, q0] = String(inst).split('-');
    CD = { base, q: q0 || 'USDT', bar: '1H', t: null };
    const q = document.getElementById('qsh');
    q.dataset.n = '';
    qHead('i-chart', 'Kapat');
    document.getElementById('qTitle').textContent = base;
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
    const { base, q, bar } = CD, inst = `${base}-${q}`, box = document.getElementById('cdv');
    if (!box)
        return;
    try {
        const [tk, cd] = await Promise.all([
            tfetch(`https://tr.okx.com/api/v5/market/ticker?instId=${inst}`, { cache: 'no-store' }, 6000).then(r => r.json()),
            live ? Promise.resolve(null) : tfetch(`https://tr.okx.com/api/v5/market/candles?instId=${inst}&bar=${bar}&limit=120`, { cache: 'no-store' }, 6000).then(r => r.json())
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
        if (!t) {
            box.innerHTML = `<div class="qpair">${CQ.map(x => `<button data-cq="${x}" class="${x === q ? 'on' : ''}" ${has.has(x) ? '' : 'disabled'}>${x}</button>`).join('')}</div><div class="empty">${ic('i-info')}<div>${inst} paritesi OKX TR'de yok</div></div>`;
            bindCoin();
            return;
        }
        const last = +t.last, open = +t.sodUtc8 || +t.open24h, ch = open ? (last / open - 1) * 100 : 0, dec = last >= 100 ? 2 : last >= 1 ? 4 : Math.min(8, 2 - Math.floor(Math.log10(last || 1)));
        const L = S?.strategies?.live, pos = (L?.positions || []).find((p) => p.inst.split('-')[0] === base), coin = (L?.coins || []).find((c) => c.inst.split('-')[0] === base);
        box.innerHTML = `<div class="qpair">${CQ.map(x => `<button data-cq="${x}" class="${x === q ? 'on' : ''}" ${has.has(x) ? '' : 'disabled'}>${x}</button>`).join('')}</div>
      <div class="cdp"><b>${nf(last, dec)} <small>${q}</small></b><span class="${cls(ch)}">${ch >= 0 ? '+' : ''}${nf(ch, 2)}% · 24 sa</span></div>
      <div class="cdk"><div><span>En yüksek</span><b>${nf(+t.high24h, dec)}</b></div><div><span>En düşük</span><b>${nf(+t.low24h, dec)}</b></div><div><span>Hacim · ${q}</span><b>${+t.volCcy24h >= 1e6 ? nf(+t.volCcy24h / 1e6, 1) + ' Mn' : +t.volCcy24h >= 1e3 ? nf(+t.volCcy24h / 1e3, 1) + ' B' : nf(+t.volCcy24h, 0)}</b></div></div>
      ${coinSvg(rows)}
      <div class="qpair sm">${CBAR.map(([b, l]) => `<button data-cb="${b}" class="${b === bar ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${pos ? `<div class="cdb"><div>${ic('i-coins')}<span>Botta</span><b>${pos.lots || 1} kademe · ${tl(pos.cost || 0, 0)} · ${sgn(pos.pnl || 0)} TL</b></div><div>${ic('i-pnl')}<span>Ortalama alış</span><b>${tl(pos.avg || 0, dec)}</b></div></div>` : ''}
      ${coin ? `<div class="cdb"><div>${ic('i-chart')}<span>Bu coinden toplam</span><b class="${cls(coin.realized)}">${sgn(coin.realized)} TL · ${coin.sells} satış</b></div></div>` : ''}
      <div class="cdn">Canlı · 5 sn'de bir · OKX TR</div>`;
        bindCoin();
    }
    catch (e) {
        if (!live)
            box.innerHTML = `<div class="empty">${ic('i-info')}<div>Veri alınamadı, tekrar dene</div></div>`;
    }
}
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
function coinSvg(rows) {
    if (rows.length < 2)
        return '';
    // Mum grafiği: yeşil = kapanış açılıştan yüksek, kırmızı = düşük; altta hacim çubukları; sağda fiyat ölçeği
    const W = 340, H = 170, VH = 26, PW = W - 44, n = rows.length, hi = Math.max(...rows.map(r => r[2])), lo = Math.min(...rows.map(r => r[3])), sp = (hi - lo) || 1, vmax = Math.max(...rows.map(r => r[5])) || 1;
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
    return `<svg class="cdc" viewBox="0 0 ${W} ${H}">${g}${c}<line x1="0" x2="${PW}" y1="${ly.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${lc}" stroke-dasharray="3 3" stroke-width=".8"/><rect x="${PW + 1}" y="${(ly - 7).toFixed(1)}" width="43" height="14" rx="3" fill="${lc}"/><text x="${PW + 4}" y="${(ly + 3.5).toFixed(1)}" class="gp">${nf(last, dec)}</text></svg>`;
}
document.addEventListener('click', e => {
    const el = e.target.closest('.row');
    if (!el || Date.now() - swJust < 400 || e.target.closest('button,a,.swb'))
        return;
    if (el.closest('.swr.open'))
        return;
    const c = el.querySelector('[data-coin]');
    if (c)
        openCoin(c.dataset.coin);
});
/* ---------- Bölümler: Spot (OKX TR botu), Futures (kaldıraç masası), Memecoin, Kasalar — her biri ayrı ekranda ---------- */
let VIEW = 'spot';
/** Tam ekran bir pencere (ayarlar, geçmiş, ajan masası) açılınca bölümler ve sekmeler gizlenir; kapanınca kalınan bölüme dönülür */
function overlayView(on) {
    document.getElementById('deck').hidden = on;
    if (on)
        document.getElementById('ovw').hidden = true;
    else
        setTimeout(renderOverview, 0);
    for (const id of ['futv', 'memev', 'kasav'])
        document.getElementById(id).hidden = true;
    if (!on && VIEW !== 'spot')
        setTimeout(() => showView(VIEW), 0);
}
function showView(v) {
    VIEW = v;
    const m = { spot: 'mainv', fut: 'futv', meme: 'memev', kasa: 'kasav' };
    for (const [k, id] of Object.entries(m))
        document.getElementById(id).hidden = k !== v;
    document.querySelectorAll('#deck button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    scrollTo(0, 0);
    renderDeck();
    navSave();
}
document.querySelectorAll('#deck button').forEach(b => b.onclick = () => showView(b.dataset.v));
document.addEventListener('click', e => { const b = e.target.closest?.('[data-sett]'); if (b)
    openSettingsTab(b.dataset.sett); });
function renderDeck() {
    if (!S)
        return;
    const X = S.xfer, sp = S.strategies?.live;
    const set = (id, t) => { const e = document.getElementById(id); if (e && e.textContent !== t)
        e.textContent = t; };
    if (sp && !sp.locked) {
        const p = liveEquity(sp) - sp.start_cash;
        set('dkSpot', Math.abs(p) < 0.5 ? '0 TL' : (p >= 0 ? '+' : '−') + nf(Math.abs(p), 0) + ' TL');
    }
    {
        const R2 = S.levr;
        set('dkFut', R2?.on ? '$' + nf(R2.equity, 2) : 'kapalı');
    }
    {
        const R3 = S.memer;
        set('dkMeme', R3?.on ? '$' + nf(R3.value, 2) : 'kapalı');
    }
    if (X) {
        const a = [X.tr_total, X.g_val, X.kasa?.usd];
        if (a.every((v) => v != null))
            set('dkKasa', '$' + nf(a.reduce((x, y) => x + y, 0) + (+S.memer?.value || 0), 0));
    }
    renderOverview();
    if (VIEW === 'fut') {
        const b = document.getElementById('futBody');
        setH(b, renderLevR() || `<div class="empty">${ic('i-layers')}<div>Kaldıraç masası verisi bekleniyor</div></div>`);
    }
    if (VIEW === 'meme') {
        const b = document.getElementById('memeBody');
        setH(b, renderMemeR() || `<div class="empty">${ic('i-flask')}<div>Memecoin masası verisi bekleniyor</div></div>`);
    }
}
/** Ana sayfa üstü: bütün kasaların toplamı ve her masanın kâr/zararı ayrı ayrı (dolar ve TL) */
function renderOverview() {
    const el = document.getElementById('ovw');
    if (!el || !S)
        return;
    const X = S.xfer, sp = S.strategies?.live, R = S.levr, M = S.memer, r = +(X?.usdtry || USDTTRY || 0);
    if (document.getElementById('deck')?.hidden || !X || !sp || sp.locked || !r) {
        el.hidden = true;
        return;
    }
    const parts = [['tr', 'Spot · OKX TR', 'i-bank', +X.tr_total || 0, ''], ['g', 'Futures · Global', 'i-layers', +X.g_val || 0, ''], ['m', 'Memecoin', 'i-flask', +M?.value || 0, ''], ['k', 'Kasa', 'i-vault', +X.kasa?.usd || 0, '']];
    const tot = [X.tr_total, X.g_val, X.kasa?.usd].every((v) => v != null) ? parts.reduce((a, p) => a + p[3], 0) : null;
    const sP = liveEquity(sp) - sp.start_cash, fP = R?.funded ? +R.pnl || 0 : 0, mP = M?.start ? +M.pnl || 0 : 0, allTL = sP + (fP + mP) * r;
    const sg = (v, u) => u !== '$' && Math.abs(v) < 0.5 ? '<b>±0 TL</b>' : `<b class="${cls(v)}">${v < 0 ? '−' : '+'}${u === '$' ? '$' + nf(Math.abs(v), 2) : nf(Math.abs(v), 0) + ' TL'}</b>`;
    const pl = { tr: sg(sP, 'TL'), g: R?.on || R?.funded ? sg(fP, '$') : '<b>kapalı</b>', m: M?.on || M?.start ? sg(mP, '$') : '<b>kapalı</b>', k: '<b class="mu">yedek</b>' };
    const sum = Math.max(1, tot || 0), bar = parts.filter(p => p[3] > 0).map(p => `<i class="p${p[0]}" style="width:${(p[3] / sum * 100).toFixed(2)}%"></i>`).join('');
    setH(el, `<div class="ob"><div class="oh">${ic('i-wallet')}<b>Toplam varlık</b><span>bütün hesaplar</span></div>
    <div class="obig"><div><strong>${tot != null ? '$' + nf(tot, 2) : '—'}</strong><small>${tot != null ? tl(tot * r, 0) : ''}</small></div>
      <div class="adf ${cls(allTL)}">${allTL >= 0 ? '▲' : '▼'} ${nf(Math.abs(allTL), 0)} TL<small>toplam kâr/zarar</small></div></div>
    <div class="abar">${bar}</div>
    <div class="og">${parts.map(([k, n, i, v]) => `<div class="p${k}"><em></em><span>${ic(i)}${n}</span><b>$${nf(v, v >= 100 ? 0 : 2)}</b><small>${pl[k]}</small></div>`).join('')}</div></div>`);
    el.hidden = false;
}
const ICON_BAD = new Set(), ICON_OK = new Set();
// Coinin hangi paritede alınıp satıldığını gösteren küçük etiket (TRY, USDT, USDC, EUR)
function pq(inst) { const q = String(inst).split('-')[1] || ''; return q ? `<span class="pq q-${q}">${q}</span>` : ''; }
function cico(inst, side, loss) {
    const b = sym(inst), t = b.slice(0, 4), lc = b.toLowerCase();
    const img = ICON_BAD.has(lc) ? '' : `<img class="${ICON_OK.has(lc) ? 'ok' : ''}" src="https://static.okx.com/cdn/oksupport/asset/currency/icon/${lc}.png" alt="" onload="ICON_OK.add('${lc}');this.classList.add('ok')" onerror="ICON_BAD.add('${lc}');this.remove()">`;
    const sd = side ? `<i class="sd ${side === 'SAT' ? 'sat' + (loss ? ' l' : '') : 'al'}">${side}</i>` : '';
    return `<div class="coin${t.length > 3 ? ' sm' : ''}" data-coin="${inst}">${t}${img}${sd}</div>`;
}
function renderCoins(x) {
    const box = document.getElementById('coins'), sumEl = document.getElementById('coinSum');
    const list = (x.coins || []).map(c => { const cur = c.open_qty ? sellPrice(c.inst, c.price) : 0, op = c.open_qty ? c.open_qty * cur - c.open_cost : 0; return { ...c, op, tot: c.realized + op }; }).sort((a, b) => b.tot - a.tot);
    if (!list.length) {
        box.innerHTML = `<div class="empty">${ic('i-coins')}<div>Henüz işlem yok; ilk alımdan sonra her coin burada ayrı görünür.</div></div>`;
        sumEl.textContent = '';
        return;
    }
    const T = list.reduce((a, c) => a + c.tot, 0);
    sumEl.className = 'hsum ' + cls(T);
    sumEl.textContent = sgn(T) + ' TL';
    setH(box, list.map(c => {
        const parts = [];
        if (c.sells)
            parts.push(`${c.sells} satış`);
        else
            parts.push(`${c.buys} alım`);
        if (c.bought)
            parts.push(tl(c.bought, 0) + ' alındı');
        // sağ alt kısa: kapandı / elde / açıktaki kâr-zarar (sağ sütun dar kalsın, sol satır bölünmesin)
        const det = c.open_qty ? (c.sells ? `açıkta ${sgn(c.op)}` : 'elde') : 'kapandı';
        return `<div class="row">${cico(c.inst)}
      <div class="mid"><b>${sym(c.inst)}${pq(c.inst)}</b><span>${parts.join(' · ')}</span></div>
      <div class="end"><b class="${cls(c.tot)}">${sgn(c.tot)} TL</b><span>${det}</span></div></div>`;
    }).join(''));
    clipList('coins', 5);
}
// Satırı sola kaydırınca "Sat" düğmesi çıkar (sadece gerçek hesapta). Kaydırılırken liste yenilenmez.
let swOpen = '', swDrag = false, swJust = 0;
const SELLING = {};
function renderPositions(x) {
    if (swDrag)
        return;
    const pos = x.positions, ps = document.getElementById('posSum'), canSell = sel === 'live' && !!x.armed;
    for (const k in SELLING)
        if (!pos.some(p => p.inst === k))
            delete SELLING[k]; // satıldı: "Satılıyor" kalksın
    {
        const T = pos.reduce((a, p) => a + p.qty * sellPrice(p.inst, p.price) - p.cost, 0);
        ps.className = 'hsum ' + cls(T);
        ps.textContent = pos.length ? `${pos.length} coin · ${sgn(T)} TL` : '';
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
      <div class="mid"><b>${sym(p.inst)}${pq(p.inst)}${prot}${p.lots > 1 ? `<i class="kd">${p.lots} kademe</i>` : ''}</b><span>Alış ${px(p.avg)} → satış ${px(cur)}<br>${ago(p.since)} alındı${volTxt(p.inst) ? ` · hacim ${volTxt(p.inst)}` : ''}</span>${rng}</div>
      <div class="end"${SELLING[p.inst] ? ` data-sell="${tx(`Satış isteği · ${Math.round((Date.now() - SELLING[p.inst]) / 1000)} sn`)}"` : ''}><b>${tl(val, 0)}</b><span class="plc ${cls(pl) || 'z'}">${sgn(pl)} TL</span><span class="plp ${cls(pl)}">${spc(plp)}</span></div></div>`;
        return canSell ? `<div class="swr${swOpen === p.inst ? ' open' : ''}${SELLING[p.inst] ? ' busy' : ''}" data-i="${p.inst}"><button class="swb" data-sell="${p.inst}">${ic('i-sell')}${SELLING[p.inst] ? 'Satılıyor' : 'Sat'}</button>${row}</div>` : row;
    }).join('')
        : `<div class="empty">${ic('i-box')}<div>Şu an açık pozisyon yok</div></div>`);
}
{
    const box = document.getElementById('positions');
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
            sellCoin(b.dataset.sell);
            return;
        }
        if (Date.now() - swJust < 400)
            return; // kaydırmanın bıraktığı tıklama satırı kapatmasın
        if (swOpen && !e.target.closest('.swr.open .swb')) {
            swOpen = '';
            box.querySelectorAll('.swr.open').forEach(w => w.classList.remove('open'));
        }
    });
}
// Tek coini sat: ayarlar.json'a satış isteği yazılır, bot ~5 sn içinde piyasa fiyatından satar
async function sellCoin(inst, retry = true) {
    if (SELLING[inst] && retry)
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
    try {
        const cur = await tfetch(API + '?t=' + Date.now(), { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, cache: 'no-store' }).then(r => { if (!r.ok)
            throw r.status; return r.json(); });
        const data = JSON.parse(decodeURIComponent(escape(atob(cur.content.replace(/\n/g, '')))));
        // Az önce başka bir coin için istek verildiyse o da listede kalsın (arka arkaya iki satış birbirini silmesin)
        const p = data.sell, keep = p && Date.now() - (p.ts || 0) < 90000 ? (p.insts || []) : [];
        data.sell = { ts: Date.now(), insts: [...new Set([...keep, inst])] };
        const body = { message: 'Uygulamadan satış: ' + inst, content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2) + '\n'))), sha: cur.sha, branch: 'main' };
        const r = await tfetch(API, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (r.status === 409 && retry)
            return sellCoin(inst, false); // aynı anda başka kayıt: güncel hâlle bir kez daha
        if (!r.ok)
            throw r.status;
        sha = (await r.json()).content.sha;
        if (orig)
            orig.sell = data.sell;
        if (draft)
            draft.sell = data.sell;
        toast(`${sym(inst)} satış isteği gönderildi; bot birkaç saniye içinde satar.`);
    }
    catch (e) {
        delete SELLING[inst];
        if (S)
            render();
        toast('Satış isteği gönderilemedi (' + e + '), tekrar dene');
        return;
    }
    // coin listeden düşünce "Satılıyor" kendiliğinden kalkar (renderPositions); 2 dakikada satılmazsa düğme geri gelir
    const t0 = SELLING[inst];
    setTimeout(() => { if (SELLING[inst] === t0) {
        delete SELLING[inst];
        if (S)
            render();
    } }, 120000);
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
    document.getElementById('rules').innerHTML = rows.map(([i, b, s]) => `<div class="rule"><div class="ic">${ic(i)}</div><div><b>${b}</b><span>${s}</span></div></div>`).join('');
    document.getElementById('rulesSum').textContent = c ? `Zarar kes ${pp(c.stop)} · acil fren ${tl(R.kill_switch, 0)} · günlük sınır ${tl(R.daily_loss_limit, 0)}` : `Zarar kes %${nf(R.stop_loss * 100, 1)} · acil fren ${tl(R.kill_switch, 0)}`;
}
/* ---------- anlık piyasa: uygulama açıkken OKX TR'den doğrudan ---------- */
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
            // tek istekle OKX TR'deki tüm TL paritelerinin anlık fiyatı ve 24 saatlik hacmi
            const r = await tfetch('https://tr.okx.com/api/v5/market/tickers?instType=SPOT', { cache: 'no-store' }, 6000).then(r => r.json()).catch(() => null);
            const all = r?.data || [], byId = new Map(all.map(t => [t.instId, t])), L_ = i => +(byId.get(i)?.last || 0), usd = L_('USDT-TRY');
            if (usd)
                USDTTRY = usd;
            // Fiyatlar TL karşılığıyla: USDT kuru USDT-TRY'den, USDC ve EUR farkı düşük USDT pariteleri üzerinden
            const K = { TRY: 1, USDT: usd, USDC: usd * L_('USDC-USDT'), EUR: L_('USDT-EUR') ? usd / L_('USDT-EUR') : 0 };
            const rows = all.filter(t => K[String(t.instId).split('-')[1]]);
            okxDown = !rows.length;
            if (okxDown && !lastTick) {
                const tg = document.getElementById('liveTag');
                tg.innerHTML = '<i></i>Erişilemiyor';
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
                tag.innerHTML = `<i></i>Canlı · ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
                tag.classList.add('on');
            }
            const x = S.strategies[sel];
            if (x && !x.locked) {
                renderMetrics(x);
                renderPositions(x);
                renderCoins(x);
                renderNow(x);
            }
            renderMarket();
            updLine();
            renderDeck();
        }
        catch (e) {
            document.getElementById('liveTag').classList.remove('on');
        }
        mkBusy = false;
    }
    // ana ekran açıkken 2 sn'de bir; ayarlar ya da geçmiş açıkken fiyat gösterilmediği için seyrek (veri tasarrufu)
    mkTimer = setTimeout(pollMarket, document.getElementById('mainv').hidden ? 8000 : 2000);
}
let okxDown = false;
function renderMarket() {
    const list = marketList(), box = document.getElementById('market');
    if (okxDown && !list.some(i => LP[i])) {
        box.className = 'card list mk';
        box._h = '';
        box.innerHTML = `<div class="empty">${ic('i-info')}<div>OKX TR'ye ulaşılamıyor. VPN açıksa OKX TR yurt dışı bağlantıyı engelliyor olabilir; VPN'i kapatınca canlı fiyatlar gelir. Bot bundan etkilenmez.</div></div>`;
        return;
    }
    const all = list.filter(i => LP[i]).sort((a, b) => LP[b].vol - LP[a].vol), rows = mkAll ? all : all.slice(0, 6);
    box.className = 'card list mk';
    const mkH = rows.length ? rows.map(i => {
        const q = LP[i];
        return `<div class="row">${cico(i)}<div class="mid"><b>${sym(i)}${pq(i)}</b><span>Hacim ${volTxt(i)} · 24 sa</span></div>
      <div class="end"><b class="pxv ${q.dir > 0 ? 'flash-up' : q.dir < 0 ? 'flash-dn' : ''}">${px(q.last)}</b><span class="${cls(q.ch)}">${spc(q.ch)}</span></div></div>`;
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
    return `<div class="okx ${o.ok ? 'ok' : 'bad'}">${ic(o.ok ? 'i-check' : 'i-info')}<span>OKX TR: ${o.status}${o.ok ? ` · boşta ${tl(o.try)}${o.usdt_tl ? ` + ${tl(o.usdt_tl)} (${o.quote || 'USDT'})` : ''}` : ''}</span></div>`;
}
function renderKasa(x) {
    const box = document.getElementById('kasa');
    if (!x.live || !x.kasa) {
        box.innerHTML = '';
        return;
    }
    const active = x.start_cash, reserve = Math.max(0, x.kasa - active), aw = Math.min(100, active / x.kasa * 100);
    const T = S?.settings?.topup || { amount: 600, profit_pct: 5, days: 1 }, amt = +T.amount || 0;
    const target = x.checkpoint * (1 + (+T.profit_pct || 5) / 100), prog = Math.max(0, Math.min(1, (liveEquity(x) - x.checkpoint) / (target - x.checkpoint || 1)));
    const waitMs = x.last_topup ? Math.max(0, x.last_topup + (+T.days || 0) * 864e5 - Date.now()) : 0, waitD = Math.ceil(waitMs / 864e5);
    const full = amt <= 0 || reserve < amt;
    box.innerHTML = `<div class="card kasa">
    <div class="top"><b>${ic('i-wallet')}Kasa<button class="qm" data-q="kasa" aria-label="Açıklama">?</button></b><span>${tl(x.kasa, 0)}</span></div>
    ${okxLine()}
    <div class="split"><i style="width:${aw}%;background:var(--amber)"></i></div>
    <div class="kv"><div>Botta aktif<b>${tl(active, 0)}</b></div><div>Kasada yedek<b>${tl(reserve, 0)}</b></div><div>Eklemeler<b>${x.topups} kez</b></div></div>
    <div class="prog">${full ? `<div class="lbl"><span>${amt <= 0 ? 'Kasadan ekleme kapalı.' : 'Kasada ekleme için yeterli yedek yok; yeni ekleme yapılmayacak.'}</span></div>`
        : `<div class="lbl"><span>Sonraki +${tl(amt, 0)} için kâr hedefi</span><b>${tl(liveEquity(x), 0)} / ${tl(target, 0)}</b></div>
      <div class="bar2"><i style="width:${(prog * 100).toFixed(1)}%"></i></div>
      <div class="hint">Aktif para son eklemeden beri %${nf(+T.profit_pct || 5, (+T.profit_pct || 5) % 1 ? 1 : 0)} kâra ulaşınca${waitD ? ` ve ${waitD} gün daha geçince` : ''} kasadan +${tl(amt, 0)} eklenir. Zarardayken ekleme yapılmaz. Başlangıç parası ve kurallar Ayarlar ekranından değiştirilebilir.</div>`}
    </div></div>`;
}
function renderLog(x) {
    const sec = document.getElementById('logSec');
    if (!x.live) {
        sec.hidden = true;
        return;
    }
    sec.hidden = false;
    document.getElementById('logSum').textContent = x.log.length ? 'Son not: ' + x.log[0][1] : 'Henüz kayıt yok';
    document.getElementById('log').innerHTML = x.log.length ? x.log.map(([ts, t]) => `<div class="row"><div class="mid"><b style="white-space:normal;font-weight:500">${t}</b><span>${dt(ts)}</span></div></div>`).join('')
        : `<div class="empty">${ic('i-info')}<div>Henüz kayıt yok</div></div>`;
}
function renderBacktest() {
    const box = document.getElementById('backtest');
    if (!B) {
        box.innerHTML = `<div class="empty">${ic('i-flag')}<div>Geçmiş test sonucu henüz yok</div></div>`;
        return;
    }
    const rows = Object.entries(B.results).sort((a, b) => b[1].pnl_pct - a[1].pnl_pct);
    box.innerHTML = rows.map(([k, r], i) => `<div class="row ${i === 0 ? 'best' : ''}"><div class="rank">${i + 1}</div>
      <div class="mid"><b>${r.name}${k === sel ? ' · seçili' : ''}</b><span>${r.trades} işlem · kazanma %${nf(r.win_rate, 0)} · en büyük düşüş %${nf(r.max_drawdown, 1)}</span></div>
      <div class="end"><b class="${cls(r.pnl_pct)}">${spc(r.pnl_pct)}</b><span>${tl(r.final, 0)}</span></div></div>`).join('')
        + `<div class="note">${B.custom ? `<b>Senin istediğin ayarlarla</b> (${dt(B.generated)}). ` : ''}Son ${B.days} gün, ${B.symbols.length} coin, gerçek OKX TR fiyatları, komisyon dahil. Aynı coinleri alıp hiç dokunmamak (al-tut): <b class="${cls(B.hold_pct)}">${spc(B.hold_pct)}</b>. Geçmiş sonuç geleceği garanti etmez.</div>`;
}
function renderChart() {
    const box = document.getElementById('chartBox'), leg = document.getElementById('legend'), note = document.getElementById('chartNote');
    const src = view === 'live' ? Object.fromEntries(Object.entries(S.strategies).filter(([k, v]) => v.equity_series && (k === 'live' || !S.strategies.live || S.strategies.live.locked)).map(([k, v]) => [k, v.equity_series]))
        : (B ? Object.fromEntries(Object.entries(B.results).map(([k, v]) => [k, v.equity])) : {});
    note.textContent = view === 'live' ? (S.created ? 'Başlangıç ' + dt(S.created).split(' ')[0] : '') : (B ? 'Son ' + B.days + ' gün' : '');
    for (const k in src) {
        const st = view === 'live' ? (S.strategies[k]?.start_cash || S.start_cash) : S.start_cash;
        src[k] = src[k].map(([t, v, b0]) => [t, (v / (b0 || st) - 1) * 100]);
    }
    const pts = Object.values(src).flat();
    if (pts.length < 4 || Object.values(src).every(s => s.length < 2)) {
        box.innerHTML = `<div class="empty">${ic('i-chart')}<div>${view === 'live' ? 'Grafik için veri birikiyor. Bot saatte bir nokta ekler.' : 'Geçmiş test verisi yok'}</div></div>`;
        leg.innerHTML = '';
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
        const z = Y(0), zl = z + 12 > H - pb - 16 ? z - 5 : z + 12; // sıfır etiketi alttaki etiketle çakışmasın
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
    box.innerHTML = `<svg id="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>`;
    leg.innerHTML = Object.keys(src).map(k => `<span><i style="background:${k === sel ? AMBER : COLORS[k]};opacity:${k === sel ? 1 : .6}"></i>${S.strategies[k]?.name || k}</span>`).join('');
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
/* ---------------- Ayarlar ---------------- */
const REPO = (() => {
    const h = location.hostname, m = h.match(/^([^.]+)\.github\.io$/);
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return m && seg ? { o: m[1], r: seg } : { o: 'tcmustafacelik', r: 'masal' };
})();
const API = `https://api.github.com/repos/${REPO.o}/${REPO.r}/contents/docs/ayarlar.json`;
let token = localStore('masal_token') || '', orig = null, draft = null, sha = null, sellArm = 0;
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
        const free = S.okx.try + (S.okx.usdt_tl || 0); // TL + boştaki USDT/USDC/EUR'nun TL karşılığı
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
        el.innerHTML = '';
        return;
    }
    let list = [];
    try {
        list = checks(st, st, false).filter(c => c.lv === 'bad' || c.lv === 'warn2');
    }
    catch (e) { }
    el.innerHTML = list.length ? `<section style="margin-top:12px"><div class="card chk">${list.map(c => `<div class="ck ${c.lv}"><span class="ci">${ic(c.lv === 'bad' ? 'i-stop' : 'i-info')}</span><div><b class="t">${c.t}</b><span class="d">${c.dsc}</span></div></div>`).join('')}
    <button class="btn sm" style="margin:2px 0 10px" onclick="document.getElementById('openSet').click()">${ic('i-gear')}Ayarlara git</button></div></section>` : '';
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
    { t: 'Futures', i: 'i-layers', sw: [['lev.real', 'Gerçek parayla işlem', 'Kararlar OKX Global\'de gerçek parayla uygulanır']], f: [
            ['lev.real_budget', 'Bütçe', 'Global fon hesabından futures\'a geçecek para', '$', 5, 5, 10000, 0],
            ['lev.max_loss', 'En fazla kayıp', 'Toplam zarar buna ulaşınca masa tamamen durur', '$', 5, 1, 10000, 0],
            ['lev.real_lev', 'Kaldıraç', 'İzole marjin; güvenlik için en fazla 3x', 'x', 1, 1, 3, 0],
            ['lev.risk_pct', 'İşlem başına risk', 'Zarar durdurmaya kadar kaybedilecek; kasanın', '%', .5, .5, 5, 1],
            ['lev.max_pos', 'En fazla pozisyon', 'Aynı anda açık', 'adet', 1, 1, 5, 0],
            ['lev.daily_loss_pct', 'Günlük zarar sınırı', 'Aşılırsa pozisyonlar kapanır, o gün işlem yok', '%', 1, 1, 20, 0],
            ['lev.sl_atr', 'Zarar durdur mesafesi', 'Saatlik oynaklığın (ATR) katı', 'kat', .5, 1, 5, 1],
            ['lev.tp_atr', 'Kâr al mesafesi', 'Saatlik oynaklığın (ATR) katı', 'kat', .5, 1, 10, 1]
        ] },
    { t: 'Memecoin', i: 'i-flask', sw: [['meme.real', 'Gerçek parayla işlem', 'Kararlar MEME cüzdanında gerçek parayla uygulanır']], f: [
            ['meme.max_loss', 'En fazla kayıp', 'Toplam zarar buna ulaşınca masa durur, tokenler satılır', '$', 5, 1, 10000, 0],
            ['meme.max_slip', 'En fazla fiyat etkisi', 'Bunu aşan alım reddedilir', '%', .5, .5, 10, 1],
            ['meme.size_pct', 'İşlem büyüklüğü', 'Kasanın', '%', 1, 1, 50, 0],
            ['meme.max_pos', 'En fazla pozisyon', 'Aynı anda tutulan token', 'adet', 1, 1, 10, 0],
            ['meme.min_liq', 'En az likidite', 'Havuzu bundan küçük token alınmaz', '$', 5000, 5000, 1e7, 0],
            ['meme.tp_pct', 'Kâr al', 'Bu kâra ulaşınca satış başlar', '%', 5, 5, 1000, 0],
            ['meme.tp_part', 'Kâr alda satılan kısım', 'Kalanı iz süren stopla yükselişte tutulur; 100 = hepsi satılır', '%', 10, 10, 100, 0],
            ['meme.sl_pct', 'Zarar durdur', 'Bu zararda satılır', '%', 1, 3, 50, 0],
            ['meme.trail_from', 'İz süren stop başlangıcı', 'Bu kâra ulaşınca devreye girer', '%', 5, 5, 200, 0],
            ['meme.trail_pct', 'İz süren stop', 'Zirveden bu kadar düşünce satılır', '%', 1, 3, 50, 0],
            ['meme.max_m5', 'Kovalamama sınırı', 'Son 5 dk\'da bundan fazla yükselmişse alınmaz', '%', 1, 2, 30, 0],
            ['meme.max_hold_h', 'En uzun tutma', 'Bu süre dolunca satılır', 'saat', 1, 1, 72, 0]
        ] },
    { t: 'Aktarım ve KASA', i: 'i-vault', f: [
            ['xfer.daily_max', 'Günlük aktarım sınırı', 'Bir günde borsalardan en fazla gönderilecek', '$', 100, 10, 100000, 0],
            ['xfer.sweep_pct', 'Kâr süpürme oranı', 'Futures ve memecoin kârının bu kadarı KASA\'ya gider; 0 kapalı', '%', 5, 0, 100, 0],
            ['xfer.sweep_days', 'Süpürme aralığı', 'Bu kadar günde bir', 'gün', 1, 1, 90, 0],
            ['xfer.sweep_min', 'En az süpürme kârı', 'Kâr bundan azsa gönderilmez', '$', 5, 1, 10000, 0]
        ] },
];
// "Kasa dahil toplam" seçiliyken hedef alanı: bottaki para + kasadaki yedek
const TGT_TOTAL = ['target.amount', 'Hedef toplam para', () => `Bot + kasa bu tutara ulaşınca her şey satılır`, 'TL', 500, 100, 1e8, 0];
// Kademeli stratejide zarar sınırı, coin sayısı ve alım tutarı kendi ayarlarından gelir; genel alanlar gizlenir
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
    'Futures': () => { const l = draft.lev || {}; return `${l.real ? 'Gerçek açık' : 'Gerçek kapalı'} · bütçe $${nf(l.real_budget ?? 30, 0)} · en fazla $${nf(l.max_loss ?? 10, 0)} kayıp · ${l.real_lev ?? 2}x`; },
    'Memecoin': () => { const m = draft.meme || {}; return `${m.real ? 'Gerçek açık' : 'Gerçek kapalı'} · kasanın ${pc(m.size_pct ?? 10)}'u · kâr ${pc(m.tp_pct ?? 30)}${(m.tp_part ?? 100) < 100 ? ` (${pc(m.tp_part)}'i)` : ''} · zarar ${pc(m.sl_pct ?? 15)}`; },
    'Aktarım ve KASA': () => { const x = draft.xfer || {}; return `Günde en çok $${nf(x.daily_max || 1000, 0)} · ${+x.sweep_pct > 0 ? `kârın ${pc(x.sweep_pct)}'i ${x.sweep_days} günde bir KASA'ya` : 'kâr süpürme kapalı'}`; }
};
const SEC_C = { 'Futures': 'red', 'Memecoin': 'violet', 'Kasa': 'teal', 'Kasadan ekleme': 'teal', 'Koruma': 'red', 'Kâr hedefi': 'green', 'Aktarım ve KASA': 'amber' };
function field([k, label, hint, u, step, min, max, dec]) {
    const v = P(draft, k), h = typeof hint === 'function' ? hint() : hint;
    return `<div class="field" data-k="${k}"><div class="lb"><b>${label}</b><span class="h">${h}</span><em></em></div>
   <div class="step"><button data-d="-1" aria-label="Azalt">${ic('i-minus')}</button>
   <label class="sv"><input inputmode="decimal" value="${fv(v, dec)}" data-step="${step}" data-min="${min}" data-max="${max}" data-dec="${dec}">
   ${u ? `<span class="u">${u}</span>` : ''}</label><button data-d="1" aria-label="Artır">${ic('i-plus')}</button></div></div>`;
}
// En çok coin bulunan pariteler (OKX TR): USDT ~300, EUR ~270, USDC ~270, TRY ~130
const QUOTES = [['USDT', '₮', 'Önerilen'], ['USDC', '$', 'Düşük fark'], ['EUR', '€', 'Düşük fark'], ['TRY', '₺', 'Fark yüksek']];
function tile(on, key, icon, name, sub) { return `<button class="tile ${on ? 'on' : ''}" data-t="${key}"><span class="ic">${ic(icon)}</span><span class="nm">${name}</span>${sub ? `<span class="pc" style="color:var(--muted);font-weight:500">${sub}</span>` : ''}</button>`; }
// ---- PIN girişi (animasyonlu) ----
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
    // Kısa link: linkte sadece 16 baytlık rastgele anahtar durur; şifreli paket depoda saklanır.
    // Paket ancak link + PIN birlikte olursa açılır; yeni link oluşunca eskisi silinir.
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
const STABS = [['spot', 'i-coins', 'Spot'], ['fut', 'i-layers', 'Futures'], ['meme', 'i-flask', 'Memecoin'], ['kasa', 'i-vault', 'Kasalar'], ['app', 'i-phone', 'Uygulama']];
const AUTO_OPEN = new Set();
const SEC_TAB = { 'Kasa': 'spot', 'Kasadan ekleme': 'spot', 'Koruma': 'spot', 'Kâr hedefi': 'spot', 'Futures': 'fut', 'Memecoin': 'meme', 'Aktarım ve KASA': 'kasa' };
function openSettingsTab(t) { STAB = t; document.getElementById('openSet').click(); }
function renderForm() {
    delete draft._bad;
    const live = draft.live;
    const dirtyTab = (t) => (t === 'spot' && secDirty(['live', 'paused', 'quote', 'strategy', 'target', 'grid', 'dip', 'trend'])) || (t === 'app' && secDirty(['notify'])) || SECTIONS.some(sec => SEC_TAB[sec.t] === t && secDirty([...sec.f.map(x => x[0]), ...(sec.sw || []).map(x => x[0])]));
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
   <div class="card" style="margin-top:8px"><div class="sw ${draft.paused ? 'on' : ''}" id="pauseSw"><div class="lb"><b style="font-size:13.5px">Botu durdur</b><span style="font-size:11.5px;color:var(--muted);display:block">Yeni alım yapılmaz; açık pozisyonların zarar sınırı çalışmaya devam eder</span></div><div class="track"><i></i></div></div>
   <div class="field" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line2)"><div class="lb"><b>Hepsini sat ve dur</b><span>Gerçek hesaptaki tüm coinleri hemen satar, botu durdurur</span></div>
   <button class="btn danger ${sellArm ? 'arm' : ''}" id="sellAll">${ic('i-sell')}${sellArm ? 'Emin misin? Dokun' : 'Hepsini sat'}</button></div></div></section>
   <div class="hint" style="margin:8px 2px 4px">Bot kesintisiz çalışır: yaklaşık 5 saniyede bir piyasayı, borsadaki korumaları ve para hareketlerini kontrol eder. Uygulama kapalı olsa da çalışır.</div>
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
            + (sec.sw || []).map(([k, a, b]) => `<div style="margin-bottom:4px">${swRow('sw_' + k.replace('.', '_'), !!P(draft, k), a, b)}</div>`).join('')
            + (sec.t === 'Futures' ? futExtra() : '')
            + (sec.t === 'Memecoin' ? memeExtra() : '')
            + (tg ? `<div style="margin-bottom:4px">${swRow('tgtSw', !!draft.target.on, 'Hedefte dur', 'Hedefte her şey satılır, bot durur')}</div>
        <div class="field"><div class="lb"><b>Hedef türü</b><span>${draft.target.mode === 'total' ? 'Bot + kasadaki yedek para toplamı' : 'Sadece kâr (başlangıç parasının üstü)'}</span></div>
        <div class="seg" id="tgtMode"><button type="button" data-m="profit" class="${draft.target.mode !== 'total' ? 'on' : ''}">Kâr</button><button type="button" data-m="total" class="${draft.target.mode === 'total' ? 'on' : ''}">Kasa dahil</button></div></div>` : '')
            + `${ff.map(field).join('')}</div>` + ACC_END;
    }
    const sf = STRAT_F[draft.strategy];
    const grid = draft.strategy === 'grid';
    const GG = [['i-coins', 'Alım', ['grid.sma_hours', 'grid.step_pct', 'grid.step3_pct', 'grid.lot_pct', 'grid.lot2_pct', 'grid.lot3_pct']], ['i-pnl', 'Satış', ['grid.lot_tp_pct', 'grid.stop_pct']], ['i-shield', 'Sınırlar', ['grid.max_lots', 'grid.max_coins', 'grid.use_pct']], ['i-eye', 'Filtreler', ['grid.trend_filter_pct', 'grid.vol_filter']]];
    const sfH = grid ? GG.map(([i, t, ks]) => `<div class="fgrp"><div class="fgh">${ic(i)}${t}</div>${ks.map(k => sf.find(f => f[0] === k)).filter(Boolean).map(field).join('')}${t === 'Alım' ? '<div id="ladder"></div>' : ''}</div>`).join('') : sf.map(field).join('');
    if (STAB === 'spot')
        h += accOpen('strat', SNAMES[draft.strategy] + ' ayarları', ICON[draft.strategy], 'blue', SUMS[draft.strategy](), secDirty([...sf.map(x => x[0]), ...(grid ? ['grid.instant'] : [])])) + `<div class="card">${sfH}`
            + (grid ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line2)">${swRow('instSw', !!draft.grid.instant, 'Anlık alım', 'Fiyat değince hemen alır')}</div>` : '') + `</div>` + ACC_END;
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
            toast(ok ? 'Eski kayıtlar temizleniyor; bot birkaç saniyede uygular' : 'Temizleme isteği gönderilemedi, tekrar dene');
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
function futExtra() {
    const R = S?.levr, l = draft.lev || {};
    let h = '';
    if (l.real && !orig?.lev?.real)
        h += `<div class="warn">${ic('i-info')}<div>Kaydedince Global fon hesabından $${nf(l.real_budget, 0)} futures'a geçer ve sinyal gelince gerçek pozisyon açılır. Kaybedebileceğin en fazla $${nf(l.max_loss, 0)}.</div></div>`;
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
        h += `<div class="hint" style="margin:2px 2px 10px">MEME cüzdanı ${m.wallet.slice(0, 4)}…${m.wallet.slice(-4)}${R?.addr ? ' · bağlı' : ''}. Yalnız bu cüzdandaki parayla işlem yapılır; KASA'ya dokunulmaz.</div>`;
    if (m.real && !orig?.meme?.real)
        h += `<div class="warn">${ic('i-info')}<div>Kaydedince MEME cüzdanındaki SOL ile gerçek alım-satım başlar. Her girişte boş SOL'un %${m.size_pct}'i kullanılır; en fazla $${nf(m.max_loss, 0)} kayıpta durur.</div></div>`;
    if (R?.dead)
        h += `<div style="margin:4px 0 8px"><button class="btn xsync" type="button" id="memeReset">${ic('i-refresh')}Yeniden başlat</button><p class="hint">Masa durdu: ${String(R.dead).replace(/</g, '&lt;')}. Yeniden başlatınca kayıp sayacı sıfırlanır.</p></div>`;
    return h;
}
/** Kademe merdiveni: ayarlara göre bir coinde her kademenin nerede, ne kadarla alınıp nerede satılacağı */
function ladder() {
    const el = document.getElementById('ladder');
    if (!el || !draft || draft.strategy !== 'grid')
        return;
    const g = draft.grid, b = +draft.budget || 0, l1 = b * g.lot_pct / 100, n = Math.max(1, Math.min(10, +g.max_lots || 1));
    let px = 1, cost = 0, qty = 0, rows = '', stopAt = 0;
    for (let i = 0; i < n; i++) {
        px *= 1 - (i < 2 ? g.step_pct : (g.step3_pct || g.step_pct)) / 100;
        const amt = l1 * (i === 0 ? 1 : i === 1 ? (g.lot2_pct ?? 100) / 100 : (g.lot3_pct ?? 100) / 100);
        const avg = cost ? cost / qty : 0, dead = i > 0 && px <= avg * (1 - g.stop_pct / 100);
        if (dead && !stopAt)
            stopAt = i + 1;
        cost += amt;
        qty += amt / px;
        const drop = (1 - px) * 100;
        rows += `<div class="lr${dead ? ' off' : ''}"><em>${i + 1}</em><span><b>−%${nf(drop, 1)}</b><small>ortalamadan</small></span><span><b>${tl(amt, 0)}</b><small>alım</small></span><span><b class="up">+%${nf(g.lot_tp_pct, 1)}</b><small>${dead ? 'ulaşılmaz' : 'kârla satılır'}</small></span><i style="width:${Math.min(100, drop * 2.2).toFixed(1)}%"></i></div>`;
    }
    const avg = cost / qty, stopPx = (1 - avg * (1 - g.stop_pct / 100)) * 100;
    setH(el, `<div class="ldh">Kademe merdiveni<span>${n} kademe · hepsi dolarsa ${tl(cost, 0)}</span></div>${rows}
    <p class="hint">Fiyat düştükçe sırayla alır; her kademe kendi fiyatından %${nf(g.lot_tp_pct, 1)} yükselince ayrı satılır. Fiyat alış ortalamasının %${nf(g.stop_pct, 1)} altına (ortalamadan −%${nf(stopPx, 1)}) inerse hepsi satılır.${stopAt ? ` <b class="dn">${stopAt}. kademeden itibaren zarar sınırına önce ulaşılır; bu kademeler hiç alınmaz.</b>` : ''}</p>`);
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
            const j = await r.json();
            sha = j.sha;
            orig = JSON.parse(decodeURIComponent(escape(atob(j.content.replace(/\n/g, '')))));
        }
        else {
            orig = await tfetch('ayarlar.json?t=' + Date.now()).then(r => r.json());
        }
    }
    catch (e) {
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
        orig.lev = { on: true, bank: 100, lev: 3, risk_pct: 1, max_pos: 3, sl_atr: 2, tp_atr: 4, daily_loss_pct: 5, fee_pct: .05, slip_pct: .05, coins: ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'HYPE', 'ZEC', 'PEPE'], real: false, real_budget: 30, real_lev: 2, max_loss: 10, real_reset: 0, ...(orig.lev || {}) };
    if (orig)
        orig.meme = { on: true, bank: 100, size_pct: 10, max_pos: 5, min_liq: 20000, max_fdv: 5000000, min_age_min: 10, max_age_h: 72, tp_pct: 30, trail_from: 15, trail_pct: 12, sl_pct: 15, max_hold_h: 4, slip_pct: 1, fee_pct: .5, max_m5: 8, wallet: '', real: false, max_loss: 10, max_slip: 2, real_reset: 0, ...(orig.meme || {}) };
    if (orig)
        orig.xfer = { daily_max: 1000, sweep_on: true, sweep_pct: 50, sweep_days: 7, sweep_min: 10, ...(orig.xfer || {}) };
    if (orig && orig.grid && orig.grid.trend_filter_pct == null)
        orig.grid.trend_filter_pct = 1;
    if (orig && !orig.notify)
        orig.notify = { enabled: false, topic: '', trades: true, alerts: true, daily: true, money: true };
    if (orig?.notify && orig.notify.daily_hour == null)
        orig.notify.daily_hour = 21;
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
/** Ayarlardaki tek bir şeyi buluta yazar (bekleyen başka değişikliklere dokunmadan): dil, tema, bildirim temizleme. */
let patchQ = Promise.resolve(), ACC_T = 0;
/** Bulut yazmaları sırayla gider: üst üste dokunuşlarda (409 çakışması) son değişiklik kaybolmasın */
function cloudPatch(fn, msg) { const p = patchQ.then(() => cloudPatch_(fn, msg)); patchQ = p.catch(() => { }); return p; }
async function cloudPatch_(fn, msg, retry = true) {
    if (!token)
        return false;
    fastWatch();
    try {
        const cur = await tfetch(API + '?t=' + Date.now(), { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, cache: 'no-store' }).then(r => { if (!r.ok)
            throw r.status; return r.json(); });
        const o = JSON.parse(decodeURIComponent(escape(atob(cur.content.replace(/\n/g, '')))));
        fn(o);
        const body = { message: msg, content: btoa(unescape(encodeURIComponent(JSON.stringify(o, null, 2) + '\n'))), sha: cur.sha, branch: 'main' };
        const r = await tfetch(API, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (r.status === 409 && retry)
            return cloudPatch_(fn, msg, false); // aynı anda başka kayıt: güncel hâli alıp bir kez daha dene
        if (!r.ok)
            throw r.status;
        sha = (await r.json()).content.sha;
        if (orig)
            fn(orig);
        if (draft)
            fn(draft);
        if (S?.settings)
            fn(S.settings);
        return true;
    }
    catch (e) {
        return false;
    }
}
async function save(obj, msg, keepDraft, retry = true) {
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
        const cur = await tfetch(API + '?t=' + Date.now(), { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }, cache: 'no-store' }).then(r => { if (!r.ok)
            throw r.status; return r.json(); });
        // Başka cihazdan/ekrandan gelmiş bekleyen istekler (satış, çevirme, hepsini sat, bildirim temizleme) bu kayıtla silinmesin
        try {
            const fr = JSON.parse(decodeURIComponent(escape(atob(cur.content.replace(/\n/g, '')))));
            const d = data;
            for (const k of ['sell', 'convert'])
                if ((fr[k]?.ts || 0) > (d[k]?.ts || 0))
                    d[k] = fr[k];
            if ((+fr.liquidate || 0) > (+d.liquidate || 0))
                d.liquidate = fr.liquidate;
            if (fr.notify && d.notify && (fr.notify.cleared || 0) > (d.notify.cleared || 0))
                d.notify.cleared = fr.notify.cleared;
            for (const k of ['xfer_req', 'xfer_cancel', 'dust', 'desk_cmd'])
                d[k] = fr[k] || [];
            if ((+fr.clear || 0) > (+d.clear || 0))
                d.clear = fr.clear;
            for (const k of ['lang', 'theme', 'accent'])
                if (fr[k])
                    d[k] = fr[k];
        }
        catch (e) { }
        const body = { message: 'Ayarlar uygulamadan güncellendi', content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2) + '\n'))), sha: cur.sha, branch: 'main' };
        const r = await tfetch(API, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (r.status === 409 && retry) {
            btn.innerHTML = ic('i-check') + 'Kaydet';
            return save(obj || data, msg, keepDraft, false);
        } // çakışma: güncel sürümle bir kez daha
        if (!r.ok)
            throw r.status;
        sha = (await r.json()).content.sha;
        const prev = keepDraft ? clean(draft) : null;
        orig = JSON.parse(JSON.stringify(data));
        draft = JSON.parse(JSON.stringify(data));
        if (prev)
            for (const k in prev)
                if (!['test_req', 'sell', 'convert', 'liquidate', 'xfer_req', 'xfer_cancel', 'dust', 'desk_cmd', 'clear'].includes(k))
                    draft[k] = prev[k];
        renderForm();
        if (S)
            render();
        toast(msg || 'Kaydedildi. Bot birkaç saniye içinde yeni ayarlarla çalışır.');
    }
    catch (e) {
        toast(e === 401 || e === 403 ? 'Yetki hatası: anahtarın Contents yazma izni olmalı' : 'Kaydedilemedi, tekrar dene (' + e + ')');
    }
    finally {
        btn.innerHTML = ic('i-check') + 'Kaydet';
    }
}
let toastT;
function toast(t) { const el = document.getElementById('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 3800); }
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
      <div class="end"><b>${tl(t.amount, 0)}</b>${sell ? `<span class="plc ${cls(t.pnl) || 'z'}">${sgn(t.pnl)} TL ${t.pnl >= 0 ? 'kâr' : 'zarar'}</span>` : `<span>harcandı</span>`}</div></div>`;
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
/* ---------- bildirimler ---------- */
let topicPlain = '';
const swRow = (id, on, title, sub) => `<div class="sw ${on ? 'on' : ''}" id="${id}"><div class="lb"><b style="font-size:13px">${title}</b><span style="font-size:11px;color:var(--muted);display:block">${sub}</span></div><div class="track"><i></i></div></div>`;
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
/* ---------- ana ekrana ekleme ---------- */
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
    document.querySelector('meta[name=theme-color]').content = d ? '#0F131A' : '#F4F5F7';
}
const ACCENTS = [['amber', 'Kehribar', '#D9861A'], ['ocean', 'Okyanus', '#2F6FDB'], ['emerald', 'Zümrüt', '#178A5B'], ['violet', 'Ametist', '#7A52C7'], ['graphite', 'Grafit', '#334155']];
function setAccent(a) { localStore('masal-renk', a); if (a === 'amber')
    delete document.documentElement.dataset.accent;
else
    document.documentElement.dataset.accent = a; }
{
    const a = localStore('masal-renk');
    if (a && a !== 'amber')
        document.documentElement.dataset.accent = a;
}
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
    {
        const cur = localStore('masal-renk') || 'amber';
        h += `<div class="prf" style="display:block"><b>Renk</b><div class="accs" id="accTiles" style="margin-top:6px">${ACCENTS.map(([k, n, c]) => `<button type="button" class="${cur === k ? 'on' : ''}" data-accent="${k}"><i style="background:${c}"></i>${n}</button>`).join('')}</div></div>`;
    }
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
        // dil bulutta tutulur: bütün cihazlar ve bildirimler aynı dilde
        localStore('masal_pref_ts', String(Date.now()));
        await cloudPatch(o => { o.lang = l; }, 'Dil değişti');
        setLang(l);
    });
    document.querySelectorAll('#accTiles button').forEach(t => t.onclick = () => { setAccent(t.dataset.accent); localStore('masal_pref_ts', String(Date.now())); clearTimeout(ACC_T); const v = t.dataset.accent; ACC_T = setTimeout(() => cloudPatch(o => { o.accent = v; }, 'Renk değişti'), 700); document.querySelectorAll('#accTiles button').forEach(x => x.classList.toggle('on', x === t)); });
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
/* ---------- sürüm ---------- */
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
/** Yenilikler: uygulama yeni sürümle ilk açıldığında, görülmemiş sürümlerin notları bir kez gösterilir. */
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
/* ---------- açılış, logo, çevrimdışı ---------- */
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
/* ---------- telefonun geri tuşu / geri kaydırma ----------
   Uygulama tek sayfa: geri tuşu tarayıcı geçmişinde geri gider ve uygulama kapanırdı. Her zaman bir "nöbetçi" geçmiş kaydı
   tutulur; geri basılınca en üstteki açık katman (PIN, alt pencere, açık satır, ayarlar, geçmiş, ajan masası) kapanır.
   Ana ekrandayken ilk geri bir uyarı gösterir, 2 sn içinde ikinci geri uygulamadan çıkar. */
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
    if (VIEW !== 'spot') {
        showView('spot');
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
/* ---------- sayfa yenilenince aynı yerde kal: bölüm, ayarlar sekmesi ve kaydırma konumu (bu sekmede saklanır) ---------- */
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
        else if (n.v && n.v !== 'spot')
            showView(n.v);
        navReady = true;
        let k = 0;
        const go = () => { scrollTo(0, n.y || 0); if (++k < 6 && Math.abs(scrollY - (n.y || 0)) > 4)
            setTimeout(go, 400); };
        setTimeout(go, 300);
    }, 60);
})();
/** Uzun listeler kısa görünür (ilk n satır); "Tümünü göster" ile açılır, tercih bu oturumda hatırlanır. */
const CLIP_OPEN = new Set();
function clipList(id, n) {
    const el = document.getElementById(id);
    if (!el)
        return;
    const rows = [...el.children].filter(c => c.classList.contains('row'));
    let b = el.querySelector(':scope>.clipb');
    const open = CLIP_OPEN.has(id);
    rows.forEach((r, i) => r.hidden = !open && i >= n);
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
