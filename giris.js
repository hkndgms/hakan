// Giriş sayfasının arayüzü. Akış:
// 1) İlk kez: GitHub anahtarı + repo + dal girilir, giriş şifresiyle mühürlenip bu cihazda saklanır.
// 2) Sonraki girişlerde: giriş şifresi mührü açar; program cihazdaki şifreli önbellekten yüklenir.
//    GitHub'a sadece programın son sürümü sorulur, değişen dosyalar indirilir.
//    İnternet yoksa önbellekteki sürümle açılır.
import {
  muhurle, muhurAc, YanlisSifre, iceAktarmalariYenidenYaz, manifestDogrula, b64Coz,
  onbellekAnahtariUret, onbellekSifrele, onbellekCoz, blobSha, programDosyalari,
} from "./giris-cekirdek.js";

const DEPO_ANAHTARI = "hk1";
const BOSTA_KILIT_DK = 10;
const API = "https://api.github.com";

const $ = (s) => document.querySelector(s);
const gorunumler = ["#kurulum", "#giris", "#yukleniyor", "#uygulama"];

function goster(secici) {
  for (const g of gorunumler) $(g).hidden = g !== secici;
  const ilkAlan = $(secici).querySelector("input");
  if (ilkAlan) ilkAlan.focus();
}

function hata(secici, mesaj) {
  const el = $(secici);
  el.textContent = mesaj || "";
  el.hidden = !mesaj;
}

function kayitOku() {
  try { return JSON.parse(localStorage.getItem(DEPO_ANAHTARI)); } catch { return null; }
}

function yolKodla(yol) {
  return yol.split("/").map(encodeURIComponent).join("/");
}

async function githubIstek(cfg, yol, kabul) {
  const yanit = await fetch(`${API}${yol}`, {
    headers: { Authorization: `Bearer ${cfg.anahtar}`, Accept: kabul },
    cache: "no-store",
  });
  if (yanit.status === 401) throw new Error("GitHub anahtarı geçersiz ya da süresi dolmuş.");
  if (yanit.status === 404) throw new Error("Repo veya dosya bulunamadı. Anahtarın bu repoya erişimi olduğundan emin olun.");
  if (!yanit.ok) throw new Error(`GitHub hatası: ${yanit.status}`);
  return yanit;
}

function istekBekle(istek) {
  return new Promise((coz, reddet) => { istek.onsuccess = () => coz(istek.result); istek.onerror = () => reddet(istek.error); });
}

async function programDeposu() {
  const istek = indexedDB.open("hk-program", 1);
  istek.onupgradeneeded = () => { istek.result.createObjectStore("dosya"); istek.result.createObjectStore("durum"); };
  const db = await istekBekle(istek);
  const is = (bolme, kip, f) => istekBekle(f(db.transaction(bolme, kip).objectStore(bolme)));
  return {
    oku: (b, k) => is(b, "readonly", (s) => s.get(k)),
    yaz: (b, k, v) => is(b, "readwrite", (s) => s.put(v, k)),
    sil: (b, k) => is(b, "readwrite", (s) => s.delete(k)),
    anahtarlar: (b) => is(b, "readonly", (s) => s.getAllKeys()),
  };
}

