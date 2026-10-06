// Giriş sayfasının arayüzü. Akış:
// 1) İlk kez: GitHub anahtarı + repo + dal girilir, giriş şifresiyle mühürlenip bu cihazda saklanır.
// 2) Sonraki girişlerde: giriş şifresi mührü açar, program private repodan indirilip bellekte çalıştırılır.
import {
  muhurle, muhurAc, YanlisSifre, iceAktarmalariYenidenYaz, manifestDogrula, b64Coz,
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

// Dosya içeriği git blob API'sinden alınır. GitHub'ın "contents" yanıtı bazı dosyaları
// metin sanıp karakter dönüşümünden geçirdiği için içerik için kullanılmaz.
async function hamDosya(cfg, yol) {
  const j = await (await githubIstek(
    cfg,
    `/repos/${cfg.repo}/contents/${yolKodla(yol)}?ref=${encodeURIComponent(cfg.dal)}`,
    "application/vnd.github+json",
  )).json();
  const blob = await (await githubIstek(cfg, `/repos/${cfg.repo}/git/blobs/${j.sha}`, "application/vnd.github+json")).json();
  return new TextDecoder().decode(b64Coz((blob.content ?? "").replace(/\s/g, "")));
}

async function programiYukle(cfg) {
  const manifest = manifestDogrula(JSON.parse(await hamDosya(cfg, "app/manifest.json")));
  // Dosyalar paralel indirilir, sonra bağımlılık sırasıyla bağlanır.
  const kaynaklar = await Promise.all(manifest.dosyalar.map((yol) => hamDosya(cfg, `app/${yol}`)));
  const harita = {};
  manifest.dosyalar.forEach((yol, i) => {
    const kaynak = iceAktarmalariYenidenYaz(kaynaklar[i], harita, yol);
    harita[yol] = URL.createObjectURL(new Blob([kaynak], { type: "text/javascript" }));
  });
  return import(harita[manifest.giris]);
}

function kilitle() {
  // Sayfayı yeniden yüklemek bellekteki anahtarları ve çözülmüş verileri siler.
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
    const kayit = await muhurle(sifre, { anahtar, repo, dal });
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
  } catch (err) {
    sifreAlani.value = "";
    goster("#giris");
    return hata("#giris-hata", err instanceof YanlisSifre ? "Şifre yanlış." : err.message);
  }
  sifreAlani.value = "";
  try {
    $("#yukleniyor-mesaj").textContent = "Program indiriliyor…";
    const program = await programiYukle(cfg);
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
