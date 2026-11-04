# ComfyUI MiniMax H3 — My Prompt Synthesizer

Varian pribadi dari [`ComfyUI-MiniMax-H3-Prompt_Synthesizer`](https://github.com/mizukir0418-gif/ComfyUI-MiniMax-H3-Prompt_Synthesizer)
dengan **3 fitur baru di node canvas**.

Repo: <https://github.com/CraftBlack/ComfyUI-MiniMax-H3-_My_Prompt_Synthesizer>

---

## ✨ Fitur baru (yang membedakan dari node asli)

### 1. Tombol **⬆️ Upload Gambar** (gambar biasa)

Memasang gambar dasar (JPG/PNG/WebP) langsung dari file di komputer. Bisa juga
drag & drop file ke canvas. Ganti gambar dasar **tidak** menghapus overlay atau
goresan yang sudah ada — jadi tinggal tukar-tukar gambar tanpa mengulang kerjaan.

### 2. Tombol **⬆️ Upload Overlay** (PNG transparan)

Memasang PNG transparan sebagai **lapisan overlay** di atas gambar dasar. Ini yang
menghilangkan kerjaan "melukis overlay ulang": lukis/beri anotasi sekali, simpan
overlay-nya, lalu pakai terus di gambar apa pun.

Overlay hasil upload digambar **di bawah** goresan kuas, jadi kamu tetap bisa
menambah coretan baru di atasnya.

Tombol pendukung: **💾 Simpan Overlay** — mengunduh lapisan overlay saat ini
(gambar upload + goresan + S/A tag + frame) sebagai file PNG transparan.

### 3. Tombol **🗑️ Hapus Gambar** dan **🗑️ Hapus Overlay**

* **Hapus Gambar** — membuang gambar dasar. Ukuran canvas dan overlay dipertahankan,
  jadi posisi anotasi tidak bergeser.
* **Hapus Overlay** — membuang overlay hasil upload, goresan tangan tetap ada.

Keduanya bisa di-**Undo** (↩️), dan ikut tersimpan di history.

### 4. Tombol **↩️ Undo** dan **↪️ Redo**

Berlaku untuk **semua** perubahan state di node:

| Aksi | Bisa di-Undo / Redo? |
|---|---|
| Upload gambar dasar | ✅ |
| Upload overlay | ✅ |
| Hapus gambar dasar / overlay | ✅ |
| Melukis & menghapus goresan (termasuk eraser) | ✅ |
| Tambah, geser, hapus S Tag / A Tag | ✅ |
| Tambah, geser, resize, hapus frame | ✅ |
| Clear all & ganti mode Overlay/Blank | ✅ |

Detail:

* Riwayat menampung **25 langkah** terakhir.
* Melakukan aksi baru otomatis **mengosongkan** stack redo (perilaku standar).
* Tombol meredup kalau tidak ada langkah tersisa; arahkan kursor untuk melihat
  jumlah langkah yang tersedia.
* Undo **tidak** dieksekusi saat kamu sedang men-drag/menggeser elemen.

---

## 🔁 Alur pakai overlay berulang

```
1. Upload Gambar          -> pasang gambar dasar (mis. foto A)
2. Upload Overlay         -> pakai PNG transparan yang sudah kamu punya
   (atau lukis manual di canvas)
3. 💾 Simpan Overlay      -> simpan jadi PNG transparan untuk dipakai lain waktu
4. Queue Prompt           -> annotated_image keluar
5. Upload Gambar          -> ganti ke foto B, overlay TIDAK perlu digambar ulang
```

Simbol:

* **S Tag (➕)** = penanda subjek (segitiga menghadap bawah, label `S1`, `S2`, ...)
* **A Tag (▲)** = penanda aksi
* **Frame (➕)** = kotak shot dengan label `Shot 1`, `Shot 2`, ...
* **Eraser + klik ganda** pada tag/frame = hapus elemen itu

---

## 📦 Instalasi

**A. Git clone**

```powershell
cd C:\ComfyUI\custom_nodes
git clone https://github.com/CraftBlack/ComfyUI-MiniMax-H3-_My_Prompt_Synthesizer.git
# restart ComfyUI
```

**B. ComfyUI-Manager** → *Install via Git URL*:

```
https://github.com/CraftBlack/ComfyUI-MiniMax-H3-_My_Prompt_Synthesizer
```

**C. Manual** — salin folder ini ke `ComfyUI/custom_nodes/`.

**D. Linux / Colab**

```bash
COMFY="/content/ComfyUI"
mkdir -p "$COMFY/custom_nodes"
git clone https://github.com/CraftBlack/ComfyUI-MiniMax-H3-_My_Prompt_Synthesizer.git \
          "$COMFY/custom_nodes/ComfyUI-MiniMax-H3-_My_Prompt_Synthesizer"
```

Tidak ada dependensi baru: `aiohttp`, `Pillow`, `numpy`, dan `torch` sudah ada di ComfyUI.

> **Aman dipasang berdampingan** dengan node aslinya. Semua nama class, route API,
> dan extension sudah diberi awalan `My`, jadi tidak ada bentrok.

---

## 🧩 Node: `MiniMax H3 My Canvas Annotator 🎨`

Class: `MiniMax_H3_MyCanvasAnnotator` — kategori `MiniMax_H3`.

**Input**

| Nama | Tipe | Catatan |
|---|---|---|
| `image` | IMAGE (opsional) | Kalau disambung, gambar ini yang jadi gambar dasar dan menang atas hasil Upload Gambar |
| `mode` | STRING | `Overlay on Image` / `Blank Storyboard` — diisi otomatis oleh tombol mode |
| `canvas_data` | STRING | Diisi otomatis: overlay transparan (PNG data-URL) |
| `bg_data` | STRING | Diisi otomatis: gambar dasar terkompresi (WebP data-URL) |

**Output**

| Slot | Nama | Isi |
|---|---|---|
| 0 | `clean_image` | Gambar dasar saja |
| 1 | `annotated_image` | Gambar dasar + overlay (alpha composite) |
| 2 | `overlay_image` | **Overlay saja, RGBA** — alpha dipertahankan, sambungkan ke `SaveImage` untuk mengekspor PNG transparan |

> `overlay_image` berkanal 4 (RGBA). Node seperti `SaveImage` / `PreviewImage` bisa
> menerimanya; kalau ada node lain yang menolak, pakai `clean_image` atau
> `annotated_image` (RGB) sebagai gantinya.

## 🧩 Node: `MiniMax H3 My Prompt Synthesizer`

Class: `MiniMaxH3MyPromptSynthesizer` — sintesis prompt MiniMax H3 dari 4 dimensi
(shot type, perspective, lens optics, camera movement), mendukung output EN/CN.

---

## ⌨️ Kontrol canvas

| Aksi | Efek |
|---|---|
| Drag mouse | Menggambar |
| Drag file ke canvas | Pasang gambar dasar |
| **Shift** + drag file | Pasang sebagai overlay |
| Scroll | Zoom |
| Alt + drag / tombol tengah / ✋ Pan | Geser tampilan |
| Ctrl+C / Ctrl+V | Copy & paste tag terpilih |
| Ctrl+Z | Undo |
| Ctrl+Y / Ctrl+Shift+Z | Redo |
| Delete / Backspace | Hapus tag terpilih |
| Klik ganda saat Eraser aktif | Hapus tag/frame di bawah kursor |

---

## 🧪 Pengujian

Dua lapis tes, keduanya tanpa perlu ComfyUI jalan.

**1. Backend (composite gambar + alpha overlay)** — 20 pemeriksaan:

```powershell
C:\ComfyUI\venv\Scripts\python.exe tests\test_annotator.py
```

Menguji bentuk tensor output, alpha overlay, jalur `image` vs `bg_data`, overlay
berbeda ukuran (auto-scale), mode Blank Storyboard, dan data URL rusak.

**2. Frontend (upload / hapus / undo / redo)** — 28 pemeriksaan di Chromium sungguhan,
memakai file `web/js/minimax_h3_canvas.js` yang asli:

```powershell
node tests\browser\run_test.js
```

Menguji tombol-tombol baru, upload gambar & overlay transparan, overlay benar-benar
menempel di `canvas_data` (dicek nilai alpha piksel), Undo/Redo untuk upload, hapus,
goresan kuas dan tag, serta pengosongan stack redo oleh aksi baru.

Butuh Playwright. Kalau tidak terdeteksi otomatis:

```powershell
$env:PLAYWRIGHT_PATH = "C:\path\ke\node_modules\playwright"
```

---

## 🔧 Troubleshooting

| Masalah | Sebab / solusi |
|---|---|
| Canvas hitam, tidak ada gambar | Belum ada gambar dasar — klik **⬆️ Upload Gambar** atau sambungkan `image` |
| Overlay tidak muncul di hasil | Cek `canvas_data` terisi; kalau kosong, tekan sekali di canvas supaya data di-sync |
| Ukuran workflow membengkak | Gambar dasar disimpan sebagai WebP maks 1280 px dan overlay sebagai PNG maks 2048 px. Turunkan `BG_MAX_DIM` / `OVERLAY_MAX_DIM` di `web/js/minimax_h3_canvas.js` |
| Kualitas gambar dasar turun setelah reload | Itu efek kompresi penyimpanan. Untuk kualitas penuh, sambungkan gambar asli ke input `image` |
| Overlay bergeser saat ganti gambar dasar | Overlay selalu diskalakan mengikuti ukuran gambar dasar. Pakai gambar dasar dengan rasio aspek yang sama |
| Geser mouse ke kanan atas bikin jendela lain fokus sendiri | Hapus blok `mousemove` di `web/js/minimax_h3_sidebar.js`, atau hapus file itu kalau tombol jendela kanan tidak dipakai |

---

## 📄 Lisensi

Mengikuti paket aslinya — lihat [LICENSE](LICENSE).
