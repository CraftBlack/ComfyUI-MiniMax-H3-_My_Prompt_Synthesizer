import { app } from "../../../scripts/app.js";

/**
 * MiniMax H3 — My Canvas Annotator (frontend)
 * ===========================================
 * Turunan dari minimax_h3_canvas.js (ComfyUI-MiniMax-H3-Prompt_Synthesizer)
 * dengan tambahan:
 *
 *   1. Tombol "Upload Gambar"    -> pasang gambar dasar (background).
 *   2. Tombol "Upload Overlay"   -> pasang PNG transparan sebagai lapisan overlay,
 *                                   jadi tidak perlu melukis ulang tiap ganti gambar.
 *   3. Tombol "Hapus Gambar" / "Hapus Overlay" -> buang yang sudah di-upload.
 *      Plus "Simpan Overlay" untuk mengekspor overlay transparan jadi file PNG.
 *
 * Catatan penting: mengganti gambar dasar TIDAK menghapus overlay/goresan.
 */

const BG_MAX_DIM = 1280;      // batas sisi terpanjang gambar dasar saat disimpan ke workflow
const BG_QUALITY = 0.85;      // kualitas webp gambar dasar
const OVERLAY_MAX_DIM = 2048; // batas sisi terpanjang overlay saat disimpan ke workflow

const toast = (() => {
    let el = null;
    return (message) => {
        if (!el) {
            el = document.createElement("div");
            el.id = "minimax-my-toast";
            el.style.cssText = "position: fixed; bottom: 20px; right: 20px; background: rgba(30,41,59,.95); color: #fff; padding: 10px 18px; border-radius: 6px; z-index: 100000; transition: opacity .3s; font-size: 13px; font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,.4); border: 1px solid #334155; max-width: 420px;";
            document.body.appendChild(el);
        }
        el.innerText = message;
        el.style.opacity = "1";
        clearTimeout(el._timer);
        el._timer = setTimeout(() => { el.style.opacity = "0"; }, 2600);
    };
})();

