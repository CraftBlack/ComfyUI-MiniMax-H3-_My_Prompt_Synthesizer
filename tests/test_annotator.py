"""
Self-test headless untuk MiniMaxH3MyCanvasAnnotator.

Tidak butuh ComfyUI jalan — modul annotator hanya memakai torch/numpy/Pillow.

Jalankan dengan python-nya ComfyUI:

    C:\\ComfyUI\\venv\\Scripts\\python.exe tests\\test_annotator.py
"""

import base64
import importlib.util
import io
import os
import sys

import numpy as np
import torch
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
MODULE_PATH = os.path.join(HERE, "..", "minimax_h3_annotator_node.py")

SIZE = 64
BOX = (22, 42)  # kotak merah di overlay

passed = 0
failed = 0


def check(label, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  [OK]   {label}")
    else:
        failed += 1
        print(f"  [FAIL] {label} {detail}")


def load_module():
    spec = importlib.util.spec_from_file_location("mmh3_annotator", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["mmh3_annotator"] = module
    spec.loader.exec_module(module)
    return module


def data_url(pil_image, fmt="PNG"):
    buf = io.BytesIO()
    pil_image.save(buf, format=fmt)
    return f"data:image/{fmt.lower()};base64," + base64.b64encode(buf.getvalue()).decode()


def base_tensor(color=(0, 0, 255), size=SIZE):
    img = Image.new("RGB", (size, size), color)
    return torch.from_numpy(np.array(img).astype(np.float32) / 255.0).unsqueeze(0)


def overlay_image(size=SIZE):
    """Overlay transparan dengan kotak merah proporsional di tengah."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    lo = round(size * BOX[0] / SIZE)
    hi = round(size * BOX[1] / SIZE)
    for x in range(lo, hi):
        for y in range(lo, hi):
            img.putpixel((x, y), (255, 0, 0, 255))
    return img


def main():
    module = load_module()
    node = module.MiniMaxH3MyCanvasAnnotator()

    overlay_url = data_url(overlay_image())
    base = base_tensor()
    base_url = data_url(Image.new("RGBA", (SIZE, SIZE), (0, 0, 255, 255)))

    print("1. Struktur node")
    check("INPUT_TYPES punya image/mode/canvas_data/bg_data",
          all(k in node.INPUT_TYPES()["optional"] for k in ("image", "mode", "canvas_data", "bg_data")))
    check("RETURN_NAMES = clean/annotated/overlay",
          node.RETURN_NAMES == ("clean_image", "annotated_image", "overlay_image"))
    check("mapping class terdaftar",
          "MiniMax_H3_MyCanvasAnnotator" in module.NODE_CLASS_MAPPINGS)

    print("\n2. Gambar dasar dari tensor + overlay transparan")
    clean, annotated, overlay = node.process_canvas(
        canvas_data=overlay_url, bg_data="", image=base, mode="Overlay on Image"
    )
    check("clean_image berbentuk (1,64,64,3)", tuple(clean.shape) == (1, SIZE, SIZE, 3), str(tuple(clean.shape)))
    check("annotated_image berbentuk (1,64,64,3)", tuple(annotated.shape) == (1, SIZE, SIZE, 3), str(tuple(annotated.shape)))
    check("overlay_image berbentuk (1,64,64,4) alias RGBA", tuple(overlay.shape) == (1, SIZE, SIZE, 4), str(tuple(overlay.shape)))

    check("clean_image tetap biru di tengah (overlay tidak bocor)",
          bool(torch.allclose(clean[0, 32, 32], torch.tensor([0.0, 0.0, 1.0]), atol=0.02)))
    check("annotated_image jadi merah di tengah",
          bool(torch.allclose(annotated[0, 32, 32], torch.tensor([1.0, 0.0, 0.0]), atol=0.02)))
    check("annotated_image tetap biru di luar kotak",
          bool(torch.allclose(annotated[0, 5, 5], torch.tensor([0.0, 0.0, 1.0]), atol=0.02)))

    print("\n3. Alpha overlay dipertahankan")
    check("alpha = 1 di dalam kotak", abs(float(overlay[0, 32, 32, 3]) - 1.0) < 0.02,
          f"dapat {float(overlay[0, 32, 32, 3]):.3f}")
    check("alpha = 0 di luar kotak", abs(float(overlay[0, 5, 5, 3])) < 0.02,
          f"dapat {float(overlay[0, 5, 5, 3]):.3f}")

    print("\n4. Tanpa overlay -> annotated == clean, overlay kosong")
    clean2, annotated2, overlay2 = node.process_canvas(canvas_data="", bg_data="", image=base)
    check("annotated == clean", bool(torch.allclose(clean2, annotated2, atol=1e-6)))
    check("overlay transparan penuh", float(overlay2[0, :, :, 3].max()) < 0.001)

    print("\n5. Jalur bg_data (tanpa sambungan image)")
    _, annotated3, overlay3 = node.process_canvas(
        canvas_data=overlay_url, bg_data=base_url, image=None, mode="Overlay on Image"
    )
    check("annotated dari bg_data jadi merah di tengah",
          bool(torch.allclose(annotated3[0, 32, 32], torch.tensor([1.0, 0.0, 0.0]), atol=0.02)))
    check("overlay dari bg_data mempertahankan alpha", abs(float(overlay3[0, 32, 32, 3]) - 1.0) < 0.02)

    print("\n6. Ukuran overlay berbeda -> diskalakan otomatis")
    small_overlay = data_url(overlay_image(32))
    _, annotated4, _ = node.process_canvas(canvas_data=small_overlay, bg_data="", image=base)
    check("tidak error & ukuran tetap 64", tuple(annotated4.shape) == (1, SIZE, SIZE, 3))
    check("bagian tengah tetap jadi merah", float(annotated4[0, 32, 32, 0]) > 0.9,
          f"R={float(annotated4[0, 32, 32, 0]):.3f}")

    print("\n7. Mode Blank Storyboard tanpa gambar -> dasar putih")
    clean5, _, _ = node.process_canvas(canvas_data="", bg_data="", image=None, mode="Blank Storyboard")
    check("dasar putih", bool(torch.allclose(clean5[0, 10, 10], torch.tensor([1.0, 1.0, 1.0]), atol=0.02)))

    print("\n8. Data URL rusak tidak bikin crash")
    clean6, annotated6, overlay6 = node.process_canvas(canvas_data="data:image/png;base64,!!!bukan-base64!!!",
                                                       bg_data="", image=base)
    check("tetap mengembalikan 3 output", len((clean6, annotated6, overlay6)) == 3)
    check("annotated == clean", bool(torch.allclose(clean6, annotated6, atol=1e-6)))

    print(f"\n{'=' * 46}\nHASIL: {passed} lulus, {failed} gagal\n{'=' * 46}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
