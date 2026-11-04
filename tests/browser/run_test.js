/**
 * Uji browser untuk web/js/minimax_h3_canvas.js
 * ============================================
 * Menjalankan file JS ASLI (bukan salinan) di Chromium sungguhan, dengan
 * `scripts/app.js` versi stub dan node ComfyUI tiruan. Yang diuji:
 *
 *   - tombol Upload Gambar / Upload Overlay / Simpan / Hapus / Undo / Redo ada
 *   - upload gambar dasar & overlay transparan benar-benar masuk ke data node
 *   - overlay menempel ke `canvas_data` (dicek nilai alpha pikselnya)
 *   - Undo & Redo bekerja untuk upload, hapus, goresan kuas, dan tag
 *   - aksi baru mengosongkan stack redo
 *
 * Jalankan:
 *
 *     node tests/browser/run_test.js
 *
 * Butuh Playwright + Chromium. Kalau Playwright tidak ditemukan otomatis,
 * arahkan lewat env var:
 *
 *     $env:PLAYWRIGHT_PATH = "C:\path\ke\node_modules\playwright"
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const CANVAS_JS = path.join(HERE, "..", "..", "web", "js", "minimax_h3_canvas.js");

function loadPlaywright() {
    const candidates = [
        process.env.PLAYWRIGHT_PATH,
        "playwright",
        "C:/Users/User/AppData/Roaming/npm/node_modules/omniroute/node_modules/playwright",
        path.join(process.env.APPDATA || "", "npm/node_modules/playwright"),
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            return require(candidate);
        } catch (_) { /* coba kandidat berikutnya */ }
    }
    throw new Error(
        "Playwright tidak ditemukan. Install dengan `npm i -g playwright` atau set env PLAYWRIGHT_PATH."
    );
}

const { chromium } = loadPlaywright();

const ROUTES = {
    "/": path.join(HERE, "index.html"),
    "/index.html": path.join(HERE, "index.html"),
    "/scripts/app.js": path.join(HERE, "app_stub.js"),
    "/extensions/PACK/js/minimax_h3_canvas.js": CANVAS_JS,
};

const MIME = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".png": "image/png" };

const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]);
    const file = ROUTES[rel];
    if (!file) { res.writeHead(404); res.end("404"); return; }
    fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(500); res.end(String(err)); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(data);
    });
});

async function launchBrowser() {
    try {
        return await chromium.launch({ headless: true });
    } catch (e) {
        console.log("[info] Chromium bawaan Playwright gagal, mencoba Chrome terpasang...");
        return await chromium.launch({ headless: true, channel: "chrome" });
    }
}

