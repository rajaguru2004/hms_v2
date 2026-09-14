"""Renders the medical documents the Patient Documents verification runs against.

Real prescriptions and lab reports cannot go in a repository, so these are
synthetic — but they are synthetic in the ways that matter: a phone-camera
resolution, a printed serif face at clinic point sizes, a lab table whose
reference ranges are set smaller than its results, and a prescription that
mentions no allergies at all.

That last one is the point of `prescription.png`. §19 says "not found" must
never become "no", and the only way to prove the pipeline honours that is to
feed it a document with no allergy section and watch what it says about
allergies.

    ai-sidecar/.venv/bin/python test/fixtures/generate-documents.py

Never the host interpreter: Pillow lives in the sidecar venv.
"""

from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent

FONTS = Path("/usr/share/fonts")
SERIF = FONTS / "liberation-serif-fonts/LiberationSerif-Regular.ttf"
SERIF_BOLD = FONTS / "liberation-serif-fonts/LiberationSerif-Bold.ttf"
SANS = FONTS / "liberation-sans-fonts/LiberationSans-Regular.ttf"
SANS_BOLD = FONTS / "liberation-sans-fonts/LiberationSans-Bold.ttf"
MONO = FONTS / "liberation-mono-fonts/LiberationMono-Regular.ttf"

# A4 at 150 DPI. Below about 120 the recogniser starts dropping the small print
# lab reference ranges are set in — ocr.py makes the same argument about the
# scale it renders PDF pages at.
WIDTH, HEIGHT = 1240, 1754

INK = (17, 17, 17)
MUTED = (85, 85, 85)
RULE = (150, 150, 150)
PAPER = (253, 252, 249)


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


class Sheet:
    """A page being written down, top to bottom."""

    def __init__(self) -> None:
        self.image = Image.new("RGB", (WIDTH, HEIGHT), PAPER)
        self.draw = ImageDraw.Draw(self.image)
        self.y = 90

    def line(self, text: str, f: ImageFont.FreeTypeFont, *, x: int = 90,
             fill: tuple[int, int, int] = INK, gap: int = 12) -> None:
        self.draw.text((x, self.y), text, font=f, fill=fill)
        self.y += f.size + gap

    def at(self, x: int, text: str, f: ImageFont.FreeTypeFont,
           fill: tuple[int, int, int] = INK) -> None:
        """Write without advancing — for columns on one row."""
        self.draw.text((x, self.y), text, font=f, fill=fill)

    def rule(self, *, gap: int = 18, width: int = 2) -> None:
        self.draw.line([(90, self.y), (WIDTH - 90, self.y)], fill=RULE, width=width)
        self.y += gap

    def space(self, px: int) -> None:
        self.y += px

    def save(self, name: str, *, pdf: bool = False) -> None:
        self.image.save(HERE / name)
        if pdf:
            self.image.save(HERE / name.replace(".png", ".pdf"), "PDF", resolution=150.0)


def prescription() -> None:
    """A printed outpatient prescription. Three drugs, no allergy section."""
    s = Sheet()
    s.line("SUNRISE MULTISPECIALITY CLINIC", font(SERIF_BOLD, 40))
    s.line("14 Station Road, Coimbatore 641002  ·  Ph 0422 244 1180",
           font(SERIF, 22), fill=MUTED)
    s.rule()

    s.line("PRESCRIPTION", font(SANS_BOLD, 30))
    s.space(8)

    s.at(90, "Patient:  Ramesh Kumar", font(SERIF, 26))
    s.at(700, "Date:  12/09/2026", font(SERIF, 26))
    s.y += 38
    s.at(90, "Age / Sex:  54 / Male", font(SERIF, 26))
    s.at(700, "OP No:  OP-2026-11847", font(SERIF, 26))
    s.y += 46
    s.line("Diagnosis:  Type 2 Diabetes Mellitus, Hypertension", font(SERIF, 26))
    s.space(10)
    s.rule(width=1)

    s.line("Rx", font(SERIF_BOLD, 44))
    s.space(6)

    drugs = [
        ("1.", "Tab. METFORMIN 500 mg", "1 tablet  -  twice daily  -  oral",
         "After food, 30 days"),
        ("2.", "Tab. AMLODIPINE 5 mg", "1 tablet  -  once daily  -  oral",
         "Morning, 30 days"),
        ("3.", "Tab. ATORVASTATIN 10 mg", "1 tablet  -  at bedtime  -  oral",
         "30 days"),
    ]
    for number, name, dosing, note in drugs:
        s.at(90, number, font(SERIF, 28))
        s.at(140, name, font(SERIF_BOLD, 28))
        s.y += 40
        s.at(140, dosing, font(SERIF, 25))
        s.y += 36
        s.at(140, note, font(SERIF, 23), fill=MUTED)
        s.y += 46

    s.space(14)
    s.rule(width=1)
    s.line("Advice:  Check fasting blood sugar after 2 weeks. Reduce salt intake.",
           font(SERIF, 25))
    s.line("Follow up:  Review after 30 days.", font(SERIF, 25))

    s.space(90)
    s.line("Dr. Anitha Raghavan, MD", font(SERIF_BOLD, 28), x=760)
    s.line("Reg. No. TN 54821", font(SERIF, 23), x=760, fill=MUTED)

    s.save("prescription.png", pdf=True)


