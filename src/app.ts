const APP_VERSION='1.40.0';
const ICON={dip:'i-dip',trend:'i-trend',grid:'i-grid',live:'i-coins'};
const COLORS={dip:'#2F6FDE',trend:'#7A5AC8',grid:'#178A5B',live:'#7C8696'};
const AMBER='#D9861A';
let S: Summary = null, B: Backtest = null, sel = 'live' as StrategyKey, view: 'live' | 'bt' = 'live';

function localStore(k: string, v?: string): string | null {try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
const nf=(v,d=2)=>new Intl.NumberFormat('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d}).format(v);
const tl=(v,d=2)=>nf(v,d)+'\u00a0TL'; // bölünmez boşluk: "TL" satır sonunda tek başına kalmasın
const sgn=v=>(v>0?'+':v<0?'−':'')+nf(Math.abs(v));
const spc=(v,d=2)=>(v>0?'+':v<0?'−':'')+'%'+nf(Math.abs(v),d); // işaretli yüzde: +%0,14 / −%1,86
const cls=v=>v>0?'up':v<0?'dn':'';
function px(v){const a=Math.abs(v);return nf(v,a>=1000?0:a>=10?2:a>=1?3:5)}
function fv(v,dec){return dec>0?String(Math.round(+v*100)/100).replace('.',','):Number(v).toLocaleString('tr-TR')} // en fazla 2 ondalık: kutudan taşmasın
function dt(ts: number, withYear?: boolean): string {const d=new Date(ts);const p=n=>String(n).padStart(2,'0');
  return p(d.getDate())+'.'+p(d.getMonth()+1)+(withYear?'.'+d.getFullYear():'')+' '+p(d.getHours())+':'+p(d.getMinutes())}
function ago(ts){const m=Math.round((Date.now()-ts)/60000);if(m<1)return 'az önce';if(m<60)return m+' dk önce';const h=Math.floor(m/60);return h<24?h+' sa önce':Math.floor(h/24)+' gün önce'}
const ic=(id,c='i')=>`<svg class="${c}"><use href="#${id}"/></svg>`;
const sym=inst=>inst.split('-')[0];

/* ---------- dil: varsayılan Türkçe; İngilizce seçilince ekrandaki yazılar sözlükle (docs/en.json) çevrilir ----------
   Kodda bütün yazılar Türkçe kalır. Çeviri, ekrana gelen her yazıya uygulanır: sayılar ve coin adları yer tutucu
   olur ({0}, {1}…), kalıp sözlükte aranır, sayılar İngilizce biçime (1,234.5 · 1.5%) çevrilerek geri konur. */
let LANG: 'tr' | 'en' = (localStore('masal_lang') === 'en' ? 'en' : 'tr');
let EN: Record<string, string> = {};
const I18N_TOK = /[+−-]?%?\d[\d.,:]*%?|\b[A-Z][A-Z0-9]{1,11}\b/g;
const I18N_MISS = new Set<string>();
function enNum(v: string): string {
  if (/^\d+\.$/.test(v)) return v.slice(0, -1); // sıra sayısı: "2." → "2"
  if (/\.(\d{1,2}|\d{4,})(?!\d)/.test(v)) return v; // nokta 3 haneyi ayırmıyorsa tarih (19.11), sayı değil
  if (!/\d/.test(v) || v.includes(':') || !/^[+−-]?%?[\d.,]+%?$/.test(v)) return v;
  const pct = v.includes('%'); let x = v.replace(/%/g, '');
  x = x.replace(/\./g, '\u0001').replace(/,/g, '.').replace(/\u0001/g, ',');
  return pct ? x + '%' : x;
}
function trKey(core: string): [string, string[]] { const vals: string[] = []; let n = 0;
  const key = core.replace(I18N_TOK, m => { vals.push(m); return '{' + (n++) + '}'; }); return [key, vals]; }
function tx(s: string): string {
  if (LANG === 'tr' || !s) return s;
  const core = s.replace(/\s+/g, ' ').trim(); if (!core) return s;
  if (EN[core] != null) return s.replace(s.trim(), EN[core]);
  const [key, vals] = trKey(core); const e = EN[key];
  if (e == null) {
    // sadece sayı/kısaltma olan yazılar (15.644 · %73 · ,04 TL): sayılar İngilizce biçime çevrilir
    if (!/[a-zçğıöşü]/.test(key)) return s.replace(/^(\s*),(?=\d)/, '$1.').replace(I18N_TOK, m => enNum(m));
    I18N_MISS.add(key); return s;
  }
  const lead = s.match(/^\s*/)[0], tail = s.match(/\s*$/)[0];
  return lead + e.replace(/\{(\d+)\}/g, (_, i) => enNum(vals[+i] ?? '')) + tail;
}
const I18N_DONE = new WeakMap<Node, string>();
function txNode(root: Node) {
  if (LANG === 'tr') return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n: Node | null = root;
  while (n) {
    if (n.nodeType === 3) {
      const p = n.parentElement?.tagName; const t = n as Text;
      if (p !== 'SCRIPT' && p !== 'STYLE' && I18N_DONE.get(t) !== t.data) { const v = tx(t.data); if (v !== t.data) t.data = v; I18N_DONE.set(t, t.data); }
    } else if (n.nodeType === 1) {
      const el = n as Element;
      for (const a of ['aria-label', 'placeholder', 'title']) { const v = el.getAttribute(a); if (v) { const nv = tx(v); if (nv !== v) el.setAttribute(a, nv); } }
    }
    n = w.nextNode();
  }
}
async function initLang() {
  document.documentElement.lang = LANG;
  if (LANG === 'tr') return;
  try { EN = await tfetch('en.json?v=' + APP_VERSION, {cache: 'no-cache'}).then(r => r.json()); } catch (e) { EN = {}; }
  txNode(document.body);
  new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') txNode(m.target); else m.addedNodes.forEach(a => txNode(a)); } })
    .observe(document.body, {subtree: true, childList: true, characterData: true});
}
(window as any).__miss = I18N_MISS;
function setLang(l: 'tr' | 'en') { localStore('masal_lang', l); location.reload(); }

/* ---------- şifreleme (bot ile aynı: PBKDF2-SHA256 + AES-GCM) ---------- */
const b64d=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)),b64e=u=>btoa(String.fromCharCode(...new Uint8Array(u)));
async function deriveKey(pw,salt,iter){const km=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:iter,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
const KEYS=new Map<string,Promise<CryptoKey>>(); // aynı tuz için anahtar bir kez türetilir (bot oturum boyunca aynı tuzu kullanır)
async function unseal(box: Sealed, pw: string): Promise<any> {const id=pw+'|'+box.salt+'|'+(box.iter||150000);
  if(!KEYS.has(id)){if(KEYS.size>20)KEYS.clear();KEYS.set(id,deriveKey(pw,b64d(box.salt),box.iter||150000))}
  let k:CryptoKey;try{k=await KEYS.get(id)}catch(e){KEYS.delete(id);throw e}
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:b64d(box.iv)},k,b64d(box.ct))))}
async function seal(obj: unknown, pw: string, iter = 150000): Promise<Sealed> {const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const k=await deriveKey(pw,salt,iter);const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},k,new TextEncoder().encode(JSON.stringify(obj)));
  return {enc:1,iter,salt:b64e(salt),iv:b64e(iv),ct:b64e(ct)}}
let pw=localStore('masal_pw')||'';
async function openLive(){
  if(!S.live_enc)return;
  const pub = S.live_public || {armed: false, paused: false};
  S.strategies.live = {locked: true,name:'Gerçek hesap',live:true,armed:pub.armed,paused:pub.paused,pnl_pct:0};
  if(!pw)return;
  try{const o=await unseal(S.live_enc,pw);S.strategies.live=o.strategy;S.okx=o.okx}
  catch(e){pw='';localStorage.removeItem('masal_pw');toast('Şifre uyuşmadı, gerçek hesap kilitli kaldı')}
}

