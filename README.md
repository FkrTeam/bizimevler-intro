# Scroll-Driven Video Template

Tek bir sabitlenmiş bölümde: video oynar, sonra içerik tutulan karenin üstünde
belirir. Kaydırmanın klibi sürdüğü modlar da var (`"forward"`, `"rewind"`); bu
proje klibi son karesinde donduran `"hold"` modunda. **Sıfır runtime
bağımlılığı** — derleme için sadece Vite.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/
npm run preview
npm run encode -- <girdi.mp4> [seçenekler]
```

---

## Yeni bir projeye uyarlama

Normalde tek bir dosyayı düzenlersiniz: **`template.config.js`**. `src/`
altında projeye özel hiçbir bilgi yok.

### 1. Kaynağın gerçek kare hızını doğrulayın

Konteynerin ilan ettiği sayıya güvenmeyin — düzenli aralıklarla kopya kare
taşıyan bir master 30 fps görünüp aslında 24 fps olabilir. Kontrolü ve ne
yapılacağını **Video kodlama** bölümü anlatıyor; doldurulmuş bir kaynağı
olduğu gibi kodlarsanız giriş oynatmasında tekleme, scrub'da takılma hissi ve
boşa giden bayt alırsınız.

Doldurma varsa kopyaları önce ayıklayın, sonra çıkanı betiğe verin:

```bash
ffmpeg -i kaynak.mp4 -vf "decimate=cycle=5" -an -c:v libx264 -qp 0 ara.mp4
```

### 2. Videoyu kodlayın

```bash
npm run encode -- kaynak.mp4 --out public/scroll-v1.mp4 --vmaf
```

Betik bu şablonun ihtiyaç duyduğu bayrak setini uygular, poster karesini üretir
ve config'e kopyalamanız gereken değerleri yazdırır:

```
Copy into template.config.js → video:
  src:      "./scroll-v1.mp4"
  width:    1792
  height:   934
  fps:      30
  duration: 9.067
```

**Dosya adını her seferinde versiyonlayın** (`scroll-v2.mp4`). Vite `public/`
içindeki dosyalara hash eklemez ve cache kuralları `immutable` diyor; aynı adı
tekrar kullanırsanız ziyaretçiler bir yıl boyunca eski videoyu görür.

### 3. `template.config.js`'i doldurun

Video değerleri, zaman çizelgesi, logo, ibare metni ve kartlar. Kart görselleri
`src/assets/` altına konur — Vite onları hash'ler ve `immutable` cache alırlar.

### 4. Bitti

Kartlar `index.html` içine **derleme anında** yazılır, tarayıcıda değil. Bu
bilinçli: markup eksiksiz gider, yani JavaScript çalışmasa da, hata verse de,
arama motoru gezse de içerik yerinde.

---

## Yapı

```
template.config.js        ← normalde düzenlediğiniz tek dosya
vite.config.js            ← config'i HTML'e enjekte eden eklenti
scripts/encode.mjs        ← video kodlama süreci
index.html                ← %PLACEHOLDER% kabuğu
public/                   ← Vite işlemeden dist/ köküne kopyalar
├── <video>.mp4
├── <video>-mobile.mp4    ← dikey kadraj (video.portrait)
├── poster.jpg
├── poster-mobile.jpg
├── og-image.jpg          ← paylaşım görseli, 1200×630
├── favicon.ico / favicon-32.png / apple-touch-icon.png
├── robots.txt / sitemap.xml
├── .htaccess             ← Apache / cPanel
└── _headers              ← CANLI HEDEF: Cloudflare Workers/Pages, Netlify
wrangler.jsonc            ← Cloudflare Workers deploy config
worker/index.js           ← Cloudflare Worker: .mp4 için byte-range (206) yanıtları
vercel.json               ← Vercel (kullanılmıyor)
deploy/
└── nginx.conf            ← nginx (kullanılmıyor)
src/
├── main.js               ← config'i modüllere bağlar
├── scrollVideo.js        ← oynatıcı; projeden habersiz
├── debug.js              ← ?debug ölçüm paneli
├── styles/{tokens,main}.css
├── assets/
└── utils/{math,motionPrefs}.js
```

---

## Yayına alma (Apache / cPanel)

```bash
npm ci          # temiz kurulum
npm run build   # dist/ sıfırdan üretilir
```

Sonra **`dist/` içeriğini** (klasörün kendisini değil) `public_html/` altına
kopyalayın. `.htaccess` gizli dosyadır — FTP istemcisinde "gizli dosyaları
göster" açık olmalı, yoksa sessizce atlanır ve cache/MIME kurallarının hiçbiri
uygulanmaz.

Yükledikten sonra üç kontrol:

1. `http://` ile açın — `https://`'e düşmüyorsa `.htaccess`'in başındaki
   HTTPS bloğunu yorumdan çıkarın. Bilerek kapalı: cPanel AutoSSL genelde
   kendi yönlendirmesini kurar ve iki tanesi yönlendirme döngüsü yapar.
