#!/usr/bin/env python3
"""Collapse excess blank lines and compact markdown table cells to `| content |`.

Markdown Preview edits often insert extra blank lines and column-align/pad table cells.
Run this after Preview edits (defaults to README.md at repo root):

   python scripts/fix-md-tables.py
   python scripts/fix-md-tables.py path/to/file.md
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SEP_CELL = re.compile(r"^:?-{3,}:?$")


def compact_cell(cell: str) -> str:
   stripped = cell.strip()
   if SEP_CELL.fullmatch(stripped):
      return " --- "
   return f" {stripped} " if stripped else " "


def compact_row(line: str) -> str:
   if not (line.startswith("|") and line.count("|") >= 2):
      return line
   parts = line.split("|")
   cells = parts[1:-1] if line.endswith("|") else parts[1:]
   return "|" + "|".join(compact_cell(c) for c in cells) + "|"


def fix_markdown(text: str) -> str:
   has_crlf = "\r\n" in text
   lines = text.replace("\r\n", "\n").splitlines()

   processed: list[str] = []
   for line in lines:
      if line.startswith("|") and line.count("|") >= 2:
         processed.append(compact_row(line))
      else:
         processed.append(line.rstrip())

   out: list[str] = []
   prev_blank = False
   for line in processed:
      blank = line.strip() == ""
      if blank:
         if prev_blank:
            continue
         out.append("")
         prev_blank = True
      else:
         out.append(line)
         prev_blank = False

   while out and out[-1] == "":
      out.pop()

   result = "\n".join(out) + "\n"
   if has_crlf:
      result = result.replace("\n", "\r\n")
   return result


def main() -> int:
   repo_root = Path(__file__).resolve().parent.parent
   path = Path(sys.argv[1]) if len(sys.argv) > 1 else repo_root / "README.md"
   if not path.is_absolute():
      path = (Path.cwd() / path).resolve()

   if not path.is_file():
      print(f"File not found: {path}", file=sys.stderr)
      return 1

   original = path.read_text(encoding="utf-8")
   fixed = fix_markdown(original)
   if fixed == original:
      print(f"Already clean: {path}")
      return 0

   path.write_text(fixed, encoding="utf-8", newline="")
   old_n = original.count("\n") + (0 if original.endswith("\n") else 1)
   new_n = fixed.count("\n") + (0 if fixed.endswith("\n") else 1)
   print(f"Fixed {path}")
   print(f"  lines: {old_n} -> {new_n}")
   return 0


if __name__ == "__main__":
   raise SystemExit(main())
