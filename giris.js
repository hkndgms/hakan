// Giriş sayfasının arayüzü. Akış:
// 1) İlk kez: kurulum dosyasıyla ya da GitHub anahtarıyla kurulur (repo ve dal anahtardan bulunur).
//    Bilgiler giriş şifresiyle mühürlenip bu cihazda saklanır ve doğrudan giriş yapılır.
// 2) Sonraki girişlerde: giriş şifresi mührü açar; program cihazdaki şifreli önbellekten yüklenir.
//    GitHub'a sadece programın son sürümü sorulur, değişen dosyalar indirilir.
//    İnternet yoksa önbellekteki sürümle açılır.
import {
  muhurle, muhurAc, YanlisSifre, iceAktarmalariYenidenYaz, manifestDogrula, b64Coz,
  onbellekAnahtariUret, onbellekSifrele, onbellekCoz, blobSha, programDosyalari,
  kurulumDosyasiOlustur, kurulumDosyasiAc, uygunRepolar,
} from "./giris-cekirdek.js";

const DEPO_ANAHTARI = "hk1";
const BOSTA_KILIT_DK = 10;
const API = "https://api.github.com";

const $ = (s) => document.querySelector(s);
const gorunumler = ["#karsilama", "#dosyadan", "#elle", "#giris", "#yukleniyor", "#uygulama"];

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
    if (sakli) {
      try {
        return new TextDecoder().decode(await onbellekCoz(cfg.onbellek, sakli, sha));
      } catch {
        // Başka bir kurulumun anahtarıyla saklanmış ya da bozulmuş kopya: silinir, yeniden indirilir.
        await db.sil("dosya", sha);
      }
    }
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

