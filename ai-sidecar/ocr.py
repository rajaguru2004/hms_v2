"""Text out of a medical document, and nothing more.

OCR answers one question — *what text is present in this image* — and is
deliberately not allowed to answer the second one, *what does it mean*. That
belongs to the model behind it. Keeping the two apart is what lets a bad
extraction be traced to a bad read rather than guessed at.

PP-OCRv5 detection and recognition, running through onnxruntime on the CPU.
The spec names PaddleOCR; this is the same pair of models without the
paddlepaddle runtime, which publishes no wheel for the interpreter this box
ships. The GPU is left alone on purpose: it is holding a 4B model, and OCR
finishing a second sooner is worth less than the interview not stalling.
"""

from __future__ import annotations

import io
import threading
from dataclasses import dataclass, asdict

import numpy as np
from PIL import Image, ImageOps

# Rendering PDF pages at 144 DPI. Below about 120 the recognition model starts
# dropping the small print that lab reference ranges are set in.
_PDF_SCALE = 2.0

_engine = None
_engine_lock = threading.Lock()


def _get_engine():
    """Load PP-OCRv5 once, on first use.

    Lazily, so /health can answer while the weights are still downloading and
    so a box that never uploads a document never pays for them.
    """
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                from rapidocr_onnxruntime import RapidOCR

                _engine = RapidOCR()
    return _engine


def available() -> bool:
    """Whether OCR could run, without actually loading it."""
    try:
        import rapidocr_onnxruntime  # noqa: F401

        return True
    except Exception:
        return False


@dataclass
class Block:
    text: str
    box: list[list[float]]
    confidence: float


@dataclass
class Page:
    text: str
    mean_confidence: float
    blocks: list[dict]


def _prepare(image: Image.Image) -> np.ndarray:
    """Normalise orientation and mode before the detector sees the page.

    `exif_transpose` matters more than it looks: a phone photograph of a
    prescription is very often stored upright with a rotation flag, and the
    detector reads the pixels, not the flag.
    """
    image = ImageOps.exif_transpose(image)
    if image.mode != "RGB":
        image = image.convert("RGB")
    return np.array(image)


def _read_page(image: Image.Image) -> Page:
    engine = _get_engine()
    result, _ = engine(_prepare(image))

    if not result:
        # A page with no detectable text is a real outcome, not a failure. The
        # caller decides whether that means "retake this photo" or "this page
        # is the back of the sheet".
        return Page(text="", mean_confidence=0.0, blocks=[])

    blocks: list[Block] = []
    for box, text, score in result:
        blocks.append(
            Block(
                text=str(text),
                box=[[float(x), float(y)] for x, y in box],
                confidence=float(score),
            )
        )

    confidences = [b.confidence for b in blocks]
    return Page(
        text="\n".join(b.text for b in blocks),
        mean_confidence=float(sum(confidences) / len(confidences)),
        blocks=[asdict(b) for b in blocks],
    )


def read(data: bytes, content_type: str) -> list[Page]:
    """Every page of one uploaded document.

    A multi-page discharge summary is one document with an ordered list of
    pages, never several documents — the page number is part of a citation
    back to the evidence.
    """
    if content_type == "application/pdf" or data[:5] == b"%PDF-":
        return _read_pdf(data)
    return [_read_page(Image.open(io.BytesIO(data)))]


def _read_pdf(data: bytes) -> list[Page]:
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(data)
    try:
        return [
            _read_page(document[index].render(scale=_PDF_SCALE).to_pil())
            for index in range(len(document))
        ]
    finally:
        document.close()
