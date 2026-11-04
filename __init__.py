"""
ComfyUI-MiniMax-H3-_My_Prompt_Synthesizer
=========================================

Varian pribadi dari `ComfyUI-MiniMax-H3-Prompt_Synthesizer` dengan tambahan pada
node canvas:

  1. Tombol **Upload Gambar**  - pasang gambar dasar dari file lokal.
  2. Tombol **Upload Overlay** - pasang PNG transparan sebagai lapisan overlay,
     jadi overlay yang sudah dilukis bisa dipakai ulang tanpa menggambar lagi.
  3. Tombol **Hapus Gambar** / **Hapus Overlay** - buang gambar yang sudah di-upload.
     Ditambah **Simpan Overlay** untuk mengekspor overlay transparan jadi file PNG.

Semua nama class, route, dan extension sengaja diberi awalan `My` supaya paket ini
bisa dipasang berdampingan dengan node aslinya tanpa bentrok.
"""

import os

WEB_DIRECTORY = "./web"

from .minimax_h3_template_node import (
    NODE_CLASS_MAPPINGS as TEMPLATE_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as TEMPLATE_DISPLAY,
)
from .minimax_h3_annotator_node import (
    NODE_CLASS_MAPPINGS as ANNOTATOR_CLASS,
    NODE_DISPLAY_NAME_MAPPINGS as ANNOTATOR_DISPLAY,
)

NODE_CLASS_MAPPINGS = {**TEMPLATE_CLASS, **ANNOTATOR_CLASS}
NODE_DISPLAY_NAME_MAPPINGS = {**TEMPLATE_DISPLAY, **ANNOTATOR_DISPLAY}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
