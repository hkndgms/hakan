// Giriş katmanının saf fonksiyonları. Arayüzden bağımsızdır, Node testleriyle sınanır.
// Bu dosya public repoda durur: içine hiçbir kişisel bilgi, repo adı veya anahtar yazılmaz.

export const PBKDF2_TEKRAR = 600000;
const EK_VERI = "hk-giris-v1";
const kodla = new TextEncoder();
const coz = new TextDecoder();

export class YanlisSifre extends Error {
  constructor() { super("Şifre yanlış."); this.name = "YanlisSifre"; }
}

export function b64(bayt) {
  let s = "";
  for (let i = 0; i < bayt.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bayt.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function b64Coz(metin) {
  const s = atob(metin);
  const cikti = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) cikti[i] = s.charCodeAt(i);
  return cikti;
}

export async function anahtarTuret(sifre, tuz, tekrar = PBKDF2_TEKRAR) {
  const temel = await crypto.subtle.importKey("raw", kodla.encode(sifre), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: tuz, iterations: tekrar },
    temel,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// Giriş bilgilerini (GitHub anahtarı, repo, dal) giriş şifresiyle mühürler.
export async function muhurle(sifre, veri, tekrar = PBKDF2_TEKRAR) {
  const tuz = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const anahtar = await anahtarTuret(sifre, tuz, tekrar);
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: kodla.encode(EK_VERI) },
    anahtar,
    kodla.encode(JSON.stringify(veri)),
  ));
  return { v: 1, tekrar, tuz: b64(tuz), iv: b64(iv), ct: b64(ct) };
}

export async function muhurAc(sifre, kayit) {
  if (!kayit || kayit.v !== 1) throw new Error("Kayıtlı giriş bilgisi tanınmadı.");
  const anahtar = await anahtarTuret(sifre, b64Coz(kayit.tuz), kayit.tekrar);
  let acik;
  try {
    acik = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64Coz(kayit.iv), additionalData: kodla.encode(EK_VERI) },
      anahtar,
      b64Coz(kayit.ct),
    );
  } catch {
    throw new YanlisSifre();
  }
  return JSON.parse(coz.decode(acik));
}

const YOL_PARCASI = /^[\w.-]+$/;

// Program dosyası yolu: "cekirdek/kripto.js" gibi; ".", ".." ve boş parça içeremez.
export function modulYoluGecerli(yol) {
  if (typeof yol !== "string" || !yol.endsWith(".js")) return false;
  return yol.split("/").every((p) => YOL_PARCASI.test(p) && p !== "." && p !== "..");
}

// "moduller/kasa/kasa.js" içindeki "../../cekirdek/depo.js" -> "cekirdek/depo.js"
export function yolCozumle(kaynakYolu, belirtec) {
  const parcalar = kaynakYolu.split("/").slice(0, -1);
  for (const p of belirtec.split("/")) {
    if (p === ".") continue;
    if (p === "..") {
      if (parcalar.length === 0) throw new Error(`Program klasörünün dışına çıkan içe aktarma: ${belirtec}`);
      parcalar.pop();
    } else {
      parcalar.push(p);
    }
  }
  return parcalar.join("/");
}

// Programın modülleri blob adresinden yüklendiği için göreli içe aktarmalar,
// önceden oluşturulmuş blob adresleriyle değiştirilir.
export function iceAktarmalariYenidenYaz(kaynak, harita, kaynakYolu = "") {
  return kaynak.replace(
    /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[\w./-]+\.js)\2/g,
    (_tam, on, tirnak, belirtec) => {
      const yol = yolCozumle(kaynakYolu, belirtec);
      if (!Object.hasOwn(harita, yol)) throw new Error(`Manifestte önce gelmesi gereken modül: ${yol}`);
      return on + tirnak + harita[yol] + tirnak;
    },
  );
}

export function manifestDogrula(manifest) {
  if (!manifest || !Array.isArray(manifest.dosyalar) || manifest.dosyalar.length === 0) {
    throw new Error("Program manifesti geçersiz.");
  }
  for (const yol of manifest.dosyalar) {
    if (!modulYoluGecerli(yol)) throw new Error(`Geçersiz modül yolu: ${yol}`);
  }
  if (!manifest.dosyalar.includes(manifest.giris)) throw new Error("Manifestte giriş modülü yok.");
  return manifest;
}
