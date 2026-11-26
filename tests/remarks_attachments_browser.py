"""Verify attachment upload, ordering, deletion, DOCX and PDF in Chromium."""
import base64
import functools
import io
import os
import re
import tempfile
import threading
import zipfile
from http.server import ThreadingHTTPServer
from pathlib import Path
from xml.etree import ElementTree as ET

import fitz
from PIL import Image
from playwright.sync_api import expect, sync_playwright

from remarks_browser import Handler, ROOT, docx, dump, export, snapshot, start, write


def bitmap(color, fmt="PNG", size=(100, 160)):
    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, fmt)
    return out.getvalue()


def colored_pdf(colors):
    with fitz.open() as pdf:
        for index, color in enumerate(colors):
            page = pdf.new_page(width=144 if index % 2 else 108, height=96 if index % 2 else 144)
            page.draw_rect(page.rect, fill=tuple(v / 255 for v in color), color=None)
        return pdf.tobytes()


def put_bytes(page, name, data):
    page.evaluate("""async ([name, data]) => {
        const dir = await testDir();
        const file = await dir.getFileHandle(name,{create:true});
        const writer = await file.createWritable();
        await writer.write(Uint8Array.from(atob(data), byte => byte.charCodeAt(0))); await writer.close();
    }""", [name, base64.b64encode(data).decode()])


def upload(page, gallery, group, *files):
    with page.expect_file_chooser() as chosen:
        gallery.get_by_role("button", name=f"Добавить фото или PDF, ряд {group}", exact=True).click()
    chosen.value.set_files(list(files))
    expect(page.locator("#pick")).to_be_enabled(timeout=30000)


def check_color(actual, expected):
    assert all(abs(a - b) <= 12 for a, b in zip(actual[:3], expected)), (actual, expected)


