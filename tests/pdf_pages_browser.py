"""Run with python -B tests/pdf_pages_browser.py.

Uses local synthetic files, real PDF worker threads and a headless Chromium
profile. Set CHROMIUM for a custom executable or PDF_PAGES_PREVIEW for images.
"""
import functools
import io
import os
import re
import shutil
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import fitz
from PIL import Image
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def generate_pdf(path, count):
    with fitz.open() as document:
        for n in range(1, count + 1):
            page = document.new_page(width=360 if n % 2 else 540, height=480 if n % 2 else 360)
            page.insert_text((36, 55), f"Original page {n}", fontsize=20)
        document.save(path, garbage=3, deflate=True)


def node(page, suffix):
    return page.locator("#pdf-pages-" + suffix)


def open_pdf(page, source):
    with page.expect_file_chooser() as choosing:
        node(page, "pick").click()
    choosing.value.set_files(source)


def insert(page, button, *paths):
    with page.expect_file_chooser() as choosing:
        button.click()
    choosing.value.set_files(list(paths))


def position(page, n):
    node(page, "jump").fill(str(n))
    node(page, "jump-form").get_by_role("button", name="Перейти", exact=True).click()
    expect(page.get_by_role("button", name="Открыть страницу " + str(n), exact=True)).to_be_visible()


def saved_pdf(page):
    with page.expect_download(timeout=120000) as download:
        node(page, "build").click()
    assert download.value.suggested_filename.endswith(".pdf")
    return download.value.path()


