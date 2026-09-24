"""Writes the .DS_Store that tells Finder how to draw the disk image window.

Finder stores window geometry, icon size and icon positions in .DS_Store at the
root of the volume, so a styled image needs that file built before the volume is
made. The background picture is referenced by an alias record, and an alias
cannot be produced from a path that is not mounted: the record below is a known
good one whose volume name is rewritten, the same approach Bitcoin Core uses to
build styled images on Linux.
"""

import base64
import sys

from ds_store import DSStore
from mac_alias import Alias

BACKGROUND_ALIAS_B64 = (
    "AAAAAAIeAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADRlFywSCsABQAAAJgPYmFja2dyb3VuZC50aWZmAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAmdE5sPgAAAAAAAAAAP////8AAA0CAAAAAAAA"
    "AAAAAAAAAAAACy5iYWNrZ3JvdW5kAAAQAAgAANGUXLAAAAARAAgAANE5sPgAAAABAAQAAACYAA4AIAAPAGIAYQBjAGsAZwBy"
    "AG8AdQBuAGQALgB0AGkAZgBmAA8AAgAAABIAHC8uYmFja2dyb3VuZC9iYWNrZ3JvdW5kLnRpZmYAFAEGAAAAAAEGAAIAAAxN"
    "YWNpbnRvc2ggSEQAAAAAAAAAAAAAAAAAAADOl6vDSCsAAAGIW4gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAnWrjdGUXLBkZXZyZGRza/////8AAAkgAAAAAAAAAAAAAAAAAAAAB2Jp"
    "dGNvaW4AABAACAAAzperwwAAABEACAAA0ZRcsAAAAAEAFAGIW4gAFqkJAAj6UgAI+lEAAmSOAA4AAgAAAA8AGgAMAE0AYQBj"
    "AGkAbgB0AG8AcwBoACAASABEABMAAS8AABUAAgAU//8AAP//AAA="
)

WINDOW_WIDTH = 640
BACKGROUND_HEIGHT = 460
# WindowBounds меряет окно вместе с заголовком, а фон ложится под него. Finder
# отдаёт ровно запрошенные размеры, поэтому не хватает как раз на заголовок:
# без запаса снизу отрезается полоса и появляется прокрутка. Высоту содержимого
# Finder считает по нижнему элементу вместе с подписью и своими полями, поэтому
# нижний ряд держится выше края фона, а не впритык.
WINDOW_CHROME = 38
WINDOW_HEIGHT = BACKGROUND_HEIGHT + WINDOW_CHROME
ICON_SIZE = 104
ICON_ROW = 170
APP_COLUMN = 170
APPLICATIONS_COLUMN = 470
README_ROW = 345
README_COLUMN = 320


def main():
    if len(sys.argv) != 5:
        raise SystemExit("usage: dmg-dsstore.py <.DS_Store> <volume name> <app name> <readme name>")
    output, volume, app, readme = sys.argv[1:]

    alias = Alias.from_bytes(base64.b64decode(BACKGROUND_ALIAS_B64))
    alias.volume.name = volume
    alias.volume.posix_path = "/Volumes/" + volume
    alias.target.carbon_path = volume + ":.background:\x00background.tiff"

    store = DSStore.open(output, "w+")
    try:
        store["."]["bwsp"] = {
            "WindowBounds": "{{200, 160}, {%d, %d}}" % (WINDOW_WIDTH, WINDOW_HEIGHT),
            "ShowStatusBar": False,
            "ShowToolbar": False,
            "ShowPathbar": False,
            "ShowSidebar": False,
            "ShowTabView": False,
            "ContainerShowSidebar": False,
            "SidebarWidth": 0,
            "PreviewPaneVisibility": False,
        }
        store["."]["icvp"] = {
            "viewOptionsVersion": 1,
            "backgroundType": 2,
            "backgroundImageAlias": alias.to_bytes(),
            "backgroundColorRed": 1.0,
            "backgroundColorGreen": 1.0,
            "backgroundColorBlue": 1.0,
            "iconSize": float(ICON_SIZE),
            "textSize": 13.0,
            "gridSpacing": 100.0,
            "gridOffsetX": 0.0,
            "gridOffsetY": 0.0,
            "arrangeBy": "none",
            "labelOnBottom": True,
            "showIconPreview": True,
            "showItemInfo": False,
        }
        store["."]["vSrn"] = ("long", 1)
        store[app]["Iloc"] = (APP_COLUMN, ICON_ROW)
        store["Applications"]["Iloc"] = (APPLICATIONS_COLUMN, ICON_ROW)
        store[readme]["Iloc"] = (README_COLUMN, README_ROW)
        store.flush()
    finally:
        store.close()

    print("%s: окно %dx%d, иконки %d, %s в (%d, %d), Applications в (%d, %d), %s в (%d, %d)"
          % (output, WINDOW_WIDTH, WINDOW_HEIGHT, ICON_SIZE, app, APP_COLUMN, ICON_ROW,
             APPLICATIONS_COLUMN, ICON_ROW, readme, README_COLUMN, README_ROW))


main()