def lab_report() -> None:
    """A haematology report — table, units, reference ranges, one flagged value."""
    s = Sheet()
    s.line("METROLAB DIAGNOSTICS", font(SANS_BOLD, 40))
    s.line("NABL accredited  ·  Report generated 12/09/2026 11:24",
           font(SANS, 22), fill=MUTED)
    s.rule()

    s.line("COMPLETE BLOOD COUNT", font(SANS_BOLD, 30))
    s.space(8)
    s.at(90, "Patient:  Ramesh Kumar", font(SANS, 25))
    s.at(700, "Sample No:  ML-88213", font(SANS, 25))
    s.y += 36
    s.at(90, "Age / Sex:  54 / Male", font(SANS, 25))
    s.at(700, "Collected:  12/09/2026", font(SANS, 25))
    s.y += 36
    s.at(90, "Referred by:  Dr. Anitha Raghavan", font(SANS, 25))
    s.y += 50

    s.rule(width=1)
    header = font(SANS_BOLD, 24)
    s.at(90, "TEST", header)
    s.at(600, "RESULT", header)
    s.at(800, "UNIT", header)
    s.at(980, "REFERENCE", header)
    s.y += 36
    s.rule(width=1)

    rows = [
        ("Haemoglobin", "11.2", "g/dL", "13.0 - 17.0", True),
        ("Total WBC Count", "8400", "/uL", "4000 - 11000", False),
        ("Platelet Count", "250000", "/uL", "150000 - 410000", False),
        ("Packed Cell Volume", "36.4", "%", "40.0 - 50.0", True),
        ("MCV", "82.1", "fL", "83.0 - 101.0", True),
        ("Random Blood Sugar", "168", "mg/dL", "70 - 140", True),
        ("Serum Creatinine", "0.9", "mg/dL", "0.7 - 1.3", False),
    ]
    body = font(SANS, 25)
    small = font(MONO, 21)
    for name, result, unit, ref, flagged in rows:
        s.at(90, name, body)
        s.at(600, result, font(SANS_BOLD, 25) if flagged else body)
        s.at(800, unit, body)
        s.at(980, ref, small, fill=MUTED)
        if flagged:
            s.at(730, "*", font(SANS_BOLD, 25))
        s.y += 44

    s.space(10)
    s.rule(width=1)
    s.line("*  Outside the stated reference interval.", font(SANS, 22), fill=MUTED)
    s.space(60)
    s.line("Verified by:  Dr. S. Nandakumar, MD (Pathology)", font(SANS, 25))

    s.save("lab-report.png", pdf=True)


def unreadable() -> None:
    """A photograph of a document that nobody can read.

    Not a corrupt file and not a blank page — those are different errors. This
    is the common one: the patient's hand moved. The pipeline has to answer it
    with a sentence, not a stack trace.
    """
    image = Image.new("RGB", (900, 1200), (96, 92, 84))
    draw = ImageDraw.Draw(image)
    f = font(SERIF, 30)
    for row in range(14):
        draw.text((70, 120 + row * 62),
                  "prescription line that the camera never caught",
                  font=f, fill=(112, 108, 100))

    random.seed(20260912)
    pixels = image.load()
    assert pixels is not None
    for _ in range(140_000):
        x = random.randrange(image.width)
        y = random.randrange(image.height)
        noise = random.randrange(-45, 45)
        r, g, b = pixels[x, y]
        pixels[x, y] = (
            max(0, min(255, r + noise)),
            max(0, min(255, g + noise)),
            max(0, min(255, b + noise)),
        )

    image = image.filter(ImageFilter.GaussianBlur(radius=7))
    image.save(HERE / "unreadable.png")


def tiny() -> None:
    """Too few pixels to be worth an OCR pass — refused before the model runs."""
    prescription_page = Image.open(HERE / "prescription.png")
    prescription_page.resize((220, 311), Image.LANCZOS).save(HERE / "too-small.png")


if __name__ == "__main__":
    prescription()
    lab_report()
    unreadable()
    tiny()
    for path in sorted(HERE.iterdir()):
        if path.suffix in {".png", ".pdf"}:
            print(f"{path.name:24} {path.stat().st_size:>8} bytes")
