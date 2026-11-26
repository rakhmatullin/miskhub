"""Verify the row actions and СКП appendices in Chromium."""
import functools
import io
import json
import tempfile
import threading
import zipfile
from http.server import ThreadingHTTPServer
from xml.etree import ElementTree as ET

from PIL import Image
from playwright.sync_api import expect, sync_playwright

from remarks_attachments_browser import bitmap, check_color, colored_pdf, put_bytes, upload
from remarks_browser import Handler, ROOT, docx, dump, read, snapshot, start, write


COMMENTS = "комментарии.json"
ACT = "Акт об Устранении №ИНТ-126.docx"
FIRST_REF = "Приложение: 1) Фотоматериалы"
SECOND_REF = "Приложение: 2) Акт приема-передачи"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def check_act(parts, groups):
    body = ET.fromstring(parts["word/document.xml"]).find(W + "body")
    rels = ET.fromstring(parts["word/_rels/document.xml.rels"])
    targets = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
    assert len(rels) == len(targets)
    references, photos = [], []
    for paragraph in body.findall(W + "p"):
        text = "".join(t.text for t in paragraph.iter(W + "t") if t.text).strip()
        if text.startswith("Приложение:"):
            references.append(text)
        if text in ("Приложение 1", "Приложение 2"):
            assert int(text[-1]) == len(photos) + 1
            assert paragraph.find(f"{W}pPr/{W}pageBreakBefore") is not None
            photos.append([])
        for image in paragraph.iter(A + "blip"):
            target = targets[image.attrib[R + "embed"]]
            if target.startswith("media/remark-photo-"):
                with Image.open(io.BytesIO(parts["word/" + target])) as jpg:
                    photos[-1].append(jpg.getpixel((jpg.width // 2, jpg.height // 2)))

    assert len(photos) == len(groups)
    assert references == ([FIRST_REF, SECOND_REF] if len(groups) == 2 else [FIRST_REF])
    for actual, expected in zip(photos, groups):
        assert len(actual) == len(expected), (actual, expected)
        for color, sample in zip(actual, expected):
            check_color(color, sample)


def run(chromium, origin, profile):
    errors, requests = [], []
    ctx, page = start(chromium, profile, origin, errors, requests)
    dump(page, [126, 127, 128])
    write(page, COMMENTS, '{"126":"Старый комментарий", "127":{"c1":"Текст","c2":"Примечание"}}')
    write(page, "интеграционные.json", '{"126":"ИНТ-126"}')
    red, blue, green, yellow = (175, 33, 55), (27, 68, 192), (42, 168, 73), (224, 173, 38)
    put_bytes(page, "126_1.jpg", bitmap(red, "JPEG"))
    put_bytes(page, "126_2.png", bitmap(blue))
    put_bytes(page, "127_2.jpg", bitmap(yellow, "JPEG"))

    page.locator("#pick").click()
    page.locator("#continueMigration").click()
    expect(page.locator("body")).to_have_attribute("data-version", "2.13")
    gallery = page.locator('tr[data-remark="126"] [data-photo-for="126"]')
    upload(page, gallery, 1, {"name": "first.png", "mimeType": "image/png", "buffer": bitmap(green)})
    upload(page, gallery, 2, {"name": "second.pdf", "mimeType": "application/pdf", "buffer": colored_pdf([yellow, red])})
    expect(gallery.locator(".remark-photo-tile")).to_have_count(5)

    menu = page.locator("#remark-row-menu")
    checkbox = menu.get_by_role("checkbox", name="СКП", exact=True)
    status = menu.get_by_role("status")

    def open_menu(n):
        trigger = page.get_by_role("button", name=f"Действия замечания №{n}", exact=True)
        trigger.click()
        expect(trigger).to_have_attribute("aria-expanded", "true")
        expect(menu).to_be_visible()
        return trigger

    def download(n, filename):
        with page.expect_download() as result:
            menu.get_by_role("button", name=f"Скачать акт Word №{n}", exact=True).click()
        assert result.value.suggested_filename == filename
        with zipfile.ZipFile(result.value.path()) as archive:
            assert archive.testzip() is None
            return {name: archive.read(name) for name in archive.namelist()}

    page.locator("#num").fill("127")
    trigger = open_menu(126)
    expect(checkbox).not_to_be_checked()
    checkbox.check()
    expect(status).to_have_text("Сохранено.")
    comments = json.loads(read(page, COMMENTS))
    assert comments == {"126": {"c1": "Старый комментарий", "c2": "", "skp": True},
                        "127": {"c1": "Текст", "c2": "Примечание"}}
    check_act(download(126, ACT), [[red, green], [blue, yellow, red]])
    assert ACT not in snapshot(page)
    page.keyboard.press("Escape")
    expect(menu).to_be_hidden()
    expect(trigger).to_have_attribute("aria-expanded", "false")

    page.reload()
    open_menu(126)
    expect(checkbox).to_be_checked()
    page.keyboard.press("Escape")
    check_act(docx(page), [[red, green], [blue, yellow, red]])

    page.set_viewport_size({"width": 360, "height": 700})
    open_menu(127)
    expect(checkbox).not_to_be_checked()
    box = menu.bounding_box()
    assert 0 <= box["x"] <= box["x"] + box["width"] <= 360
    assert 0 <= box["y"] <= box["y"] + box["height"] <= 700
    check_act(download(127, "Акт об Устранении №127.docx"), [[yellow]])
    checkbox.check()
    expect(status).to_have_text("Сохранено.")
    check_act(download(127, "Акт об Устранении №127.docx"), [[], [yellow]])

    open_menu(128)
    expect(checkbox).not_to_be_checked()
    checkbox.check()
    expect(status).to_have_text("Сохранено.")
    check_act(download(128, "Акт об Устранении №128.docx"), [[], []])

    open_menu(126)
    checkbox.uncheck()
    expect(status).to_have_text("Сохранено.")
    assert json.loads(read(page, COMMENTS))["126"] == {"c1": "Старый комментарий", "c2": ""}
    check_act(download(126, ACT), [[red, green, blue, yellow, red]])

    page.keyboard.press("Escape")
    page.locator('.version-switch a[href="./sborka-v2.10.html"]').click()
    expect(page.locator("body")).to_have_attribute("data-version", "2.10")
    expect(gallery.locator(".remark-photo-tile")).to_have_count(5)
    expect(page.locator("[data-remark-menu]")).to_have_count(0)
    page.locator('.version-switch a[href="./sborka.html"]').click()
    open_menu(127)
    expect(checkbox).to_be_checked()
    assert not errors, errors
    assert not requests, requests
    ctx.close()
    print("PASS: row actions, saved СКП, two DOCX appendices, fallback and v2.10 navigation")


def main():
    handler = functools.partial(Handler, directory=ROOT)
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server, tempfile.TemporaryDirectory() as profile, sync_playwright() as p:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            run(p.chromium, f"http://127.0.0.1:{server.server_port}/", profile)
        finally:
            server.shutdown()
            thread.join()


if __name__ == "__main__":
    main()