2. Videoda ileri sarın — çalışmıyorsa `Accept-Ranges` başlığı geçmiyordur.
3. Linki WhatsApp'a yapıştırın — önizleme çıkmıyorsa `page.url` yanlıştır.

Alan adı değişirse tek yer: `template.config.js` → `page.url`. `robots.txt` ve
`sitemap.xml` içindeki adresler elle güncellenir.

**Klip değişirse dosya adını versiyonlayın** (`be-v12.mp4`). `public/` altındaki
dosyalara Vite hash eklemez ve cache kuralları `immutable` der; aynı adı yeniden
kullanırsanız ziyaretçiler bir yıl boyunca eski videoda kalır. Poster, ikon ve
paylaşım görseli bu kuralın dışında — onlar bir haftalık cache alır, ad
değiştirmeden güncellenebilirler.

---

## Zaman çizelgesi

`scroll` altındaki değerler bölümün kendi kaydırmasının kesirleri, yukarıdan
aşağı tek bir sekans gibi okunur:

Bu projenin ayarı (`mode: "hold"`):

```
klip kendi hızında oynar, son karesinde donar — zaman çizgisi kaydırmaya bağlı değil
0.00 ─ 0.28   son kare tek başına ekranda, ibare görünür
0.28 ─ 0.46   ibare söner, sahneyi boşaltır
0.40 ─ 0.75   kartlar son karenin üstüne gelir
0.75 ─ 1.00   sabit durur, okunur, bölüm serbest kalır
```

Hepsi kaydırma konumunun **saf fonksiyonu** — tek seferlik olay yok. Yukarı
kaydırınca her şey kendiliğinden geri sarılıyor, ayrı bir "geri al" mantığı
gerekmiyor.

### Üç mod

| `scroll.mode` | Davranış |
|---|---|
| `"hold"` | Klip bir kez oynar ve son karesinde durur. Kaydırma zaman çizgisine hiç dokunmaz; sadece içeriği o karenin üstüne getirir. |
| `"forward"` | Otomatik oynatma yok; kaydırma klibi baştan sona sürer. Basit hâli. |
| `"rewind"` | Klip bir kez oynar, sonra kaydırma onu sıfıra geri sarar. |

`"hold"` modunun tek kararı: **klip hâlâ oynarken kaydırılırsa ne olur?**
Oynamaya devam etmesine izin verilse kartlar klibin ortasındaki rastgele bir
karenin üstüne açılırdı — modun vaat etmediği tek şey bu. Bu yüzden bölümün
başından belirgin bir kaydırma (%6) "izlemeyi bıraktım" olarak okunur ve zaman
çizgisi o anda son kareye park edilir. Beklerseniz hiçbir şey atlanmaz.

`"rewind"` modunda çözülen asıl sorun **devir teslim**: ~10 saniyelik bir klip
çoğu ziyaretçi tarafından bitmeden kaydırılır. "Önce bitsin" derseniz, kaydırdığı
an zaman çizgisi hiç görülmemiş bir konuma zıplar. Bunun yerine devir teslim
anında videonun nerede kaldığı (T0) ve sayfanın ne kadar kaydığı (p0)
kaydedilir, sonra **kalan kaydırma, oynamış olan kısma** ölçeklenir. Erken
kaydırırsanız kısa bir klibi kalan mesafe boyunca geri sararsınız; beklerseniz
tamamını. Her iki durumda da zıplama yok, ölü kaydırma yok.

