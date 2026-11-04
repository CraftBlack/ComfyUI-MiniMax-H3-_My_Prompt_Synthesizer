import { app } from "/scripts/app.js";

/**
 * MiniMax H3 — My Sidebar (opsional)
 * ==================================
 * Salinan dari minimax_h3_sidebar.js dengan penyesuaian:
 *   - nama extension  : MiniMaxH3.Sidebar        -> MiniMaxH3My.Sidebar
 *   - route API       : /anima/upload_url        -> /minimax_h3_my/upload_url
 *   - class target    : MiniMaxH3PromptSynthesizer -> MiniMaxH3MyPromptSynthesizer
 *   - penjaga defaultPrevented supaya tidak dobel kerja kalau paket asli juga terpasang
 *
 * Catatan: kalau tombol "buka jendela kanan" dan drag URL tidak kamu pakai, file ini
 * boleh dihapus — node canvas tetap jalan normal.
 */

let splitWindow = null;

function showToast(message) {
    let toast = document.getElementById("minimax-my-sidebar-toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "minimax-my-sidebar-toast";
        toast.style = "position: fixed; bottom: 20px; right: 20px; background: rgba(30, 41, 59, 0.95); color: #fff; padding: 10px 18px; border-radius: 6px; z-index: 100000; transition: opacity 0.3s, transform 0.3s; font-size: 13px; font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,0.4); border: 1px solid #334155;";
        document.body.appendChild(toast);
    }
    toast.innerText = message;
    toast.style.opacity = "1";
    setTimeout(() => { toast.style.opacity = "0"; }, 2300);
}

function openRightWindow(url) {
    const screenWidth = window.screen.availWidth;
    const screenHeight = window.screen.availHeight;
    const winWidth = Math.floor(screenWidth * 0.45);
    const left = screenWidth - winWidth;

    const windowFeatures = `width=${winWidth},height=${screenHeight},left=${left},top=0,resizable=yes,scrollbars=yes,location=yes,status=yes`;
    splitWindow = window.open(url, "MiniMax_My_Split_Window", windowFeatures);
    if (splitWindow) splitWindow.focus();
}

app.registerExtension({
    name: "MiniMaxH3My.Sidebar",

    async setup() {
        // Geser mouse ke tepi kanan atas -> fokuskan jendela kanan.
        // Hapus blok ini kalau dirasa mengganggu.
        window.addEventListener("mousemove", (e) => {
            const isRightEdge = e.clientX >= window.innerWidth - 30;
            const isUpperHalf = e.clientY <= (window.innerHeight / 2);
            if (isRightEdge && isUpperHalf && splitWindow && !splitWindow.closed) {
                splitWindow.focus();
            }
        });

        // Drag gambar dari browser luar -> unduh lewat backend -> isi widget `image`.
        window.addEventListener("drop", async (event) => {
            if (event.defaultPrevented) return;

            let url = event.dataTransfer.getData("text/plain") || event.dataTransfer.getData("text/uri-list");
            const html = event.dataTransfer.getData("text/html");

            if (html && (!url || !url.startsWith("http"))) {
                const match = html.match(/src=["'](.*?)["']/);
                if (match) url = match[1];
            }

            if (!url || !url.startsWith("http")) return;

            const canvas = app.canvas;
            if (!canvas) return;

            const pos = canvas.convertEventToCanvasOffset({ clientX: event.clientX, clientY: event.clientY });
            const node = canvas.getNodeOnPos(pos[0], pos[1]);
            if (!node?.widgets) return;

            const imageWidget = node.widgets.find((w) => w.name === "image");
            if (!imageWidget) return;

            event.preventDefault();
            event.stopPropagation();

            const oldVal = imageWidget.value;
            imageWidget.value = "⚡ Mengunduh gambar lewat backend...";

            try {
                const response = await fetch("/minimax_h3_my/upload_url", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ url }),
                });
                const result = await response.json();

                if (result.name) {
                    imageWidget.value = result.name;
                    if (imageWidget.callback) imageWidget.callback(result.name);
                    node.setSize(node.computeSize());
                    app.graph.setDirtyCanvas(true, true);
                    showToast("✅ Gambar dari web berhasil masuk ke node!");
                } else {
                    imageWidget.value = oldVal;
                    showToast(`❌ ${result.error || "Gagal mengunduh"}`);
                }
            } catch (err) {
                console.error(err);
                imageWidget.value = oldVal;
                showToast("❌ Tidak bisa menghubungi layanan unduh ComfyUI!");
            }
        }, false);
    },

    async nodeCreated(node) {
        if (node.comfyClass !== "MiniMaxH3MyPromptSynthesizer") return;

        node.addWidget("button", "🌐 Buka Danbooru Populer (Hot)", null, () => {
            openRightWindow("https://danbooru.donmai.us/posts?tags=order%3Arank");
        });

        node.addWidget("button", "🔥 Buka E-Hentai (AI Generated)", null, () => {
            openRightWindow("https://e-hentai.org/?f_search=ai+generated");
        });
    },
});
