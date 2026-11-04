// Stub minimal `scripts/app.js` supaya web/js/minimax_h3_canvas.js bisa dimuat
// di luar ComfyUI. Yang dibutuhkan hanya `app.registerExtension`.
export const app = {
    __ext: null,
    registerExtension(ext) {
        this.__ext = ext;
    },
    graph: { setDirtyCanvas() {} },
};