### Kaydırma mesafesi

Kaydırma zaman çizgisini sürdüğünde (`"rewind"`, `"forward"`)
`runwayPerSecond` (varsayılan 43dvh/sn) klip süresiyle çarpılıp bölüm
yüksekliğine dönüşür. Bunu klibe bağlı tutmak zorunlu: sabit bırakılırsa kısa
klip sürüklenir, uzun klip yarışır.

`scroll.runway` bunu doğrudan ezer ve `"hold"` için vardır: orada klip
sürülmediği için mesafeyi klibin süresine bağlamak ölü kaydırmadan başka bir şey
kazandırmaz. Mesafenin tek işi içeriğe gelip okunacak yer açmak — bu projede
200dvh, yani sabitlenmiş ekranın altında 100dvh gerçek yol.

---

## İki kadraj: `video.portrait`

Geniş master 1.92:1. Bir telefonun ~0.46:1 ekranını onunla kaplamak resmin
kabaca dörtte üçünü atar ve kırpmayı `object-fit`'in denk getirdiği yere
bırakır. Bu yüzden dar ekranlar aynı klibin **yeniden kodlanmışını** değil, o
şekil için kurgulanmış **ayrı bir kadrajını** alır.

Teslimat `<source media>` ile:

```html
<source src="./be-v11-mobile.mp4" type="video/mp4" media="(max-width: 719px)" />
<source src="./be-v11.mp4"        type="video/mp4" />
```

Kaynak seçimi bir kez, indirme başlamadan önce yapılır — **telefon geniş dosyayı
hiç indirmez**, masaüstü de dikeyini. Sıra önemli: eşleşen ilk `source` kazanır,
o yüzden dar durum önce, geniş kadraj koşulsuz fallback olarak sonra yazılır.

Bedeli, seçimin viewport değişince yeniden değerlendirilmemesi: masaüstü
penceresini breakpoint'in ötesine sürüklerseniz başladığı kadrajla kalır. Bu,
takasın doğru tarafı — alternatifi, yalnızca pencere sürüklenirken doğan bir
durumu düzeltmek için megabaytlarca dosyayı ikinci kez indirmek.

`poster` **attribute'u kullanılmıyor**: tek dosya alır, dikey kadrajın kendi
posteri gerekir. İkisi de `--film-poster` olarak token'a yazılır (dikey olan
config'in verdiği media query altında) ve `.film__video`'nun arka planı olarak
boyanır. Böylece breakpoint tek yerde — `template.config.js` — yaşar; markup ile
stil onun üzerinde ayrışamaz.

---

## Kart görselleri

Üç genişlik (480/800/1200 WebP q86) ve `sizes` ile teslim edilir. `sizes`
**render genişliğini** söyler, dosya genişliğini değil — cihaz piksel oranıyla
çarpmayı tarayıcı kendi yapar. 2× ekranda 347px'lik bir yuva 694px ister ve
800'ü alır; 400px'lik bir telefonda 40vw = 160px, 3× ile 480'i alır.

`width`/`height` en büyük dosyayı tarif eder; oran her boyutta aynı olduğu için
doğru intrinsic oranı verir ve yükleme sırasında sıçrama olmaz. `src` ise
ortadaki dosyadır: `srcset` tanımayan bir tarayıcının düşeceği yer, ve orada
doğru seçim en büyüğü değil, hiçbir durumda kötü olmayanıdır.

---

## Bu projenin klipleri — ölçülmüş kararlar

Her iki master da 30 fps ilan ediyordu; ikisi de gerçekte 30 fps değildi ve
ikisinin de sonunda donmuş bir kuyruk vardı. Ölçümler:

