"""Layout engine for the idea-brief PDFs. Content lives in ideas_*.py."""
import re
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import simpleSplit
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                PageBreak, KeepTogether, ListFlowable, ListItem, CondPageBreak)
from reportlab.platypus.flowables import HRFlowable

W, H = letter
INK = colors.HexColor("#1F2328")
MUTED = colors.HexColor("#5B616B")
RULE = colors.HexColor("#D9DCE1")
SOFT = colors.HexColor("#F5F6F8")
MARGIN = 0.8 * inch
CONTENT_W = W - 2 * MARGIN

COMPETITION = "Meta VR Start Developer Competition 2026"


def tint(c, f):
    return colors.Color(c.red + (1 - c.red) * f, c.green + (1 - c.green) * f, c.blue + (1 - c.blue) * f)


def md(t):
    t = t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)


def styles(accent):
    s = {}
    s["body"] = ParagraphStyle("body", fontName="Helvetica", fontSize=10, leading=14.6, textColor=INK, spaceAfter=7)
    s["cell"] = ParagraphStyle("cell", parent=s["body"], fontSize=8.8, leading=12, spaceAfter=0)
    s["cellh"] = ParagraphStyle("cellh", parent=s["cell"], fontName="Helvetica-Bold", textColor=colors.white)
    s["cellk"] = ParagraphStyle("cellk", parent=s["cell"], fontName="Helvetica-Bold", textColor=INK)
    s["h1"] = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=16, leading=20, textColor=INK, spaceBefore=4, spaceAfter=3)
    s["num"] = ParagraphStyle("num", fontName="Helvetica-Bold", fontSize=9, leading=11, textColor=accent, spaceAfter=0)
    s["h2"] = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=accent, spaceBefore=6, spaceAfter=4)
    s["callt"] = ParagraphStyle("callt", parent=s["body"], fontName="Helvetica-Bold", textColor=accent, spaceAfter=3)
    s["callb"] = ParagraphStyle("callb", parent=s["body"], spaceAfter=0)
    s["bul"] = ParagraphStyle("bul", parent=s["body"], spaceAfter=3)
    s["quote"] = ParagraphStyle("quote", parent=s["body"], fontName="Helvetica-Oblique", fontSize=11, leading=16, textColor=INK)
    return s


def table(rows, widths, st, accent, header=True):
    data = []
    for i, r in enumerate(rows):
        sty = st["cellh"] if (header and i == 0) else st["cell"]
        data.append([Paragraph(md(str(c)), st["cellk"] if (j == 0 and not (header and i == 0)) else sty)
                     for j, c in enumerate(r)])
    total = sum(widths)
    t = Table(data, colWidths=[CONTENT_W * w / total for w in widths], repeatRows=1 if header else 0)
    cmds = [("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE)]
    if header:
        cmds += [("BACKGROUND", (0, 0), (-1, 0), accent)]
    start = 1 if header else 0
    for i in range(start, len(rows)):
        if (i - start) % 2 == 1:
            cmds.append(("BACKGROUND", (0, i), (-1, i), SOFT))
    t.setStyle(TableStyle(cmds))
    return t


def callout(title, text, st, accent):
    inner = []
    if title:
        inner.append(Paragraph(md(title), st["callt"]))
    for para in text.split("\n\n"):
        inner.append(Paragraph(md(para), st["callb"]))
    t = Table([[inner]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), tint(accent, 0.9)),
                           ("LINEBEFORE", (0, 0), (0, -1), 3, accent),
                           ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                           ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9)]))
    return t


def bullets(items, st, accent, numbered=False):
    li = [ListItem(Paragraph(md(i), st["bul"]), leftIndent=14) for i in items]
    kw = dict(bulletType="1", bulletFontName="Helvetica-Bold", bulletFontSize=9, bulletColor=accent) if numbered \
        else dict(bulletType="bullet", start="•", bulletFontSize=9, bulletColor=accent)
    return ListFlowable(li, leftIndent=14, **kw)


