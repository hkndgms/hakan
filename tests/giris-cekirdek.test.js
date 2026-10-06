import { test } from "node:test";
import assert from "node:assert/strict";
import {
  b64, b64Coz, muhurle, muhurAc, YanlisSifre,
  iceAktarmalariYenidenYaz, manifestDogrula, modulYoluGecerli, yolCozumle,
} from "../giris-cekirdek.js";

const HIZLI = 1000; // Testlerde hız için düşük tekrar sayısı kullanılır.

test("base64 büyük veride gidiş-dönüş yapar", () => {
  const veri = new Uint8Array(200000);
  for (let i = 0; i < veri.length; i += 65536) crypto.getRandomValues(veri.subarray(i, i + 65536));
  assert.deepEqual(b64Coz(b64(veri)), veri);
});

test("doğru şifre mührü açar", async () => {
  const bilgi = { anahtar: "github_pat_deneme", repo: "a/b", dal: "main" };
  const kayit = await muhurle("dogru-sifre-123", bilgi, HIZLI);
  assert.deepEqual(await muhurAc("dogru-sifre-123", kayit), bilgi);
});

test("mühür içinde anahtar düz yazı olarak görünmez", async () => {
  const kayit = await muhurle("dogru-sifre-123", { anahtar: "github_pat_GIZLI" }, HIZLI);
  assert.ok(!JSON.stringify(kayit).includes("GIZLI"));
});

test("yanlış şifre reddedilir", async () => {
  const kayit = await muhurle("dogru-sifre-123", { anahtar: "x" }, HIZLI);
  await assert.rejects(muhurAc("yanlis-sifre-123", kayit), YanlisSifre);
});

test("değiştirilmiş mühür reddedilir", async () => {
  const kayit = await muhurle("dogru-sifre-123", { anahtar: "x" }, HIZLI);
  const ct = b64Coz(kayit.ct);
  ct[0] ^= 1;
  await assert.rejects(muhurAc("dogru-sifre-123", { ...kayit, ct: b64(ct) }), YanlisSifre);
});

test("aynı veri her mühürde farklı görünür", async () => {
  const a = await muhurle("s-123456789012", { anahtar: "x" }, HIZLI);
  const b = await muhurle("s-123456789012", { anahtar: "x" }, HIZLI);
  assert.notEqual(a.ct, b.ct);
  assert.notEqual(a.tuz, b.tuz);
});

test("içe aktarmalar blob adresleriyle değiştirilir", () => {
  const harita = { "a.js": "blob:1", "b.js": "blob:2" };
  const kaynak = [
    'import { x } from "./a.js";',
    "import * as y from './b.js';",
    'import "./a.js";',
    'const z = await import("./b.js");',
    'export { q } from "./a.js";',
  ].join("\n");
  const sonuc = iceAktarmalariYenidenYaz(kaynak, harita);
  assert.equal(sonuc, [
    'import { x } from "blob:1";',
    "import * as y from 'blob:2';",
    'import "blob:1";',
    'const z = await import("blob:2");',
    'export { q } from "blob:1";',
  ].join("\n"));
});

test("manifest dışındaki modül reddedilir", () => {
  assert.throws(() => iceAktarmalariYenidenYaz('import "./yok.js";', {}), /Manifestte önce/);
});

test("alt klasörlerdeki göreli yollar çözülür", () => {
  assert.equal(yolCozumle("moduller/kasa/kasa.js", "../../cekirdek/depo.js"), "cekirdek/depo.js");
  assert.equal(yolCozumle("moduller/kasa/kasa.js", "./defter.js"), "moduller/kasa/defter.js");
  assert.equal(yolCozumle("cekirdek/kabuk.js", "../moduller/kasa/kasa.js"), "moduller/kasa/kasa.js");
  assert.throws(() => yolCozumle("a.js", "../disari.js"), /dışına çıkan/);
  const harita = { "cekirdek/depo.js": "blob:d", "moduller/kasa/defter.js": "blob:k" };
  const sonuc = iceAktarmalariYenidenYaz(
    'import { a } from "../../cekirdek/depo.js";\nimport * as d from "./defter.js";',
    harita,
    "moduller/kasa/kasa.js",
  );
  assert.equal(sonuc, 'import { a } from "blob:d";\nimport * as d from "blob:k";');
});