| | geniş kadraj | dikey kadraj |
|---|---|---|
| kaynak | `be-1.mp4` 1920×1000 | `be-mobil.mp4` 500×900 |
| gerçek kadans | **24**, temiz kopyalarla 30'a doldurulmuş | **30**, blend'lenmiş 24→30 |
| ölü kuyruk | 2.96 sn (183. kareden sonra donuk) | 1.33 sn |
| çıktı | 190 kare · 7.92 sn · 24 fps | 285 kare · 9.50 sn · 30 fps |
| ayar | crf 20 · GOP 48 · veryslow | crf 20 · GOP 60 · veryslow |
| boyut | 9.28 MB | 3.24 MB |
| VMAF | 98.16 / tavan **98.56** | 98.75 / tavan **99.65** |

Geniş kadrajın kopyaları temiz olduğu için `decimate=cycle=5` ile ayıklandı.
Dikey kadrajınkiler **blend'lenmiş** — bilgi karışmış, geri alınamaz — o yüzden
o klip kendi doğal 30 fps'inde kalıyor.

Tavanların 100 olmadığına dikkat: her iki master da zaten ~10 Mbps H.264, yani
kayıplı. Kalibrasyon yapmadan "98 aldık" cümlesi anlamsız; burada 98.16, tavanın
**%99.6'sı** demek.

**GOP artık 15 değil, 48.** Kısa GOP scrub'ın seek maliyeti içindi; `"hold"`
modunda klip sürülmüyor, tek seek son kareye ve o da yalnızca ziyaretçi girişi
atladığında. Ölçüm GOP 48'i hem 240'a hem 24'e tercih ediyor:

| | boyut | VMAF |
|---|---|---|
| crf 20 · GOP 48 | 9.28 MB | 98.16 |
| crf 18 · GOP 240 | 10.10 MB | 98.16 |
| crf 22 · GOP 48 | 8.00 MB | 97.95 |
| crf 20 · GOP 240 | 8.68 MB | 97.95 |

Aynı VMAF'ta GOP 48 her seferinde daha küçük: uzun GOP baytı P-zincirine
harcayıp kaliteyi düşürüyor, çok kısa GOP ise keyframe'e harcıyor. Son kareye
zorlanmış bir keyframe denendi — %2.9 boyut karşılığı ~50 ms; alınmadı.

Tekrar üretmek için:

```bash
# geniş kadraj
ffmpeg -y -i be-1.mp4 -vf "decimate=cycle=5" -frames:v 190 -an \
  -c:v libx264 -profile:v high -level 4.0 -refs 4 -preset veryslow \
  -crf 20 -g 48 -keyint_min 48 -sc_threshold 0 -pix_fmt yuv420p \
  -movflags +faststart public/be-v11.mp4

# dikey kadraj
ffmpeg -y -i be-mobil.mp4 -frames:v 285 -an \
  -c:v libx264 -profile:v high -level 4.0 -refs 4 -preset veryslow \
  -crf 20 -g 60 -keyint_min 60 -sc_threshold 0 -pix_fmt yuv420p \
  -movflags +faststart public/be-v11-mobile.mp4

# posterler (ilk kare)
ffmpeg -y -i public/be-v11.mp4 -vf "select=eq(n\,0),scale=1024:-2" \
  -frames:v 1 -q:v 6 public/poster.jpg
ffmpeg -y -i public/be-v11-mobile.mp4 -vf "select=eq(n\,0),scale=500:-2" \
  -frames:v 1 -q:v 6 public/poster-mobile.jpg

# kart görselleri
for p in be10 be11 be12; do for w in 480 800 1200; do
  ffmpeg -y -i $p.jpg -vf "scale=$w:-2:flags=lanczos" \
    -c:v libwebp -quality 86 -compression_level 6 -preset picture \
    src/assets/projects/$p-$w.webp
done; done
```

`npm run encode` betiğinin varsayılanları (GOP 15, crf 27, 30 fps) hâlâ
`"rewind"`/`"forward"` içindir — `"hold"` için yukarıdaki bayrak seti geçerli.

---

## Video kodlama — ölçülmüş kararlar

Aşağıdakilerin hepsi tahmin değil, VMAF ile ölçüldü.

