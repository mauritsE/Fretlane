"""The PDF buyers download from the Ko-fi Shop: download links and first-open steps.

    python3 marketing/kofi/guide.py

Writes marketing/kofi/out/Fretlane-download-and-install.pdf. Needs reportlab.
Links point at releases/latest, so the PDF stays right after a new release.
The text follows release/RELEASE_NOTES.md; update both together.
"""
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "out" / "Fretlane-download-and-install.pdf"

LATEST = "https://github.com/mauritsE/Fretlane/releases/latest"
SITE = "https://fretlane-sync-magic.lovable.app/"
KOFI = "https://ko-fi.com/mauritselzinga"
ISSUES = "https://github.com/mauritsE/Fretlane/issues"

# DejaVu has the arrows (→ ⇆) that the built-in PDF fonts lack.
DEJAVU = Path("/usr/share/fonts/truetype/dejavu")
pdfmetrics.registerFont(TTFont("Sans", str(DEJAVU / "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("Sans-Bold", str(DEJAVU / "DejaVuSans-Bold.ttf")))
pdfmetrics.registerFontFamily("Sans", normal="Sans", bold="Sans-Bold", italic="Sans", boldItalic="Sans-Bold")

INK, MUTED, AMBER = HexColor("#1b1d23"), HexColor("#5b6170"), HexColor("#c9861a")

body = ParagraphStyle("body", fontName="Sans", fontSize=9.5, leading=13.5, textColor=INK, spaceAfter=6)
h1 = ParagraphStyle("h1", parent=body, fontName="Sans-Bold", fontSize=20, leading=24, spaceAfter=4)
h2 = ParagraphStyle("h2", parent=body, fontName="Sans-Bold", fontSize=14, leading=18, spaceBefore=5, spaceAfter=3)
small = ParagraphStyle("small", parent=body, fontSize=9.5, leading=13, textColor=MUTED)
cell = ParagraphStyle("cell", parent=body, fontSize=9.5, leading=13, spaceAfter=0)


def link(url: str, text: str | None = None) -> str:
    return f'<link href="{url}" color="#c9861a"><u>{text or url}</u></link>'


def bullets(items: list[str]) -> list[Paragraph]:
    return [Paragraph(i, body, bulletText="•") for i in items]


story = [
    Image(str(ROOT / "build" / "icon.png"), 13 * mm, 13 * mm, hAlign="LEFT"),
    Spacer(1, 2 * mm),
    Paragraph("Thanks for supporting Fretlane", h1),
    Paragraph("Here's how to download it and open it for the first time. It takes a couple of minutes.", body),

    Paragraph("1. Download", h2),
    Paragraph(f"Open {link(LATEST)} and download the file for your computer. "
              "It's always the newest version.", body),
]

rows = [
    ["Your computer", "File to download", "Then"],
    ["<b>Windows</b> 10 / 11", "Fretlane-…-windows-setup.exe",
     "Double-click it. Fretlane installs and opens by itself, with a shortcut on your desktop and in the Start menu."],
    ["<b>Mac</b> with Apple chip (M1, M2, M3, M4…)", "Fretlane-…-mac-arm64.zip",
     "Double-click the zip, then drag <b>Fretlane</b> into your <b>Applications</b> folder."],
    ["<b>Mac</b> with Intel chip (older Macs)", "Fretlane-…-mac-x64.zip", "Same as above."],
    ["<b>Linux</b>", "Fretlane-…-linux-x86_64.AppImage",
     "Right-click → Properties → allow executing as a program, then double-click it."],
]
table = Table([[Paragraph(c, cell) for c in r] for r in rows], colWidths=[34 * mm, 68 * mm, 72 * mm])
table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), HexColor("#f3ece0")),
    ("LINEBELOW", (0, 0), (-1, -1), 0.5, HexColor("#d9dbe1")),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("TOPPADDING", (0, 0), (-1, -1), 4),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
]))
story += [
    table,
    Spacer(1, 1.5 * mm),
    Paragraph("Not sure which Mac you have? Apple menu → <b>About This Mac</b>. \"Chip: Apple M…\" means "
              "Apple chip. \"Processor: Intel\" means Intel.", small),

    Paragraph("2. Open it the first time", h2),
    Paragraph("Fretlane isn't registered with Apple or Microsoft, so the first time you open it your computer "
              "asks whether you trust it. You only have to do this once.", body),
    *bullets([
        "<b>Mac:</b> open Fretlane. When macOS says it can't verify the app, click <b>Done</b>. Then go to "
        "<b>System Settings → Privacy &amp; Security</b>, scroll down to \"Fretlane was blocked\", click "
        "<b>Open Anyway</b> and confirm. On older macOS versions you can instead right-click Fretlane → "
        "<b>Open</b> → <b>Open</b>.",
        "<b>Windows:</b> if a blue \"Windows protected your PC\" box appears, click <b>More info</b> → "
        "<b>Run anyway</b>.",
    ]),

    Paragraph("3. Play", h2),
    *bullets([
        "Click a song to open it. 22 songs are included (Greensleeves, Für Elise, House of the Rising Sun "
        "and more), with guitar, bass and drums.",
        "<b>+ Add song:</b> use a Guitar Pro file (.gp, .gp5, .gpx…), a MusicXML file, a link to a tab file, "
        "or a plain-text tab pasted in. Optionally add the song's YouTube or Spotify link.",
        "<b>⇆ Sync:</b> pause the video or song on the first beat and click <b>Pin</b>, and the tab follows it.",
        "<b>Metronome</b> (or press <b>M</b>): tap tempo, accents, and one click for the song's own tempo.",
        "<b>Spotify songs</b> play at normal speed only, and may be 30-second previews. To slow a song down, "
        "use a YouTube video of it.",
    ]),
    Paragraph("Your songs are saved in a <b>Fretlane</b> folder in your home folder "
              "(<b>File → Show Songs Folder</b>). Updating to a newer version keeps your library.", body),

    Paragraph("Help and feedback", h2),
    Paragraph(f"Something broken, or an idea? Message me on Ko-fi ({link(KOFI, 'ko-fi.com/mauritselzinga')}) "
              f"or open an issue at {link(ISSUES, 'github.com/mauritsE/Fretlane/issues')}. "
              f"Website: {link(SITE, 'fretlane-sync-magic.lovable.app')}.", body),
    Paragraph("Fretlane is free and open source (MIT licence). Your support helps me keep working on it. "
              "Thank you!", small),
]

if __name__ == "__main__":
    OUT.parent.mkdir(exist_ok=True)
    SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=12 * mm,
                      bottomMargin=10 * mm, title="Fretlane: download and install", author="Maurits Elzinga").build(story)
    print(OUT.relative_to(ROOT))