// ---------- Ortak ----------
function dosyaIndir(nesne) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(nesne, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "hesap-kurulum.json";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function dugmeyleCalis(dugme, bekleMetni, is) {
  const eski = dugme.textContent;
  dugme.disabled = true;
  dugme.textContent = bekleMetni;
  try { return await is(); } finally { dugme.disabled = false; dugme.textContent = eski; }
}

// "Göster" düğmeleri yanındaki şifre kutusunu açıp kapatır.
for (const d of document.querySelectorAll(".goster")) {
  d.addEventListener("click", () => {
    const girdi = d.previousElementSibling;
    const acik = girdi.type === "text";
    girdi.type = acik ? "password" : "text";
    d.textContent = acik ? "Göster" : "Gizle";
  });
}
for (const d of document.querySelectorAll(".geri")) d.addEventListener("click", () => goster("#karsilama"));

// Anahtar ve repoyu GitHub'da doğrular: repo private olmalı, anahtar yazabilmeli.
async function repoDogrula(anahtar, repo) {
  const bilgi = await (await githubIstek({ anahtar }, `/repos/${repo}`, "application/vnd.github+json")).json();
  if (bilgi.private !== true) throw new Error("Bu repo private değil. Veriler için private bir repo kullanın.");
  if (!bilgi.permissions?.push) throw new Error("Anahtarın bu repoya yazma izni yok. Contents izni Read and write olmalı.");
  return bilgi.default_branch || "main";
}

// Bilgileri mühürleyip saklar, sonra doğrudan giriş yapar.
async function kurVeGir(sifre, { anahtar, repo, dal }) {
  const cfg = { anahtar, repo, dal, onbellek: onbellekAnahtariUret() };
  localStorage.setItem(DEPO_ANAHTARI, JSON.stringify(await muhurle(sifre, cfg)));
  await programiAc(cfg, "");
}

async function programiAc(cfg, veriSifresi) {
  goster("#yukleniyor");
  $("#yukleniyor-mesaj").textContent = "Program açılıyor…";
  try {
    const { program } = await programiYukle(cfg, (m) => { $("#yukleniyor-mesaj").textContent = m; });
    goster("#uygulama");
    bostaKilidiKur();
    await program.baslat({ ...cfg, veriSifresi, kok: $("#uygulama"), kilitle });
  } catch (err) {
    goster("#giris");
    hata("#giris-hata", `Program açılamadı: ${err.message}`);
  }
}

// ---------- Karşılama ----------
$("#sec-dosya").addEventListener("click", () => goster("#dosyadan"));
$("#sec-elle").addEventListener("click", () => goster("#elle"));

// ---------- Kurulum dosyasıyla ----------
let dosyaMetni = "";
$("#dosya-sec").addEventListener("click", () => $("#kurulum-dosyasi").click());
$("#kurulum-dosyasi").addEventListener("change", async () => {
  const dosya = $("#kurulum-dosyasi").files[0];
  $("#kurulum-dosyasi").value = "";
  if (!dosya) return;
  dosyaMetni = await dosya.text();
  $("#dosya-adi").textContent = dosya.name;
  hata("#dosya-hata");
  $("#dosya-sifre").focus();
});
$("#dosya-form").addEventListener("submit", (e) => {
  e.preventDefault();
  hata("#dosya-hata");
  if (!dosyaMetni) return hata("#dosya-hata", "Önce kurulum dosyasını seçin.");
  const sifre = $("#dosya-sifre").value;
  dugmeyleCalis(e.submitter ?? $("#dosya-form button[type=submit]"), "Kuruluyor…", async () => {
    try {
      const bilgi = await kurulumDosyasiAc(sifre, dosyaMetni);
      await repoDogrula(bilgi.anahtar, bilgi.repo);
      $("#dosya-sifre").value = "";
      dosyaMetni = "";
      await kurVeGir(sifre, bilgi);
    } catch (err) {
      hata("#dosya-hata", err instanceof YanlisSifre ? "Dosyanın şifresi yanlış." : err.message);
    }
  });
});

// ---------- Elle (GitHub anahtarıyla) ----------
let bulunanAnahtar = "";
async function repolariBul() {
  const anahtar = $("#kur-anahtar").value.trim();
  if (!anahtar || anahtar === bulunanAnahtar) return;
  bulunanAnahtar = anahtar;
  const durum = $("#repo-durum");
  durum.hidden = false;
  durum.textContent = "Anahtar kontrol ediliyor…";
  $("#repo-alani").hidden = true;
  try {
    const liste = uygunRepolar(await (await githubIstek({ anahtar }, "/user/repos?per_page=100&sort=updated", "application/vnd.github+json")).json());
    if (!liste.length) throw new Error("Bu anahtar hiçbir private repoya yazamıyor. Anahtarda veri reposunu seçip Contents iznini Read and write yapın.");
    $("#kur-repo").replaceChildren(...liste.map(({ repo, dal }) => Object.assign(document.createElement("option"), { value: JSON.stringify({ repo, dal }), textContent: repo })));
    $("#repo-alani").hidden = liste.length === 1;
    durum.textContent = liste.length === 1 ? `Anahtar doğru. Bağlanılacak repo: ${liste[0].repo}` : "Anahtar doğru. Bağlanılacak repoyu seçin.";
  } catch (err) {
    bulunanAnahtar = "";
    durum.textContent = err.message;
  }
}
let anahtarZamanlayici;
$("#kur-anahtar").addEventListener("input", () => { clearTimeout(anahtarZamanlayici); anahtarZamanlayici = setTimeout(repolariBul, 600); });
$("#kur-anahtar").addEventListener("change", repolariBul);

$("#elle-form").addEventListener("submit", (e) => {
  e.preventDefault();
  hata("#elle-hata");
  const anahtar = $("#kur-anahtar").value.trim();
  const sifre = $("#kur-sifre").value;
  if (!anahtar) return hata("#elle-hata", "GitHub erişim anahtarını yapıştırın.");
  if (sifre.length < 12) return hata("#elle-hata", "Giriş şifresi en az 12 karakter olmalı.");
  dugmeyleCalis(e.submitter ?? $("#elle-form button[type=submit]"), "Kontrol ediliyor…", async () => {
    try {
      await repolariBul();
      if (!$("#kur-repo").value) throw new Error($("#repo-durum").textContent || "Anahtar doğrulanamadı.");
      const { repo, dal } = JSON.parse($("#kur-repo").value);
      const varsayilanDal = await repoDogrula(anahtar, repo);
      const bilgi = { anahtar, repo, dal: dal || varsayilanDal };
      if ($("#kur-dosya").checked) dosyaIndir(await kurulumDosyasiOlustur(sifre, bilgi));
      $("#kur-anahtar").value = "";
      $("#kur-sifre").value = "";
      await kurVeGir(sifre, bilgi);
    } catch (err) {
      hata("#elle-hata", err.message);
    }
  });
});

// ---------- Giriş ----------
$("#giris-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hata("#giris-hata");
  const sifreAlani = $("#giris-sifre");
  const veriAlani = $("#giris-veri");
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
    return hata("#giris-hata", err instanceof YanlisSifre ? "Giriş şifresi yanlış." : err.message);
  }
  const veriSifresi = veriAlani.value;
  sifreAlani.value = "";
  veriAlani.value = "";
  await programiAc(cfg, veriSifresi);
});

// Kurulu cihazdan dosya: giriş şifresiyle açılıp aynı şifreyle dosyaya yazılır.
$("#giris-indir").addEventListener("click", () => {
  hata("#giris-hata");
  const sifre = $("#giris-sifre").value;
  if (!sifre) return hata("#giris-hata", "Kurulum dosyası için önce giriş şifrenizi yazın.");
  dugmeyleCalis($("#giris-indir"), "Hazırlanıyor…", async () => {
    try {
      const { anahtar, repo, dal } = await muhurAc(sifre, kayitOku());
      dosyaIndir(await kurulumDosyasiOlustur(sifre, { anahtar, repo, dal }));
    } catch (err) {
      hata("#giris-hata", err instanceof YanlisSifre ? "Giriş şifresi yanlış." : err.message);
    }
  });
});

$("#sifirla").addEventListener("click", () => { $("#sifirla-onay").hidden = false; });
$("#sifirla-evet").addEventListener("click", () => {
  localStorage.removeItem(DEPO_ANAHTARI);
  $("#sifirla-onay").hidden = true;
  goster("#karsilama");
});
$("#sifirla-hayir").addEventListener("click", () => { $("#sifirla-onay").hidden = true; });

goster(kayitOku() ? "#giris" : "#karsilama");

// Uygulama olarak kurulabilmesi ve internetsiz açılabilmesi için.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