def render_blocks(blocks, st, accent, counter=None):
    out = []
    counter = counter if counter is not None else [0]
    for b in blocks:
        k = b[0]
        if k == "h":
            counter[0] += 1
            n = counter[0]
            out += [CondPageBreak(2.6 * inch), Spacer(1, 10),
                    KeepTogether([Paragraph(f"SECTION {n:02d}", st["num"]), Paragraph(md(b[1]), st["h1"]),
                                  HRFlowable(width="100%", thickness=0.8, color=accent, spaceBefore=2, spaceAfter=8)])]
        elif k == "h2":
            out += [CondPageBreak(1.5 * inch), Paragraph(md(b[1]), st["h2"])]
        elif k == "p":
            out.append(Paragraph(md(b[1]), st["body"]))
        elif k == "quote":
            out += [Paragraph(md(b[1]), st["quote"]), Spacer(1, 6)]
        elif k == "bul":
            out += [bullets(b[1], st, accent), Spacer(1, 5)]
        elif k == "num":
            out += [bullets(b[1], st, accent, numbered=True), Spacer(1, 5)]
        elif k == "tbl":
            out += [table(b[1], b[2], st, accent), Spacer(1, 10)]
        elif k == "kv":
            out += [table(b[1], [1, 2.6], st, accent, header=False), Spacer(1, 10)]
        elif k == "call":
            out += [callout(b[1], b[2], st, accent), Spacer(1, 10)]
        elif k == "keep":
            inner = render_blocks(b[1], st, accent, counter)
            out.append(KeepTogether(inner))
        elif k == "break":
            out.append(PageBreak())
        else:
            raise ValueError(k)
    return out


def check_charset(obj, where="idea"):
    """Built-in Helvetica only covers cp1252; fail loudly instead of printing black boxes."""
    if isinstance(obj, str):
        try:
            obj.encode("cp1252")
        except UnicodeEncodeError as e:
            raise SystemExit(f"Unsupported character in {where}: {obj[max(0, e.start - 20):e.end + 20]!r}")
    elif isinstance(obj, dict):
        for k, v in obj.items():
            check_charset(v, f"{where}.{k}")
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            check_charset(v, f"{where}[{i}]")


def build(idea, path, total):
    check_charset(idea, idea["slug"])
    accent = colors.HexColor(idea["accent"])
    st = styles(accent)

    def cover(c, doc):
        c.saveState()
        band = 4.7 * inch
        c.setFillColor(accent)
        c.rect(0, H - band, W, band, stroke=0, fill=1)
        c.saveState()
        clip = c.beginPath()
        clip.rect(0, H - band, W, band)
        c.clipPath(clip, stroke=0, fill=0)
        c.setFillColor(tint(accent, 0.25))
        c.circle(W - 1.1 * inch, H - band + 0.2 * inch, 1.9 * inch, stroke=0, fill=1)
        c.setFillColor(accent)
        c.circle(W - 1.1 * inch, H - band + 0.2 * inch, 1.2 * inch, stroke=0, fill=1)
        c.restoreState()
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 8.5)
        c.drawString(MARGIN, H - 0.75 * inch, f"{COMPETITION.upper()}   ·   IDEA BRIEF {idea['num']} OF {total}")
        c.setFont("Helvetica-Bold", 40)
        c.drawString(MARGIN, H - 2.05 * inch, idea["name"])
        c.setFont("Helvetica", 14)
        y = H - 2.55 * inch
        for line in simpleSplit(idea["tagline"], "Helvetica", 14, W - 2 * MARGIN - 1.6 * inch):
            c.drawString(MARGIN, y, line)
            y -= 19
        # chips
        x, y = MARGIN, H - band + 0.55 * inch
        c.setFont("Helvetica-Bold", 8.5)
        for chip in [idea["track"] + " track", idea["division"], "Target: " + idea["target"]]:
            w = c.stringWidth(chip, "Helvetica-Bold", 8.5) + 18
            c.setFillColor(colors.white)
            c.roundRect(x, y, w, 19, 9.5, stroke=0, fill=1)
            c.setFillColor(accent)
            c.drawString(x + 9, y + 6, chip)
            x += w + 7
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 8)
        c.drawString(MARGIN, 0.5 * inch, f"{idea.get('prepared', 'Prepared 29 Sep 2026')}  ·  Deadline 18 Nov 2026, 12:00 PT  ·  Built for IWSDK (WebXR) on Meta Quest 3 / 3S")
        c.restoreState()

    def later(c, doc):
        c.saveState()
        c.setStrokeColor(RULE)
        c.setLineWidth(0.5)
        c.line(MARGIN, 0.62 * inch, W - MARGIN, 0.62 * inch)
        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(accent)
        c.drawString(MARGIN, 0.45 * inch, idea["name"].upper())
        c.setFont("Helvetica", 8)
        c.setFillColor(MUTED)
        c.drawString(MARGIN + c.stringWidth(idea["name"].upper(), "Helvetica-Bold", 8) + 8, 0.45 * inch,
                     f"Idea brief {idea['num']} of {total}")
        c.drawRightString(W - MARGIN, 0.45 * inch, f"Page {doc.page}")
        c.setFillColor(accent)
        c.rect(0, H - 0.18 * inch, W, 0.18 * inch, stroke=0, fill=1)
        c.restoreState()

    doc = SimpleDocTemplate(path, pagesize=letter, leftMargin=MARGIN, rightMargin=MARGIN,
                            topMargin=0.75 * inch, bottomMargin=0.85 * inch,
                            title=f"{idea['name']} - Idea Brief", author="Idea brief", subject=idea["tagline"])
    story = [Spacer(1, 4.15 * inch),
             Paragraph("AT A GLANCE", st["num"]), Spacer(1, 4),
             table([list(r) for r in idea["glance"]], [1, 2.6], st, accent, header=False),
             Spacer(1, 12),
             callout("The one-line pitch", idea["pitch"], st, accent),
             PageBreak()]
    story += render_blocks(idea["blocks"], st, accent)
    doc.build(story, onFirstPage=cover, onLaterPages=later)