def word_images(parts, expected):
    xml = ET.fromstring(parts["word/document.xml"])
    rels = ET.fromstring(parts["word/_rels/document.xml.rels"])
    a = "http://schemas.openxmlformats.org/drawingml/2006/main"
    r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    wp = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    by_id = {item.attrib["Id"]: item.attrib["Target"] for item in rels}
    assert len(by_id) == len(rels)
    assert by_id["rId13"] == "media/remark-photo-1.jpg"
    assert parts["word/media/remark-photo-1.jpg"] == bitmap((70, 80, 100), "JPEG")
    paths = [by_id[blip.attrib[f"{{{r}}}embed"]] for blip in xml.iter(f"{{{a}}}blip")
             if f"{{{r}}}embed" in blip.attrib]
    paths = [p for p in paths if p.startswith("media/remark-photo-")]
    ids = [element.attrib["id"] for element in xml.iter(f"{{{wp}}}docPr")]
    assert len(ids) == len(set(ids))
    assert len(paths) == len(expected) and len(set(paths)) == len(expected)
    for path, color in zip(paths, expected):
        with Image.open(io.BytesIO(parts["word/" + path])) as jpg:
            assert jpg.format == "JPEG"
            check_color(jpg.getpixel((jpg.width // 2, jpg.height // 2)), color)


def custom_template():
    original = base64.b64decode((ROOT / "shablon-akt.b64").read_bytes())
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(original)) as source, zipfile.ZipFile(output, "w") as target:
        for name in source.namelist():
            value = source.read(name)
            if name == "word/_rels/document.xml.rels":
                value = value.replace(b"</Relationships>", (
                    b'<Relationship Id="rId13" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
                    b'relationships/image" Target="media/remark-photo-1.jpg"/></Relationships>'))
            target.writestr(name, value)
        target.writestr("word/media/remark-photo-1.jpg", bitmap((70, 80, 100), "JPEG"))
    return output.getvalue()


def pdf_images(page, colors, bounds):
    images = [fitz.Rect(i["bbox"]) for i in page.get_image_info()]
    assert len(images) == len(colors), (len(images), len(colors))
    raster = page.get_pixmap(matrix=fitz.Matrix(2, 2))
    for i, rect in enumerate(images):
        assert bounds.contains(rect), rect
        assert all((rect & other).get_area() < .02 for other in images[:i]), rect
        x, y = int((rect.x0 + rect.x1) + .5), int((rect.y0 + rect.y1) + .5)
        check_color(raster.pixel(x, y), colors[i])


def run(chromium, origin, profile):
    errors, requests = [], []
    ctx, page = start(chromium, profile, origin, errors, requests)
    legacy_first, legacy_second = (200, 33, 42), (25, 158, 66)
    first_image, last_image = (34, 66, 201), (220, 165, 20)
    pages_a = [(20, 190, 206), (158, 45, 160), (214, 114, 70), (80, 85, 122)]
    pages_b = [(55 + x * 9, 125 + x * 5, 175 - x * 7) for x in range(12)]
    dump(page, [126,127])
    write(page, "интеграционные.json", '{"126":"ИНТ-126"}')
    put_bytes(page, "126_1.JPG", bitmap(legacy_first, "JPEG"))
    put_bytes(page, "126_2.png", bitmap(legacy_second))
    put_bytes(page, "shablon-akt.docx", custom_template())
    page.locator("#pick").click()
    page.locator("#continueMigration").click()
    expect(page.locator("body")).to_have_attribute("data-version", "2.12")
    mini = page.locator('tr[data-remark="126"] [data-photo-for="126"]')
    expect(mini.locator(".remark-photo-row")).to_have_count(2)
    expect(mini.locator(".remark-photo-tile")).to_have_count(2)
    original = snapshot(page)

    upload(page, mini, 1,
        {"name":"1.png","mimeType":"image/png","buffer":bitmap(first_image)},
        {"name":"a.pdf","mimeType":"application/pdf","buffer":colored_pdf(pages_a)},
        {"name":"2.png","mimeType":"image/png","buffer":bitmap(last_image)})
    expect(mini.locator(".remark-photo-row").nth(0).locator(".remark-photo-tile")).to_have_count(7)
    upload(page, mini, 2, {"name":"b.pdf","mimeType":"application/pdf","buffer":colored_pdf(pages_b)})
    expect(mini.locator(".remark-photo-row").nth(1).locator(".remark-photo-tile")).to_have_count(13)

    good = snapshot(page)
    assert all(good[name] == content for name, content in original.items())
    upload(page, mini, 1, {"name":"bad.pdf","mimeType":"application/pdf","buffer":b"Broken PDF"})
    expect(page.locator("#remark-photo-status")).to_contain_text("bad.pdf")
    assert snapshot(page) == good

    page.reload()
    expect(mini.locator(".remark-photo-tile")).to_have_count(20)
    page.locator('#num').fill("126")
    large = page.locator('#out [data-photo-for="126"]')
    expect(large.locator(".remark-photo-row")).to_have_count(2)
    expect(large.locator(".remark-photo-tile")).to_have_count(20)
    assert not any("после" in text.lower() for text in large.all_text_contents())
    for group in range(2):
        image = large.locator(".remark-photo-row").nth(group).locator("img").first
        image.scroll_into_view_if_needed()
        expect(image).to_have_attribute("src", re.compile(r"^blob:"))
        page.wait_for_function("img => img.naturalWidth > 0", arg=image.element_handle())
    large.locator(".remark-photo-row").nth(0).get_by_role("button", name="Открыть фото 4", exact=True).click()
    expect(page.locator("#remark-photo-image")).to_be_visible()
    page.locator("#remark-photo-remove").click()
    expect(mini.locator(".remark-photo-tile")).to_have_count(19)
    expect(large.locator(".remark-photo-tile")).to_have_count(19)
    expect(page.locator("#remark-photo-preview")).to_be_hidden()
    assert len(snapshot(page)) == len(good) - 1
    expected = [legacy_first, first_image, pages_a[0], *pages_a[2:], last_image, legacy_second, *pages_b]

    word_images(docx(page), expected)
    print("PASS: two unlabeled rows, legacy files, mixed multipage imports, deletion and DOCX image order", flush=True)

    with export(page, [126]) as single, export(page, [126,127]) as multi, export(page) as journal:
        assert len(single) == 1 and len(multi) == 2 and len(journal) == 3
        pdf_images(single[0], expected, fitz.Rect(36, 60, 559, 460))
        pdf_images(multi[0], expected, fitz.Rect(36, 60, 559, 460))
        pdf_images(journal[0], expected, fitz.Rect(481, 60, 544.01, 180))
        pdf_images(journal[1], expected, fitz.Rect(36, 60, 559, 460))
        assert journal[2].get_image_info() == []
        if os.getenv("REMARKS_PREVIEW"):
            output = Path(os.environ["REMARKS_PREVIEW"])
            output.mkdir(parents=True, exist_ok=True)
            journal[0].get_pixmap().save(output / "attachment-cover.png")
            single[0].get_pixmap().save(output / "attachment-page.png")
            page.locator("#num").fill("126")
            large.scroll_into_view_if_needed()
            page.wait_for_function("""() => {
                const rows = [...document.querySelectorAll('#out .remark-photo-row')];
                return rows.length === 2 && rows.every(row => row.querySelector('img')?.naturalWidth);
            }""")
            page.screenshot(path=output / "attachments-ui.png")

    page.locator('.version-switch a[href="./sborka-v2.9.html"]').click()
    expect(page.locator("body")).to_have_attribute("data-version","2.9")
    expect(page.locator('tr[data-remark="126"] .mini-photos img')).to_have_count(2)
    page.locator('.version-switch a[href="./sborka.html"]').click()
    expect(mini.locator(".remark-photo-tile")).to_have_count(19)
    assert not errors, errors
    assert not requests, requests
    ctx.close()
    print("PASS: single, multi and journal PDF layouts keep all 19 images within bounds", flush=True)


def main():
    handler = functools.partial(Handler, directory=ROOT)
    with ThreadingHTTPServer(("127.0.0.1",0), handler) as server, tempfile.TemporaryDirectory() as profile, sync_playwright() as p:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            run(p.chromium, f"http://127.0.0.1:{server.server_port}/", profile)
        finally:
            server.shutdown()
            thread.join()


if __name__ == "__main__":
    main()