**Önce skalayı kalibre edin: VMAF'ın tavanı 100 olmayabilir.** Bu klipte
_kayıpsız_ bir kodlama bile 97,98 veriyordu. Kareler birebir aynıydı (PSNR
sonsuz, adm/vif ≈ 1,0); sebep libvmaf'ın yüksek hareketli görüntüde regresyon
çıktısını 100'ün altına düşürmesi. Yani mutlak skoru "90+ iyidir" diye okumak
yanıltır. Her ölçüm turuna kaynağın kayıpsız bir kodlamasını sokup tavanı
belirleyin, kararları **tavana uzaklığa** göre verin. Kopya kareler ayıklanınca
aynı klibin tavanı 97,98'den 98,57'ye çıktı — tavan içeriğe göre değişiyor.

**Kare hızı kaynağın _gerçek_ hızıyla aynı kalmalı — ve o hız konteynerin ilan
ettiği sayı olmayabilir.** Hızı düşürmek scrub'da görünmez (hızı ziyaretçi
kontrol ediyor) ama giriş oynatmasında gözle görülür şekilde tekler; gerçekten
30 fps olan bir kaynağı 24'e indirmek daha da kötüdür, çünkü tam bölünmeyen
dönüşüm düzensiz kare aralığı üretir.

Fakat bu projenin klibi 30 fps ilan ediyordu ve **her beşinci karesi bir
öncekinin kopyasıydı**: 24 fps'lik bir master, kare çoğaltılarak 30'a
doldurulmuş. Doldurmayı taşımak üç yerden birden zarar verir — giriş
oynatmasında düzensiz kare aralığı (tam da kaçınmaya çalıştığınız tekleme),
scrub'da her beş karede bir "değişmedi" hissi, ve boşa giden bayt.

Kontrolü ucuz — kare farkının ortalama parlaklığını yazdırın:

```bash
ffmpeg -i kaynak.mp4 -vf "tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG" -f null -
```

Düzenli aralıklarla sıfıra yakın değerler görüyorsanız kaynak doldurulmuştur.
Bu klipte 110 karenin 22'si, istisnasız beşte bir aralıkla sıfırdı.

**Doldurmayı `decimate` ile atın, `fps=` ile değil.** İkisi de doğru sayıda kare
üretir, ama `fps=` seçimini zaman damgasına göre yapar ve yuvarlama denk
gelmediğinde kopyayı tutup gerçek kareyi atar. `decimate=cycle=5` seçimi içeriğe
göre yapar: her beşlide en çok tekrar edeni atar. Fark ölçüldüğünde tartışmasız:

| Yöntem | Atılan karelerin ortalama hareketi (YAVG) |
|---|---|
| `fps=24` | 7,14 — gerçek içerik atılmış |
| **`decimate=cycle=5`** | **0,23 — yalnızca kopyalar** |

Bu, "hareketli bölümde kopya kaldı mı?" diye bakarak yakalanmaz; yanlış kare
atıldığında da geriye kopya kalmaz. Ayırt etmek için iki dosyanın tüm karelerini
hash'leyip küme olarak karşılaştırmak gerekti.

Kopyaların atılması ölçülen kaliteyi de yükseltti: aynı CRF'te tavana uzaklık
0,62 VMAF'tan 0,31'e indi. Buna karşılık dosya %8 **büyüdü** — kopya kareler
sabit CRF'te neredeyse bedavaydı, onlar gidince geriye yalnızca gerçek bedeli
olan kareler kaldı. Kare sayısının azalması dosyayı küçültmez; baytı kaliteye
kaydırır.

**GOP en büyük lever ve iki yönlü keser.** Rastgele kareye gitmek en yakın
keyframe'den ileri çözmek demek, yani kısa GOP scrub'ı ucuzlatır. Ama yavaş
veya durağan görüntüde sık keyframe, neredeyse aynı resmi tam maliyetle
yeniden kodlayıp dosyanın çoğunu yer. Bu projede 10 → 15 geçişi dosyayı **%15
küçültürken kaliteyi de artırdı**.

| GOP | Boyut | Kalite | En kötü seek |
|---|---|---|---|
| 5 | +%60 | daha düşük | 4 kare |
| 10 | referans | referans | 9 kare |
| **15** | **−%15** | **+1,0 VMAF** | **14 kare** |
| 20 | −%16 | +2,5 VMAF | 19 kare |