app.registerExtension({
    name: "MiniMax.H3.My.CanvasAnnotator",

    async nodeCreated(node) {
        if (node.comfyClass !== "MiniMax_H3_MyCanvasAnnotator") return;

        // ---------------------------------------------------------------
        // Sembunyikan widget bawaan (nilainya diisi otomatis dari canvas)
        // ---------------------------------------------------------------
        const hideWidget = (w) => {
            if (!w) return;
            w.type = "hidden";
            w.computeSize = () => [0, -4];
            w.draw = () => {};
        };

        const modeWidget = node.widgets?.find((w) => w.name === "mode");
        const canvasDataWidget = node.widgets?.find((w) => w.name === "canvas_data");
        const bgDataWidget = node.widgets?.find((w) => w.name === "bg_data");

        hideWidget(modeWidget);
        hideWidget(canvasDataWidget);
        hideWidget(bgDataWidget);

        // ---------------------------------------------------------------
        // DOM
        // ---------------------------------------------------------------
        const container = document.createElement("div");
        container.tabIndex = 0;
        container.style.cssText = "display: flex; flex-direction: column; gap: 6px; padding: 8px; background: #1a1a1e; border-radius: 8px; border: 1px solid #333; box-sizing: border-box; width: 100%; height: 100%; outline: none;";

        const canvas = document.createElement("canvas");
        canvas.style.cssText = "border: 1px solid #444; border-radius: 4px; background: #000; cursor: crosshair; touch-action: none; width: 100%; flex: 1; min-height: 260px;";
        const ctx = canvas.getContext("2d");

        const bgCanvas = document.createElement("canvas");
        const bgCtx = bgCanvas.getContext("2d");
        const drawCanvas = document.createElement("canvas");
        const drawCtx = drawCanvas.getContext("2d");

        bgCanvas.width = drawCanvas.width = 1024;
        bgCanvas.height = drawCanvas.height = 1024;
        bgCtx.fillStyle = "#000000";
        bgCtx.fillRect(0, 0, 1024, 1024);

        // ---------------------------------------------------------------
        // State
        // ---------------------------------------------------------------
        let currentMode = "Overlay on Image";

        let uploadedBgImg = null;          // gambar dasar (Image object, resolusi penuh untuk layar)
        let uploadedBgDataUrl = null;      // versi terkompresi, untuk restore & simpan workflow
        let uploadedBgName = null;         // nama file asli, cuma untuk label status
        let uploadedOverlayImg = null;     // overlay transparan (Image object)
        let uploadedOverlayDataUrl = null; // PNG lossless, untuk restore & simpan workflow
        let uploadedOverlayName = null;

        let modeData = {
            "Overlay on Image": { strokes: [], sTags: [], aTags: [], frames: [], bgW: 1024, bgH: 1024 },
            "Blank Storyboard": { strokes: [], sTags: [], aTags: [], frames: [], bgW: 1024, bgH: 1024 },
        };

        let isDrawing = false;
        let isPanMode = false;
        let isPanning = false;
        let isEraser = false;
        let currentColor = "#FF0000";
        let brushSize = 6;

        let strokes = [];
        let currentStroke = null;
        let sTags = [];
        let aTags = [];
        let frames = [];
        let history = [];
        let future = [];   // stack redo

        let selectedElement = null;
        let clipboardItem = null;
        let activeElement = null;

        let viewScale = 1.0;
        let viewPan = { x: 0, y: 0 };
        let panStart = { x: 0, y: 0 };
        let lastClickTime = 0;

        let isHovered = false;
        container.addEventListener("mouseenter", () => { isHovered = true; });
        container.addEventListener("mouseleave", () => { isHovered = false; });

        const colors = [
            { name: "Red", code: "#FF0000" },
            { name: "Yellow", code: "#FFFF00" },
            { name: "Green", code: "#00FF00" },
            { name: "Blue", code: "#0088FF" },
            { name: "Black", code: "#000000" },
            { name: "Purple", code: "#8A2BE2" },
            { name: "White", code: "#FFFFFF" },
        ];

        // ---------------------------------------------------------------
        // State per-mode + riwayat
        // ---------------------------------------------------------------
        const storeCurrentModeState = () => {
            modeData[currentMode] = {
                strokes: JSON.parse(JSON.stringify(strokes)),
                sTags: JSON.parse(JSON.stringify(sTags)),
                aTags: JSON.parse(JSON.stringify(aTags)),
                frames: JSON.parse(JSON.stringify(frames)),
                bgW: bgCanvas.width,
                bgH: bgCanvas.height,
            };
        };

        const paintBaseLayer = () => {
            bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
            if (currentMode === "Overlay on Image") {
                if (uploadedBgImg) {
                    bgCtx.drawImage(uploadedBgImg, 0, 0, bgCanvas.width, bgCanvas.height);
                } else {
                    bgCtx.fillStyle = "#000000";
                    bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
                }
            } else {
                bgCtx.fillStyle = "#FFFFFF";
                bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
            }
        };

        const loadModeState = (targetMode) => {
            currentMode = targetMode;
            const data = modeData[targetMode] || { strokes: [], sTags: [], aTags: [], frames: [], bgW: 1024, bgH: 1024 };

            strokes = data.strokes || [];
            sTags = data.sTags || [];
            aTags = data.aTags || [];
            frames = data.frames || [];

            bgCanvas.width = drawCanvas.width = data.bgW || 1024;
            bgCanvas.height = drawCanvas.height = data.bgH || 1024;

            paintBaseLayer();
            rebuildDrawCanvas();
            updateStatus();
            render();
        };

        const getNextAvailableId = (prefix, list) => {
            const usedNumbers = new Set();
            const regex = new RegExp(`^${prefix.trim()}\\s*(\\d+)$`);
            list.forEach((item) => {
                if (item && item.id) {
                    const match = item.id.trim().match(regex);
                    if (match) usedNumbers.add(parseInt(match[1], 10));
                }
            });
            let nextId = 1;
            while (usedNumbers.has(nextId)) nextId++;
            return `${prefix}${nextId}`;
        };

        // Overlay raster (hasil upload) digambar DULU, baru goresan kuas di atasnya.
        const rebuildDrawCanvas = () => {
            drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
            const scaleRatio = drawCanvas.width / 512;

            if (uploadedOverlayImg) {
                drawCtx.save();
                drawCtx.globalCompositeOperation = "source-over";
                drawCtx.drawImage(uploadedOverlayImg, 0, 0, drawCanvas.width, drawCanvas.height);
                drawCtx.restore();
            }

            strokes.forEach((s) => {
                if (!s.points || s.points.length < 1) return;
                drawCtx.save();
                drawCtx.beginPath();
                drawCtx.lineCap = "round";
                drawCtx.lineJoin = "round";

                if (s.isEraser) {
                    drawCtx.globalCompositeOperation = "destination-out";
                    drawCtx.lineWidth = s.size * scaleRatio * 2;
                } else {
                    drawCtx.globalCompositeOperation = "source-over";
                    drawCtx.strokeStyle = s.color;
                    drawCtx.lineWidth = s.size * scaleRatio;
                }

                drawCtx.moveTo(s.points[0].x, s.points[0].y);
                for (let i = 1; i < s.points.length; i++) {
                    drawCtx.lineTo(s.points[i].x, s.points[i].y);
                }
                drawCtx.stroke();
                drawCtx.restore();
            });
        };

        const HISTORY_LIMIT = 25;

        // Diisi ulang setelah tombol Undo/Redo dibuat (lihat bagian toolbar)
        let refreshHistoryButtons = () => {};

        /** Kondisi lengkap node saat ini: gambar terpasang + isi canvas per-mode. */
        const snapshot = () => ({
            mode: currentMode,
            modeDataSnapshot: JSON.parse(JSON.stringify(modeData)),
            // Image & data URL disimpan by-reference (bukan di-deep-copy) supaya hemat memori
            uploadedBgImg,
            uploadedBgDataUrl,
            uploadedBgName,
            uploadedOverlayImg,
            uploadedOverlayDataUrl,
            uploadedOverlayName,
        });

        const restoreSnapshot = (state) => {
            modeData = state.modeDataSnapshot || modeData;

            // Index tag bisa berubah setelah restore -> jangan biarkan seleksi menggantung
            selectedElement = null;
            activeElement = null;
            currentStroke = null;
            isDrawing = false;

            // Snapshot selalu memuat keenam kunci ini (boleh bernilai null),
            // jadi salin apa adanya. `??` akan salah karena null juga state yang sah.
            if ("uploadedBgImg" in state) {
                uploadedBgImg = state.uploadedBgImg;
                uploadedBgDataUrl = state.uploadedBgDataUrl;
                uploadedBgName = state.uploadedBgName;
                uploadedOverlayImg = state.uploadedOverlayImg;
                uploadedOverlayDataUrl = state.uploadedOverlayDataUrl;
                uploadedOverlayName = state.uploadedOverlayName;
            }

            loadModeState(state.mode || currentMode);
            updateModeButtons();
            syncData();
            refreshHistoryButtons();
        };

        /**
         * Dipanggil SEBELUM sebuah aksi mengubah state (upload, hapus, mulai goresan,
         * tambah/geser tag, frame, clear, ganti mode). Aksi baru membatalkan redo.
         */
        const saveState = () => {
            storeCurrentModeState();
            if (history.length >= HISTORY_LIMIT) history.shift();
            history.push(snapshot());
            future.length = 0;
            refreshHistoryButtons();
        };

        const undo = () => {
            // Jangan batalkan state di tengah drag/geser/pan
            if (isDrawing || activeElement || isPanning) return;
            if (history.length === 0) {
                toast("Tidak ada yang bisa di-undo.");
                return;
            }
            storeCurrentModeState();
            // Simpan kondisi sekarang supaya bisa di-redo
            if (future.length >= HISTORY_LIMIT) future.shift();
            future.push(snapshot());

            restoreSnapshot(history.pop());
        };

        const redo = () => {
            if (isDrawing || activeElement || isPanning) return;
            if (future.length === 0) {
                toast("Tidak ada yang bisa di-redo.");
                return;
            }
            storeCurrentModeState();
            if (history.length >= HISTORY_LIMIT) history.shift();
            history.push(snapshot());

            restoreSnapshot(future.pop());
        };

        // ---------------------------------------------------------------
        // Ekspor data ke widget + properties
        // ---------------------------------------------------------------
        const getCompressedBgData = () => {
            let w = bgCanvas.width;
            let h = bgCanvas.height;
            if (w > BG_MAX_DIM || h > BG_MAX_DIM) {
                if (w > h) { h = Math.round((h * BG_MAX_DIM) / w); w = BG_MAX_DIM; }
                else { w = Math.round((w * BG_MAX_DIM) / h); h = BG_MAX_DIM; }
            }
            const compCanvas = document.createElement("canvas");
            compCanvas.width = w;
            compCanvas.height = h;
            compCanvas.getContext("2d").drawImage(bgCanvas, 0, 0, w, h);
            return compCanvas.toDataURL("image/webp", BG_QUALITY);
        };

        // Overlay transparan = lapisan gambar yang di-upload + goresan + tag + frame
        const renderOverlayToCanvas = (target) => {
            const tctx = target.getContext("2d");
            tctx.clearRect(0, 0, target.width, target.height);
            tctx.drawImage(drawCanvas, 0, 0);

            const scale = target.width / 512;
            frames.forEach((f) => drawFrameBox(tctx, f, scale));
            sTags.forEach((tag) => drawSTag(tctx, tag, scale));
            aTags.forEach((tag) => drawATag(tctx, tag, scale));
        };

        const buildOverlayCanvas = () => {
            const temp = document.createElement("canvas");
            temp.width = drawCanvas.width;
            temp.height = drawCanvas.height;
            renderOverlayToCanvas(temp);
            return temp;
        };

        const syncData = () => {
            storeCurrentModeState();
            if (modeWidget) modeWidget.value = currentMode;

            if (canvasDataWidget) canvasDataWidget.value = buildOverlayCanvas().toDataURL("image/png");
            if (bgDataWidget) bgDataWidget.value = getCompressedBgData();

            node.properties = node.properties || {};
            node.properties["canvas_state"] = serializeState();
        };

        const serializeState = () => JSON.stringify({
            currentMode,
            modeData,
            uploadedBgData: uploadedBgDataUrl || null,
            uploadedBgName: uploadedBgName || null,
            uploadedOverlayData: uploadedOverlayDataUrl || null,
            uploadedOverlayName: uploadedOverlayName || null,
        });

        const origOnSerialize = node.onSerialize;
        node.onSerialize = function (o) {
            if (origOnSerialize) origOnSerialize.apply(this, arguments);
            storeCurrentModeState();
            o.properties = o.properties || {};
            o.properties["canvas_state"] = serializeState();
        };

        const loadImageFromDataUrl = (dataUrl) => new Promise((resolve) => {
            if (!dataUrl) return resolve(null);
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = dataUrl;
        });

        const restoreFromProperties = async () => {
            const raw = node.properties && node.properties["canvas_state"];
            if (!raw) return;
            try {
                const state = JSON.parse(raw);
                currentMode = state.currentMode || "Overlay on Image";
                if (state.modeData) modeData = state.modeData;

                uploadedBgDataUrl = state.uploadedBgData || null;
                uploadedBgName = state.uploadedBgName || null;
                uploadedOverlayDataUrl = state.uploadedOverlayData || null;
                uploadedOverlayName = state.uploadedOverlayName || null;

                const [bgImg, overlayImg] = await Promise.all([
                    loadImageFromDataUrl(uploadedBgDataUrl),
                    loadImageFromDataUrl(uploadedOverlayDataUrl),
                ]);

                uploadedBgImg = bgImg;
                uploadedOverlayImg = overlayImg;

                // Data URL yang gagal dimuat jangan dipertahankan
                if (!bgImg) { uploadedBgDataUrl = null; uploadedBgName = null; }
                if (!overlayImg) { uploadedOverlayDataUrl = null; uploadedOverlayName = null; }

                loadModeState(currentMode);
                updateModeButtons();
            } catch (e) {
                console.error("[MiniMax H3 My Canvas] restore error:", e);
            }
        };

        const origOnConfigure = node.onConfigure;
        node.onConfigure = function (info) {
            if (origOnConfigure) origOnConfigure.apply(this, arguments);
            setTimeout(restoreFromProperties, 150);
        };

        // ---------------------------------------------------------------
        // Upload / hapus gambar
        // ---------------------------------------------------------------
        const readImageFile = (file) => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error("File bukan gambar yang bisa dibaca."));
                img.src = reader.result;
            };
            reader.onerror = () => reject(new Error("Gagal membaca file."));
            reader.readAsDataURL(file);
        });

        const imageToDataUrl = (img, maxDim, mime = "image/png", quality) => {
            let w = img.naturalWidth || img.width;
            let h = img.naturalHeight || img.height;
            if (maxDim && (w > maxDim || h > maxDim)) {
                if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
                else { w = Math.round((w * maxDim) / h); h = maxDim; }
            }
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const cx = c.getContext("2d");
            cx.drawImage(img, 0, 0, w, h);
            return quality === undefined ? c.toDataURL(mime) : c.toDataURL(mime, quality);
        };

        /** Pasang gambar dasar. Goresan & overlay TIDAK dihapus. */
        const applyBaseImage = (img, name) => {
            saveState();

            uploadedBgImg = img;
            uploadedBgName = name;

            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;

            bgCanvas.width = drawCanvas.width = w;
            bgCanvas.height = drawCanvas.height = h;

            currentMode = "Overlay on Image";
            updateModeButtons();

            paintBaseLayer();
            rebuildDrawCanvas();

            uploadedBgDataUrl = getCompressedBgData();

            viewScale = 1.0;
            viewPan = { x: 0, y: 0 };

            updateStatus();
            render();
            syncData();
        };

        /** Pasang overlay transparan. Goresan tangan tetap dipertahankan. */
        const applyOverlayImage = (img, name) => {
            saveState();

            uploadedOverlayImg = img;
            uploadedOverlayName = name;
            uploadedOverlayDataUrl = imageToDataUrl(img, OVERLAY_MAX_DIM, "image/png");

            rebuildDrawCanvas();
            updateStatus();
            render();
            syncData();
        };

        const clearBaseImage = () => {
            if (!uploadedBgImg) {
                toast("Belum ada gambar yang di-upload.");
                return;
            }
            saveState();
            uploadedBgImg = null;
            uploadedBgDataUrl = null;
            uploadedBgName = null;

            // Ukuran canvas sengaja dipertahankan supaya overlay tidak bergeser
            paintBaseLayer();
            updateStatus();
            render();
            syncData();
            toast("🗑️ Gambar dasar dihapus. Overlay & goresan tetap utuh.");
        };

        const clearOverlayImage = () => {
            if (!uploadedOverlayImg) {
                toast("Belum ada overlay yang di-upload.");
                return;
            }
            saveState();
            uploadedOverlayImg = null;
            uploadedOverlayDataUrl = null;
            uploadedOverlayName = null;

            rebuildDrawCanvas();
            updateStatus();
            render();
            syncData();
            toast("🗑️ Overlay dihapus. Goresan tangan tetap ada.");
        };

        const downloadOverlay = () => {
            const a = document.createElement("a");
            a.href = buildOverlayCanvas().toDataURL("image/png");
            a.download = `minimax_overlay_${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            toast("💾 Overlay transparan disimpan sebagai PNG. Pakai tombol Upload Overlay untuk memakainya lagi.");
        };

        const fileInputBase = document.createElement("input");
        fileInputBase.type = "file";
        fileInputBase.accept = "image/*";
        fileInputBase.style.display = "none";
        fileInputBase.addEventListener("change", async (e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = "";
            if (!file) return;
            try {
                const img = await readImageFile(file);
                applyBaseImage(img, file.name);
                toast(`✅ Gambar dasar dipasang: ${file.name}`);
            } catch (err) {
                console.error(err);
                toast(`❌ ${err.message}`);
            }
        });

        const fileInputOverlay = document.createElement("input");
        fileInputOverlay.type = "file";
        fileInputOverlay.accept = "image/png,image/webp,image/*";
        fileInputOverlay.style.display = "none";
        fileInputOverlay.addEventListener("change", async (e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = "";
            if (!file) return;
            try {
                const img = await readImageFile(file);
                applyOverlayImage(img, file.name);
                toast(`✅ Overlay dipasang: ${file.name}`);
            } catch (err) {
                console.error(err);
                toast(`❌ ${err.message}`);
            }
        });

        // ---------------------------------------------------------------
        // Drag & drop file ke canvas: biasa = gambar dasar, Shift = overlay
        // ---------------------------------------------------------------
        container.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        container.addEventListener("drop", async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const files = e.dataTransfer.files;
            if (!files || files.length === 0 || !files[0].type.startsWith("image/")) return;

            const file = files[0];
            try {
                const img = await readImageFile(file);
                if (e.shiftKey) {
                    applyOverlayImage(img, file.name);
                    toast(`✅ Overlay dipasang (Shift+drop): ${file.name}`);
                } else {
                    applyBaseImage(img, file.name);
                    toast(`✅ Gambar dasar dipasang: ${file.name}`);
                }
            } catch (err) {
                console.error(err);
                toast(`❌ ${err.message}`);
            }
        });

        canvas.addEventListener("wheel", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
            viewScale = Math.min(Math.max(0.3, viewScale * zoomFactor), 5.0);
            render();
        }, { passive: false });

        // ---------------------------------------------------------------
        // Keyboard: copy/paste/delete tag
        // ---------------------------------------------------------------
        const handleGlobalKeyDown = (e) => {
            const isNodeActive = isHovered || container.contains(document.activeElement);
            if (!isNodeActive) return;

            const mod = e.ctrlKey || e.metaKey;
            const isCopy = mod && (e.key === "c" || e.key === "C");
            const isPaste = mod && (e.key === "v" || e.key === "V");
            const isDelete = e.key === "Delete" || e.key === "Backspace";
            const isUndo = mod && !e.shiftKey && (e.key === "z" || e.key === "Z");
            const isRedo = mod && ((e.shiftKey && (e.key === "z" || e.key === "Z")) || e.key === "y" || e.key === "Y");

            if (isCopy || isPaste || isDelete || isUndo || isRedo) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }

            if (isUndo) { undo(); return; }
            if (isRedo) { redo(); return; }

            if (isCopy) {
                if (selectedElement) {
                    if (selectedElement.type === "A" && aTags[selectedElement.index]) {
                        clipboardItem = { type: "A", data: JSON.parse(JSON.stringify(aTags[selectedElement.index])) };
                    } else if (selectedElement.type === "S" && sTags[selectedElement.index]) {
                        clipboardItem = { type: "S", data: JSON.parse(JSON.stringify(sTags[selectedElement.index])) };
                    }
                }
            } else if (isPaste) {
                if (clipboardItem) {
                    saveState();
                    const newItem = JSON.parse(JSON.stringify(clipboardItem.data));
                    newItem.x += 30;
                    newItem.y += 30;
                    if (clipboardItem.type === "A") {
                        aTags.push(newItem);
                        selectedElement = { type: "A", index: aTags.length - 1 };
                    } else if (clipboardItem.type === "S") {
                        sTags.push(newItem);
                        selectedElement = { type: "S", index: sTags.length - 1 };
                    }
                    render();
                    syncData();
                }
            } else if (isDelete) {
                if (selectedElement) {
                    saveState();
                    if (selectedElement.type === "A") aTags.splice(selectedElement.index, 1);
                    else if (selectedElement.type === "S") sTags.splice(selectedElement.index, 1);
                    selectedElement = null;
                    render();
                    syncData();
                }
            }
        };

        window.addEventListener("keydown", handleGlobalKeyDown, true);

        const origOnRemoved = node.onRemoved;
        node.onRemoved = function () {
            window.removeEventListener("keydown", handleGlobalKeyDown, true);
            if (origOnRemoved) origOnRemoved.apply(this, arguments);
        };

        // ---------------------------------------------------------------
        // Penggambar tag & frame
        // ---------------------------------------------------------------
        const drawSTag = (targetCtx, tag, scale = 1.0) => {
            const size = 32 * scale;
            targetCtx.save();
            targetCtx.translate(tag.x, tag.y);

            targetCtx.beginPath();
            targetCtx.moveTo(-size / 2, -size / 2);
            targetCtx.lineTo(size / 2, -size / 2);
            targetCtx.lineTo(0, size / 2);
            targetCtx.closePath();

            targetCtx.fillStyle = "#8A2BE2";
            targetCtx.fill();
            targetCtx.strokeStyle = tag.isSelected ? "#00FFFF" : "#FFFFFF";
            targetCtx.lineWidth = (tag.isSelected ? 3 : 2) * scale;
            targetCtx.stroke();

            targetCtx.fillStyle = "#FFFFFF";
            targetCtx.font = `bold ${12 * scale}px sans-serif`;
            targetCtx.textAlign = "center";
            targetCtx.textBaseline = "middle";
            targetCtx.fillText(tag.id, 0, -size / 6);

            targetCtx.restore();
        };

        const drawATag = (targetCtx, tag, scale = 1.0) => {
            const size = 32 * scale;
            targetCtx.save();
            targetCtx.translate(tag.x, tag.y);

            targetCtx.beginPath();
            targetCtx.moveTo(0, -size / 2);
            targetCtx.lineTo(size / 2, size / 2);
            targetCtx.lineTo(-size / 2, size / 2);
            targetCtx.closePath();

            targetCtx.fillStyle = "#8A2BE2";
            targetCtx.fill();
            targetCtx.strokeStyle = tag.isSelected ? "#00FFFF" : "#FFFFFF";
            targetCtx.lineWidth = (tag.isSelected ? 3 : 2) * scale;
            targetCtx.stroke();

            targetCtx.fillStyle = "#FFFFFF";
            targetCtx.font = `bold ${12 * scale}px sans-serif`;
            targetCtx.textAlign = "center";
            targetCtx.textBaseline = "middle";
            targetCtx.fillText(tag.id, 0, size / 6);

            targetCtx.restore();
        };

        const drawFrameBox = (targetCtx, frame, scale = 1.0) => {
            targetCtx.save();
            targetCtx.strokeStyle = "#FFD700";
            targetCtx.lineWidth = 3 * scale;
            targetCtx.setLineDash([8 * scale, 4 * scale]);
            targetCtx.strokeRect(frame.x, frame.y, frame.w, frame.h);
            targetCtx.setLineDash([]);

            targetCtx.fillStyle = "#FFD700";
            targetCtx.fillRect(frame.x, frame.y - 28 * scale, 95 * scale, 28 * scale);
            targetCtx.fillStyle = "#000000";
            targetCtx.font = `bold ${13 * scale}px sans-serif`;
            targetCtx.textAlign = "center";
            targetCtx.textBaseline = "middle";
            targetCtx.fillText(frame.id, frame.x + 47.5 * scale, frame.y - 14 * scale);

            const handleSize = 16 * scale;
            targetCtx.fillStyle = "#FFD700";
            targetCtx.fillRect(frame.x + frame.w - handleSize, frame.y + frame.h - handleSize, handleSize, handleSize);

            targetCtx.restore();
        };

        // ---------------------------------------------------------------
        // Render
        // ---------------------------------------------------------------
        const render = () => {
            const rect = canvas.getBoundingClientRect();
            if (canvas.width !== rect.width || canvas.height !== rect.height) {
                canvas.width = rect.width || 512;
                canvas.height = rect.height || 340;
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.save();
            ctx.translate(viewPan.x, viewPan.y);
            ctx.scale(viewScale, viewScale);

            const aspect = bgCanvas.width / bgCanvas.height;
            let dw = canvas.width;
            let dh = canvas.height;
            if (aspect > 1) dh = canvas.width / aspect;
            else dw = canvas.height * aspect;

            const dx = (canvas.width - dw) / 2;
            const dy = (canvas.height - dh) / 2;

            ctx.drawImage(bgCanvas, dx, dy, dw, dh);
            ctx.drawImage(drawCanvas, dx, dy, dw, dh);

            const renderScale = dw / bgCanvas.width;

            frames.forEach((f) => {
                drawFrameBox(ctx, {
                    id: f.id,
                    x: dx + f.x * renderScale,
                    y: dy + f.y * renderScale,
                    w: f.w * renderScale,
                    h: f.h * renderScale,
                }, 1.0);
            });

            sTags.forEach((tag) => {
                drawSTag(ctx, {
                    id: tag.id,
                    x: dx + tag.x * renderScale,
                    y: dy + tag.y * renderScale,
                    isSelected: selectedElement?.type === "S" && selectedElement.index === sTags.indexOf(tag),
                }, 1.0);
            });

            aTags.forEach((tag) => {
                drawATag(ctx, {
                    id: tag.id,
                    x: dx + tag.x * renderScale,
                    y: dy + tag.y * renderScale,
                    isSelected: selectedElement?.type === "A" && selectedElement.index === aTags.indexOf(tag),
                }, 1.0);
            });

            if (currentMode === "Blank Storyboard") {
                const handleSize = 18;
                ctx.fillStyle = "#2e5b88";
                ctx.strokeStyle = "#FFFFFF";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.rect(dx + dw - handleSize, dy + dh - handleSize, handleSize, handleSize);
                ctx.fill();
                ctx.stroke();
            }

            ctx.restore();
        };

        const getCanvasPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            const clientX = e.clientX - rect.left;
            const clientY = e.clientY - rect.top;

            const aspect = bgCanvas.width / bgCanvas.height;
            let dw = canvas.width;
            let dh = canvas.height;
            if (aspect > 1) dh = canvas.width / aspect;
            else dw = canvas.height * aspect;

            const dx = (canvas.width - dw) / 2;
            const dy = (canvas.height - dh) / 2;

            const vx = (clientX * (canvas.width / rect.width) - viewPan.x) / viewScale;
            const vy = (clientY * (canvas.height / rect.height) - viewPan.y) / viewScale;

            return {
                x: ((vx - dx) / dw) * drawCanvas.width,
                y: ((vy - dy) / dh) * drawCanvas.height,
                vx, vy, dx, dy, dw, dh,
            };
        };

        const hitTestControls = (pos) => {
            for (let i = sTags.length - 1; i >= 0; i--) {
                if (Math.hypot(pos.x - sTags[i].x, pos.y - sTags[i].y) < 28) {
                    return { type: "S_move", index: i, offsetX: pos.x - sTags[i].x, offsetY: pos.y - sTags[i].y };
                }
            }
            for (let i = aTags.length - 1; i >= 0; i--) {
                if (Math.hypot(pos.x - aTags[i].x, pos.y - aTags[i].y) < 28) {
                    return { type: "A_move", index: i, offsetX: pos.x - aTags[i].x, offsetY: pos.y - aTags[i].y };
                }
            }

            for (let i = frames.length - 1; i >= 0; i--) {
                const f = frames[i];
                if (Math.abs(pos.x - (f.x + f.w)) < 30 && Math.abs(pos.y - (f.y + f.h)) < 30) {
                    return { type: "frame_resize", index: i, startW: f.w, startH: f.h, startX: pos.x, startY: pos.y };
                }
                if (pos.x >= f.x - 10 && pos.x <= f.x + 105 && pos.y >= f.y - 35 && pos.y <= f.y + 10) {
                    return { type: "frame_move", index: i, offsetX: pos.x - f.x, offsetY: pos.y - f.y };
                }
            }

            if (currentMode === "Blank Storyboard") {
                if (Math.abs(pos.vx - (pos.dx + pos.dw)) < 22 && Math.abs(pos.vy - (pos.dy + pos.dh)) < 22) {
                    return { type: "canvas_resize", startW: bgCanvas.width, startH: bgCanvas.height, startX: pos.vx, startY: pos.vy };
                }
            }

            return null;
        };

        // ---------------------------------------------------------------
        // Pointer
        // ---------------------------------------------------------------
        canvas.addEventListener("pointerdown", (e) => {
            container.focus();
            const now = Date.now();
            const isDoubleClick = (now - lastClickTime < 300);
            lastClickTime = now;

            const pos = getCanvasPos(e);
            const hit = hitTestControls(pos);

            if (isEraser && isDoubleClick && hit) {
                saveState();
                if (hit.type === "frame_move" || hit.type === "frame_resize") frames.splice(hit.index, 1);
                else if (hit.type === "S_move") sTags.splice(hit.index, 1);
                else if (hit.type === "A_move") aTags.splice(hit.index, 1);
                selectedElement = null;
                render();
                syncData();
                return;
            }

            if (hit) {
                saveState();
                activeElement = hit;
                canvas.setPointerCapture(e.pointerId);

                if (hit.type === "A_move") selectedElement = { type: "A", index: hit.index };
                else if (hit.type === "S_move") selectedElement = { type: "S", index: hit.index };
                else selectedElement = null;

                canvas.style.cursor = hit.type.includes("resize") ? "nwse-resize" : "move";
                render();
                return;
            }

            if (isPanMode || e.button === 1 || e.altKey) {
                isPanning = true;
                panStart = { x: e.clientX - viewPan.x, y: e.clientY - viewPan.y };
                canvas.style.cursor = "grabbing";
                return;
            }

            selectedElement = null;

            saveState();
            isDrawing = true;
            currentStroke = {
                color: currentColor,
                size: brushSize,
                isEraser: isEraser,
                points: [{ x: pos.x, y: pos.y }],
            };
            strokes.push(currentStroke);
            rebuildDrawCanvas();
            render();
        });

        canvas.addEventListener("pointermove", (e) => {
            if (isPanning) {
                viewPan.x = e.clientX - panStart.x;
                viewPan.y = e.clientY - panStart.y;
                render();
                return;
            }

            const pos = getCanvasPos(e);

            if (activeElement) {
                if (activeElement.type === "canvas_resize") {
                    const scaleFactor = drawCanvas.width / pos.dw;
                    const newW = Math.max(300, activeElement.startW + (pos.vx - activeElement.startX) * scaleFactor);
                    const newH = Math.max(300, activeElement.startH + (pos.vy - activeElement.startY) * scaleFactor);

                    bgCanvas.width = drawCanvas.width = Math.round(newW);
                    bgCanvas.height = drawCanvas.height = Math.round(newH);

                    paintBaseLayer();
                    rebuildDrawCanvas();
                } else if (activeElement.type === "S_move") {
                    sTags[activeElement.index].x = pos.x - activeElement.offsetX;
                    sTags[activeElement.index].y = pos.y - activeElement.offsetY;
                } else if (activeElement.type === "A_move") {
                    aTags[activeElement.index].x = pos.x - activeElement.offsetX;
                    aTags[activeElement.index].y = pos.y - activeElement.offsetY;
                } else if (activeElement.type === "frame_move") {
                    frames[activeElement.index].x = pos.x - activeElement.offsetX;
                    frames[activeElement.index].y = pos.y - activeElement.offsetY;
                } else if (activeElement.type === "frame_resize") {
                    frames[activeElement.index].w = Math.max(100, activeElement.startW + (pos.x - activeElement.startX));
                    frames[activeElement.index].h = Math.max(80, activeElement.startH + (pos.y - activeElement.startY));
                }
                render();
                return;
            }

            if (!isDrawing || !currentStroke) return;
            currentStroke.points.push({ x: pos.x, y: pos.y });
            rebuildDrawCanvas();
            render();
        });

        const stopDrawing = (e) => {
            if (activeElement) {
                if (e.pointerId) canvas.releasePointerCapture(e.pointerId);
                activeElement = null;
                canvas.style.cursor = isPanMode ? "grab" : "crosshair";
                syncData();
            }
            if (isDrawing) {
                isDrawing = false;
                currentStroke = null;
                syncData();
            }
            if (isPanning) {
                isPanning = false;
                canvas.style.cursor = isPanMode ? "grab" : "crosshair";
            }
        };
        canvas.addEventListener("pointerup", stopDrawing);
        canvas.addEventListener("pointerleave", stopDrawing);

        // ---------------------------------------------------------------
        // UI: baris mode
        // ---------------------------------------------------------------
        const smallBtn = (label, bg = "#333", color = "#fff") => {
            const b = document.createElement("button");
            b.textContent = label;
            b.style.cssText = `flex: 1; padding: 5px 4px; background: ${bg}; color: ${color}; border: 1px solid #555; border-radius: 4px; cursor: pointer; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
            return b;
        };

        const modeBar = document.createElement("div");
        modeBar.style.cssText = "display: flex; gap: 4px; width: 100%;";

        const btnOverlay = smallBtn("🖼️ Overlay Image");
        const btnBlankMode = smallBtn("📄 Blank Storyboard");

        const updateModeButtons = () => {
            const active = "flex: 1; padding: 5px 4px; background: #2e5b88; color: #fff; border: 1px solid #4a7bb0; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
            const idle = "flex: 1; padding: 5px 4px; background: #333; color: #ccc; border: 1px solid #555; border-radius: 4px; cursor: pointer; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
            btnOverlay.style.cssText = currentMode === "Overlay on Image" ? active : idle;
            btnBlankMode.style.cssText = currentMode === "Blank Storyboard" ? active : idle;
        };

        btnOverlay.onclick = () => {
            if (currentMode === "Overlay on Image") return;
            saveState();
            storeCurrentModeState();
            loadModeState("Overlay on Image");
            updateModeButtons();
            syncData();
        };

        btnBlankMode.onclick = () => {
            if (currentMode === "Blank Storyboard") return;
            saveState();
            storeCurrentModeState();
            loadModeState("Blank Storyboard");
            updateModeButtons();
            syncData();
        };

        modeBar.appendChild(btnOverlay);
        modeBar.appendChild(btnBlankMode);
        updateModeButtons();

        // ---------------------------------------------------------------
        // UI: baris upload / hapus (FITUR BARU)
        // ---------------------------------------------------------------
        const statusLabel = document.createElement("div");
        statusLabel.style.cssText = "font-size: 10px; color: #9aa4b2; padding: 0 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";

        const shortName = (name) => {
            if (!name) return "—";
            return name.length > 22 ? `${name.slice(0, 19)}…` : name;
        };

        const updateStatus = () => {
            const base = uploadedBgImg ? `✅ ${shortName(uploadedBgName)}` : "—";
            const ov = uploadedOverlayImg ? `✅ ${shortName(uploadedOverlayName)}` : "—";
            statusLabel.textContent = `Gambar: ${base}   |   Overlay: ${ov}`;
            statusLabel.title = `Gambar: ${uploadedBgName || "-"}\nOverlay: ${uploadedOverlayName || "-"}`;
        };

        const uploadBar = document.createElement("div");
        uploadBar.style.cssText = "display: flex; gap: 4px; width: 100%;";

        const btnUploadBase = smallBtn("⬆️ Upload Gambar", "#2e5b88", "#fff");
        btnUploadBase.title = "Pilih gambar biasa (JPG/PNG/WebP) sebagai gambar dasar.";
        btnUploadBase.onclick = () => fileInputBase.click();

        const btnDeleteBase = smallBtn("🗑️ Hapus Gambar", "#5a2222", "#ffd7d7");
        btnDeleteBase.title = "Buang gambar dasar yang di-upload. Overlay & goresan tetap dipertahankan.";
        btnDeleteBase.onclick = clearBaseImage;

        uploadBar.appendChild(btnUploadBase);
        uploadBar.appendChild(btnDeleteBase);

        const overlayBar = document.createElement("div");
        overlayBar.style.cssText = "display: flex; gap: 4px; width: 100%;";

        const btnUploadOverlay = smallBtn("⬆️ Upload Overlay (PNG transparan)", "#5b3a8a", "#fff");
        btnUploadOverlay.title = "Pakai PNG transparan sebagai lapisan overlay — tidak perlu melukis ulang.";
        btnUploadOverlay.onclick = () => fileInputOverlay.click();

        const btnSaveOverlay = smallBtn("💾 Simpan Overlay", "#2f5d3a", "#d7ffe0");
        btnSaveOverlay.title = "Unduh lapisan overlay sekarang sebagai PNG transparan.";
        btnSaveOverlay.onclick = downloadOverlay;

        const btnDeleteOverlay = smallBtn("🗑️ Hapus Overlay", "#5a2222", "#ffd7d7");
        btnDeleteOverlay.title = "Buang overlay yang di-upload. Goresan tangan tetap ada.";
        btnDeleteOverlay.onclick = clearOverlayImage;

        overlayBar.appendChild(btnUploadOverlay);
        overlayBar.appendChild(btnSaveOverlay);
        overlayBar.appendChild(btnDeleteOverlay);

        // ---------------------------------------------------------------
        // UI: alat gambar
        // ---------------------------------------------------------------
        const toolbarTop = document.createElement("div");
        toolbarTop.style.cssText = "display: flex; gap: 4px; align-items: center; justify-content: space-between;";

        const palette = document.createElement("div");
        palette.style.cssText = "display: flex; gap: 4px; align-items: center;";

        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "2";
        slider.max = "30";
        slider.value = brushSize;
        slider.style.width = "40px";
        slider.oninput = (e) => { brushSize = e.target.value; };

        const btnPan = smallBtn("✋ Pan");
        btnPan.style.flex = "0 0 auto";
        btnPan.onclick = () => {
            isPanMode = !isPanMode;
            btnPan.style.background = isPanMode ? "#2e5b88" : "#333";
            canvas.style.cursor = isPanMode ? "grab" : "crosshair";
        };

        colors.forEach((c) => {
            const btn = document.createElement("div");
            btn.style.cssText = `width: 16px; height: 16px; border-radius: 50%; background: ${c.code}; cursor: pointer; border: 2px solid ${c.code === currentColor && !isEraser ? "#FFF" : "transparent"};`;
            btn.title = c.name;
            btn.onclick = () => {
                isEraser = false;
                isPanMode = false;
                currentColor = c.code;
                canvas.style.cursor = "crosshair";
                Array.from(palette.children).forEach((child) => { child.style.borderColor = "transparent"; });
                btn.style.borderColor = "#FFF";
                btnPan.style.background = btnEraser.style.background = "#333";
            };
            palette.appendChild(btn);
        });

        const btnAddSTag = smallBtn("➕ S Tag");
        btnAddSTag.style.flex = "0 0 auto";
        btnAddSTag.onclick = () => {
            saveState();
            sTags.push({ id: getNextAvailableId("S", sTags), x: bgCanvas.width / 2, y: bgCanvas.height / 2 });
            render();
            syncData();
        };

        const btnAddATag = smallBtn("▲ A Tag", "#8A2BE2", "#fff");
        btnAddATag.style.flex = "0 0 auto";
        btnAddATag.onclick = () => {
            saveState();
            aTags.push({ id: getNextAvailableId("A", aTags), x: bgCanvas.width / 2, y: bgCanvas.height / 2 });
            render();
            syncData();
        };

        const toolbarBottom = document.createElement("div");
        toolbarBottom.style.cssText = "display: flex; gap: 4px; align-items: center; justify-content: space-between;";

        const btnAddFrame = smallBtn("➕ Frame");
        btnAddFrame.style.flex = "0 0 auto";
        btnAddFrame.onclick = () => {
            saveState();
            const fw = bgCanvas.width * 0.7;
            const fh = bgCanvas.height * 0.22;
            const fy = 50 + frames.length * (fh + 30);
            frames.push({ id: getNextAvailableId("Shot ", frames), x: (bgCanvas.width - fw) / 2, y: fy, w: fw, h: fh });
            render();
            syncData();
        };

        const btnEraser = smallBtn("🧹 Eraser");
        btnEraser.style.flex = "0 0 auto";
        btnEraser.onclick = () => {
            isEraser = !isEraser;
            isPanMode = false;
            btnEraser.style.background = isEraser ? "#8B0000" : "#333";
            btnPan.style.background = "#333";
            canvas.style.cursor = "crosshair";
        };

        const btnUndo = smallBtn("↩️ Undo");
        btnUndo.style.flex = "0 0 auto";
        btnUndo.title = "Batalkan aksi terakhir (upload, lukis, tag, frame, hapus). Ctrl+Z";
        btnUndo.onclick = undo;

        const btnRedo = smallBtn("↪️ Redo");
        btnRedo.style.flex = "0 0 auto";
        btnRedo.title = "Ulangi aksi yang baru dibatalkan. Ctrl+Y / Ctrl+Shift+Z";
        btnRedo.onclick = redo;

        const btnClear = smallBtn("🗑️ Clear");
        btnClear.style.flex = "0 0 auto";
        btnClear.title = "Hapus semua goresan, tag, frame, DAN overlay yang di-upload.";
        btnClear.onclick = () => {
            saveState();
            strokes = [];
            sTags = [];
            aTags = [];
            frames = [];
            uploadedOverlayImg = null;
            uploadedOverlayDataUrl = null;
            uploadedOverlayName = null;
            rebuildDrawCanvas();
            updateStatus();
            render();
            syncData();
        };

        toolbarTop.appendChild(palette);
        toolbarTop.appendChild(slider);
        toolbarTop.appendChild(btnPan);
        toolbarTop.appendChild(btnAddSTag);
        toolbarTop.appendChild(btnAddATag);

        toolbarBottom.appendChild(btnAddFrame);
        toolbarBottom.appendChild(btnEraser);
        toolbarBottom.appendChild(btnUndo);
        toolbarBottom.appendChild(btnRedo);
        toolbarBottom.appendChild(btnClear);

        refreshHistoryButtons = () => {
            btnUndo.style.opacity = history.length ? "1" : "0.45";
            btnRedo.style.opacity = future.length ? "1" : "0.45";
            btnUndo.title = `Batalkan aksi terakhir (Ctrl+Z) — ${history.length} langkah tersedia`;
            btnRedo.title = `Ulangi aksi (Ctrl+Y / Ctrl+Shift+Z) — ${future.length} langkah tersedia`;
        };
        refreshHistoryButtons();

        container.appendChild(modeBar);
        container.appendChild(uploadBar);
        container.appendChild(overlayBar);
        container.appendChild(canvas);
        container.appendChild(toolbarTop);
        container.appendChild(toolbarBottom);
        container.appendChild(statusLabel);
        container.appendChild(fileInputBase);
        container.appendChild(fileInputOverlay);

        node.addDOMWidget("canvas_widget", "Canvas", container);

        updateStatus();
        node.onResize = function () { render(); };
        node.size = [460, 720];
        setTimeout(() => {
            updateStatus();
            render();
        }, 100);
    },
});