server.listen(0, "127.0.0.1", async () => {
    const port = server.address().port;
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });

    const pageErrors = [];
    page.on("pageerror", (e) => { pageErrors.push(e.message); console.log("[pageerror]", e.message); });

    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await page.waitForFunction("window.__loaded === true");

    const results = await page.evaluate(async () => {
        const out = [];
        const ok = (label, cond, detail = "") => out.push({ label, pass: !!cond, detail });

        const until = async (fn, ms = 6000) => {
            const t0 = Date.now();
            while (Date.now() - t0 < ms) {
                try { if (fn()) return true; } catch (_) { /* belum siap */ }
                await new Promise((r) => setTimeout(r, 40));
            }
            return false;
        };

        const getAlpha = (dataUrl, x, y) => new Promise((resolve) => {
            const im = new Image();
            im.onload = () => {
                const c = document.createElement("canvas");
                c.width = im.width;
                c.height = im.height;
                const cx = c.getContext("2d");
                cx.drawImage(im, 0, 0);
                resolve(cx.getImageData(x, y, 1, 1).data[3]);
            };
            im.onerror = () => resolve(-1);
            im.src = dataUrl;
        });

        const { app } = await import("/scripts/app.js");
        if (!app.__ext) return [{ label: "extension terdaftar", pass: false, detail: "app.__ext kosong" }];

        const host = document.getElementById("host");
        const node = {
            comfyClass: "MiniMax_H3_MyCanvasAnnotator",
            widgets: [
                { name: "mode", value: "Overlay on Image", type: "string" },
                { name: "canvas_data", value: "", type: "string" },
                { name: "bg_data", value: "", type: "string" },
            ],
            properties: {},
            size: [400, 600],
            addDOMWidget(_n, _t, el) { host.appendChild(el); this.__el = el; },
            computeSize() { return [400, 600]; },
            setSize() {},
        };

        await app.__ext.nodeCreated(node);
        await new Promise((r) => setTimeout(r, 250));

        const container = node.__el;
        const canvasEl = container.querySelector("canvas");
        const inputs = container.querySelectorAll('input[type="file"]');
        const widget = (name) => node.widgets.find((w) => w.name === name);
        const btn = (label) => [...container.querySelectorAll("button")].find((b) => b.textContent.includes(label));
        const state = () => { try { return JSON.parse(node.properties.canvas_state || "{}"); } catch (_) { return {}; } };
        const modeData = () => state().modeData?.["Overlay on Image"] || {};
        const strokeCount = () => (modeData().strokes || []).length;
        const tagCount = (k) => (modeData()[k] || []).length;

        const makeFile = (w, h, paint, name) => new Promise((resolve) => {
            const c = document.createElement("canvas");
            c.width = w; c.height = h;
            paint(c.getContext("2d"), w, h);
            c.toBlob((b) => resolve(new File([b], name, { type: "image/png" })), "image/png");
        });

        const upload = (index, file) => {
            const input = inputs[index];
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event("change"));
        };

        // ---------- 1. tombol ----------
        const wanted = ["⬆️ Upload Gambar", "🗑️ Hapus Gambar", "⬆️ Upload Overlay", "💾 Simpan Overlay", "🗑️ Hapus Overlay", "↩️ Undo", "↪️ Redo"];
        const missing = wanted.filter((l) => !btn(l));
        ok("semua tombol baru dirender", missing.length === 0, missing.join(" | "));
        ok("canvas & 2 file input ada", !!canvasEl && inputs.length === 2, `inputs=${inputs.length}`);

        // ---------- 2. upload gambar dasar ----------
        const baseFile = await makeFile(200, 200, (cx, w, h) => { cx.fillStyle = "#0000ff"; cx.fillRect(0, 0, w, h); }, "base.png");
        upload(0, baseFile);
        ok("Upload Gambar tercatat di properties", await until(() => !!state().uploadedBgData));
        ok("bg_data terisi WebP", String(widget("bg_data").value).startsWith("data:image/webp"), String(widget("bg_data").value).slice(0, 24));
        ok("status menampilkan tanda terpasang", container.textContent.includes("✅"));

        // ---------- 3. undo / redo upload ----------
        btn("↩️ Undo").click();
        ok("Undo membatalkan upload gambar", await until(() => state().uploadedBgData === null));
        btn("↪️ Redo").click();
        ok("Redo mengembalikan gambar yang di-upload", await until(() => !!state().uploadedBgData));

        // ---------- 4. upload overlay transparan ----------
        const overlayFile = await makeFile(200, 200, (cx, w, h) => {
            cx.clearRect(0, 0, w, h);
            cx.fillStyle = "rgba(255,0,0,1)";
            cx.fillRect(80, 80, 40, 40);
        }, "overlay.png");
        upload(1, overlayFile);
        ok("Upload Overlay tercatat di properties", await until(() => !!state().uploadedOverlayData));

        const alphaCenter = await getAlpha(widget("canvas_data").value, 100, 100);
        ok("overlay menempel di canvas_data (alpha 255 di tengah)", alphaCenter > 200, `alpha=${alphaCenter}`);

        // ---------- 5. undo / redo overlay ----------
        btn("↩️ Undo").click();
        ok("Undo menghapus overlay", await until(() => state().uploadedOverlayData === null));
        const alphaAfterUndo = await getAlpha(widget("canvas_data").value, 100, 100);
        ok("undo overlay benar-benar bersih di canvas_data", alphaAfterUndo < 10, `alpha=${alphaAfterUndo}`);

        btn("↪️ Redo").click();
        ok("Redo mengembalikan overlay", await until(() => !!state().uploadedOverlayData));
        const alphaAfterRedo = await getAlpha(widget("canvas_data").value, 100, 100);
        ok("redo overlay kembali menempel", alphaAfterRedo > 200, `alpha=${alphaAfterRedo}`);

        // ---------- 6. melukis ----------
        const rect = canvasEl.getBoundingClientRect();
        const cx0 = rect.left + rect.width * 0.5;
        const cy0 = rect.top + rect.height * 0.5;
        const pev = (type, x, y) => canvasEl.dispatchEvent(new PointerEvent(type, {
            clientX: x, clientY: y, pointerId: 1, bubbles: true, cancelable: true,
        }));

        pev("pointerdown", cx0, cy0);
        pev("pointermove", cx0 + 30, cy0 + 20);
        pev("pointerup", cx0 + 30, cy0 + 20);
        ok("menggambar menambah 1 goresan", await until(() => strokeCount() === 1), `strokes=${strokeCount()}`);

        btn("↩️ Undo").click();
        ok("Undo membatalkan goresan", await until(() => strokeCount() === 0), `strokes=${strokeCount()}`);
        btn("↪️ Redo").click();
        ok("Redo mengembalikan goresan", await until(() => strokeCount() === 1), `strokes=${strokeCount()}`);

        // ---------- 7. tag ----------
        btn("➕ S Tag").click();
        ok("tambah S Tag", await until(() => tagCount("sTags") === 1), `sTags=${tagCount("sTags")}`);
        btn("↩️ Undo").click();
        ok("Undo membatalkan S Tag", await until(() => tagCount("sTags") === 0), `sTags=${tagCount("sTags")}`);
        btn("↪️ Redo").click();
        ok("Redo mengembalikan S Tag", await until(() => tagCount("sTags") === 1), `sTags=${tagCount("sTags")}`);

        // ---------- 8. hapus gambar / overlay ----------
        btn("🗑️ Hapus Gambar").click();
        ok("Hapus Gambar membuang gambar dasar", await until(() => state().uploadedBgData === null));
        ok("overlay tetap ada setelah gambar dihapus", !!state().uploadedOverlayData);
        btn("↩️ Undo").click();
        ok("Undo mengembalikan gambar yang dihapus", await until(() => !!state().uploadedBgData));

        btn("🗑️ Hapus Overlay").click();
        ok("Hapus Overlay membuang overlay", await until(() => state().uploadedOverlayData === null));
        ok("goresan tetap ada setelah overlay dihapus", strokeCount() === 1, `strokes=${strokeCount()}`);
        btn("↩️ Undo").click();
        ok("Undo mengembalikan overlay yang dihapus", await until(() => !!state().uploadedOverlayData));

        // ---------- 9. aksi baru mengosongkan redo ----------
        const redoBtn = btn("↪️ Redo");
        ok("redo masih tersedia sebelum aksi baru", parseFloat(redoBtn.style.opacity || "1") > 0.9, `opacity=${redoBtn.style.opacity}`);
        btn("▲ A Tag").click();
        await new Promise((r) => setTimeout(r, 200));
        ok("aksi baru mengosongkan stack redo", parseFloat(redoBtn.style.opacity || "1") < 0.6, `opacity=${redoBtn.style.opacity}`);

        const beforeRedo = JSON.stringify(modeData());
        btn("↪️ Redo").click();
        await new Promise((r) => setTimeout(r, 200));
        ok("Redo saat kosong tidak mengubah apa pun", JSON.stringify(modeData()) === beforeRedo);

        return out;
    });

    await browser.close();
    server.close();

    let pass = 0;
    let fail = 0;
    console.log("\n=== UJI BROWSER: upload / overlay / hapus / undo / redo ===\n");
    for (const r of results) {
        if (r.pass) { pass++; console.log(`  [OK]   ${r.label}`); }
        else { fail++; console.log(`  [FAIL] ${r.label}${r.detail ? "  (" + r.detail + ")" : ""}`); }
    }
    console.log(`\n${"=".repeat(52)}\nHASIL: ${pass} lulus, ${fail} gagal${pageErrors.length ? `, ${pageErrors.length} page error` : ""}\n${"=".repeat(52)}`);

    process.exit(fail || pageErrors.length ? 1 : 0);
});