Eğilim ikinci klipte de sürdü ve daha ileri gitti — 1920×1000, crf 20'de ölçüm:

| GOP | Boyut | VMAF | En kötü seek |
|---|---|---|---|
| 15 | 14,51 MB | 96,73 | 14 kare |
| 20 | 13,04 MB | 96,77 | 19 kare |
| 25 | 12,37 MB | 96,84 | 24 kare |
| **30** | **10,98 MB** | **96,96** | **29 kare** |

Yani GOP 30, 15'e göre hem %24 küçük hem daha kaliteli. Tek bedeli arama
zinciri, ve bu bedel ölçüldüğünde küçük çıktı: **tek çekirdek yazılım** decode
ile en kötü seek GOP 20'de 107 ms, GOP 30'da 141 ms (crf 18'de ölçüldü; GOP 15
ayrıca ölçülmedi). Donanım decode'da bu fark ~10 ms'e iniyor ve h264 donanım
decode'u fiilen evrensel — kaçınılması gereken şey AV1'di, h264 değil. 2,6 MB
ise her ziyaretçinin her soğuk yüklemede ödediği gerçek maliyet. Bu yüzden
şablonun varsayılanı 15'te bırakıldı ama bu proje
**saniyede bir keyframe** ile sevk ediliyor: 30 fps'te `--gop 30`, 24 fps'te
`--gop 24`.

**Bayt'ı çözünürlüğe harcayın, CRF'e değil.** Sabit bütçede piksele harcamak
her ölçümde kuantalayıcıya harcamayı yendi. 1600/crf27 (4,61 MB) 1280/crf23'e
(5,19 MB) eşit kalite verdi, 0,58 MB daha az yerle.

**`-level 4.0 -refs 4` kozmetik değil.** Bunlar olmadan `veryslow` referans
sayısını 16'ya çıkarıyor ve dosya AVC seviye 5.0 ilan ediyor; bu, eski
cihazları donanım decode'dan yazılıma düşürür — yani tam da kaçınmaya
çalıştığınız takılmayı üretir.

**İşe yaramayanlar** (denendi, ölçüldü, atıldı): `-preset veryslow` tek başına
kısa GOP'ta hiçbir kazanç vermedi (dosyanın %85'i I-frame, preset iyileştirmesi
inter-frame tahmininde işe yarıyor) · `-bf 0` hem %7 büyüttü hem seek zincirini
uzattı · `-aq-mode 3` kaliteyi düşürdü.

**AV1** aynı boyutta ~+2,3 VMAF veriyor, aynı kalitede ~%24 küçük. Ama scroll
scrub'ı için riskli: AV1 donanım decode'u yalnızca yeni cihazlarda var, eski
cihazlar yazılımda çözer ve biz saniyede onlarca seek yapıyoruz. Tarayıcı
desteği ile donanım desteği aynı şey değil.

---

## Oynatıcı — çözülen dört sorun

Çoğu scroll-video uygulaması `video.currentTime = progress * duration` satırını
doğrudan scroll handler'ına yazdığı için takılır.

**Seek kuyruğa girmiyor.** Scroll, decoder'ın seek yapabileceğinden çok daha
sık tetiklenir; her yazma devam eden seek'i geçersiz kılar ve decoder hiç kare
gösteremez. Scroll hiçbir şey yazmıyor, tek bir rAF döngüsü hedefe sönümleniyor.

**Bir seek bitmeden yenisi açılmıyor.** `requestVideoFrameCallback` karenin
ekrana geldiğini bildirene kadar bekleniyor; 400 ms watchdog ile kilitlenme yok.

**Kare altı seek yapılmıyor.** Fark 1/fps'in altındaysa atlanıyor.

**İnmemiş veriye seek yapılmıyor.** Soğuk cache'te hedef buffer dışındaysa en
yakın hazır kenara kırpılıyor. Görüntü kaydırmanın birkaç kare gerisinde kalıyor
ama donmuyor — çok daha iyi bir bozulma biçimi. İndirme sürerken seek toleransı
da 3 kareye genişliyor.