# Shared facts reused across briefs ----------------------------------------------------------

TIMELINE_WEEKS = [
    ("Week 1", "29 Sep - 4 Oct"), ("Week 2", "5 - 11 Oct"), ("Week 3", "12 - 18 Oct"),
    ("Week 4", "19 - 25 Oct"), ("Week 5", "26 Oct - 1 Nov"), ("Week 6", "2 - 8 Nov"),
    ("Week 7", "9 - 15 Nov"), ("Ship", "16 - 18 Nov"),
]


def plan_table(goals):
    rows = [["Week", "Dates", "Goal", "Exit criterion"]]
    for (wk, dates), (goal, exitc) in zip(TIMELINE_WEEKS, goals):
        rows.append([wk, dates, goal, exitc])
    return ("tbl", rows, [0.7, 1.1, 2.6, 2.0])


def requirements_block(hands, seated, bus, wrapper):
    return [
        ("h2", "Hard requirement and design guidelines"),
        ("tbl", [["Test", "What the rules ask", "How this idea passes"],
                 ["Hands-first (hard requirement)", "Complete the entire experience without ever pairing a controller.", hands],
                 ["Airplane seat test", "Every interaction works within a two-foot radius, seated.", seated],
                 ["One bus stop test", "Fast cold start, clean pause/resume, a satisfying moment in 10 minutes or less.", bus],
                 ["Take it away test", "Remove any third-party service and a project still stands.", wrapper]],
         [1.2, 1.8, 3.0]),
    ]


def rules_notes_block(extra=None):
    items = [
        "**One prize per entry.** Rule 7 limits each entry to a single prize, so this brief aims at one track prize and names one special award as a fallback rather than trying to stack awards.",
        "**Submission:** a public HTTPS link (GitHub Pages, Vercel or similar) that stays live until the winner announcement (about 11 Dec 2026), a public YouTube/Vimeo video under 3 minutes, and the Devpost form (name, 140-character tagline, track, division, description of about 500 words, hand-interaction notes, target launch date).",
        "**No changes after the deadline.** Judging uses the build as it stood at 18 Nov 2026, 12:00 PT. Plan to submit on 17 Nov and freeze the hosted build.",
        "**Content rules:** English (or English subtitles), no identifiable real people other than entrants, no brand names or logos, all music, art and fonts properly licensed or original.",
        "**Video rules:** real footage from a Quest or the XR simulator; do not lean on AI-generated video to carry the pitch.",
        "**Performance floor:** judges expect at least 60 fps on Quest hardware. Target 72 fps.",
    ]
    if extra:
        items += extra
    return [("h2", "Competition rules that shape this plan"), ("bul", items)]