test("manifest doğrulaması", () => {
  assert.ok(manifestDogrula({ giris: "main.js", dosyalar: ["a.js", "main.js"] }));
  assert.ok(manifestDogrula({ giris: "c/k.js", dosyalar: ["c/a.js", "c/k.js"] }));
  assert.throws(() => manifestDogrula({ giris: "main.js", dosyalar: [] }));
  assert.throws(() => manifestDogrula({ giris: "main.js", dosyalar: ["../kotu.js", "main.js"] }));
  assert.throws(() => manifestDogrula({ giris: "main.js", dosyalar: ["a//b.js", "main.js"] }));
  assert.throws(() => manifestDogrula({ giris: "yok.js", dosyalar: ["main.js"] }));
  assert.equal(modulYoluGecerli("/kok.js"), false);
  assert.equal(modulYoluGecerli("a/./b.js"), false);
  assert.equal(modulYoluGecerli("a/b.txt"), false);
});

import { onbellekAnahtariUret, onbellekSifrele, onbellekCoz, blobSha, programDosyalari } from "../giris-cekirdek.js";
import { createHash } from "node:crypto";

test("program önbelleği şifreli saklanır, başka anahtar ya da kimlikle açılmaz", async () => {
  const anahtar = onbellekAnahtariUret();
  const kod = new TextEncoder().encode("export const x = 1; // GIZLI-KOD");
  const paket = await onbellekSifrele(anahtar, kod, "sha-a");
  assert.ok(!Buffer.from(paket).toString("latin1").includes("GIZLI"));
  assert.deepEqual(await onbellekCoz(anahtar, paket, "sha-a"), kod);
  await assert.rejects(onbellekCoz(onbellekAnahtariUret(), paket, "sha-a"));
  await assert.rejects(onbellekCoz(anahtar, paket, "sha-b"));
});

test("git dosya kimliği git ile aynı hesaplanır", async () => {
  const bayt = new TextEncoder().encode("merhaba\n");
  const beklenen = createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${bayt.length}\0`), Buffer.from(bayt)])).digest("hex");
  assert.equal(await blobSha(bayt), beklenen);
});

test("ağaçtan sadece program dosyaları alınır", () => {
  const agac = { tree: [
    { type: "blob", path: "app/manifest.json", sha: "1" },
    { type: "blob", path: "app/cekirdek/kabuk.js", sha: "2" },
    { type: "tree", path: "app/cekirdek", sha: "3" },
    { type: "blob", path: "tests/a.js", sha: "4" },
  ] };
  assert.deepEqual(programDosyalari(agac), { "manifest.json": "1", "cekirdek/kabuk.js": "2" });
});

import { kurulumDosyasiOlustur, kurulumDosyasiAc } from "../giris-cekirdek.js";

test("kurulum dosyası şifreyle açılır; veri şifresi ve önbellek anahtarı içinde olmaz", async () => {
  const bilgi = { anahtar: "github_pat_GIZLI", repo: "a/b", dal: "main", onbellek: "x", veriSifresi: "y" };
  const dosya = await kurulumDosyasiOlustur("dosya-sifresi-uzun", bilgi, HIZLI);
  const metin = JSON.stringify(dosya);
  assert.ok(!metin.includes("GIZLI") && !metin.includes("a/b"));
  assert.deepEqual(await kurulumDosyasiAc("dosya-sifresi-uzun", metin), { anahtar: "github_pat_GIZLI", repo: "a/b", dal: "main" });
  await assert.rejects(kurulumDosyasiAc("yanlis-sifre", metin), YanlisSifre);
  await assert.rejects(kurulumDosyasiAc("x", "merhaba"), /kurulum dosyası değil/);
});

test("cihaz kaydı kurulum dosyası yerine, kurulum dosyası cihaz kaydı yerine açılmaz", async () => {
  const kayit = await muhurle("sifre-123456789", { anahtar: "a" }, HIZLI);
  await assert.rejects(kurulumDosyasiAc("sifre-123456789", JSON.stringify({ ...kayit, tur: "hk-kurulum" })), YanlisSifre);
  const dosya = await kurulumDosyasiOlustur("sifre-123456789", { anahtar: "a", repo: "r/r", dal: "d" }, HIZLI);
  await assert.rejects(muhurAc("sifre-123456789", dosya), YanlisSifre);
});