Ayrıca: bölüm ekran dışındayken döngü tamamen duruyor · iOS'ta hiç oynamamış
video kare boyamadığı için muted play/pause ile decoder primeleniyor · ilerleme
çubuğu 1000 adımda ve `scaleX` ile güncelleniyor.

---

## Erişilebilirlik

- `prefers-reduced-motion: reduce`: otomatik oynatma yok, scrub yok, döngü
  başlamıyor. Poster duruyor ve kaydırmanın açacağı her şey baştan görünür.
  Uzun koşu mesafesi tek ekrana iniyor, yoksa ölü kaydırma olurdu.
- **İçerik JavaScript olmadan görünür.** CSS'te varsayılan görünür; gizli
  başlangıç durumu yalnızca `<head>` içindeki satır içi script'in eklediği
  `.js-anim` sınıfı altında devreye giriyor.
- Scroll ele geçirilmiyor; `position: sticky` kullanılıyor.
- Video `aria-hidden="true"` — anlamı çevresindeki metin taşıyor.
- Kartlar opaklık %60'ı geçene kadar `pointer-events: none` — görünmez link
  tuzağı yok.
- Skip link, görünür odak halkaları, durum rengine ek metin.

---

## Canlı sunucu

**Byte-range zorunlu.** `Accept-Ranges: bytes` göndermeyen sunucuda tarayıcı
seek yapamaz, tüm dosyayı indirir. Yayın sonrası doğrulayın:

```bash
curl -I -H "Range: bytes=0-1023" https://siteniz.com/scroll-v1.mp4
```

`HTTP/2 206` görmelisiniz. **200 dönerse scrub kesin takılır.**

**Videoyu sıkıştırmayın.** MP4 zaten sıkıştırılmış; gzip CPU yakar, kazanç ~%0
ve **range request'i bozar**.

**Cache:** `index.html` → `max-age=0, must-revalidate` (yoksa deploy görünmez) ·
`/assets/*` ve `/*.mp4` → `immutable`.

Host'a göre dosyalar hazır: `public/_headers` + `wrangler.jsonc` + `worker/`
(Cloudflare Workers — canlı hedef; aynı `_headers` Cloudflare Pages ve Netlify'da
da çalışır), `vercel.json`, `deploy/nginx.conf`, `public/.htaccess` (Apache).

**Byte-range zorunlu.** Safari, `Range` isteğine `206 Partial Content` dönmeyen
bir sunucudan video oynatmaz; Chromium ise her seek'te dosyayı baştan indirir.
Apache, nginx, Vercel ve Netlify bunu kendiliğinden yapar. Cloudflare'in statik
dosya servisi yapmaz — `worker/index.js` bu yüzden var: `.mp4` istekleri
(`run_worker_first`) Worker'a düşer, o da dosyayı dilimleyip `206` döner. Yerelde
denemek için `npx wrangler dev`, sonra:

```bash
curl -sI -H "Range: bytes=0-1023" http://127.0.0.1:8787/be-v11.mp4
# beklenen: HTTP/1.1 206 Partial Content, Content-Range: bytes 0-1023/<boyut>
```

---

## Hata ayıklama

`?debug` ekleyin — sol üstte canlı panel açılır. Üç farklı sebep aynı hissi
verir ama sayılar ayırır:

| Belirti | Sebep |
|---|---|
| fps düşük, seek süreleri düşük | Kompozisyon/boyama — katmanlar, blur |
| fps normal, seek süreleri yüksek (>50 ms) | Decode — GOP uzun, çözünürlük yüksek |
| buffered %100'ün altındayken sıçramalar | Ağ / inmemiş veriye seek |

`?noblur` ile kartların backdrop blur'ünü kapatabilirsiniz. Birleştirin:
`?debug&noblur`.

---

## Bilinen sınırlar

- Tek tema (koyu). Video arka planı sayfa arka planıyla eşleşmek zorunda:
  `tokens.css` içindeki `--bg`.
- İçerik ızgarası üç karta göre ayarlı. Farklı sayı için `main.css` içindeki
  `.cards` grid tanımı değişmeli.
- Tarayıcıda görsel doğrulama yapılmadı; sayılar ve build doğrulandı.