// Bot kayıtları ayrı "data" dalında tutulur (site her turda yeniden yayınlanmasın diye)
/** Süre sınırlı istek: VPN ya da zayıf bağlantıda askıda kalan istek sonsuza kadar beklenmez. */
async function tfetch(url: string, opt: RequestInit = {}, ms = 8000): Promise<Response> {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, {...opt, signal: c.signal}); } finally { clearTimeout(t); }
}
const CACHE_KEY = 'masal_cache_';
/** Bot kayıtları sırayla üç kaynaktan denenir; hepsi başarısızsa telefonda saklanan son veri kullanılır. */
async function getData<T = any>(f: string): Promise<T> {
  const t = Date.now();
  const tries: [string, RequestInit][] = [];
  if (token) tries.push([`https://api.github.com/repos/${REPO.o}/${REPO.r}/contents/docs/data/${f}?ref=data&t=${t}`, {headers: {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github.raw+json'}, cache: 'no-store'}]);
  tries.push([`https://raw.githubusercontent.com/${REPO.o}/${REPO.r}/data/docs/data/${f}?t=${t}`, {cache: 'no-store'}]);
  for (const [u, o] of tries) {
    try { const r = await tfetch(u, o); if (r.ok) { const j = await r.json(); try { localStorage.setItem(CACHE_KEY + f, JSON.stringify(j)); } catch (e) {} return j; } } catch (e) {}
  }
  try { const c = localStorage.getItem(CACHE_KEY + f); if (c) { offlineData = true; return JSON.parse(c); } } catch (e) {}
  throw new Error('veri alınamadı');
}
let offlineData = false, retryTimer: ReturnType<typeof setTimeout> = null;
let lastLoad=0,dataSha='',dataTag='',lastB=0;
// Botun her kaydı "data" dalında yeni bir sürüm oluşturur; uygulama 2 saniyede bir bakar, değiştiyse hemen yeniler
async function watchData(){if(document.hidden||!S)return;
  // ETag ile sorulur: değişiklik yoksa GitHub 304 döner ve bu, saatlik istek hakkından düşmez (2 sn'de bir bakmak güvenli)
  if(token){try{const h:Record<string,string>={Authorization:'Bearer '+token,Accept:'application/vnd.github.sha'};if(dataTag)h['If-None-Match']=dataTag;
    const r=await tfetch(`https://api.github.com/repos/${REPO.o}/${REPO.r}/commits/data`,{headers:h,cache:'no-store'});
    if(r.status===304){syncMark(true);return}
    if(r.ok){dataTag=r.headers.get('ETag')||'';const sha=(await r.text()).trim();syncMark(true);if(dataSha&&sha!==dataSha)load(true);dataSha=sha}else syncMark(false)}catch(e){syncMark(false)}return}
  if(Date.now()-lastLoad>15000)load(true)}
setInterval(watchData,2000); // otomatik eşitleme her zaman açık: 2 sn'de bir buluta bakılır
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&S)load(true)});
async function load(quiet?: boolean) {lastLoad=Date.now();offlineData=false;clearTimeout(retryTimer);
  const btn=document.getElementById('reload');if(!quiet)btn.classList.add('spin');
  const err=document.getElementById('err');err.style.display='none';
  try{
    // açılışta son kayıtlı veri hemen gösterilir (bekleme yok), taze veri gelince yerine yazılır
    if(!S){try{const c=localStorage.getItem(CACHE_KEY+'summary.json');if(c){S=JSON.parse(c);B=JSON.parse(localStorage.getItem(CACHE_KEY+'backtest.json')||'null');await openLive();
      if(S.strategies.live)sel='live';if(!S.strategies[sel])sel=Object.keys(S.strategies)[0] as StrategyKey;render();hideSplash()}}catch(e){S=null}}
    // geçmiş test haftada bir değişir: 10 dakikada bir yeterli
    const needB=!B||Date.now()-lastB>6e5;
    const [s,b]=await Promise.all([getData('summary.json'),needB?getData('backtest.json').catch(()=>null):Promise.resolve(B)]);
    if(needB)lastB=Date.now();
    S=s;B=b;await openLive();
    syncMark(!offlineData);
    // dil ve tema buluttan: başka cihazda değiştirildiyse bu cihaz da uyar (az önce burada değiştirildiyse bekler)
    {const st=S.settings as any,recent=Date.now()-+(localStore('masal_pref_ts')||0)<180000;
     if(st&&!recent){if(st.theme&&st.theme!==themeMode())setTheme(st.theme);if(st.lang&&st.lang!==LANG){localStore('masal_pref_ts',String(Date.now()));setLang(st.lang);return}}}
    nMerge();
    if(offlineData){err.innerHTML=`Bağlantı kurulamadı; <b>${dt(S.updated)}</b> tarihli son veri gösteriliyor. Kendiliğinden yeniden deneniyor…`;err.style.display='block';retryTimer=setTimeout(()=>load(true),15000)}if(S.strategies.live)sel='live';if(!S.strategies[sel])sel = Object.keys(S.strategies)[0] as StrategyKey;render();pollMarket();startNotes();
  }catch(e){syncMark(false);console.error(e);err.textContent='Veriler alınamadı (bağlantı ya da VPN). Kendiliğinden yeniden deneniyor…';err.style.display='block';retryTimer=setTimeout(()=>load(true),10000)}
  finally{btn.classList.remove('spin');hideSplash();cloudUI()}
}

function render(){
  updLine();homeChecks();
  const L=S.strategies.live;
  {const m=document.getElementById('mode'),halt=L&&L.halted,real=L&&L.armed,want=orig?orig.live:S.settings?.live;
   const pending=L&&!halt&&want!==undefined&&!!want!==!!real;
   m.className='mode'+(halt?' halt':real?' real':'');
   if(pending)m.className='mode';
   m.innerHTML=pending?`<span class="mi">${ic('i-refresh')}</span><span><b>${want?'Gerçeğe':'Denemeye'}</b><small>geçiliyor…</small></span>`:halt?`<span class="mi">${ic('i-stop')}</span><span><b>Durdu</b><small>Acil fren</small></span>`
     :L&&L.paused?`<span class="mi">${ic('i-pause')}</span><span><b>Beklemede</b><small>Yeni alım yok</small></span>`
     :real?`<span class="mi">${ic('i-coins')}</span><span><b>Gerçek</b><small>OKX TR'de</small></span>`
     :`<span class="mi">${ic('i-flask')}</span><span><b>Deneme</b><small>Emir gitmez</small></span>`;
   m.onclick=()=>document.getElementById('openSet').click()}
  document.getElementById('foot').innerHTML='Fiyatlar uygulama açıkken OKX TR\'den anlık güncellenir; bot kesintisiz çalışır, yaklaşık 5 saniyede bir kontrol eder.<br>'+(L&&L.armed?'Ekrandaki rakamlar OKX TR hesabındaki gerçek işlemlerdir.':'Gerçek para kullanılmıyor; tüm işlemler sanal.');
  if(S.strategies.live&&sel!=='live')sel='live'; // sanal stratejiler kapalı: her zaman gerçek hesap
  const x=S.strategies[sel];
  const locked=!!x.locked;
  document.getElementById('chartSec').hidden=locked;
  if(locked){
    document.getElementById('hero').className='hero';
    document.getElementById('hero').innerHTML=`<div class="hh"><span class="hn">${ic('i-lock')}Gerçek hesap</span></div><div class="lock" style="margin-top:10px"><b>${ic('i-lock')}Veriler şifreli</b>
      <p>Bakiye ve işlemlerin herkese açık sayfada şifreli duruyor. Görmek için OKX'te API anahtarını oluştururken belirlediğin şifreyi (Passphrase) gir. Şifre sadece bu cihazda saklanır.</p>
      <input class="inp" id="pwIn" type="password" placeholder="OKX şifresi" autocomplete="off"><button class="btn primary" id="pwBtn" style="width:100%">${ic('i-lock')}Kilidi aç</button></div>`;
    document.getElementById('alerts').innerHTML='';
    document.getElementById('pwBtn').onclick=async()=>{const v = (document.getElementById('pwIn') as HTMLInputElement).value;if(!v)return toast('Şifreyi gir');
      try{const o=await unseal(S.live_enc,v);pw=v;localStore('masal_pw',v);S.strategies.live=o.strategy;S.okx=o.okx;render();toast('Kilit açıldı')}
      catch(e){toast('Şifre yanlış')}};
    ['positions','trades','coins'].forEach(id=>document.getElementById(id).innerHTML=`<div class="empty">${ic('i-lock')}<div>Kilitli</div></div>`);
    document.getElementById('nowSec').hidden=true;document.getElementById('kasa').innerHTML='';
    document.getElementById('logSec').hidden=true;
    renderBacktest();renderRules(x.risk||S.risk,null);renderMarket();return;
  }
  let al='';
  if(x.halted)al+=`<div class="alert red">${ic('i-power')}<div><b>Acil fren devrede.</b> ${x.halt_reason}. Bot bu stratejide yeni işlem açmıyor.</div></div>`;
  document.getElementById('alerts').innerHTML=al;
  renderMetrics(x);
  renderNow(x);
  renderKasa(x);
  renderChart();
  renderPositions(x);renderCoins(x);
  const tr=x.recent.slice(0,12);
  document.getElementById('trades').innerHTML=tr.length?tr.map(t=>{const sell=t.side==='SAT';
    return `<div class="row">${cico(t.inst,t.side,t.pnl<0)}
      <div class="mid"><b>${sym(t.inst)}${pq(t.inst)} ${sell?'satıldı':'alındı'}</b><span>${dt(t.ts)} · ${t.reason} · ${px(t.price)}</span></div>
      <div class="end"><b>${tl(t.amount,0)}</b>${sell?`<span class="plc ${cls(t.pnl)||'z'}">${sgn(t.pnl)} TL ${t.pnl>=0?'kâr':'zarar'}</span>`:`<span>harcandı</span>`}</div></div>`}).join('')
    :`<div class="empty">${ic('i-list')}<div>Henüz işlem yok. Bot fırsat bekliyor.</div></div>`;
  renderBacktest();
  renderLog(x);
  renderRules(x.risk||S.risk,x.cfg);
  renderMarket();
}

/* ---------- açıklamalar ("?" düğmeleri) ---------- */
const pp=(v,d=1)=>'%'+nf(v*100,Math.round(v*1000)%10?d:0);
function gloss(k: string): [string, string] {
  const L=S?.strategies?.live,c=(L&&!L.locked&&L.cfg)||null;
  const step=c?pp(c.step):'%1,5',tp=c?pp(c.lot_tp):'%4',stop=c?pp(c.stop):'%12',ml=c?c.max_lots:4,mc=c?c.max_coins:20,lot=c?tl(c.lot,0):'bir kademe',use=c?pp(c.max_use,0):'%40',cf=c?.coin_filter?pp(c.coin_filter):'%1',qt=S?.settings?.quote||S?.okx?.quote||'USDT';
  const G={
    nasil:['Bot nasıl alıp satar?',`${c?.instant?'<p>Bot <b>5 saniyede bir</b> fiyatlara bakar; fiyat alım seviyesine değdiği an alır. Alım seviyesi son kapanan 15 dakikalık mumlara göre hesaplanır.</p>':'<p>Bot <b>5 saniyede bir</b> piyasaya bakar, kararını <b>15 dakikalık mum</b> kapanınca verir.</p>'}
      <ul><li><b>Alım:</b> Bir coin son ${c?.sma_h||20} saatin ortalamasından <b>${step}</b> aşağı inince ${lot}'lik bir parça (kademe) alır.</li>
      <li><b>Düşerse:</b> ${step} düşüşte 2. kademeyi${c?.step3&&c.step3>c.step?`, ${pp(c.step3)} daha düşüşte 3. kademeyi`:''} alır; bir coinde en fazla <b>${ml}</b> kademe.${c&&((c.lot2??1)<1||(c.lot3??1)<1)?` Kademe tutarları: ${tl(c.lot,0)} → ${tl(c.lot*(c.lot2??1),0)} → ${tl(c.lot*(c.lot3??1),0)}.`:''}</li>
      <li><b>Satış:</b> Her kademe kendi alış fiyatının <b>${tp}</b> üstüne çıkınca ayrı satılır.</li>
      <li><b>Zarar kesme:</b> Ortalama maliyetin <b>${stop}</b> altına inerse o coindeki her şey satılır.</li>
      <li><b>Düşüş filtresi:</b> Coin bir günde ${cf}'den fazla geriliyorsa "düşen bıçak" sayılır, yeni alım bekletilir.</li></ul>
      <p>${qt==='TRY'?'Coinler <b>TRY paritesinden</b> alınır.':`Coinler <b>${qt} paritesinden</b> alınır; TL gerekirse otomatik ${qt}'ye çevrilir.`} Uygulamadaki bütün fiyat ve tutarlar <b>TL karşılığıdır</b>.</p>
      <p>Aynı anda en fazla <b>${mc}</b> coin tutulur ve bütçenin en fazla <b>${use}</b>'ı coine yatırılır; kalanı güvenlik payıdır.</p>`],
    yakin:['Alıma yakın coinler',`<p>Her satır bir coinin <b>alım fiyatına ne kadar uzak</b> olduğunu gösterir.</p>
      <ul><li><span class="chip m">%0,8 düşerse</span> fiyat bu kadar daha inerse bot alır.</li>
      <li><span class="chip g">Alım şartında</span> fiyat alım seviyesinde; ${c?.instant?'bot birkaç saniye içinde alır':'15 dakikalık mum bu seviyede kapanırsa bot alır'}.</li>
      <li><span class="chip a">Düşüş filtresi</span> coin hızlı düşüyor; düşüş yavaşlayana kadar alım bekletiliyor.</li>
      <li><span class="chip a">Şartta · bütçe dolu</span> fiyat uygun ama coinlere ayrılan para dolu; bir kademe satılınca alır.</li>
      <li><span class="chip a">Şartta · coin sınırı dolu</span> fiyat uygun ama aynı anda tutulabilecek coin sayısı dolu; elindeki bir coin satılınca alır.</li>
      <li><b>Alım</b> fiyatı bir eşiktir: fiyat bunun altına inince bot <b>o anki (daha düşük) fiyattan</b> alır.</li>
      <li><i class="kd">1 kademe</i> coin zaten elde; mavi yüzde kadar daha düşerse bir sonraki kademe alınır (<b>2. alım</b> fiyatı).</li></ul>
      <p>Şartta görünüp alınmıyorsa: ${c?.instant?'':'mum henüz kapanmamıştır, ya da '}bütçe sınırı / coin sayısı dolmuştur.</p>`],
    pozisyon:['Elimdeki coinler',`<ul><li><b>Alış → şimdi:</b> ortalama alış fiyatın ve şu anki fiyat.</li>
      <li><b>Çubuk:</b> solda kırmızı <b>zarar durdur</b>, sağda yeşil <b>kâr al</b> fiyatı. Yuvarlak, fiyatın şu an nerede olduğunu gösterir; ince çizgi alış fiyatın. Yuvarlak sağa gittikçe kâra yaklaşırsın.</li>
      <li><span class="shd">${ic('i-shield')}</span> <b>Borsa korumalı:</b> bu satış emirleri OKX'te bekliyor; bot ya da telefon kapalı olsa bile çalışır.</li>
      <li><b>Sağdaki renkli kutu:</b> şimdi satılsa ne kadar kâr (yeşil) ya da zarar (kırmızı) edeceğin.</li>
      <li><b>Elle satmak için</b> satırı sola kaydır ve kırmızı <b>Sat</b> düğmesine dokun; bot birkaç saniye içinde piyasa fiyatından satar.</li></ul>`],
    coinkz:['Coin bazında kâr/zarar',`<p>Her coin için şimdiye kadar elde edilen sonuç:</p>
      <ul><li><b>Büyük rakam:</b> satılan kademelerin kesinleşmiş sonucu + elde duran kısmın şu anki sonucu.</li>
      <li><b>Kapandı:</b> coin tamamen satıldı, sonuç kesin. <b>Elde:</b> henüz hiç satılmadı. <b>Açıkta:</b> elde kalan kısmın henüz kesinleşmemiş kâr/zararı.</li></ul>
      <p>Başlıktaki rakam bütün coinlerin toplamıdır.</p>`],
    use:['Coinlere ayrılan sınır',`<p>Bot bütçenin en fazla <b>${use}</b>'ını aynı anda coine yatırır. Çubuk bunun ne kadarının dolu olduğunu gösterir.</p>
      <p>Çubuk dolunca bot yeni coin almaz; bir kademe kârla satılınca yer açılır ve yeniden alım yapar. Bu sınır sert düşüşte paranın tamamının coinde kalmasını engeller.</p>`],
    kasa:['Kasa',`<p><b>Kasa</b>, bu iş için ayırdığın toplam para. <b>Botta aktif</b> kısmı bot kullanır, <b>yedek</b> kısmı bekler.</p><p>Bot kâr ettikçe kasadan kademeli ekleme yapar; zarardayken ekleme yapmaz.</p>`]
  };
  return G[k]||['',''];
}
/* ---------- bulut: verilerin GitHub'la eşitlenme durumu (üst çubuktaki bulut simgesi) ----------
   Bot her değişiklikte (en geç 30 sn'de bir) kayıtları buluta yedekler; uygulama birkaç saniyede bir kontrol eder. */
let syncOk = 0, syncBad = false;
function syncMark(ok: boolean) { if (ok) { syncOk = Date.now(); syncBad = false; } else syncBad = true; cloudUI(); }
function cloudUI() {
  const b = document.getElementById('reload'); if (!b) return;
  const off = syncBad || !syncOk || Date.now() - syncOk > 90000;
  b.classList.toggle('cok', !off); b.classList.toggle('coff', off);
  b.querySelector('use').setAttribute('href', off ? '#i-cloud-off' : '#i-cloud');
  b.setAttribute('aria-label', off ? 'Bulut: bağlantı yok' : 'Bulut: eşitlendi');
}
setInterval(cloudUI, 5000);
function openCloud() {
  const q = document.getElementById('qsh'); q.dataset.n = ''; qHead('i-cloud', 'Kapat');
  const off = syncBad || !syncOk || Date.now() - syncOk > 90000, p = (n: number) => String(n).padStart(2, '0');
  const tm = (t: number) => { if (!t) return '—'; const d = new Date(t); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
  document.getElementById('qTitle').textContent = 'Bulut eşitleme';
  document.getElementById('qText').innerHTML = `<div class="cld ${off ? 'off' : 'ok'}">${ic(off ? 'i-cloud-off' : 'i-cloud')}<b>${off ? 'Bağlantı yok, son veri gösteriliyor' : 'Eşitlendi'}</b></div>
    <div class="kvl"><span>Son eşitleme</span><b>${tm(syncOk)}</b></div>
    <div class="kvl"><span>Botun son kaydı</span><b>${tm(S?.updated || 0)}</b></div>
    <div class="kvl"><span>Otomatik eşitleme</span><b class="up">Her zaman açık · ${token?2:15} sn</b></div>
    ${(S as any)?.perf?.turn?`<div class="kvl"><span>Botun tur süresi</span><b>${nf((S as any).perf.turn,1)} sn</b></div>`:''}
    <p class="cldn">Bot her işlemde ve en geç 30 saniyede bir bütün kayıtları buluta (GitHub) yedekler. Uygulama buluta sürekli bakar, değişiklik olunca hemen yeniler; fiyatlar 2 saniyede bir borsadan canlı gelir. Ayarlar <b>Kaydet</b>'e basınca buluta yazılır.</p>
    <button class="btn" id="syncNow" style="width:100%;margin-bottom:10px">${ic('i-refresh')}Şimdi eşitle</button>`;
  q.hidden = false;
  document.getElementById('syncNow').onclick = async () => { q.hidden = true; await load(); toast(syncBad ? 'Eşitlenemedi, bağlantını kontrol et' : 'Eşitlendi'); };
}
/* ---------- bildirimler: telefona giden ntfy mesajları uygulama içinde de anlık görünür ----------
   Konu adı ayarlarda şifreli durur; gerçek hesabın kilidi açıksa (şifre bu cihazdaysa) çözülür ve
   ntfy'ın canlı akışına (SSE) bağlanılır. Son 24 saat listelenir, yeni gelen mesaj ekranda da belirir. */
type NMsg = {id: string; time: number; title: string; message: string; tags?: string[]};
/* Bildirimler buluttan gelir: bot gönderdiği her bildirimi gerçek hesabın şifreli kaydına yazar (her cihaz aynı listeyi görür).
   Uygulama açıkken ntfy canlı akışından gelenler de anında eklenir. Süre seçimi 1/6/12/24 saat. */
const NOTES: NMsg[] = [];
let nES: EventSource | null = null, nTopic = '', nHours = +(localStore('masal_nh') || 24);
const nSeen = () => +(localStore('masal_nseen') || 0);
const nClr = () => Math.max(+(S?.settings?.notify?.cleared || 0), +(localStore('masal_nclr') || 0)); // temizleme zamanı bulutta (ayarlarda)
const nKey = (m: {title: string; message: string}) => m.title + '|' + m.message;
/** Buluttaki listeyi (bot kaydı) canlı akıştan gelenlerle birleştirir; aynı bildirim iki kez görünmez. */
function nMerge() {
  const cloud = ((S?.strategies?.live as any)?.notifs || []) as {t: number; title: string; message: string; tags?: string[]}[];
  for (const c of cloud) {
    const time = Math.round(c.t / 1000);
    if (NOTES.some(x => nKey(x) === nKey(c) && Math.abs(x.time - time) < 120)) continue;
    NOTES.push({id: 'c' + c.t + c.title, time, title: c.title, message: c.message, tags: c.tags});
  }
  NOTES.sort((a, b) => b.time - a.time); if (NOTES.length > 200) NOTES.length = 200; nBadge();
}
const nVisible = () => NOTES.filter(m => m.time > nClr() && m.time > Date.now() / 1000 - 86400);
function nKind(t?: string[]): [string, string] {
  const g = t || [];
  if (g.includes('rotating_light') || g.includes('warning')) return ['i-info', 'r'];
  if (g.includes('shopping_cart')) return ['i-coins', 'b'];
  if (g.includes('moneybag') || g.includes('trophy') || g.includes('white_check_mark')) return ['i-check', 'g'];
  return ['i-bell', 'm'];
}
function nBadge() {
  const b = document.getElementById('bellBtn'), n = document.getElementById('bellN'); if (!b) return;
  b.hidden = !nTopic; const k = nVisible().filter(m => m.time > nSeen()).length;
  n.hidden = !k; n.textContent = k > 9 ? '9+' : String(k);
}
async function startNotes() {
  if (nES || !pw) return;
  try {
    const st = (await tfetch('ayarlar.json?t=' + Date.now()).then(r => r.json())) as Settings;
    const tp = st?.notify?.topic; if (!st?.notify?.enabled || !tp) return;
    nTopic = typeof tp === 'object' ? await unseal(tp as any, pw) : String(tp);
  } catch (e) { return; }
  const t0 = Date.now() / 1000;
  nES = new EventSource(`https://ntfy.sh/${encodeURIComponent(nTopic)}/sse?since=24h`);
  nES.onmessage = ev => {
    let m: any; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.event !== 'message' || NOTES.some(x => x.id === m.id || (nKey(x) === nKey({title: m.title || 'Masal', message: m.message || ''}) && Math.abs(x.time - m.time) < 120))) return;
    NOTES.push({id: m.id, time: m.time, title: m.title || 'Masal', message: m.message || '', tags: m.tags});
    NOTES.sort((a, b) => b.time - a.time); if (NOTES.length > 200) NOTES.length = 200;
    if (m.time >= t0 - 5) { toast(`${m.title || 'Masal'} · ${(m.message || '').split('\n')[0]}`); setTimeout(() => load(true), 1500); }
    nBadge(); if (!document.getElementById('qsh').hidden && document.getElementById('qsh').dataset.n) openNotes();
  };
  nBadge();
}
function qHead(i: string, b: string) {document.querySelector('#qIco use').setAttribute('href', '#' + i); document.getElementById('qOk').textContent = b;}
function openNotes() {
  const q = document.getElementById('qsh'); q.dataset.n = '1'; qHead('i-bell', 'Kapat');
  document.getElementById('qTitle').textContent = 'Bildirimler';
  const from = Date.now() / 1000 - nHours * 3600, list = nVisible().filter(m => m.time > from), p = n => String(n).padStart(2, '0');
  const bar = `<div class="nbar"><div class="seg" id="nRange">${[1, 6, 12, 24].map(h => `<button type="button" data-h="${h}" class="${h === nHours ? 'on' : ''}">${h} sa</button>`).join('')}</div>
    <button type="button" class="nclr" id="nClear"${list.length ? '' : ' disabled'}>${ic('i-trash')}Temizle</button></div>`;
  document.getElementById('qText').innerHTML = bar + (list.length ? `<div class="nlist">${list.map(m => {const [i, c] = nKind(m.tags), d = new Date(m.time * 1000);
    return `<div class="nrow${m.time > nSeen() ? ' new' : ''}"><span class="ni ${c}">${ic(i)}</span><div><b>${m.title}</b><p>${m.message.replace(/</g, '&lt;')}</p></div><time>${p(d.getHours())}:${p(d.getMinutes())}</time></div>`}).join('')}</div>`
    : `<div class="empty">${ic('i-bell')}<div>Son ${nHours} saatte bildirim yok</div></div>`);
  q.hidden = false;
  document.querySelectorAll<HTMLElement>('#nRange button').forEach(b => b.onclick = () => {nHours = +b.dataset.h; localStore('masal_nh', String(nHours)); openNotes()});
  document.getElementById('nClear').onclick = async () => {const top = Math.ceil(Date.now() / 1000);
    localStore('masal_nclr', String(top)); NOTES.length = 0; openNotes();
    // temizleme bütün cihazlarda geçerli olsun: zaman ayarlara (buluta) yazılır
    await cloudPatch(o => { o.notify = {...(o.notify || {} as any), cleared: top}; }, 'Bildirim geçmişi temizlendi');
    toast('Bildirim geçmişi temizlendi')};
  const v = nVisible(); if (v.length) localStore('masal_nseen', String(v[0].time)); nBadge();
}
document.getElementById('bellBtn').onclick = openNotes;
function openGloss(k: string){const [t,h]=gloss(k);if(!t)return;
  document.getElementById('qsh').dataset.n='';qHead('i-info','Anladım');document.getElementById('qTitle').textContent=t;document.getElementById('qText').innerHTML=h;document.getElementById('qsh').hidden=false}
document.addEventListener('click',e=>{const q=(e.target as HTMLElement).closest<HTMLElement>('.qm');if(q){e.preventDefault();e.stopPropagation();openGloss(q.dataset.q)}});
document.getElementById('qOk').onclick=()=>document.getElementById('qsh').hidden=true;
document.getElementById('qsh').onclick=e=>{if(e.target===e.currentTarget)(e.currentTarget as HTMLElement).hidden=true};
document.querySelectorAll<HTMLElement>('.adv .acch').forEach(b=>b.onclick=()=>b.parentElement.classList.toggle('open'));

/* ---------- "Bot şimdi ne yapıyor" ---------- */
let nowAll=false;
function nextBar(){const m=15*6e4,t=Math.ceil((Date.now()+1000)/m)*m,d=new Date(t);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
function renderNow(x: Strategy){
  const sec=document.getElementById('nowSec'),box=document.getElementById('now');
  if(!x.live){sec.hidden=true;return}
  sec.hidden=false;
  const w=x.watch,c=x.cfg,used=w?w.used:x.positions.reduce((a,p)=>a+p.cost,0);
  let st:[string,string,string,string];
  if(x.halted)st=['red','i-power','Durdu: acil fren devrede',`${x.halt_reason||''}. Yeni işlem açılmıyor.`];
  else if(x.target_done)st=['','i-flag','Kâr hedefi tuttu',`${tl(parseFloat(x.target_done),0)} hedefine ulaşıldı; bütün coinler satıldı, bot durdu. Devam etmek için Ayarlar'dan hedefi kapat ya da yükselt.`];
  else if(x.paused)st=['amb','i-pause','Beklemede: yeni alım yapmıyor','Ayarlardan durdurdun. Elindeki coinlerin kâr al / zarar durdur koruması sürüyor.'];
  else if(x.blocked_today)st=['amb','i-stop','Bugünlük durdu','Günlük zarar sınırına ulaşıldı; yarın yeniden alım yapar. Satışlar sürüyor.'];
  else if(w&&!w.room)st=['amb','i-layers','Bütçe sınırı dolu',`Coinlere ayrılan ${tl(w.cap,0)}'nin ${tl(used,0)}'si kullanımda. Bir kademe kârla satılınca yeniden alır.`];
  else if(w&&w.coins>=w.max_coins)st=['amb','i-layers','Coin sayısı dolu',`Aynı anda en fazla ${w.max_coins} coin tutuluyor. Biri satılınca yeni coin alır.`];
  else st=['','i-target',x.armed?'Fırsat kolluyor':'Fırsat kolluyor (deneme)',
    c?`${w?w.items.length+' coini':'Coinleri'} izliyor. Bir coin ${c.sma_h||20} saatlik ortalamasının ${pp(c.step)} altına inince ${tl(c.lot,0)} alır, ${pp(c.lot_tp)} kârda satar.`
     :'Coinleri izliyor; strateji şartı oluşunca alım yapar.'];
  let h=`<div class="st ${st[0]}"><span class="si">${ic(st[1])}</span><div><b>${st[2]}</b><p>${st[3]}</p></div></div>`;
  if(w&&w.items.length){
    const items=w.items.map(it=>{const cur=livePrice(it.i,it.p);return {...it,cur,gap:(cur/it.t-1)*100}}).sort((a,b)=>(a.f?1:0)-(b.f?1:0)||a.gap-b.gap);
    const show=nowAll?items:items.slice(0,5);
    // alım şartı var ama alım yapılamıyorsa gerçek sebep yazılır (elde olan coine kademe eklemeyi coin sınırı engellemez)
    const why=(it:{h?:number})=>x.halted?'acil fren':x.paused?'beklemede':x.blocked_today?'bugünlük durdu':!w.room?'bütçe dolu':(!it.h&&w.coins>=w.max_coins)?'coin sınırı dolu':'';
    h+=`<div class="wh">${ic('i-list')}Alıma en yakın coinler<button class="qm" data-q="yakin" aria-label="Açıklama">?</button></div><div class="list">`;
    h+=show.map(it=>{let chip:string;
      if(it.f)chip=`<span class="chip a">${ic('i-pause')}Düşüş filtresi</span>`;
      else if(it.gap<=0){const r=why(it);chip=r?`<span class="chip a">${ic('i-layers')}Şartta · ${r}</span>`:`<span class="chip g">${ic('i-check')}Alım şartında</span>`}
      else chip=`<span class="chip ${it.h?'b':'m'}">%${nf(it.gap,it.gap<10?1:0)} düşerse</span>`;
      const near=it.f||it.gap<=0?'':`<div class="near"><i style="width:${Math.max(4,Math.min(100,100-it.gap*20)).toFixed(0)}%"></i></div>`;
      return `<div class="row wrow">${cico(it.i)}<div class="mid"><b>${sym(it.i)}${pq(it.i)}${it.h?`<i class="kd">${it.h} kademe</i>`:''}</b>
        <div class="pv"><span><em>Şimdi</em>${px(it.cur)}</span><span><em>${it.h?`${it.h+1}. alım`:'Alım'}</em>${px(it.t)}</span></div></div><div class="end">${chip}${near}</div></div>`}).join('');
    h+='</div>';
    if(items.length>5)h+=`<button class="more" id="nowMore">${nowAll?'Daha az göster':`Tümünü göster (${items.length} coin)`}</button>`;
  }
  h+=c?.instant?`<div class="nf">${ic('i-clock')}Anlık alım açık: fiyat alım seviyesine değdiği an alır (5 sn'de bir kontrol)</div>`
    :`<div class="nf">${ic('i-clock')}Sonraki karar ${nextBar()}'te (15 dakikalık mum kapanışı) · fiyatlar 5 sn'de bir kontrol edilir</div>`;
  box.innerHTML=h;
  const mb=document.getElementById('nowMore');if(mb)mb.onclick=()=>{nowAll=!nowAll;renderNow(x)};
}

function updLine(){
  const p=(n,l=2)=>String(n).padStart(l,'0');
  const live=lastTick?(()=>{const d=new Date(lastTick);return `<b class="up">● Canlı ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}</b> · `})():'';
  let bot='Bot henüz çalışmadı';
  if(S?.updated){const sec=Math.max(0,Math.round((Date.now()-S.updated)/1000));
    bot=sec<=180?`Bot çalışıyor · son tur ${sec<60?sec+' sn':Math.round(sec/60)+' dk'} önce`
      :`<b class="dn">Bot sessiz · ${ago(S.updated)}</b>`}
  document.getElementById('updated').innerHTML=live+bot;
}
function volTxt(inst){const v=LP[inst]?.vol;return v==null?'':v>=1e9?nf(v/1e9,1)+'\u00a0Mr\u00a0TL':v>=1e6?nf(v/1e6,1)+'\u00a0Mn\u00a0TL':nf(v/1e3,0)+'\u00a0B\u00a0TL'}
function livePrice(inst,fallback){return LP[inst]?.last??fallback}
// Elde tutulan coinin değeri: şimdi satılsa alınacak fiyat (alıcıların en iyi teklifi). Az işlem gören TL paritelerinde son işlem fiyatı yanıltır.
function sellPrice(inst,fallback){return LP[inst]?.bid||LP[inst]?.last||fallback}
function liveEquity(x){return x.cash+x.positions.reduce((a,p)=>a+p.qty*sellPrice(p.inst,p.price),0)}

function renderMetrics(x: Strategy){
  const eq=liveEquity(x),pnl=eq-x.start_cash,pct=(eq/x.start_cash-1)*100,today=x.today_pnl+(eq-x.equity);
  const inCoins=eq-x.cash,live=sel==='live';
  const hero=document.getElementById('hero');hero.className='hero'+(live?'':' virt');
  const tag=live?(x.armed?`<span class="pill real"><i></i>Gerçek para</span>`:`<span class="pill demo">${ic('i-flask')}Deneme</span>`):`<span class="pill virt">${ic('i-layers')}Sanal</span>`;
  const big=nf(eq,2).split(',');
  let h=`<div class="hh"><span class="hn">${ic(live?'i-wallet':ICON[sel])}${live?'Gerçek hesap':x.name}</span>${tag}
    </div>
    <div class="big">${big[0]}<small>,${big[1]} TL</small></div>
    <div class="chg"><span class="${cls(pnl)}"><em>Toplam</em>${sgn(pnl)} TL · ${spc(pct)}</span><span class="${cls(today)}"><em>Bugün</em>${sgn(today)} TL</span></div>
    <div class="hk"><div><span>Boşta nakit</span><b>${tl(x.cash,0)}</b></div><div><span>Coinlerde</span><b>${tl(inCoins,0)}</b></div>
      <div><span>Kazanma</span><b>${x.win_rate==null?'—':'%'+nf(x.win_rate,0)}</b></div></div>`;
  const w=x.watch;
  if(live&&w&&w.cap){const used=x.positions.reduce((a,p)=>a+p.cost,0),r=Math.min(100,used/w.cap*100);
    h+=`<div class="use"><div class="ul">Coinlere ayrılan sınır<button class="qm" data-q="use" aria-label="Açıklama">?</button><b>${tl(used,0)} / ${tl(w.cap,0)}</b></div>
      <div class="ub"><i class="${w.room?'':'full'}" style="width:${r.toFixed(1)}%"></i></div>
      <div class="uh">${x.positions.length}/${w.max_coins} coin · ${x.trades} kapanan işlem · başlangıç ${tl(x.start_cash,0)}</div></div>`}
  else h+=`<div class="use">${live?'':`<div class="uh" style="color:var(--text);font-size:12.5px;line-height:1.45">${x.desc}</div>`}<div class="uh">${x.trades} kapanan işlem · başlangıç ${tl(x.start_cash,0)}${live?'':' (sanal para)'}</div></div>`;
  hero.innerHTML=h;
  renderAssets(x,eq);
}
/** Varlık özeti: yatırdığın toplam para ile şu an elindeki her şey (bot + kasadaki yedek) yan yana. */
function renderAssets(x: Strategy, eq: number){
  const box=document.getElementById('assets');if(!box)return;
  const kasa=+((x as any).kasa||S?.settings?.kasa||0);
  if(sel!=='live'||!kasa){box.hidden=true;return}
  const reserve=Math.max(0,kasa-x.start_cash),now=eq+reserve,net=now-kasa,inCoins=eq-x.cash;
  const T=S?.settings?.target as any;
  let tgt='';
  if(T?.on&&T.amount>0){const total=T.mode==='total',cur=total?now:now-kasa,goal=+T.amount,r=Math.max(0,Math.min(100,cur/goal*100));
    tgt=`<div class="ast"><div class="ul">${total?'Kasa dahil hedef':'Kâr hedefi'}<b>${tl(cur,0)} / ${tl(goal,0)}</b></div>
      <div class="ub"><i class="tg" style="width:${r.toFixed(1)}%"></i></div><div class="uh">Hedefe ${tl(Math.max(0,goal-cur),0)} kaldı · %${nf(r,0)}</div></div>`}
  box.hidden=false;
  box.innerHTML=`<div class="ah">${ic('i-wallet')}<b>Varlık özeti</b><span>bütün paran</span></div>
    <div class="a2"><div><span>Yatırdığın</span><b>${tl(kasa,0)}</b></div><div><span>Şu an hepsi</span><b>${tl(now,0)}</b></div>
      <div><span>Fark</span><b class="${cls(net)}">${sgn(net)} TL</b></div></div>
    <div class="a3"><span>Botta nakit <b>${tl(x.cash,0)}</b></span><span>Coinlerde <b>${tl(inCoins,0)}</b></span><span>Kasada yedek <b>${tl(reserve,0)}</b></span></div>${tgt}`;
}

const ICON_BAD = new Set<string>(), ICON_OK = new Set<string>();
// Coinin hangi paritede alınıp satıldığını gösteren küçük etiket (TRY, USDT, USDC, EUR)
function pq(inst: string): string {const q=String(inst).split('-')[1]||'';return q?`<span class="pq q-${q}">${q}</span>`:''}
function cico(inst: string, side?: Side, loss?: boolean): string {const b=sym(inst),t=b.slice(0,4),lc=b.toLowerCase();
  const img=ICON_BAD.has(lc)?'':`<img class="${ICON_OK.has(lc)?'ok':''}" src="https://static.okx.com/cdn/oksupport/asset/currency/icon/${lc}.png" alt="" onload="ICON_OK.add('${lc}');this.classList.add('ok')" onerror="ICON_BAD.add('${lc}');this.remove()">`;
  const sd=side?`<i class="sd ${side==='SAT'?'sat'+(loss?' l':''):'al'}">${side}</i>`:'';
  return `<div class="coin${t.length>3?' sm':''}">${t}${img}${sd}</div>`}
function renderCoins(x){
  const box=document.getElementById('coins'),sumEl=document.getElementById('coinSum');
  const list=(x.coins||[]).map(c=>{const cur=c.open_qty?sellPrice(c.inst,c.price):0,op=c.open_qty?c.open_qty*cur-c.open_cost:0;return {...c,op,tot:c.realized+op}}).sort((a,b)=>b.tot-a.tot);
  if(!list.length){box.innerHTML=`<div class="empty">${ic('i-coins')}<div>Henüz işlem yok; ilk alımdan sonra her coin burada ayrı görünür.</div></div>`;sumEl.textContent='';return}
  const T=list.reduce((a,c)=>a+c.tot,0);sumEl.className='hsum '+cls(T);sumEl.textContent=sgn(T)+' TL';
  box.innerHTML=list.map(c=>{const parts=[];
    if(c.sells)parts.push(`${c.sells} satış`);else parts.push(`${c.buys} alım`);
    if(c.bought)parts.push(tl(c.bought,0)+' alındı');
    // sağ alt kısa: kapandı / elde / açıktaki kâr-zarar (sağ sütun dar kalsın, sol satır bölünmesin)
    const det=c.open_qty?(c.sells?`açıkta ${sgn(c.op)}`:'elde'):'kapandı';
    return `<div class="row">${cico(c.inst)}
      <div class="mid"><b>${sym(c.inst)}${pq(c.inst)}</b><span>${parts.join(' · ')}</span></div>
      <div class="end"><b class="${cls(c.tot)}">${sgn(c.tot)} TL</b><span>${det}</span></div></div>`}).join('');
}
// Satırı sola kaydırınca "Sat" düğmesi çıkar (sadece gerçek hesapta). Kaydırılırken liste yenilenmez.
let swOpen='',swDrag=false,swJust=0;const SELLING:Record<string,number>={};
function renderPositions(x){
  if(swDrag)return;
  const pos=x.positions,ps=document.getElementById('posSum'),canSell=sel==='live'&&!!x.armed;
  for(const k in SELLING)if(!pos.some(p=>p.inst===k))delete SELLING[k]; // satıldı: "Satılıyor" kalksın
  {const T=pos.reduce((a,p)=>a+p.qty*sellPrice(p.inst,p.price)-p.cost,0);ps.className='hsum '+cls(T);ps.textContent=pos.length?`${pos.length} coin · ${sgn(T)} TL`:''}
  document.getElementById('positions').innerHTML=pos.length?pos.map(p=>{const cur=sellPrice(p.inst,p.price),val=p.qty*cur,pl=val-p.cost,plp=(val/p.cost-1)*100;
    const prot=p.protected===true?`<span class="shd" title="Borsa korumalı">${ic('i-shield')}</span>`:p.protected===false?`<span class="shd no" title="Koruma bekliyor">${ic('i-shield')}</span>`:'';
    let rng='';
    if(p.tp&&p.sl&&p.tp>p.sl){const lg=(px(p.sl)+px(p.tp)).length>14,k=v=>Math.max(0,Math.min(100,(v-p.sl)/(p.tp-p.sl)*100));
      rng=`<div class="rng"><i class="av" style="left:${k(p.avg).toFixed(1)}%"></i><i class="mk ${cls(pl)}" style="left:${k(cur).toFixed(1)}%"></i></div>
        <div class="rngl"><em class="dn">${lg?'Zarar':'Zarar durdur'} ${px(p.sl)}</em><em class="up">${lg?'Kâr':'Kâr al'} ${px(p.tp)}</em></div>`}
    const row=`<div class="row pos${canSell?' swc':''}">${cico(p.inst)}
      <div class="mid"><b>${sym(p.inst)}${pq(p.inst)}${prot}${p.lots>1?`<i class="kd">${p.lots} kademe</i>`:''}</b><span>Alış ${px(p.avg)} → satış ${px(cur)}<br>${ago(p.since)} alındı${volTxt(p.inst)?` · hacim ${volTxt(p.inst)}`:''}</span>${rng}</div>
      <div class="end"><b>${tl(val,0)}</b><span class="plc ${cls(pl)||'z'}">${sgn(pl)} TL</span><span class="plp ${cls(pl)}">${spc(plp)}</span></div></div>`;
    return canSell?`<div class="swr${swOpen===p.inst?' open':''}${SELLING[p.inst]?' busy':''}" data-i="${p.inst}"><button class="swb" data-sell="${p.inst}">${ic('i-sell')}${SELLING[p.inst]?'Satılıyor':'Sat'}</button>${row}</div>`:row}).join('')
    :`<div class="empty">${ic('i-box')}<div>Şu an açık pozisyon yok</div></div>`;
}
{const box=document.getElementById('positions');let sx=0,sy=0,el:HTMLElement=null,dx=0,lock='';
  const start=(x,y,t)=>{const w=(t as HTMLElement).closest<HTMLElement>('.swr');if(!w)return;el=w;sx=x;sy=y;dx=0;lock='';swDrag=true;w.classList.add('drag')};
  const move=(x,y,ev)=>{if(!el)return;const ddx=x-sx,ddy=y-sy;if(!lock)lock=Math.abs(ddx)>8&&Math.abs(ddx)>Math.abs(ddy)?'x':(Math.abs(ddy)>8?'y':'');
    if(lock!=='x')return;ev.preventDefault?.();swDrag=true;const base=el.classList.contains('open')?-88:0;dx=Math.min(0,Math.max(-110,base+ddx));
    (el.querySelector('.swc') as HTMLElement).style.transform=`translateX(${dx}px)`};
  const end=()=>{if(!el){swDrag=false;return}const c=el.querySelector('.swc') as HTMLElement;c.style.transform='';el.classList.remove('drag');
    if(lock==='x'){swOpen=dx<-44?el.dataset.i:'';box.querySelectorAll<HTMLElement>('.swr').forEach(w=>w.classList.toggle('open',w.dataset.i===swOpen))}
    if(lock==='x')swJust=Date.now();el=null;swDrag=false;lock=''};
  box.addEventListener('touchstart',e=>start(e.touches[0].clientX,e.touches[0].clientY,e.target),{passive:true});
  box.addEventListener('touchmove',e=>move(e.touches[0].clientX,e.touches[0].clientY,e),{passive:false});
  box.addEventListener('touchend',end);box.addEventListener('touchcancel',end);
  box.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')start(e.clientX,e.clientY,e.target)});
  box.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'&&e.buttons)move(e.clientX,e.clientY,e)});
  window.addEventListener('pointerup',e=>{if(e.pointerType==='mouse')end()});
  box.addEventListener('click',e=>{const b=(e.target as HTMLElement).closest<HTMLElement>('.swb');if(b){sellCoin(b.dataset.sell);return}
    if(Date.now()-swJust<400)return; // kaydırmanın bıraktığı tıklama satırı kapatmasın
    if(swOpen&&!(e.target as HTMLElement).closest('.swr.open .swb')){swOpen='';box.querySelectorAll('.swr.open').forEach(w=>w.classList.remove('open'))}});
}
// Tek coini sat: ayarlar.json'a satış isteği yazılır, bot ~5 sn içinde piyasa fiyatından satar
async function sellCoin(inst: string, retry = true){
  if(SELLING[inst]&&retry)return;
  if(!token){toast('Satmak için önce Ayarlar\'dan GitHub bağlantısını kur');return}
  SELLING[inst]=Date.now();swOpen='';if(S)render();
  try{
    const cur=await tfetch(API+'?t='+Date.now(),{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'},cache:'no-store'}).then(r=>{if(!r.ok)throw r.status;return r.json()});
    const data=JSON.parse(decodeURIComponent(escape(atob(cur.content.replace(/\n/g,'')))));
    // Az önce başka bir coin için istek verildiyse o da listede kalsın (arka arkaya iki satış birbirini silmesin)
    const p=data.sell,keep:string[]=p&&Date.now()-(p.ts||0)<90000?(p.insts||[]):[];
    data.sell={ts:Date.now(),insts:[...new Set([...keep,inst])]};
    const body={message:'Uygulamadan satış: '+inst,content:btoa(unescape(encodeURIComponent(JSON.stringify(data,null,2)+'\n'))),sha:cur.sha,branch:'main'};
    const r=await tfetch(API,{method:'PUT',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify(body)});
    if(r.status===409&&retry)return sellCoin(inst,false); // aynı anda başka kayıt: güncel hâlle bir kez daha
    if(!r.ok)throw r.status;sha=(await r.json()).content.sha;if(orig)orig.sell=data.sell;if(draft)draft.sell=data.sell;
    toast(`${sym(inst)} satış isteği gönderildi; bot birkaç saniye içinde satar.`);
  }catch(e){delete SELLING[inst];if(S)render();toast('Satış isteği gönderilemedi ('+e+'), tekrar dene');return}
  // coin listeden düşünce "Satılıyor" kendiliğinden kalkar (renderPositions); 2 dakikada satılmazsa düğme geri gelir
  setTimeout(()=>{if(SELLING[inst]){delete SELLING[inst];if(S)render()}},120000);
}

function renderRules(R: Risk, c?: GridCfg | null){
  const rows=c?[
    ['i-coins',(c.lot2??1)===1&&(c.lot3??1)===1?tl(c.lot,0):`${nf(c.lot,0)}·${nf(c.lot*(c.lot2??1),0)}·${tl(c.lot*(c.lot3??1),0)}`,'1., 2. ve 3. kademe tutarı'],
    ['i-layers',c.max_coins+' coin','Aynı anda en fazla'],
    ['i-grid',c.max_lots+' kademe','Bir coinde en fazla'],
    ['i-pnl',pp(c.lot_tp)+' kâr','Her kademe ayrı satılır'],
    ['i-stop',pp(c.stop)+' zarar','Ortalamanın altına inerse hepsini satar'],
    ['i-wallet',pp(c.max_use,0)+' bütçe','Aynı anda coinde en fazla'],
    ['i-calx',tl(R.daily_loss_limit,0),'Günlük kayıp sınırı'],
    ['i-power',tl(R.kill_switch,0),'Altına inerse acil fren']
  ]:[
    ['i-coins',tl(R.trade_size,0),'İşlem başına en fazla'],
    ['i-layers',R.max_positions+' pozisyon','Aynı anda en fazla'],
    ['i-stop','%'+nf(R.stop_loss*100,1)+' zarar','Bu noktada otomatik satar'],
    ['i-calx',tl(R.daily_loss_limit,0),'Günlük kayıp sınırı'],
    ['i-power',tl(R.kill_switch,0),'Altına inerse acil fren']
  ];
  rows.push(['i-info','%'+nf((S.fee+S.slippage)*100,2),'Komisyon + kayma (tek yön)']);
  document.getElementById('rules').innerHTML=rows.map(([i,b,s])=>`<div class="rule"><div class="ic">${ic(i)}</div><div><b>${b}</b><span>${s}</span></div></div>`).join('');
  document.getElementById('rulesSum').textContent=c?`Zarar kes ${pp(c.stop)} · acil fren ${tl(R.kill_switch,0)} · günlük sınır ${tl(R.daily_loss_limit,0)}`:`Zarar kes %${nf(R.stop_loss*100,1)} · acil fren ${tl(R.kill_switch,0)}`;
}

/* ---------- anlık piyasa: uygulama açıkken OKX TR'den doğrudan ---------- */
const LP: Record<string, Ticker> = {};let mkTimer: ReturnType<typeof setTimeout> = null, mkBusy = false, lastTick = 0;
function marketList(){const x=S?.strategies?.[sel];const held=x&&!x.locked?x.positions.map(p=>p.inst):[];
  return [...new Set([...held,...(S?.universe||[])])]}
async function pollMarket(){
  clearTimeout(mkTimer);
  if(!S)return;
  if(document.hidden){mkTimer=setTimeout(pollMarket,3000);return}
  if(!mkBusy){mkBusy=true;
    try{
      const list=new Set(marketList());
      // tek istekle OKX TR'deki tüm TL paritelerinin anlık fiyatı ve 24 saatlik hacmi
      const r=await tfetch('https://tr.okx.com/api/v5/market/tickers?instType=SPOT',{cache:'no-store'},6000).then(r=>r.json()).catch(()=>null);
      const all=r?.data||[],byId=new Map<string,any>(all.map(t=>[t.instId,t])),L_=i=>+(byId.get(i)?.last||0),usd=L_('USDT-TRY');
      // Fiyatlar TL karşılığıyla: USDT kuru USDT-TRY'den, USDC ve EUR farkı düşük USDT pariteleri üzerinden
      const K={TRY:1,USDT:usd,USDC:usd*L_('USDC-USDT'),EUR:L_('USDT-EUR')?usd/L_('USDT-EUR'):0};
      const rows=all.filter(t=>K[String(t.instId).split('-')[1]]);
      okxDown=!rows.length;
      if(okxDown&&!lastTick){const tg=document.getElementById('liveTag');tg.innerHTML='<i></i>Erişilemiyor';tg.classList.remove('on')}
      rows.forEach(t=>{const inst=t.instId,k=K[inst.split('-')[1]],last=+t.last*k;if(!last)return;const prev=LP[inst]?.last;
        LP[inst]={last,bid:+t.bidPx*k||0,vol:+t.volCcy24h*k,ch:(+t.last/(+t.open24h)-1)*100,dir:prev==null?0:Math.sign(last-prev),ts:+t.ts};
        if(list.has(inst))lastTick=Math.max(lastTick,+t.ts)});
      const tag=document.getElementById('liveTag');
      if(lastTick){const d=new Date(lastTick),p=(n,l=2)=>String(n).padStart(l,'0');
        tag.innerHTML=`<i></i>Canlı · ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;tag.classList.add('on')}
      const x=S.strategies[sel];
      if(x&&!x.locked){renderMetrics(x);renderPositions(x);renderCoins(x);renderNow(x)}
      renderMarket();updLine();
    }catch(e){document.getElementById('liveTag').classList.remove('on')}
    mkBusy=false}
  // ana ekran açıkken 2 sn'de bir; ayarlar ya da geçmiş açıkken fiyat gösterilmediği için seyrek (veri tasarrufu)
  mkTimer=setTimeout(pollMarket,document.getElementById('mainv').hidden?8000:2000);
}
let okxDown=false;
function renderMarket(){
  const list=marketList(),box=document.getElementById('market');
  if(okxDown&&!list.some(i=>LP[i])){box.className='card list mk';box.innerHTML=`<div class="empty">${ic('i-info')}<div>OKX TR'ye ulaşılamıyor. VPN açıksa OKX TR yurt dışı bağlantıyı engelliyor olabilir; VPN'i kapatınca canlı fiyatlar gelir. Bot bundan etkilenmez.</div></div>`;return}
  const all=list.filter(i=>LP[i]).sort((a,b)=>LP[b].vol-LP[a].vol),rows=mkAll?all:all.slice(0,6);
  box.className='card list mk';
  box.innerHTML=rows.length?rows.map(i=>{const q=LP[i];
    return `<div class="row">${cico(i)}<div class="mid"><b>${sym(i)}${pq(i)}</b><span>Hacim ${volTxt(i)} · 24 sa</span></div>
      <div class="end"><b class="pxv ${q.dir>0?'flash-up':q.dir<0?'flash-dn':''}">${px(q.last)}</b><span class="${cls(q.ch)}">${spc(q.ch)}</span></div></div>`}).join('')
    +(all.length>6?`<button class="more" id="mkMore">${mkAll?'Daha az göster':`Tümünü göster (${all.length} coin)`}</button>`:'')
    :`<div class="empty">${ic('i-pnl')}<div>Fiyatlar yükleniyor…</div></div>`;
  const mb=document.getElementById('mkMore');if(mb)mb.onclick=()=>{mkAll=!mkAll;renderMarket()};
}
let mkAll=false;
document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollMarket()});

function okxLine(){const o=S.okx;if(!o)return '';
  return `<div class="okx ${o.ok?'ok':'bad'}">${ic(o.ok?'i-check':'i-info')}<span>OKX TR: ${o.status}${o.ok?` · boşta ${tl(o.try)}${o.usdt_tl?` + ${tl(o.usdt_tl)} (${o.quote||'USDT'})`:''}`:''}</span></div>`}
function renderKasa(x){
  const box=document.getElementById('kasa');
  if(!x.live||!x.kasa){box.innerHTML='';return}
  const active=x.start_cash,reserve=Math.max(0,x.kasa-active),aw=Math.min(100,active/x.kasa*100);
  const T=S?.settings?.topup||{amount:600,profit_pct:5,days:1},amt=+T.amount||0;
  const target=x.checkpoint*(1+(+T.profit_pct||5)/100),prog=Math.max(0,Math.min(1,(liveEquity(x)-x.checkpoint)/(target-x.checkpoint||1)));
  const waitMs=x.last_topup?Math.max(0,x.last_topup+(+T.days||0)*864e5-Date.now()):0,waitD=Math.ceil(waitMs/864e5);
  const full=amt<=0||reserve<amt;
  box.innerHTML=`<div class="card kasa">
    <div class="top"><b>${ic('i-wallet')}Kasa<button class="qm" data-q="kasa" aria-label="Açıklama">?</button></b><span>${tl(x.kasa,0)}</span></div>
    ${okxLine()}
    <div class="split"><i style="width:${aw}%;background:var(--amber)"></i></div>
    <div class="kv"><div>Botta aktif<b>${tl(active,0)}</b></div><div>Kasada yedek<b>${tl(reserve,0)}</b></div><div>Eklemeler<b>${x.topups} kez</b></div></div>
    <div class="prog">${full?`<div class="lbl"><span>${amt<=0?'Kasadan ekleme kapalı.':'Kasada ekleme için yeterli yedek yok; yeni ekleme yapılmayacak.'}</span></div>`
      :`<div class="lbl"><span>Sonraki +${tl(amt,0)} için kâr hedefi</span><b>${tl(liveEquity(x),0)} / ${tl(target,0)}</b></div>
      <div class="bar2"><i style="width:${(prog*100).toFixed(1)}%"></i></div>
      <div class="hint">Aktif para son eklemeden beri %${nf(+T.profit_pct||5,(+T.profit_pct||5)%1?1:0)} kâra ulaşınca${waitD?` ve ${waitD} gün daha geçince`:''} kasadan +${tl(amt,0)} eklenir. Zarardayken ekleme yapılmaz. Başlangıç parası ve kurallar Ayarlar ekranından değiştirilebilir.</div>`}
    </div></div>`;
}

function renderLog(x){
  const sec=document.getElementById('logSec');
  if(!x.live){sec.hidden=true;return}
  sec.hidden=false;document.getElementById('logSum').textContent=x.log.length?'Son not: '+x.log[0][1]:'Henüz kayıt yok';
  document.getElementById('log').innerHTML=x.log.length?x.log.map(([ts,t])=>`<div class="row"><div class="mid"><b style="white-space:normal;font-weight:500">${t}</b><span>${dt(ts)}</span></div></div>`).join('')
    :`<div class="empty">${ic('i-info')}<div>Henüz kayıt yok</div></div>`;
}

function renderBacktest(){
  const box=document.getElementById('backtest');
  if(!B){box.innerHTML=`<div class="empty">${ic('i-flag')}<div>Geçmiş test sonucu henüz yok</div></div>`;return}
  const rows=Object.entries(B.results).sort((a,b)=>b[1].pnl_pct-a[1].pnl_pct);
  box.innerHTML=rows.map(([k,r],i)=>`<div class="row ${i===0?'best':''}"><div class="rank">${i+1}</div>
      <div class="mid"><b>${r.name}${k===sel?' · seçili':''}</b><span>${r.trades} işlem · kazanma %${nf(r.win_rate,0)} · en büyük düşüş %${nf(r.max_drawdown,1)}</span></div>
      <div class="end"><b class="${cls(r.pnl_pct)}">${spc(r.pnl_pct)}</b><span>${tl(r.final,0)}</span></div></div>`).join('')
    +`<div class="note">${B.custom?`<b>Senin istediğin ayarlarla</b> (${dt(B.generated)}). `:''}Son ${B.days} gün, ${B.symbols.length} coin, gerçek OKX TR fiyatları, komisyon dahil. Aynı coinleri alıp hiç dokunmamak (al-tut): <b class="${cls(B.hold_pct)}">${spc(B.hold_pct)}</b>. Geçmiş sonuç geleceği garanti etmez.</div>`;
}

function renderChart(){
  const box=document.getElementById('chartBox'),leg=document.getElementById('legend'),note=document.getElementById('chartNote');
  const src=view==='live'?Object.fromEntries(Object.entries(S.strategies).filter(([k,v])=>v.equity_series&&(k==='live'||!S.strategies.live||S.strategies.live.locked)).map(([k,v])=>[k,v.equity_series]))
    :(B?Object.fromEntries(Object.entries(B.results).map(([k,v])=>[k,v.equity])):{});
  note.textContent=view==='live'?(S.created?'Başlangıç '+dt(S.created).split(' ')[0]:''):(B?'Son '+B.days+' gün':'');
  for(const k in src){const st=view==='live'?(S.strategies[k]?.start_cash||S.start_cash):S.start_cash;src[k]=src[k].map(([t,v,b0])=>[t,(v/(b0||st)-1)*100])}
  const pts=Object.values(src).flat();
  if(pts.length<4||Object.values(src).every(s=>s.length<2)){
    box.innerHTML=`<div class="empty">${ic('i-chart')}<div>${view==='live'?'Grafik için veri birikiyor. Bot saatte bir nokta ekler.':'Geçmiş test verisi yok'}</div></div>`;leg.innerHTML='';return}
  const W=520,H=170,pl=4,pr=4,pt=10,pb=18;
  const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]).concat([0]);
  const x0=Math.min(...xs),x1=Math.max(...xs);let y0=Math.min(...ys),y1=Math.max(...ys);const pad=(y1-y0)*.12||1;y0-=pad;y1+=pad;
  const X=t=>pl+(t-x0)/(x1-x0||1)*(W-pl-pr),Y=v=>pt+(1-(v-y0)/(y1-y0))*(H-pt-pb);
  const path=s=>s.map((p,i)=>(i?'L':'M')+X(p[0]).toFixed(1)+' '+Y(p[1]).toFixed(1)).join(' ');
  let g=`<line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--zero)" stroke-dasharray="4 4" stroke-width="1"/>`;
  {const z=Y(0),zl=z+12>H-pb-16?z-5:z+12; // sıfır etiketi alttaki etiketle çakışmasın
   g+=`<text x="2" y="${zl}" font-size="10" fill="var(--faint)">Başlangıç %0</text>`;
   if(pt+8<zl-14)g+=`<text x="2" y="${pt+8}" font-size="10" fill="var(--faint)">${spc(y1,1)}</text>`;
   if(H-pb-3>zl+14)g+=`<text x="2" y="${H-pb-3}" font-size="10" fill="var(--faint)">${spc(y0,1)}</text>`;}
  const order=Object.keys(src).filter(k=>k!==sel).concat(src[sel]?[sel]:[]);
  for(const k of order){const s=src[k];if(s.length<2)continue;const on=k===sel;
    g+=`<path d="${path(s)}" fill="none" stroke="${on?AMBER:COLORS[k]}" stroke-width="${on?2.4:1.3}" stroke-opacity="${on?1:.45}" stroke-linejoin="round"/>`;
    if(on){const l=s[s.length-1];g+=`<circle cx="${X(l[0])}" cy="${Y(l[1])}" r="3.5" fill="${AMBER}" stroke="var(--surface)" stroke-width="1.5"/>`}}
  g+=`<text x="2" y="${H-4}" font-size="10" fill="#9AA1AC">${dt(x0).split(' ')[0]}</text><text x="${W-2}" y="${H-4}" text-anchor="end" font-size="10" fill="#9AA1AC">${dt(x1).split(' ')[0]}</text>`;
  box.innerHTML=`<svg id="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>`;
  leg.innerHTML=Object.keys(src).map(k=>`<span><i style="background:${k===sel?AMBER:COLORS[k]};opacity:${k===sel?1:.6}"></i>${S.strategies[k]?.name||k}</span>`).join('');
}

document.getElementById('seg').onclick = e => {const b = (e.target as HTMLElement).closest('button');if(!b)return;view = b.dataset.v as 'live' | 'bt';
  document.querySelectorAll<HTMLElement>('#seg button').forEach(x=>x.classList.toggle('on',x===b));renderChart()};
document.getElementById('reload').onclick = openCloud;
/* ---------------- Ayarlar ---------------- */
const REPO=(()=>{const h=location.hostname,m=h.match(/^([^.]+)\.github\.io$/);const seg=location.pathname.split('/').filter(Boolean)[0];
  return m&&seg?{o:m[1],r:seg}:{o:'tcmustafacelik',r:'masal'}})();
const API=`https://api.github.com/repos/${REPO.o}/${REPO.r}/contents/docs/ayarlar.json`;
let token = localStore('masal_token') || '', orig: Settings = null, draft: Settings = null, sha: string = null, sellArm: ReturnType<typeof setTimeout> | 0 = 0;
const SNAMES={grid:'Kademeli',dip:'Düşüşte al',trend:'Trend takibi'};
const P=(o,k)=>k.split('.').reduce((a,x)=>a?.[x],o);
const SETP=(o,k,v)=>{const ks=k.split('.');const last=ks.pop();ks.reduce((a,x)=>a[x],o)[last]=v};
const MIN_ORDER=10;
const pctTL=(p)=>tl((draft.budget||0)*p/100,0);
const sizeTL=(p)=>{const v=(draft.budget||0)*p/100;return v<MIN_ORDER?`${tl(v,2)} (${MIN_ORDER} TL altı, alım yapılamaz)`:tl(v,0)};
function checks(d: Settings = draft, o: Settings = orig || ({} as Settings), diff = true): Check[] {
  const out=[],T=(v,dd=0)=>tl(v,dd);
  const b=+d.budget||0,k=+d.kasa||0,st=d.strategy,fee=((S?.fee||.0025)+(S?.slippage||.001))*100;
  const per=st==='grid'?b*d.grid.lot_pct/100:b*d.risk.trade_pct/100;
  const maxUse=st==='grid'?Math.min(per*d.grid.max_lots*d.grid.max_coins,b*(d.grid.use_pct??40)/100):per*d.risk.max_positions;
  const add=(lv,t,dsc)=>out.push({lv,t,dsc});
  if(per<MIN_ORDER)add('bad','Hiç alım yapılmaz',`Her alım ${T(per,2)} çıkıyor; bot ${MIN_ORDER} TL'nin altındaki emirleri göndermez. ${st==='grid'?'Kademe büyüklüğünü':'İşlem büyüklüğünü'} en az %${Math.ceil(MIN_ORDER*100/Math.max(b,1))} yap ya da bottaki parayı artır.`);
  const L=S?.strategies?.live,inv=L&&!L.locked?(L.positions||[]).reduce((a,p)=>a+(p.cost||0),0):0;
  if(d.live&&S?.okx&&S.okx.try!=null){
    const free=S.okx.try+(S.okx.usdt_tl||0); // TL + boştaki USDT/USDC/EUR'nun TL karşılığı
    if(free<per)add('bad','OKX\'te para yetmiyor',`Alım-satım hesabında ${T(free,2)} var; bir alım için ${T(per)} gerekir. Fonlama'dan Alım-satım'a aktar.`);
    else if(free+inv<b)add('warn2','OKX\'te para az',`Bot ${T(b)} ile çalışacak ama alım-satım hesabında ${T(free)} boşta${inv?` ve ${T(inv)} coinde`:''} var.`)}
  if(maxUse>b*1.001&&per>=MIN_ORDER)add('warn2','Para bütün kademelere yetmez',`Hepsi dolarsa ${T(maxUse)} gerekir, botta ${T(b)} var; son alımlar yapılamaz. ${st==='grid'?'Kademe ya da coin sayısını':'Pozisyon sayısını'} azalt veya parayı artır.`);
  if(k<b)add('warn2','Kasa bottaki paradan küçük',`Kasa ${T(k)}, botta ${T(b)}. Kasadan ekleme hiç çalışmaz; kasayı en az ${T(b)} yap.`);
  else if(d.topup.amount>0&&k-b<d.topup.amount)add('info','Kasadan ekleme yapılamaz',`Kasada eklenecek ${T(k-b)} kalıyor; ${T(d.topup.amount)}'lik ekleme için yetmez.`);
  const tp=st==='grid'?d.grid.lot_tp_pct:st==='dip'?d.dip.take_profit_pct:null;
  if(tp!=null&&tp<=fee*2)add('warn2','Kâr hedefi masrafı karşılamıyor',`Alış ve satışta toplam ~%${nf(fee*2,2)} komisyon ve kayma gidiyor; %${nf(tp,1)} kâr hedefi neredeyse hiç kazandırmaz.`);
  if(diff&&orig&&JSON.stringify(o)!==JSON.stringify(clean(d))){
    const ch=[];
    if(o.budget!==d.budget)ch.push(`Bottaki para ${T(o.budget)} → <b>${T(b)}</b>; fark ${b>o.budget?'kullanılabilir paraya eklenir':'kullanılabilir paradan düşülür'}, coinler satılmaz`);
    const oper=o.strategy==='grid'?o.budget*o.grid.lot_pct/100:o.budget*o.risk.trade_pct/100;
    if(Math.abs(oper-per)>.005)ch.push(`Her alım ${T(oper,oper<10?2:0)} → <b>${T(per,per<10?2:0)}</b>`);
    const ok_=o.budget*(1-o.risk.kill_pct/100),nk=b*(1-d.risk.kill_pct/100);if(Math.abs(ok_-nk)>.5)ch.push(`Acil fren ${T(ok_)} altı → <b>${T(nk)} altı</b>`);
    const od=o.budget*o.risk.daily_loss_pct/100,nd=b*d.risk.daily_loss_pct/100;if(Math.abs(od-nd)>.5)ch.push(`Günlük kayıp sınırı ${T(od)} → <b>${T(nd)}</b>`);
    if(o.live!==d.live)ch.push(d.live?'<b>Gerçek emir</b> başlar':'Deneme moduna geçilir; elde kalan coinler satılmaz');
    if(o.strategy!==d.strategy)ch.push(`Strateji ${SNAMES[o.strategy]} → <b>${SNAMES[d.strategy]}</b>${o.live?'; eski stratejinin coinleri satılır':''}`);
    if((o.quote||'USDT')!==(d.quote||'USDT'))ch.push(`Yeni alımlar <b>${d.quote}</b> paritesinden yapılır; eldeki coinler kendi paritesinde satılır`);
    if(!!o.target?.on!==!!d.target?.on||(d.target?.on&&(o.target?.amount!==d.target?.amount||o.target?.mode!==d.target?.mode)))ch.push(d.target?.on?(d.target.mode==='total'?`Kasa dahil toplam para <b>${T(d.target.amount)}</b> olunca`:`Toplam kâr <b>${T(d.target.amount)}</b> olunca`)+' bütün coinler satılır ve bot durur':'Kâr hedefi kapanır; bot olduğu gibi devam eder');
    if(!!o.grid?.instant!==!!d.grid?.instant)ch.push(d.grid?.instant?'<b>Anlık alım</b> açılır: fiyat alım seviyesine değince hemen alır':'Anlık alım kapanır: 15 dakikalık mum kapanışı beklenir');
    if(o.paused!==d.paused)ch.push(d.paused?'Yeni alım <b>durur</b>; korumalar çalışmaya devam eder':'Bot yeniden alım yapmaya başlar');
    if(ch.length)add('info','Kaydedince ne olacak',ch.join('<br>'));
  }
  if(diff&&L&&!L.locked&&d.budget<(o.budget||0)){const cash=L.cash||0,cut=(o.budget||0)-d.budget;
    if(cut>cash)add('info','Bütçe yatırılmış paranın altına iniyor',`Boşta ${T(cash)} var; kalan ${T(cut-cash)} coinler satıldıkça düşülür. Hiçbir coin zorla satılmaz.`)}
  if(!out.some(x=>x.lv==='bad'||x.lv==='warn2'))out.unshift({lv:'ok',t:'Ayarlar uyumlu',dsc:`Her alım ${T(per,per<10?2:0)} · en çok ${T(Math.min(maxUse,b))} kullanılır · acil fren ${T(b*(1-d.risk.kill_pct/100))} altında · günlük kayıp sınırı ${T(b*d.risk.daily_loss_pct/100)}`});
  return out}
function homeChecks(){const el=document.getElementById('homeChk');if(!el)return;const st=S?.settings;
  if(!st||!st.grid){el.innerHTML='';return}
  let list=[];try{list=checks(st,st,false).filter(c=>c.lv==='bad'||c.lv==='warn2')}catch(e){}
  el.innerHTML=list.length?`<section style="margin-top:12px"><div class="card chk">${list.map(c=>`<div class="ck ${c.lv}"><span class="ci">${ic(c.lv==='bad'?'i-stop':'i-info')}</span><div><b class="t">${c.t}</b><span class="d">${c.dsc}</span></div></div>`).join('')}
    <button class="btn sm" style="margin:2px 0 10px" onclick="document.getElementById('openSet').click()">${ic('i-gear')}Ayarlara git</button></div></section>`:''}
function testInfo(){const req=orig?.test_req,cu=B?.custom;
  if(req&&(!cu||cu.ts!==req.ts))return `<div class="ck info"><span class="ci">${ic('i-refresh')}</span><div><b class="t">Test çalışıyor…</b><span class="d">Son 30 günün 15 dakikalık fiyatlarıyla deneniyor; 3–4 dakika sürer. Bot bu sırada çalışmaya devam eder.</span></div></div>`;
  if(cu&&B?.results){const r=B.results[cu.strategy]||Object.values(B.results)[0];
    return `<div class="ck ${r.pnl_pct>=0?'ok':'warn2'}"><span class="ci">${ic('i-flag')}</span><div><b class="t">Test sonucu: ${r.name} ${spc(r.pnl_pct)}</b><span class="d">${dt(B.generated)} · istediğin ayarlarla son ${B.days} gün · ${r.trades} satış · kazanma %${nf(r.win_rate,0)} · en büyük düşüş %${nf(r.max_drawdown,1)} · hiç dokunmasan %${nf(B.hold_pct)}</span></div></div>`}
  return ''}
function updateChecks(){const el=document.getElementById('checks');if(!el||!draft)return;
  const IC={bad:'i-stop',warn2:'i-info',info:'i-refresh',ok:'i-check'};
  el.innerHTML=checks().map(c=>`<div class="ck ${c.lv}"><span class="ci">${ic(IC[c.lv])}</span><div><b class="t">${c.t}</b><span class="d">${c.dsc}</span></div></div>`).join('')+testInfo()
   +`<button class="btn sm" id="runTest" style="margin:2px 0 10px">${ic('i-flag')}Bu ayarlarla son 30 günü test et</button>`;
  const b=document.getElementById('runTest');if(b)b.onclick=()=>{const s0=clean(draft);delete s0.test_req;delete s0._bad;
    const keep=JSON.parse(JSON.stringify(orig));keep.test_req={ts:Date.now(),s:s0};
    save(keep,'Test istendi; sonuç 3–4 dakikada burada görünür. Ayarların değişmedi.',true)}}
const SECTIONS=[
 {t:'Kasa',i:'i-wallet',f:[
  ['budget','Bottaki başlangıç parası','Botun işlem yaptığı para','TL',100,100,1e7,0],
  ['kasa','Kasa','Hesaptaki toplam; bot aşmaz','TL',500,500,1e8,0]]},
 {t:'Kasadan ekleme',i:'i-plus',f:[
  ['topup.amount','Ekleme tutarı','Her kâr hedefinde kasadan','TL',100,0,1e7,0],
  ['topup.profit_pct','Kâr hedefi','Son eklemeden beri','%',.5,.5,100,1],
  ['topup.days','Bekleme süresi','İki ekleme arasında en az','gün',1,0,365,0]]},
 {t:'Koruma',i:'i-shield',f:[
  ['risk.stop_pct','Zarar sınırı','Bu zararda otomatik satılır','%',.5,.5,50,1],
  ['risk.daily_loss_pct','Günlük kayıp sınırı',()=>`Şu an ${pctTL(draft.risk.daily_loss_pct)}; aşılırsa o gün alım yok`,'%',.5,.5,50,1],
  ['risk.kill_pct','Acil fren',()=>`${tl(draft.budget*(1-draft.risk.kill_pct/100),0)} altında her şey satılır`,'%',1,1,90,0],
  ['risk.max_positions','En fazla pozisyon','Aynı anda tutulan coin','adet',1,1,30,0],
  ['risk.trade_pct','İşlem büyüklüğü',()=>`Bottaki paranın; şu an ${sizeTL(draft.risk.trade_pct)}`,'%',1,1,100,0]]},
 {t:'Kâr hedefi',i:'i-flag',f:[
  ['target.amount','Hedef kâr',()=>`Bu kârda her şey satılır, bot durur`,'TL',500,100,1e8,0]]},
];
// "Kasa dahil toplam" seçiliyken hedef alanı: bottaki para + kasadaki yedek
const TGT_TOTAL=['target.amount','Hedef toplam para',()=>`Bot + kasa bu tutara ulaşınca her şey satılır`,'TL',500,100,1e8,0];
// Kademeli stratejide zarar sınırı, coin sayısı ve alım tutarı kendi ayarlarından gelir; genel alanlar gizlenir
const GRID_HIDE=new Set(['risk.stop_pct','risk.max_positions','risk.trade_pct']);
function secFields(sec){return draft?.strategy==='grid'?sec.f.filter(f=>!GRID_HIDE.has(f[0])):sec.f}
const STRAT_F={
 grid:[['grid.sma_hours','Ortalama süresi','Alım fiyatı bu ortalamaya göre','saat',2,4,72,0],
  ['grid.step_pct','Kademe aralığı','Bu kadar düşünce yeni kademe','%',.5,.5,20,1],
  ['grid.step3_pct','3. kademe aralığı','2. kademeden sonra bu kadar düşüş','%',.5,.5,30,1],
  ['grid.lot_pct','Kademe büyüklüğü',()=>`Bottaki paranın; şu an ${sizeTL(draft.grid.lot_pct)}`,'%',.5,.5,50,1],
  ['grid.lot2_pct','2. kademe tutarı',()=>`1. kademeye göre; ${tl(draft.budget*draft.grid.lot_pct/100*(draft.grid.lot2_pct??100)/100,0)}`,'%',5,10,100,0],
  ['grid.lot3_pct','3. kademe tutarı',()=>`1. kademeye göre; ${tl(draft.budget*draft.grid.lot_pct/100*(draft.grid.lot3_pct??100)/100,0)}`,'%',5,10,100,0],
  ['grid.lot_tp_pct','Kademe kârı','Her kademe ayrı satılır','%',.5,.5,50,1],
  ['grid.max_lots','En fazla kademe','Bir coinde','adet',1,1,10,0],
  ['grid.max_coins','En fazla coin','Aynı anda tutulan coin','adet',1,1,100,0],
  ['grid.use_pct','Toplam kullanım sınırı',()=>`Coinlere en fazla; şu an ${pctTL(draft.grid.use_pct??40)}`,'%',1,5,100,2],
  ['grid.trend_filter_pct','Düşüş filtresi','Günde bu kadar düşen beklenir; 0 kapalı','%',.5,0,10,1],
  ['grid.stop_pct','Toplu zarar sınırı','Ortalamanın altında hepsi satılır','%',.5,1,50,1]],
 dip:[['dip.dip_pct','Düşüş eşiği','Ortalamanın bu kadar altında alır','%',.5,.5,30,1],
  ['dip.rsi_max','Aşırı satım eşiği','RSI bu değerin altındayken alınır','',1,5,60,0],
  ['dip.take_profit_pct','Kâr hedefi','Bu kâra ulaşınca satılır','%',.5,.5,50,1],
  ['dip.max_hold_hours','En uzun bekleme','Bu süre dolunca satılır','saat',1,1,500,0]],
 trend:[['trend.trailing_pct','İz süren stop','Fiyat zirveden bu kadar geri çekilince satılır','%',.5,.5,30,1]],
};

let OPEN=new Set();
function accOpen(id,title,icon,color,sum,dirty){return `<section class="acc c-${color}${OPEN.has(id)?' open':''}" data-acc="${id}"><button class="acch" type="button"><span class="aic">${ic(icon)}</span><span class="att"><b>${title}</b><small>${sum}</small></span>${dirty?'<i class="dot"></i>':''}<svg class="i chev"><use href="#i-back"/></svg></button><div class="accb">`}
const ACC_END='</div></section>';
function secDirty(keys){return keys.some(k=>JSON.stringify(P(draft,k))!==JSON.stringify(P(orig,k)))}
const pc=v=>'%'+String(v).replace('.',',');
const SUMS={
 'Kasa':()=>`${tl(draft.budget,0)} botta · kasa ${tl(draft.kasa,0)}`,
 'Kasadan ekleme':()=>`+${tl(draft.topup.amount,0)} · ${pc(draft.topup.profit_pct)} kârda · ${draft.topup.days} gün arayla`,
 'Kâr hedefi':()=>{const t=draft.target||{on:false,amount:20000},tot=t.mode==='total',a=tl(t.amount,0);
   return t.on?(tot?`Açık · kasa dahil ${a} olunca her şey satılır`:`Açık · +${a} kârda her şey satılır`):`Kapalı · ${tot?'kasa dahil ':'kâr '}${a}`},
 'Koruma':()=>draft.strategy==='grid'?`Günlük ${pc(draft.risk.daily_loss_pct)} · acil fren ${pc(draft.risk.kill_pct)}`:`Zarar ${pc(draft.risk.stop_pct)} · günlük ${pc(draft.risk.daily_loss_pct)} · acil fren ${pc(draft.risk.kill_pct)}`,
 grid:()=>`${(()=>{const l=draft.budget*draft.grid.lot_pct/100,a=(draft.grid.lot2_pct??100)/100,c=(draft.grid.lot3_pct??100)/100;return a===1&&c===1?tl(l,0)+' kademe':`${nf(l,0)} → ${nf(l*a,0)} → ${tl(l*c,0)}`})()} · ${draft.grid.max_coins} coine kadar · en çok ${tl(draft.budget*(draft.grid.use_pct??40)/100,0)}${draft.grid.instant?' · anlık alım':''}`,
 dip:()=>`Düşüş ${pc(draft.dip.dip_pct)} · kâr ${pc(draft.dip.take_profit_pct)} · en çok ${draft.dip.max_hold_hours} saat`,
 trend:()=>`İz süren stop ${pc(draft.trend.trailing_pct)}`};
const SEC_C={'Kasa':'teal','Kasadan ekleme':'teal','Koruma':'red','Kâr hedefi':'green'};
function field([k,label,hint,u,step,min,max,dec]){
  const v=P(draft,k),h=typeof hint==='function'?hint():hint;
  return `<div class="field" data-k="${k}"><div class="lb"><b>${label}</b><span class="h">${h}</span><em></em></div>
   <div class="step"><button data-d="-1" aria-label="Azalt">${ic('i-minus')}</button>
   <input inputmode="decimal" value="${fv(v,dec)}" data-step="${step}" data-min="${min}" data-max="${max}" data-dec="${dec}">
   <span class="u">${u}</span><button data-d="1" aria-label="Artır">${ic('i-plus')}</button></div></div>`}

// En çok coin bulunan pariteler (OKX TR): USDT ~300, EUR ~270, USDC ~270, TRY ~130
const QUOTES: [string,string,string][]=[['USDT','₮','Önerilen'],['USDC','$','Düşük fark'],['EUR','€','Düşük fark'],['TRY','₺','Fark yüksek']];
function tile(on: boolean, key: string, icon: string, name: string, sub?: string): string {return `<button class="tile ${on?'on':''}" data-t="${key}"><span class="ic">${ic(icon)}</span><span class="nm">${name}</span>${sub?`<span class="pc" style="color:var(--muted);font-weight:500">${sub}</span>`:''}</button>`}

// ---- PIN girişi (animasyonlu) ----
function pinPad(o){return new Promise(res=>{
  const v=document.createElement('div');v.className='pinv';
  const logo=document.querySelector('#logo .lg')?.outerHTML.replace(/id="h/g,'id="p').replace(/url\(#h/g,'url(#p')||'';
  v.innerHTML=`<div class="plg">${logo}</div><h3>${o.title}</h3><p>${o.sub||''}</p>
    <div class="pbox">${'<i></i>'.repeat(6)}</div><div class="perr">${o.err||''}</div>
    <div class="pkeys">${[1,2,3,4,5,6,7,8,9].map(n=>`<button data-k="${n}">${n}</button>`).join('')}
    <button class="ghost" data-k="x">${o.cancel===false?'':'Vazgeç'}</button><button data-k="0">0</button><button class="ghost" data-k="b" aria-label="Sil">${ic('i-del')}</button></div>`;
  document.body.appendChild(v);
  let val='',busy=false;const box=v.querySelector('.pbox'),err=v.querySelector('.perr');
  const draw=()=>box.querySelectorAll<HTMLElement>('i').forEach((e,i)=>{e.className=(i<val.length?'f':'')+(i===val.length?' cur':'')});draw();
  const close=r=>{document.removeEventListener('keydown',kd);v.classList.add('out');setTimeout(()=>v.remove(),250);res(r)};
  const press=async k=>{if(busy)return;
    if(k==='x'){if(o.cancel!==false)close(null);return}
    if(k==='b'){val=val.slice(0,-1);box.classList.remove('bad');err.textContent='';draw();return}
    if(val.length>=6)return;val+=k;box.classList.remove('bad');err.textContent='';draw();navigator.vibrate?.(8);
    if(val.length<6)return;busy=true;
    const r=o.check?await o.check(val):true;
    if(r===true){box.classList.add('ok');setTimeout(()=>close(val),380)}
    else{box.classList.add('bad','shake');err.textContent=typeof r==='string'?r:'Tekrar dene';navigator.vibrate?.([30,40,30]);
      setTimeout(()=>{box.classList.remove('shake');val='';draw();busy=false;if(r===null)close(null)},450)}};
  v.querySelectorAll<HTMLElement>('.pkeys button').forEach(b=>b.onclick=()=>press(b.dataset.k));
  const kd=e=>{if(/^[0-9]$/.test(e.key))press(e.key);else if(e.key==='Backspace')press('b');else if(e.key==='Escape')press('x')};
  document.addEventListener('keydown',kd);
})}
const b64u=s=>btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const b64uD=s=>atob(s.replace(/-/g,'+').replace(/_/g,'/'));
async function makeLink(){
  const p1=await pinPad({title:'PIN belirle',sub:'Bağlantı linkini korumak için 6 haneli bir PIN seç. Linki açınca bu PIN sorulacak.'});if(!p1)return;
  const p2=await pinPad({title:'PIN\'i tekrar gir',sub:'Aynı 6 haneyi bir kez daha gir.',check:v=>v===p1||'PIN\'ler aynı değil'});if(!p2)return;
  // Kısa link: linkte sadece 16 baytlık rastgele anahtar durur; şifreli paket depoda saklanır.
  // Paket ancak link + PIN birlikte olursa açılır; yeni link oluşunca eskisi silinir.
  const rnd=crypto.getRandomValues(new Uint8Array(16)),key=b64u(String.fromCharCode(...rnd)),id=await bagId(key);
  const box=await seal({t:token,p:pw||''},key+':'+p1,300000);
  try{await ghPut(`docs/bag/${id}.json`,JSON.stringify(box),'Bağlantı linki');
    const old=localStore('masal_bag');if(old&&old!==id)ghDel(`docs/bag/${old}.json`).catch(()=>{});localStore('masal_bag',id)}
  catch(e){return toast('Link kaydedilemedi, bağlantını kontrol et')}
  const link=location.origin+location.pathname+'#'+key;
  const v=document.createElement('div');v.className='pinv';
  v.innerHTML=`<div class="plg">${document.querySelector('#logo .lg')?.outerHTML.replace(/id="h/g,'id="q').replace(/url\(#h/g,'url(#q')||''}</div><h3>Bağlantı linkin hazır</h3>
    <p>Notlar'a kaydet ya da kendine gönder. Dokununca Masal açılır, PIN'i girince GitHub'a bağlanır${pw?' ve gerçek hesabın kilidi açılır':''}. Linki kimseyle paylaşma.</p>
    <div class="lnk" style="text-align:center">${link.replace(/^https?:\/\//,'')}</div>
    <div class="pact"><button class="btn" id="lkCopy">${ic('i-copy')}Kopyala</button><button class="btn" id="lkShare">${ic('i-link')}Paylaş</button></div>
    <button class="btn primary pdone" id="lkOk">Tamam</button>`;
  document.body.appendChild(v);
  v.querySelector<HTMLElement>('#lkCopy').onclick=()=>navigator.clipboard?.writeText(link).then(()=>toast('Link kopyalandı'),()=>toast('Kopyalanamadı'));
  v.querySelector<HTMLElement>('#lkShare').onclick=()=>navigator.share?navigator.share({title:'Masal bağlantı linki',url:link}).catch(()=>{}):navigator.clipboard?.writeText(link).then(()=>toast('Paylaşım yok; link kopyalandı'));
  v.querySelector<HTMLElement>('#lkOk').onclick=()=>{v.classList.add('out');setTimeout(()=>v.remove(),250)};
}
async function bagId(key){const h=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)));return [...h.slice(0,6)].map(b=>b.toString(16).padStart(2,'0')).join('')}
async function ghPut(path,text,msg){const url=`https://api.github.com/repos/${REPO.o}/${REPO.r}/contents/${path}`;
  const r=await tfetch(url,{method:'PUT',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'},body:JSON.stringify({message:msg,content:btoa(unescape(encodeURIComponent(text)))})});if(!r.ok)throw r.status}
async function ghDel(path){const url=`https://api.github.com/repos/${REPO.o}/${REPO.r}/contents/${path}`,h={Authorization:'Bearer '+token,Accept:'application/vnd.github+json'};
  const g=await tfetch(url,{headers:h});if(!g.ok)return;const sha=(await g.json()).sha;await tfetch(url,{method:'DELETE',headers:h,body:JSON.stringify({message:'Eski bağlantı linki silindi',sha})})}
async function openLink(){
  const short=location.hash.match(/^#([\w-]{22})$/),m=location.hash.match(/^#bag=([\w-]+)/);if(!short&&!m)return;
  history.replaceState(null,'',location.pathname+location.search);
  let box,pre='';
  if(short){pre=short[1]+':';const id=await bagId(short[1]);
    for(const u of [`https://raw.githubusercontent.com/${REPO.o}/${REPO.r}/main/docs/bag/${id}.json`,`bag/${id}.json`]){
      try{const r=await tfetch(u+'?t='+Date.now(),{cache:'no-store'});if(r.ok){box=await r.json();break}}catch(e){}}
    if(!box)return toast('Bu link geçersiz ya da yenisi oluşturulmuş')}
  else{try{box=JSON.parse(b64uD(m[1]))}catch(e){return toast('Bağlantı linki bozuk')}}
  let tries=0,got=null;
  const ok=await pinPad({title:'PIN\'ini gir',sub:'Bağlantı linkini oluştururken seçtiğin 6 haneli PIN.',check:async v=>{
    try{got=await unseal(box,pre+v);return true}catch(e){tries++;return tries>=5?null:`PIN yanlış · ${5-tries} hakkın kaldı`}}});
  if(!ok||!got){if(tries>=5)toast('Çok fazla yanlış deneme; link kullanılamadı');return}
  token=got.t;localStore('masal_token',token);if(got.p){pw=got.p;localStore('masal_pw',pw)}
  toast('Bağlandı');
}
function renderConn(){
  const c=document.getElementById('conn');
  c.innerHTML=token?`<div class="conn1"><div class="lb"><b>${ic('i-check')}Bağlı</b><span>${REPO.o}/${REPO.r}</span></div>
    <button class="btn sm" id="mkLink">${ic('i-lock')}Link</button><button class="btn sm" id="unlink">Kaldır</button></div>`
  :`<div style="font-size:13px">Ayarları kaydedebilmek için bir kereye mahsus GitHub erişim anahtarı gir. Anahtar sadece bu telefonda saklanır.</div>
    <input class="inp" id="tok" type="password" placeholder="github_pat_…" autocomplete="off">
    <button class="btn primary" id="link" style="width:100%">${ic('i-link')}Bağlan</button>
    <ol class="steps"><li>GitHub'da <b>Settings → Developer settings → Fine-grained tokens → Generate new token</b></li>
    <li><b>Repository access:</b> Only select repositories → <b>${REPO.r}</b></li><li><b>Permissions → Contents:</b> Read and write</li><li>Oluşan anahtarı kopyalayıp yukarıya yapıştır</li></ol>`;
  const mk=document.getElementById('mkLink');if(mk)mk.onclick=makeLink;
  const u=document.getElementById('unlink');if(u)u.onclick=()=>{token='';localStorage.removeItem('masal_token');renderConn()};
  const l=document.getElementById('link');if(l)l.onclick=async()=>{const t = (document.getElementById('tok') as HTMLInputElement).value.trim();if(!t)return toast('Anahtarı yapıştır');
    l.textContent='Kontrol ediliyor…';try{const r=await tfetch(API,{headers:{Authorization:'Bearer '+t,Accept:'application/vnd.github+json'}});
      if(!r.ok)throw r.status;token=t;localStore('masal_token',t);await loadSettings();toast('Bağlandı')}catch(e){toast(e===404?'Depo ya da dosya bulunamadı: izinleri kontrol et':'Anahtar geçersiz ya da yetkisi yok');renderConn()}};
}

function renderForm(){
  const live=draft.live;
  let h=`<section><h2><span class="hb c-green">${ic('i-power')}</span>Çalışma</h2>
   <div class="tiles two" data-g="mode">${tile(!live,'demo','i-flask','Deneme','Emir gönderilmez')}${tile(live,'real','i-coins','Gerçek','OKX TR hesabında')}</div>
   ${live&&!orig.live?`<div class="warn">${ic('i-info')}<div>Kaydedince bot OKX TR hesabında <b>gerçek emir</b> vermeye başlar. API anahtarı GitHub Secrets'ta olmalı.</div></div>`:''}
   ${!live&&orig.live?`<div class="warn">${ic('i-info')}<div>Denemeye geçince hesaptaki coinler bot tarafından satılmaz. Gerekirse önce aşağıdan <b>Hepsini sat</b>.</div></div>`:''}
   <div class="card" style="margin-top:8px"><div class="sw ${draft.paused?'on':''}" id="pauseSw"><div class="lb"><b style="font-size:13.5px">Botu durdur</b><span style="font-size:11.5px;color:var(--muted);display:block">Yeni alım yapılmaz; açık pozisyonların zarar sınırı çalışmaya devam eder</span></div><div class="track"><i></i></div></div>
   <div class="field" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line2)"><div class="lb"><b>Hepsini sat ve dur</b><span>Gerçek hesaptaki tüm coinleri hemen satar, botu durdurur</span></div>
   <button class="btn danger ${sellArm?'arm':''}" id="sellAll">${ic('i-sell')}${sellArm?'Emin misin? Dokun':'Hepsini sat'}</button></div></div></section>
   <div class="hint" style="margin:8px 2px 4px">Bot kesintisiz çalışır: yaklaşık 5 saniyede bir piyasayı, borsadaki korumaları ve para hareketlerini kontrol eder. Uygulama kapalı olsa da çalışır.</div>
   <section><h2><span class="hb c-amber">${ic('i-coins')}</span>İşlem paritesi</h2><div class="tiles qtiles" data-g="quote">${QUOTES.map(([q,g,sub])=>`<button class="tile ${(draft.quote||'USDT')===q?'on':''}" data-t="${q}"><span class="ic"><b class="qg">${g}</b></span><span class="nm">${q}</span><span class="pc" style="color:var(--muted);font-weight:500">${sub}</span></button>`).join('')}</div>
   <div class="hint" style="margin:8px 2px 0">Yeni alımlar bu paritede yapılır; gereken para TL'den otomatik çevrilir. Eldeki coinler kendi paritesinde satılır. Bütün tutarlar TL karşılığıyla görünür.</div></section>
   <section><h2><span class="hb c-blue">${ic('i-target')}</span>Strateji</h2><div class="tiles" data-g="strat">${['grid','dip','trend'].map(k=>tile(draft.strategy===k,k,ICON[k],SNAMES[k])).join('')}</div>
   ${draft.strategy!==orig.strategy&&orig.live?`<div class="warn">${ic('i-info')}<div>Gerçek modda strateji değişince eski stratejinin açık coinleri satılır, yeni strateji temiz başlar.</div></div>`:''}</section>
   <section><h2><span class="hb c-violet">${ic('i-shield')}</span>Kontrol<span class="hsum" style="font-weight:500;color:var(--faint);font-size:11px">değiştirdikçe güncellenir</span></h2><div class="card chk" id="checks"></div></section>`;
  h+='<section style="margin-bottom:-2px"><h2><span class="hb c-gray">'+ic('i-layers')+'</span>Ayrıntılı ayarlar<span class="hsum" style="font-weight:500;color:var(--faint);font-size:11px">dokununca açılır</span></h2></section>';
  h+=notifySection();
  if(!draft.target)draft.target={on:false,amount:20000,mode:'profit'};
  for(const sec of SECTIONS){const tg=sec.t==='Kâr hedefi',ff=tg&&draft.target.mode==='total'?[TGT_TOTAL]:secFields(sec);
    h+=accOpen(sec.t,sec.t,sec.i,SEC_C[sec.t],SUMS[sec.t](),secDirty([...ff.map(x=>x[0]),...(tg?['target.on','target.mode']:[])]))+`<div class="card">`
      +(tg?`<div style="margin-bottom:4px">${swRow('tgtSw',!!draft.target.on,'Hedefte dur','Hedefte her şey satılır, bot durur')}</div>
        <div class="field"><div class="lb"><b>Hedef türü</b><span>${draft.target.mode==='total'?'Bot + kasadaki yedek para toplamı':'Sadece kâr (başlangıç parasının üstü)'}</span></div>
        <div class="seg" id="tgtMode"><button type="button" data-m="profit" class="${draft.target.mode!=='total'?'on':''}">Kâr</button><button type="button" data-m="total" class="${draft.target.mode==='total'?'on':''}">Kasa dahil</button></div></div>`:'')
      +`${ff.map(field).join('')}</div>`+ACC_END}
  const sf=STRAT_F[draft.strategy];
  const grid=draft.strategy==='grid';
  h+=accOpen('strat',SNAMES[draft.strategy]+' ayarları',ICON[draft.strategy],'blue',SUMS[draft.strategy](),secDirty([...sf.map(x=>x[0]),...(grid?['grid.instant']:[])]))+`<div class="card">${sf.map(field).join('')}`
    +(grid?`<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line2)">${swRow('instSw',!!draft.grid.instant,'Anlık alım','Fiyat değince hemen alır')}</div>`:'')+`</div>`+ACC_END;
  h+=installSection();
  const f=document.getElementById('setForm');f.innerHTML=h;
  f.querySelectorAll<HTMLElement>('.acch').forEach(b=>b.onclick=()=>{const sec=b.parentElement,id=sec.dataset.acc;sec.classList.toggle('open');
    if(sec.classList.contains('open'))OPEN.add(id);else{OPEN.delete(id);renderForm()}});
  f.querySelectorAll<HTMLElement>('[data-g=mode] .tile').forEach(b=>b.onclick=()=>{draft.live=b.dataset.t==='real';renderForm()});
  f.querySelectorAll<HTMLElement>('[data-g=quote] .tile').forEach(b=>b.onclick=()=>{draft.quote=b.dataset.t;renderForm()});
  f.querySelectorAll<HTMLElement>('[data-g=strat] .tile').forEach(b=>b.onclick=()=>{draft.strategy = b.dataset.t as Settings['strategy'];renderForm()});
  document.getElementById('pauseSw').onclick=()=>{draft.paused=!draft.paused;renderForm()};
  document.getElementById('tgtSw').onclick=()=>{draft.target.on=!draft.target.on;renderForm()};
  document.querySelectorAll<HTMLElement>('#tgtMode button').forEach(b=>b.onclick=()=>{draft.target.mode=b.dataset.m;renderForm()});
  const isw=document.getElementById('instSw');if(isw)isw.onclick=()=>{draft.grid.instant=!draft.grid.instant;renderForm()};
  bindNotify();bindInstall();
  document.getElementById('sellAll').onclick=()=>{if(!sellArm){sellArm=setTimeout(()=>{sellArm=0;renderForm()},4000);return renderForm()}
    clearTimeout(sellArm);sellArm=0;const keep=JSON.parse(JSON.stringify(orig));keep.liquidate=Date.now();keep.paused=true;save(keep,'Hepsini sat isteği gönderildi; bot birkaç saniye içinde satar ve durur.')};
  f.querySelectorAll<HTMLElement>('.field[data-k]').forEach(el=>{const k=el.dataset.k,inp=el.querySelector('input');
    const set = (raw: string, fromBtn?: boolean) => {const mn=+inp.dataset.min,mx=+inp.dataset.max,dc=+inp.dataset.dec;
      const r0=String(raw).trim();let v=dc>0?parseFloat(r0.replace(',','.')):parseFloat(r0.replace(/[.,\s]/g,''));
      const em=el.querySelector('em');
      if(isNaN(v)||v<mn||v>mx){el.querySelector('.step').classList.add('bad');em.textContent=`${nf(mn,dc)} ile ${nf(mx,dc)} arasında olmalı`;draft._bad=(draft._bad||new Set()).add(k)}
      else{el.querySelector('.step').classList.remove('bad');em.textContent='';draft._bad?.delete(k);v=+v.toFixed(dc);SETP(draft,k,v);if(fromBtn)inp.value=fv(v,dc)}
      refresh()};
    inp.oninput=()=>set(inp.value);inp.onblur=()=>{if(!draft._bad?.has(k))inp.value=fv(P(draft,k),+inp.dataset.dec)};
    el.querySelectorAll<HTMLElement>('button[data-d]').forEach(b=>b.onclick=()=>{const st=+inp.dataset.step;let v=P(draft,k)+(+b.dataset.d)*st;
      v=Math.min(+inp.dataset.max,Math.max(+inp.dataset.min,v));set(String(+v.toFixed(+inp.dataset.dec)).replace('.',','),true)});
  });
  refresh();
}

function clean(o){const c=JSON.parse(JSON.stringify(o,(k,v)=>k==='_bad'?undefined:v));return c}
function refresh(){
  const d=clean(draft),ch=JSON.stringify(orig)!==JSON.stringify(d);
  document.getElementById('savebar').hidden=!ch;document.getElementById('dirtyTag').hidden=!ch;updateChecks();
  document.querySelectorAll<HTMLElement>('.field[data-k]').forEach(el=>{const k=el.dataset.k;
    el.querySelector('.step').classList.toggle('changed',P(orig,k)!==P(d,k));
    const all=[...(k==='target.amount'&&draft.target?.mode==='total'?[TGT_TOTAL]:[]),...SECTIONS.flatMap(s=>s.f),...Object.values(STRAT_F).flat()].find(f=>f[0]===k);
    if(all&&typeof all[2]==='function')el.querySelector('.h').textContent=all[2]()});
}

async function loadSettings(){
  try{
    if(token){const r=await tfetch(API+'?t='+Date.now(),{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'},cache:'no-store'});
      if(!r.ok)throw r.status;const j=await r.json();sha=j.sha;orig=JSON.parse(decodeURIComponent(escape(atob(j.content.replace(/\n/g,'')))))}
    else{orig=await tfetch('ayarlar.json?t='+Date.now()).then(r=>r.json())}
  }catch(e){orig=S?.settings||null;if(e===401){token='';localStorage.removeItem('masal_token');toast('GitHub anahtarının süresi dolmuş, yeniden bağlan')}}
  if(!orig){document.getElementById('setForm').innerHTML=`<div class="empty">${ic('i-info')}<div>Ayarlar yüklenemedi</div></div>`;return}
  if(orig&&orig.grid&&orig.grid.use_pct==null)orig.grid.use_pct=40;
  if(orig&&orig.grid&&orig.grid.trend_filter_pct==null)orig.grid.trend_filter_pct=1;
  if(orig&&!orig.notify)orig.notify={enabled:false,topic:'',trades:true,alerts:true,daily:true,money:true};
  if(orig?.notify&&orig.notify.daily_hour==null)orig.notify.daily_hour=21;
  topicPlain='';
  if(pw&&typeof orig.notify?.topic==='object'){try{topicPlain=await unseal(orig.notify.topic,pw)}catch(e){}}else if(typeof orig.notify?.topic==='string')topicPlain=orig.notify.topic;
  draft=JSON.parse(JSON.stringify(orig));renderConn();renderForm();
}

/** Ayarlardaki tek bir şeyi buluta yazar (bekleyen başka değişikliklere dokunmadan): dil, tema, bildirim temizleme. */
async function cloudPatch(fn: (o: Settings) => void, msg: string, retry = true): Promise<boolean> {
  if (!token) return false;
  try {
    const cur = await tfetch(API + '?t=' + Date.now(), {headers: {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json'}, cache: 'no-store'}).then(r => { if (!r.ok) throw r.status; return r.json(); });
    const o = JSON.parse(decodeURIComponent(escape(atob(cur.content.replace(/\n/g, ''))))); fn(o);
    const body = {message: msg, content: btoa(unescape(encodeURIComponent(JSON.stringify(o, null, 2) + '\n'))), sha: cur.sha, branch: 'main'};
    const r = await tfetch(API, {method: 'PUT', headers: {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    if (r.status === 409 && retry) return cloudPatch(fn, msg, false); // aynı anda başka kayıt: güncel hâli alıp bir kez daha dene
    if (!r.ok) throw r.status; sha = (await r.json()).content.sha;
    if (orig) fn(orig); if (draft) fn(draft); if (S?.settings) fn(S.settings);
    return true;
  } catch (e) { return false; }
}
async function save(obj?: Settings, msg?: string, keepDraft?: boolean, retry = true) {
  if(!token){toast('Kaydetmek için önce GitHub bağlantısını kur');document.getElementById('connSec').scrollIntoView({behavior:'smooth'});return}
  if(draft._bad&&draft._bad.size&&obj===undefined){toast('Kırmızı alanları düzelt');return}
  const data=obj||clean(draft),btn=document.getElementById('save');btn.textContent='Kaydediliyor…';
  try{
    const cur=await tfetch(API+'?t='+Date.now(),{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'},cache:'no-store'}).then(r=>{if(!r.ok)throw r.status;return r.json()});
    // Başka cihazdan/ekrandan gelmiş bekleyen istekler (satış, çevirme, hepsini sat, bildirim temizleme) bu kayıtla silinmesin
    try{const fr=JSON.parse(decodeURIComponent(escape(atob(cur.content.replace(/\n/g,'')))));const d:any=data;
      for(const k of ['sell','convert'])if((fr[k]?.ts||0)>(d[k]?.ts||0))d[k]=fr[k];
      if((+fr.liquidate||0)>(+d.liquidate||0))d.liquidate=fr.liquidate;
      if(fr.notify&&d.notify&&(fr.notify.cleared||0)>(d.notify.cleared||0))d.notify.cleared=fr.notify.cleared}catch(e){}
    const body={message:'Ayarlar uygulamadan güncellendi',content:btoa(unescape(encodeURIComponent(JSON.stringify(data,null,2)+'\n'))),sha:cur.sha,branch:'main'};
    const r=await tfetch(API,{method:'PUT',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify(body)});
    if(r.status===409&&retry){btn.innerHTML=ic('i-check')+'Kaydet';return save(obj||data,msg,keepDraft,false)} // çakışma: güncel sürümle bir kez daha
    if(!r.ok)throw r.status;sha=(await r.json()).content.sha;const prev=keepDraft?clean(draft):null;orig=JSON.parse(JSON.stringify(data));draft=JSON.parse(JSON.stringify(data));
    if(prev)for(const k in prev)if(k!=='test_req')draft[k]=prev[k];
    renderForm();if(S)render();toast(msg||'Kaydedildi. Bot birkaç saniye içinde yeni ayarlarla çalışır.');
  }catch(e){toast(e===401||e===403?'Yetki hatası: anahtarın Contents yazma izni olmalı':'Kaydedilemedi, tekrar dene ('+e+')')}
  finally{btn.innerHTML=ic('i-check')+'Kaydet'}
}

let toastT;function toast(t){const el=document.getElementById('toast');el.textContent=t;el.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>el.hidden=true,3800)}
let HIST: Trade[] = null, hCoin = '', hSide: '' | Side = '';
function showHist(on){document.getElementById('mainv').hidden=on;document.getElementById('histv').hidden=!on;
  document.querySelector('header').hidden=on;scrollTo(0,0);if(!on)pollMarket()}
async function openHistory(){hCoin='';hSide='';showHist(true);
  const body=document.getElementById('histBody');body.innerHTML=`<div class="empty">${ic('i-refresh')}<div>Yükleniyor…</div></div>`;
  const x=S.strategies[sel];document.getElementById('histTitle').textContent='İşlem geçmişi · '+(x?.name||'');
  try{const d=await getData('trades.json');let list=d.strategies?.[sel];
    if(!list&&sel==='live'&&d.live_enc&&pw)list=await unseal(d.live_enc,pw);
    HIST=(list||x?.recent||[]).slice().sort((a,b)=>b.ts-a.ts)}
  catch(e){HIST=(x?.recent||[]).slice()}
  renderHist()}
function renderHist(){const body=document.getElementById('histBody');const all=HIST||[];
  if(!all.length){body.innerHTML=`<div class="card"><div class="empty">${ic('i-list')}<div>Bu hesapta henüz işlem yok.</div></div></div>`;return}
  const coins=[...new Set(all.map(t=>t.inst))].sort();
  const rows=all.filter(t=>(!hCoin||t.inst===hCoin)&&(!hSide||t.side===hSide));
  const sells=rows.filter(t=>t.side==='SAT'),pnl=sells.reduce((a,t)=>a+(t.pnl||0),0);
  let h=`<section style="margin-top:6px"><div class="hsumk"><div><b>${rows.length}</b><span>işlem</span></div><div><b>${rows.length-sells.length}</b><span>alım</span></div><div><b>${sells.length}</b><span>satış</span></div><div><b class="${cls(pnl)}">${sgn(pnl)}</b><span>TL kâr/zarar</span></div></div></section>
  <section><h2>${ic('i-coins')}Coin</h2><div class="coins4" id="hCoins"><button class="tile ${!hCoin?'on':''}" data-c=""><span class="ic">${ic('i-layers')}</span><span class="nm">Tümü</span></button>
    ${coins.map(c=>`<button class="tile ${hCoin===c?'on':''}" data-c="${c}">${cico(c)}<span class="nm">${sym(c)}</span>${pq(c)}</button>`).join('')}</div></section>
  <section><h2>${ic('i-list')}İşlemler<span class="hsum"><span class="seg" id="hSide">${[['','Tümü'],['AL','Alım'],['SAT','Satış']].map(([k,n])=>`<button class="${hSide===k?'on':''}" data-s="${k}">${n}</button>`).join('')}</span></span></h2>`;
  if(!rows.length)h+=`<div class="card"><div class="empty">${ic('i-list')}<div>Bu süzgeçte işlem yok.</div></div></div>`;
  let day='';
  for(const t of rows){const d=new Date(t.ts),dk=d.toDateString();
    if(dk!==day){if(day)h+='</div>';day=dk;const dp=rows.filter(r=>new Date(r.ts).toDateString()===dk&&r.side==='SAT').reduce((a,r)=>a+(r.pnl||0),0);
      h+=`<div class="dayh"><span>${d.toLocaleDateString(LANG==='en'?'en-GB':'tr-TR',{day:'numeric',month:'long',weekday:'long'})}</span>${dp?`<b class="${cls(dp)}">${sgn(dp)} TL</b>`:''}</div><div class="card list">`}
    const sell=t.side==='SAT',hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
    h+=`<div class="row">${cico(t.inst,t.side,t.pnl<0)}<div class="mid"><b>${sym(t.inst)}${pq(t.inst)} ${sell?'satıldı':'alındı'}</b><span>${hm} · ${t.reason} · ${px(t.price)}</span></div>
      <div class="end"><b>${tl(t.amount,0)}</b>${sell?`<span class="plc ${cls(t.pnl)||'z'}">${sgn(t.pnl)} TL ${t.pnl>=0?'kâr':'zarar'}</span>`:`<span>harcandı</span>`}</div></div>`}
  if(day)h+='</div>';h+='</section>';
  body.innerHTML=h;
  body.querySelectorAll<HTMLElement>('#hCoins .tile').forEach(b=>b.onclick=()=>{hCoin=b.dataset.c;renderHist()});
  body.querySelectorAll<HTMLElement>('#hSide button').forEach(b=>b.onclick=()=>{hSide = b.dataset.s as '' | Side;renderHist()});
}
document.getElementById('histBtn').onclick=openHistory;
document.getElementById('closeHist').onclick=()=>showHist(false);
function showSettings(on){document.getElementById('mainv').hidden=on;document.getElementById('setv').hidden=!on;
  document.querySelector('header').hidden=on;scrollTo(0,0);if(on)loadSettings();else pollMarket()}
document.getElementById('openSet').onclick=()=>showSettings(true);
document.getElementById('closeSet').onclick=()=>{if(draft&&JSON.stringify(orig)!==JSON.stringify(clean(draft))&&!confirmLeave())return;showSettings(false)};
let leaveArm=0;function confirmLeave(){if(leaveArm)return true;leaveArm=1;toast('Kaydedilmemiş değişiklik var. Çıkmak için geri tuşuna tekrar dokun.');setTimeout(()=>leaveArm=0,3500);return false}

/* ---------- bildirimler ---------- */
let topicPlain='';
const swRow=(id,on,title,sub)=>`<div class="sw ${on?'on':''}" id="${id}"><div class="lb"><b style="font-size:13px">${title}</b><span style="font-size:11px;color:var(--muted);display:block">${sub}</span></div><div class="track"><i></i></div></div>`;
function notifySection(){
  const N=draft.notify||(draft.notify={enabled:false,topic:'',trades:true,alerts:true,daily:true,money:true});
  const nOn=[N.money!==false,N.trades,N.alerts,N.daily].filter(Boolean).length;
  let h=accOpen('bild','Bildirimler','i-bell','violet',!pw?'Kilitli: önce gerçek hesabın kilidini aç':N.enabled?`Açık · ${nOn} tür bildirim`:'Kapalı',secDirty(['notify']))+`<div class="card">`;
  if(!pw)return h+`<div style="font-size:13px;color:var(--muted)">${ic('i-lock')} Bildirimleri açmak için önce ana ekranda <b>Gerçek hesap</b> kutusuna dokunup kilidi aç.</div></div>`+ACC_END;
  h+=swRow('nOn',N.enabled,'Telefona bildirim gönder','Olaylar anında telefonuna ve uygulamadaki zile düşer');
  if(N.enabled){
    const T=[['nMo',N.money!==false,'i-wallet','Para','Yatırma, çekme'],['nTr',!!N.trades,'i-coins','Al-sat','Alım, satım'],
      ['nAl',!!N.alerts,'i-shield','Uyarılar','Hata, acil fren'],['nDy',!!N.daily,'i-day','Günlük özet',`Saat ${String(N.daily_hour??21).padStart(2,'0')}:00`]];
    const mask=topicPlain?topicPlain.slice(0,9)+'•'.repeat(Math.max(4,topicPlain.length-9)):'—';
    h+=`<div class="nsub">Hangi bildirimler gelsin</div>
      <div class="tiles ntiles">${T.map(([id,on,i,t,d])=>`<button type="button" class="tile ${on?'on':''}" id="${id}"><span class="ic">${ic(i as string)}</span><span class="nm">${t}</span><span class="pc">${d}</span><em class="ck">${ic(on?'i-check':'i-minus')}</em></button>`).join('')}</div>
      ${N.daily?`<div class="nhour">${field(['notify.daily_hour','Özet saati','Günlük özet bu saatte gelir',':00',1,0,23,0])}</div>`:''}
      <div class="nsub">Bildirim kanalı</div>
      <div class="nchan"><span class="nci">${ic('i-lock')}</span><div class="nct"><b id="nTopic" data-m="1">${mask}</b><span>Gizli tut; bu adı bilen bildirimleri görür</span></div></div>
      <div class="nbtns"><button type="button" class="btn sm" id="nShow">${ic('i-eye')}Göster</button><button type="button" class="btn sm" id="nCopy">${ic('i-copy')}Kopyala</button><button type="button" class="btn sm" id="nTest">${ic('i-bell')}Test</button></div>
      <details class="setup"${N.topic?'':' open'}><summary>${ic('i-phone')}Telefona kurulum (ntfy)</summary>
      <ol class="steps"><li><b>ntfy</b> uygulamasını kur: <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">Android</a> · <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener">iPhone</a></li>
      <li>ntfy'de <b>+</b> düğmesine dokun, <b>Kopyala</b> ile aldığın kanal adını yapıştır, <b>Abone ol</b>.</li>
      <li>Burada <b>Kaydet</b>'e bas, sonra <b>Test</b>'e dokun.</li></ol></details>`;
  }
  return h+'</div>'+ACC_END;
}
function bindNotify(){
  const N=draft.notify;if(!N||!pw)return;
  const t=(id,f)=>{const e=document.getElementById(id);if(e)e.onclick=f};
  t('nOn',async()=>{N.enabled=!N.enabled;
    if(N.enabled&&!topicPlain){topicPlain='masal-'+Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>(b%36).toString(36)).join('');
      N.topic=await seal(topicPlain,pw)}
    renderForm()});
  t('nTr',()=>{N.trades=!N.trades;renderForm()});t('nAl',()=>{N.alerts=!N.alerts;renderForm()});t('nDy',()=>{N.daily=!N.daily;renderForm()});t('nMo',()=>{N.money=N.money===false;renderForm()});
  t('nShow',()=>{const e=document.getElementById('nTopic'),b=document.getElementById('nShow');if(!e||!topicPlain)return;const m=e.dataset.m==='1';e.dataset.m=m?'0':'1';e.textContent=m?topicPlain:topicPlain.slice(0,9)+'•'.repeat(Math.max(4,topicPlain.length-9));b.lastChild.textContent=m?'Gizle':'Göster'});
  t('nCopy',()=>{navigator.clipboard?.writeText(topicPlain).then(()=>toast('Konu adı kopyalandı'),()=>toast('Kopyalanamadı, elle seç'))});
  t('nTest',async()=>{try{const r=await tfetch('https://ntfy.sh/',{method:'POST',body:JSON.stringify({topic:topicPlain,title:'Masal',message:'Test bildirimi: bağlantı çalışıyor.',tags:['white_check_mark']})});
    toast(r.ok?'Test bildirimi gönderildi':'Gönderilemedi ('+r.status+')')}catch(e){toast('Gönderilemedi, bağlantını kontrol et')}});
}

/* ---------- ana ekrana ekleme ---------- */
let installEvt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvt=e;if(!document.getElementById('setv').hidden&&draft)renderForm()});
window.addEventListener('appinstalled',()=>{installEvt=null;toast('Masal ana ekrana eklendi');if(draft)renderForm()});
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & {standalone?: boolean}).standalone;
function themeMode(){try{return localStorage.getItem('masal-tema')||'auto'}catch(e){return 'auto'}}
const darkMQ=matchMedia('(prefers-color-scheme: dark)');
function applyTheme(){const m=themeMode(),d=m==='dark'||(m==='auto'&&darkMQ.matches);document.documentElement.dataset.theme=d?'dark':'light';
  document.querySelector<HTMLMetaElement>('meta[name=theme-color]').content=d?'#0F131A':'#F4F5F7'}
function setTheme(m){try{localStorage.setItem('masal-tema',m)}catch(e){}applyTheme()}
darkMQ.addEventListener?.('change',applyTheme);applyTheme();
function installSection(){
  const tmn={light:'Açık',dark:'Koyu',auto:'Otomatik'}[themeMode()];
  let h=accOpen('app','Uygulama','i-phone','gray',`Sürüm ${APP_VERSION} · tema ${tmn} · ${LANG==='en'?'English':'Türkçe'}${remoteVer&&vcmp(remoteVer.version,APP_VERSION)>0?' · yeni sürüm var':''}`,false)+`<div class="card">`;
  if(standalone())h+=`<div style="display:flex;gap:8px;align-items:center;color:var(--green);font-weight:600;font-size:13.5px">${ic('i-check')}Masal ana ekranında uygulama olarak yüklü</div>`;
  else if(installEvt)h+=`<div style="font-size:13px;margin-bottom:10px">Masal'ı ana ekrana ekle; kendi simgesiyle uygulama gibi açılır, internet yokken de son verileri gösterir.</div><button class="btn primary" id="instBtn" style="width:100%">${ic('i-phone')}Ana ekrana ekle</button>`;
  else h+=`<ol class="steps" style="margin-top:0"><li><b>Android (Chrome):</b> sağ üstteki ⋮ → <b>Ana ekrana ekle</b></li><li><b>iPhone (Safari):</b> Paylaş → <b>Ana Ekrana Ekle</b></li><li><b>Bilgisayar (Chrome/Edge):</b> adres çubuğundaki <b>Yükle</b> simgesi</li></ol>`;
  const tm=themeMode();
  h+=`<div class="prf"><b>Tema</b><div class="seg mini" id="themeTiles">${[['light','i-sun','Açık'],['dark','i-moon','Koyu'],['auto','i-auto','Otomatik']].map(([k,i,n])=>`<button type="button" class="${tm===k?'on':''}" data-th="${k}">${ic(i)}${n}</button>`).join('')}</div></div>`;
  h+=`<div class="prf"><b>Dil</b><div class="seg mini" id="langTiles">${[['tr','Türkçe'],['en','English']].map(([k,n])=>`<button type="button" class="${LANG===k?'on':''}" data-lg="${k}">${n}</button>`).join('')}</div></div>`;
  const newer=remoteVer&&vcmp(remoteVer.version,APP_VERSION)>0;
  h+=`<div class="ver"><div><b>Sürüm ${APP_VERSION}</b><span>${newer?'Yeni sürüm hazır: '+remoteVer.version:'Güncel'}${remoteVer?.date?' · '+remoteVer.date.split('-').reverse().join('.'):''}</span></div>
    <button class="btn ${newer?'primary':''}" id="verBtn">${ic('i-refresh')}${newer?'Güncelle':'Denetle'}</button></div>`;
  return h+'</div>'+ACC_END;
}
function bindInstall(){document.querySelectorAll<HTMLElement>('#langTiles button').forEach(t=>t.onclick=async()=>{const l=t.dataset.lg as 'tr'|'en';if(l===LANG)return;
    // dil bulutta tutulur: bütün cihazlar ve bildirimler aynı dilde
    localStore('masal_pref_ts',String(Date.now()));await cloudPatch(o=>{o.lang=l},'Dil değişti');
    setLang(l)});document.querySelectorAll<HTMLElement>('#themeTiles button').forEach(t=>t.onclick=()=>{setTheme(t.dataset.th);localStore('masal_pref_ts',String(Date.now()));cloudPatch(o=>{(o as any).theme=t.dataset.th},'Tema değişti');document.querySelectorAll<HTMLElement>('#themeTiles button').forEach(x=>x.classList.toggle('on',x===t))});const v=document.getElementById('verBtn');if(v)v.onclick=()=>{if(remoteVer&&vcmp(remoteVer.version,APP_VERSION)>0)applyUpdate();else checkVersion(true)};const b=document.getElementById('instBtn');if(b)b.onclick=async()=>{installEvt.prompt();await installEvt.userChoice;installEvt=null;renderForm()}}

/* ---------- sürüm ---------- */
let remoteVer=null;
const vcmp=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++){if((x[i]||0)!==(y[i]||0))return (x[i]||0)-(y[i]||0)}return 0};
async function checkVersion(manual?: boolean) {
  try{remoteVer=await tfetch('version.json?t='+Date.now(),{cache:'no-store'}).then(r=>r.json())}catch(e){if(manual)toast('Sürüm bilgisi alınamadı');return}
  const bar=document.getElementById('upbar');
  if(vcmp(remoteVer.version,APP_VERSION)>0){
    bar.innerHTML=`<div class="in">${ic('i-refresh')}<div><b>Yeni sürüm algılandı: ${remoteVer.version}</b><small>${(remoteVer.notes||[]).slice(0,2).join(' · ')}</small></div><button class="btn" id="upBtn">Güncelle</button></div>`;
    bar.hidden=false;document.getElementById('upBtn').onclick=applyUpdate;
  }else{bar.hidden=true;if(manual)toast('Masal güncel: sürüm '+APP_VERSION)}
  if(!document.getElementById('setv').hidden&&draft)renderForm();
}
async function applyUpdate(){
  try{const regs=await navigator.serviceWorker?.getRegistrations?.()||[];for(const r of regs)await r.update();
    const ks=await caches?.keys?.()||[];for(const k of ks)await caches.delete(k)}catch(e){}
  location.replace(location.pathname+'?v='+(remoteVer?.version||Date.now()));
}
setInterval(()=>{if(!document.hidden)checkVersion()},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkVersion()});
checkVersion();

/* ---------- açılış, logo, çevrimdışı ---------- */
let splashT0=Date.now();
function hideSplash(){const sp=document.getElementById('splash');if(!sp||sp.classList.contains('out'))return;
  setTimeout(()=>{sp.classList.add('out');setTimeout(()=>sp.remove(),400)},Math.max(0,2000-(Date.now()-splashT0)))}
setTimeout(hideSplash,4000);
document.getElementById('logo').onclick=()=>{const l=document.querySelector('#logo .lg');const c = l.cloneNode(true) as Element;c.classList.remove('done');l.replaceWith(c);setTimeout(()=>c.classList.add('done'),1600)};
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(()=>{});
document.getElementById('save').onclick=()=>save();
document.getElementById('undo').onclick=()=>{draft=JSON.parse(JSON.stringify(orig));renderForm()};

(async()=>{await initLang();await openLink();load()})();
