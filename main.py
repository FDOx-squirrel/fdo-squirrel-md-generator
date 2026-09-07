"""fdo-squirrel-md-generator orchestrator -- the only entry point.

    python main.py                     run the (one) step
    python main.py --list              print steps and exit
    python main.py --only build        same as the default here, spelled out
    python main.py --dry-run           print the plan, run nothing
    python main.py --strict            also lint site/index.html for CDN version pins (this is what CI runs)

This repo has exactly one step (see py/step_build.py's own docstring for
why) -- --from/--skip exist for family-wide consistency (every repo takes
the same six flags, PRIMER.md primer-repo skill) but are degenerate here.
See PRIMER.md for what "build" does and why. It is independently runnable
as `python py/step_build.py --strict` too -- this file is a convenience,
not the only path.
"""
from __future__ import annotations

import argparse
import importlib
import sys
import time
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Step:
    id: str
    module: str  # imported lazily as py.<module>
    depends_on: tuple[str, ...] = field(default_factory=tuple)
    network: bool = False
    description: str = ""


STEPS: list[Step] = [
    Step("build", "step_build",
         description="Render docs/config.js, copy site/+schemas/ into docs/ (no network)."),
]

STEP_IDS = [s.id for s in STEPS]
STEP_BY_ID = {s.id: s for s in STEPS}


def build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="Print steps and exit.")
    ap.add_argument("--only", metavar="STEP", help="Run exactly one step.")
    ap.add_argument("--from", dest="frm", metavar="STEP", help="Run this step and everything after.")
    ap.add_argument("--skip", metavar="STEP", help="Run everything but this step.")
    ap.add_argument("--dry-run", action="store_true", help="Print the plan, run nothing.")
    ap.add_argument("--strict", action="store_true", help="Warnings become errors; also lints site/index.html's CDN pins.")
    return ap


def _check_known(step_id: str | None) -> None:
    if step_id and step_id not in STEP_BY_ID:
        raise SystemExit(f"Unknown step: {step_id} (known: {', '.join(STEP_IDS)})")


def resolve_selection(args: argparse.Namespace) -> list[str]:
    _check_known(args.only)
    _check_known(args.frm)
    _check_known(args.skip)
    if sum(bool(x) for x in (args.only, args.frm, args.skip)) > 1:
        raise SystemExit("--only/--from/--skip are mutually exclusive")
    if args.only:
        return [args.only]
    if args.frm:
        i = STEP_IDS.index(args.frm)
        return STEP_IDS[i:]
    if args.skip:
        return [s for s in STEP_IDS if s != args.skip]
    return list(STEP_IDS)


def print_list() -> None:
    for s in STEPS:
        deps = f" (depends on: {', '.join(s.depends_on)})" if s.depends_on else ""
        print(f"  {s.id:<8} {s.description}{deps}")


def run_step(step: Step, args: argparse.Namespace) -> tuple[bool, str]:
    mod = importlib.import_module(f"py.{step.module}")
    return mod.run(args)


def main() -> int:
    args = build_arg_parser().parse_args()

    if args.list:
        print_list()
        return 0

    selection = resolve_selection(args)

    if args.dry_run:
        print("Plan (dry run, nothing executed):")
        for step_id in selection:
            print(f"  - {step_id}")
        return 0

    timings: list[tuple[str, float]] = []
    for step_id in selection:
        step = STEP_BY_ID[step_id]
        start = time.monotonic()
        try:
            ok, message = run_step(step, args)
        except Exception as exc:  # noqa: BLE001 -- report, do not swallow
            print(f"[{step_id}] ERROR: {exc}", file=sys.stderr)
            return 1
        elapsed = time.monotonic() - start
        timings.append((step_id, elapsed))
        print(f"[{step_id}] {message} ({elapsed:.2f}s)")
        if not ok:
            print(f"[{step_id}] step reported failure, stopping.", file=sys.stderr)
            return 1

    total = sum(t for _, t in timings) or 1e-9
    print("\nTiming:")
    for step_id, elapsed in timings:
        print(f"  {step_id:<10} {elapsed:6.2f}s  {100 * elapsed / total:5.1f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