def cases(page, folder):
    small = folder / "Схема.pdf"
    huge = folder / "10000.pdf"
    green = folder / "зелёная.png"
    blue = folder / "синяя.jpg"
    generate_pdf(small, 3)
    Image.new("RGB", (200, 100), (18, 176, 92)).save(green)
    Image.new("RGB", (100, 240), (12, 61, 180)).save(blue)
    open_pdf(page, small)
    expect(node(page, "status")).to_contain_text("3 страницы")
    expect(node(page, "grid").locator("img:not([hidden])")).to_have_count(3, timeout=15000)

    assert saved_pdf(page).read_bytes() == small.read_bytes()
    page.get_by_role("button", name="Открыть страницу 2", exact=True).click()
    expect(node(page, "viewer")).to_be_visible()
    expect(node(page, "picture")).to_be_visible()
    expect(node(page, "viewer-title")).to_have_text("Страница 2 из 3")
    assert node(page, "viewer").evaluate("e => e.clientHeight === innerHeight")
    node(page, "zoom").click()
    expect(node(page, "preview")).to_have_class("zoomed")
    node(page, "zoom").click()
    page.keyboard.press("ArrowRight")
    expect(node(page, "viewer-title")).to_have_text("Страница 3 из 3")
    with page.expect_download() as target:
        node(page, "save-image").click()
    assert target.value.suggested_filename.endswith("-стр-3.jpg")
    with Image.open(io.BytesIO(target.value.path().read_bytes())) as raster:
        assert raster.format == "JPEG" and 1100 <= raster.width <= 1250 and raster.height >= 1500
    page.keyboard.press("Escape")
    expect(node(page, "viewer")).to_be_hidden()

    page.get_by_role("button", name="Удалить страницу 2", exact=True).click()
    expect(node(page, "count")).to_contain_text("2 страницы")
    insert(page, page.get_by_role("button", name="Вставить изображение перед страницей 2", exact=True), green)
    expect(node(page, "count")).to_contain_text("3 страницы")
    insert(page, node(page, "add"), blue)
    expect(node(page, "count")).to_contain_text("4 страницы")
    expect(node(page, "grid").locator("img:not([hidden])")).to_have_count(4)
    with page.expect_download() as target:
        page.get_by_role("button", name="Скачать картинку страницы 2", exact=True).click()
    assert target.value.path().read_bytes() == green.read_bytes()
    with fitz.open(saved_pdf(page)) as output:
        assert len(output) == 4
        assert output[0].get_text().strip() == "Original page 1"
        assert output[2].get_text().strip() == "Original page 3"
        assert output[0].rect == fitz.Rect(0, 0, 360, 480)
        assert all(output[idx].get_images() for idx in (1, 3))
        for idx, expected in ((1, (18, 176, 92)), (3, (12, 61, 180))):
            raster = output[idx].get_pixmap()
            assert all(abs(a - b) < 6 for a, b in zip(raster.pixel(raster.width//2, raster.height//2), expected))
    broken = folder / "Ошибка.pdf"
    broken.write_text("Invalid input")
    open_pdf(page, broken)
    expect(node(page, "status")).to_contain_text("Не удалось прочитать")
    expect(node(page, "count")).to_contain_text("4 страницы")
    print("PASS: unchanged export, fullscreen, JPEG, delete, insert, order, vector text, bad file", flush=True)

    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    node(page, "pick").scroll_into_view_if_needed()
    if os.getenv("PDF_PAGES_PREVIEW"):
        page.screenshot(path=os.environ["PDF_PAGES_PREVIEW"] + "-mobile.png")
    page.set_viewport_size({"width": 1280, "height": 900})
    generate_pdf(huge, 10_000)
    open_pdf(page, huge)
    expect(node(page, "status")).to_contain_text(re.compile(r"10\s+000 страниц"), timeout=30000)
    expect(node(page, "grid").locator("img:not([hidden])").first).to_be_visible()
    assert 0 < node(page, "grid").locator(".pdf-page-cell").count() < 75
    position(page, 5000)
    position(page, 1)
    position(page, 10000)
    assert node(page, "grid").locator(".pdf-page-cell").count() < 75
    page.get_by_role("button", name="Открыть страницу 10000", exact=True).click()
    expect(node(page, "picture")).to_be_visible()
    page.keyboard.press("Escape")
    page.get_by_role("button", name="Удалить страницу 10000", exact=True).click()
    expect(node(page, "count")).to_contain_text(re.compile(r"9\s+999 страниц"))
    insert(page, node(page, "add"), blue)
    expect(node(page, "count")).to_contain_text(re.compile(r"10\s+000 страниц"))
    with fitz.open(saved_pdf(page)) as output:
        assert len(output) == 10000
        assert output[4999].get_text().strip() == "Original page 5000"
        assert output[9998].get_text().strip() == "Original page 9999"
        assert output[9999].get_text().strip() == "" and output[9999].get_images()
    print("PASS: preview, virtual gallery under 75 cards and modified export for 10,000 pages", flush=True)

    page.locator("header a[href='./pdf-master-v2.1.html']").click()
    expect(page.locator("body")).to_have_attribute("data-version", "2.1")
    assert page.locator("#pdf-pages").count() == 0
    page.locator("#file-input").set_input_files(small)
    expect(page.locator(".card .take")).to_have_count(1)
    page.locator("header a[href='./pdf-master.html']").click()
    expect(page.locator("body")).to_have_attribute("data-version", "2.2")
    expect(node(page, "pick")).to_be_visible()
    print("PASS: archived v2.1 still opens PDFs and switches back to v2.2", flush=True)


def main():
    with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
        handler = functools.partial(QuietHandler, directory=ROOT)
        with ThreadingHTTPServer(("127.0.0.1", 0), handler) as web:
            thread = threading.Thread(target=web.serve_forever, daemon=True)
            thread.start()
            base = f"http://127.0.0.1:{web.server_port}/"
            browser = p.chromium.launch(executable_path=os.getenv("CHROMIUM") or shutil.which("chromium"), headless=True)
            context = browser.new_context(viewport={"width": 1280, "height": 900})
            errors, requests = [], []

            def route(r):
                if r.request.url.startswith(base):
                    r.continue_()
                else:
                    requests.append(r.request.url)
                    r.abort()

            context.route("http**/*", route)
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("dialog", lambda dialog: dialog.accept())
            page.set_default_timeout(12000)
            page.goto(base + "pdf-master.html")
            try:
                cases(page, Path(tmp))
                assert not errors, errors
                assert not requests, requests
            finally:
                browser.close()
                web.shutdown()
                thread.join()


if __name__ == "__main__":
    main()
