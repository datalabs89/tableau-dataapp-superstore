"""
Publish the built .twbx to a Tableau Cloud site.

Uses the official Tableau Server Client (TSC), so the upload goes through
Tableau's own REST API rather than anything hand-rolled.

Credentials are never stored in this repo and never passed as arguments (they
would land in shell history and in the process table). Read from the
environment instead:

    TABLEAU_SERVER      e.g. https://10ay.online.tableau.com
    TABLEAU_SITE        the site's content URL, e.g. tableaucommunityleaders
    TABLEAU_PAT_NAME    the personal access token's name
    TABLEAU_PAT_VALUE   the personal access token's secret

Create the token in Tableau Cloud: click your avatar -> My Account Settings ->
Personal Access Tokens -> Create new token.

    python scripts/publish_to_cloud.py --list-projects
    python scripts/publish_to_cloud.py --project "Sales Analytics" --overwrite
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TWBX = ROOT / "build" / "Superstore Executive.twbx"

# Site content is not under this script's control: workbook and project names
# routinely carry accents and non-Latin scripts, and the Windows console
# defaults to cp1252. Without this, printing one of those names raises
# UnicodeEncodeError and takes down a publish that had already succeeded.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


def need(name: str) -> str:
    v = os.environ.get(name, "").strip()
    if not v:
        raise SystemExit(
            f"FATAL: {name} is not set.\n"
            f"  set {name}=... before running (see this file's docstring)")
    return v


def connect():
    try:
        import tableauserverclient as TSC
    except ImportError:
        raise SystemExit(
            "FATAL: tableauserverclient is not installed.\n"
            "  pip install tableauserverclient")
    return TSC


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--twbx", default=str(DEFAULT_TWBX),
                    help="path to the .twbx to publish")
    ap.add_argument("--project", default=None,
                    help="target project name (default: your Personal Space)")
    ap.add_argument("--name", default=None, help="workbook name on the site")
    ap.add_argument("--overwrite", action="store_true",
                    help="replace an existing workbook of the same name")
    ap.add_argument("--list-projects", action="store_true",
                    help="list projects on the site and exit")
    ap.add_argument("--list-workbooks", action="store_true",
                    help="list workbooks on the site and exit")
    args = ap.parse_args()

    TSC = connect()
    server = need("TABLEAU_SERVER").rstrip("/")
    site = os.environ.get("TABLEAU_SITE", "").strip()
    pat_name = need("TABLEAU_PAT_NAME")
    pat_value = need("TABLEAU_PAT_VALUE")

    auth = TSC.PersonalAccessTokenAuth(pat_name, pat_value, site_id=site)
    srv = TSC.Server(server, use_server_version=True)

    print(f"signing in : {server}  site='{site or '(default)'}'")
    with srv.auth.sign_in(auth):
        print(f"  signed in. server REST API version {srv.version}")

        if args.list_projects:
            print()
            print("projects:")
            for p in TSC.Pager(srv.projects):
                print(f"  {p.name:<40} id={p.id}")
            return 0

        if args.list_workbooks:
            print()
            print("workbooks:")
            for w in TSC.Pager(srv.workbooks):
                print(f"  {w.name:<44} project={w.project_name}")
            return 0

        twbx = Path(args.twbx)
        if not twbx.exists():
            raise SystemExit(f"FATAL: {twbx} not found - run scripts/build_all.py first")
        size_mb = twbx.stat().st_size / 1024 / 1024
        print(f"publishing : {twbx.name}  ({size_mb:.1f} MB)")

        # Resolve the destination project.
        if args.project:
            match = next((p for p in TSC.Pager(srv.projects)
                          if p.name == args.project), None)
            if match is None:
                names = [p.name for p in TSC.Pager(srv.projects)]
                raise SystemExit(f"FATAL: no project named {args.project!r}.\n"
                                 f"  available: {names}")
            project_id = match.id
            dest = match.name
        else:
            # No project: publish to the signed-in user's Personal Space.
            project_id = None
            dest = "Personal Space"

        # Replacing an existing workbook means REPUBLISHING over it, not calling
        # update(). TSC's `workbooks.update()` takes no file argument at all - it
        # only changes metadata (owner, project, tab display). Passing a path to
        # it silently discards the path, reports success, and leaves the old
        # workbook untouched. That bug shipped once here and was caught only by
        # noticing the site's updated_at had not moved.
        existing = next((w for w in TSC.Pager(srv.workbooks)
                         if w.name == (args.name or twbx.stem)), None)

        if existing is not None and not args.overwrite:
            raise SystemExit(
                f"FATAL: a workbook named {existing.name!r} already exists "
                f"(project={existing.project_name}).\n"
                f"  pass --overwrite to replace it.")

        # PublishMode.Overwrite replaces a same-named workbook in the project.
        # project_id must come from the workbook being replaced, or the upload
        # lands in a different project and leaves a duplicate behind.
        wb_item = TSC.WorkbookItem(
            project_id=existing.project_id if existing is not None else project_id,
            name=args.name or twbx.stem)
        published = srv.workbooks.publish(
            wb_item, str(twbx), mode=TSC.Server.PublishMode.Overwrite)
        action = "replaced" if existing is not None else "published"

        print(f"  {action}: {published.name}  -> {dest}")
        print(f"  id: {published.id}")

        # Confirm the site's copy is actually the one just uploaded: a
        # republish that silently no-ops is a failure this check catches.
        fresh = srv.workbooks.get_by_id(published.id)
        print(f"  updated_at: {fresh.updated_at}")
        size_kb = fresh.size / 1024 if fresh.size else 0
        print(f"  size on site: {size_kb:,.0f} KB")

        wb_id = published.id
        # TSC does not always populate the web URL, so build it.
        site_part = f"/#/site/{site}" if site else ""
        print(f"  url: {server}{site_part}/workbooks/{wb_id}")
        print()
        print("next: Tableau Cloud -> Settings -> Packages -> allow packages,")
        print("      then open the workbook and use the Data pane to verify queries.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