async function kimlikOzeti(metin) {
  const o = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(metin)));
  return Array.from(o.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Program dosyaları cihazda şifreli saklanır; sadece değişenler indirilir.
async function programiYukle(cfg, durumYaz) {
  const db = await programDeposu();
  const anahtarAdi = await kimlikOzeti(`${cfg.repo}|${cfg.dal}`);
  let durum = await db.oku("durum", anahtarAdi);
  let bas;
  try {
    bas = (await (await githubIstek(cfg, `/repos/${cfg.repo}/git/ref/heads/${yolKodla(cfg.dal)}`, "application/vnd.github+json")).json()).object.sha;
  } catch (e) {
    if (!(e instanceof TypeError) || !durum) throw e;
    bas = durum.bas;
    durumYaz("İnternet yok; bu cihazdaki program açılıyor…");
  }
  if (bas !== durum?.bas) {
    durumYaz("Programın yeni sürümü kontrol ediliyor…");
    const agac = await (await githubIstek(cfg, `/repos/${cfg.repo}/git/trees/${bas}?recursive=1`, "application/vnd.github+json")).json();
    durum = { bas, dosyalar: programDosyalari(agac) };
  }

  let indirilen = 0;
  const metinGetir = async (yol) => {
    const sha = durum.dosyalar[yol];
    if (!sha) throw new Error(`Program dosyası bulunamadı: ${yol}`);
    const sakli = await db.oku("dosya", sha);
    if (sakli) return new TextDecoder().decode(await onbellekCoz(cfg.onbellek, sakli, sha));
    const blob = await (await githubIstek(cfg, `/repos/${cfg.repo}/git/blobs/${sha}`, "application/vnd.github+json")).json();
    const bayt = b64Coz((blob.content ?? "").replace(/\s/g, ""));
    if (await blobSha(bayt) !== sha) throw new Error("Program dosyası eksik indi. Tekrar deneyin.");
    await db.yaz("dosya", sha, await onbellekSifrele(cfg.onbellek, bayt, sha));
    indirilen++;
    return new TextDecoder().decode(bayt);
  };

  const manifest = manifestDogrula(JSON.parse(await metinGetir("manifest.json")));
  const kaynaklar = await Promise.all(manifest.dosyalar.map((yol) => metinGetir(yol)));
  await db.yaz("durum", anahtarAdi, durum);
  // Artık kullanılmayan eski sürüm dosyaları silinir.
  const gerekli = new Set(Object.values(durum.dosyalar));
  for (const sha of await db.anahtarlar("dosya")) if (!gerekli.has(sha)) await db.sil("dosya", sha);

  const harita = {};
  manifest.dosyalar.forEach((yol, i) => {
    const kaynak = iceAktarmalariYenidenYaz(kaynaklar[i], harita, yol);
    harita[yol] = URL.createObjectURL(new Blob([kaynak], { type: "text/javascript" }));
  });
  return { program: await import(harita[manifest.giris]), indirilen };
}

function kilitle() {
  // Sayfayı yeniden yüklemek bellekteki anahtarları ve çözülmüş verileri siler.
  window.hkKilitleniyor = true;
  location.replace(location.pathname);
}

function bostaKilidiKur() {
  let zamanlayici;
  const sifirla = () => {
    clearTimeout(zamanlayici);
    zamanlayici = setTimeout(kilitle, BOSTA_KILIT_DK * 60 * 1000);
  };
  for (const olay of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"]) {
    addEventListener(olay, sifirla, { passive: true });
  }
  sifirla();
}

$("#kurulum-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hata("#kurulum-hata");
  const anahtar = $("#kur-anahtar").value.trim();
  const repo = $("#kur-repo").value.trim();
  const dal = $("#kur-dal").value.trim() || "main";
  const sifre = $("#kur-sifre").value;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return hata("#kurulum-hata", "Repo adı kullanici/repo biçiminde olmalı.");
  if (sifre.length < 12) return hata("#kurulum-hata", "Giriş şifresi en az 12 karakter olmalı.");
  if (sifre !== $("#kur-sifre2").value) return hata("#kurulum-hata", "Şifreler birbirini tutmuyor.");

  const dugme = $("#kurulum-form button");
  dugme.disabled = true;
  dugme.textContent = "Kontrol ediliyor…";
  try {
    const bilgi = await (await githubIstek({ anahtar }, `/repos/${repo}`, "application/vnd.github+json")).json();
    if (bilgi.private !== true) throw new Error("Bu repo private değil. Veriler için private bir repo kullanın.");
    if (!bilgi.permissions?.push) throw new Error("Anahtarın bu repoya yazma izni yok. Contents izni Read and write olmalı.");
    const kayit = await muhurle(sifre, { anahtar, repo, dal, onbellek: onbellekAnahtariUret() });
    localStorage.setItem(DEPO_ANAHTARI, JSON.stringify(kayit));
    $("#kurulum-form").reset();
    goster("#giris");
  } catch (err) {
    hata("#kurulum-hata", err.message);
  } finally {
    dugme.disabled = false;
    dugme.textContent = "Kaydet";
  }
});

$("#giris-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hata("#giris-hata");
  const sifreAlani = $("#giris-sifre");
  let cfg;
  goster("#yukleniyor");
  $("#yukleniyor-mesaj").textContent = "Şifre kontrol ediliyor…";
  try {
    cfg = await muhurAc(sifreAlani.value, kayitOku());
    if (!cfg.onbellek) {
      // Eski kurulum: önbellek anahtarı eklenip kayıt yeniden mühürlenir.
      cfg.onbellek = onbellekAnahtariUret();
      localStorage.setItem(DEPO_ANAHTARI, JSON.stringify(await muhurle(sifreAlani.value, cfg)));
    }
  } catch (err) {
    sifreAlani.value = "";
    goster("#giris");
    return hata("#giris-hata", err instanceof YanlisSifre ? "Şifre yanlış." : err.message);
  }
  sifreAlani.value = "";
  try {
    $("#yukleniyor-mesaj").textContent = "Program açılıyor…";
    const { program } = await programiYukle(cfg, (m) => { $("#yukleniyor-mesaj").textContent = m; });
    goster("#uygulama");
    bostaKilidiKur();
    await program.baslat({ ...cfg, kok: $("#uygulama"), kilitle });
  } catch (err) {
    goster("#giris");
    hata("#giris-hata", `Program açılamadı: ${err.message}`);
  }
});

$("#sifirla").addEventListener("click", () => { $("#sifirla-onay").hidden = false; });
$("#sifirla-evet").addEventListener("click", () => {
  localStorage.removeItem(DEPO_ANAHTARI);
  $("#sifirla-onay").hidden = true;
  goster("#kurulum");
});
$("#sifirla-hayir").addEventListener("click", () => { $("#sifirla-onay").hidden = true; });

goster(kayitOku() ? "#giris" : "#kurulum");

// Uygulama olarak kurulabilmesi ve internetsiz açılabilmesi için.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
