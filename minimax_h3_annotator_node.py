"""
MiniMax H3 — My Canvas Annotator
================================

Varian dari `MiniMax_H3_CanvasAnnotator` (ComfyUI-MiniMax-H3-Prompt_Synthesizer)
dengan tambahan:

1. Output ketiga `overlay_image` — lapisan overlay transparan (RGBA) supaya bisa
   diekspor/di-`SaveImage` sebagai PNG transparan dan dipakai ulang.
2. Decode data-URL yang lebih tahan banting (webp/png/jpeg, alpha dijaga).

Alur data dari frontend:

    canvas_data  -> data:image/png;base64,...  lapisan overlay TRANSPARAN (RGBA)
                    berisi: gambar overlay yang di-upload + goresan kuas +
                    S/A tag + frame box.
    bg_data      -> data:image/webp;base64,... gambar dasar (background) yang
                    dikompres di browser.
    image        -> opsional, tensor IMAGE dari node upstream. Kalau ada dan
                    mode == "Overlay on Image", tensor ini menang atas bg_data.

Output:

    clean_image      : gambar dasar saja
    annotated_image  : gambar dasar + overlay (alpha composite)
    overlay_image    : overlay saja, RGBA (alpha dipertahankan)
"""

import base64
import io

import numpy as np
import torch
from PIL import Image


def _decode_data_url(data_url):
    """Ubah `data:image/...;base64,XXXX` menjadi PIL.Image RGBA. None kalau gagal."""
    if not data_url or "," not in data_url:
        return None
    try:
        _, encoded = data_url.split(",", 1)
        raw = base64.b64decode(encoded)
        return Image.open(io.BytesIO(raw)).convert("RGBA")
    except Exception as exc:  # noqa: BLE001 - apa pun penyebabnya, jangan bikin node gagal
        print(f"[MiniMax H3 My Canvas] gagal decode data URL: {exc}")
        return None


def _tensor_from_pil(pil_image, mode="RGB"):
    """PIL -> tensor ComfyUI berbentuk (1, H, W, C) float32 0..1."""
    array = np.array(pil_image.convert(mode)).astype(np.float32) / 255.0
    return torch.from_numpy(array).unsqueeze(0)


class MiniMaxH3MyCanvasAnnotator:
    """Composite gambar dasar + overlay transparan dari canvas frontend."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "image": ("IMAGE",),
                "mode": ("STRING", {"default": "Overlay on Image"}),
                "canvas_data": ("STRING", {"default": "", "multiline": True}),
                "bg_data": ("STRING", {"default": "", "multiline": True}),
            },
        }

    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE")
    RETURN_NAMES = ("clean_image", "annotated_image", "overlay_image")
    FUNCTION = "process_canvas"
    CATEGORY = "MiniMax_H3"

    def process_canvas(self, mode="Overlay on Image", canvas_data="", bg_data="", image=None):
        # 1. Lapisan overlay transparan (gambar upload + goresan + tag + frame)
        overlay_pil = _decode_data_url(canvas_data)

        # 2. Gambar dasar: tensor upstream > bg_data > warna solid
        use_upstream = image is not None and mode == "Overlay on Image"
        if use_upstream:
            frame = 255.0 * image[0].cpu().numpy()
            base_pil = Image.fromarray(np.clip(frame, 0, 255).astype(np.uint8)).convert("RGBA")
        else:
            base_pil = _decode_data_url(bg_data)
            if base_pil is None:
                base_color = (0, 0, 0, 255) if mode == "Overlay on Image" else (255, 255, 255, 255)
                init_size = overlay_pil.size if overlay_pil else (1024, 1024)
                base_pil = Image.new("RGBA", init_size, base_color)

        # 3. Samakan ukuran overlay dengan gambar dasar
        if overlay_pil is not None and overlay_pil.size != base_pil.size:
            if use_upstream:
                # Ada gambar dari node upstream -> gambar itu yang jadi acuan
                overlay_pil = overlay_pil.resize(base_pil.size, Image.Resampling.LANCZOS)
            elif base_pil.width * base_pil.height < overlay_pil.width * overlay_pil.height:
                # Tanpa upstream: yang resolusi lebih tinggi jadi acuan
                base_pil = base_pil.resize(overlay_pil.size, Image.Resampling.LANCZOS)
            else:
                overlay_pil = overlay_pil.resize(base_pil.size, Image.Resampling.LANCZOS)

        # 4. Composite
        annotated_pil = base_pil.copy()
        if overlay_pil is not None:
            annotated_pil.alpha_composite(overlay_pil)

        # 5. Output overlay (RGBA; transparan penuh kalau belum ada overlay)
        overlay_out = overlay_pil if overlay_pil is not None else Image.new("RGBA", base_pil.size, (0, 0, 0, 0))

        return (
            _tensor_from_pil(base_pil, "RGB"),
            _tensor_from_pil(annotated_pil, "RGB"),
            _tensor_from_pil(overlay_out, "RGBA"),
        )


NODE_CLASS_MAPPINGS = {
    "MiniMax_H3_MyCanvasAnnotator": MiniMaxH3MyCanvasAnnotator,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MiniMax_H3_MyCanvasAnnotator": "MiniMax H3 My Canvas Annotator 🎨",
}
