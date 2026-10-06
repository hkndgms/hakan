# Giriş sayfası

Bu public repo sadece kişisel kasa sisteminin giriş sayfasını içerir ve GitHub Pages ile yayınlanır. Program ve veriler ayrı bir private repoda durur. Ayrıntılı mimari ve kurallar o repodaki CLAUDE.md dosyasındadır.

## Kurallar

- Bu repo herkese açıktır. İçine kişisel bilgi, private reponun adı, anahtar veya şifre asla yazılmaz.
- Sayfa olabildiğince küçük kalır: şifre kutusu, şifre çözme, programı cihazda şifreli saklama ve çalıştırma. Başka özellik eklenmez.
- Program önbelleği (IndexedDB `hk-program`), kurulumda üretilip giriş şifresiyle mühürlenen ayrı bir anahtarla şifrelenir. Dosyalar git kimliğiyle doğrulanır.
- `sw.js` sadece bu sitenin kendi dosyalarını saklar; GitHub isteklerine karışmaz. Dosya listesi değişirse `SURUM` artırılır.
- Dış kaynaktan script, font veya stil yüklenmez.
- `index.html` içindeki Content-Security-Policy gevşetilmez.
- Her değişiklikten sonra `npm test` çalıştırılır.

## Kullanıcının kuralları

Henüz tanımlanmadı. Kullanıcı kurallarını verdiğinde buraya da eklenecek.
