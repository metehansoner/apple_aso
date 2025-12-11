# Apple ASO - AppStore Connect Otomasyon Aracı

🍎 AppStore Connect için keywords ve app bilgilerini toplu güncelleme sistemi

## Özellikler

### 📱 Keywords Menüsü
- JSON response'dan keywords parse etme
- CSV ile toplu düzenleme
- Değişiklikleri karşılaştırma (kırmızı vurgulama)
- Sadece değişen kayıtlar için otomatik curl çalıştırma
- Status kodları ile başarı/hata takibi

### 📝 Name & Subtitle Menüsü
- AppInfo JSON parse etme
- State seçimi (PREPARE_FOR_SUBMISSION, READY_FOR_SALE, vb.)
- Name ve Subtitle toplu düzenleme
- CSV karşılaştırma ve otomatik güncelleme
- Sadece değişiklik olan kayıtları güncelleme

### 📋 Best ASO Prompt
- ASO optimizasyon rehberi
- 39 dil için kurallar ve öneriler
- Markdown formatında güzel görüntüleme

## Kurulum

```bash
npm install
npm start
```

Tarayıcıda `http://localhost:3000` adresine gidin.

## Kullanım

1. İlgili menüyü seçin
2. JSON response'u yapıştırın
3. Mevcut veriyi indirin (CSV)
4. CSV'yi düzenleyin
5. Düzenlenmiş CSV'yi yükleyin
6. Curl komutunu yapıştırın
7. Sadece değişiklik olan kayıtlar otomatik güncellenir

## Teknolojiler

- Node.js
- Express.js
- Vanilla JavaScript
- Modern CSS

