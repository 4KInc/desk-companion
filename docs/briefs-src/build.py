"""Builds the Desk Companion brief: python3 docs/briefs-src/build.py (needs reportlab).

Writes idea-briefs/06-desk-companion.pdf. The other five briefs were generated in an
earlier session; their PDFs are in idea-briefs/ but their sources were not kept.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from engine import build  # noqa: E402
from idea_desk_companion import IDEA  # noqa: E402

TOTAL_BRIEFS = 6
out = os.path.join(HERE, '..', '..', 'idea-briefs', f"{IDEA['num']:02d}-{IDEA['slug']}.pdf")
build(IDEA, os.path.normpath(out), TOTAL_BRIEFS)
print('wrote', os.path.normpath(out))
