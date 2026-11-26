"""Verify combined columns and five-line descriptions in Chromium."""
import functools
import os
import tempfile
import threading
from http.server import ThreadingHTTPServer

from playwright.sync_api import expect, sync_playwright

from remarks_browser import Handler, ROOT, start, write


def run(chromium, origin, profile):
    errors, requests = [], []
    ctx, page = start(chromium, profile, origin, errors, requests)
    long_text = "Восстановить покрытие в коридоре. " * 12 + "Проверить результат."
    five_lines = "\n".join(f"Пункт {i}" for i in range(1, 6))
    six_lines = five_lines + "\nПункт 6"
    adaptive = "Проверить покрытие. " * 6 + "Фото приложить."
    rows = [["Номер", "Статус", "Описание", "Дата", "Срок устранения", "Интеграционный номер"]]
    rows.extend([n, "К устранению", description, "25.11.2026", deadline, integration]
                for n, description, deadline, integration in [
                    (200, long_text, "28.11.2026", "206"),
                    (201, "Короткое замечание", "28.11.2026", ""),
                    (202, five_lines, "", "007"),
                    (203, six_lines, "28.11.2026", ""),
                    (204, adaptive, "28.11.2026", ""),
                ])
    page.evaluate("""async rows => {
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Акты');
        const dir = await testDir();
        const file = await dir.getFileHandle('выгрузка.xlsx', {create:true});
        const writer = await file.createWritable();
        await writer.write(XLSX.write(book, {bookType:'xlsx', type:'array'}));
        await writer.close();
    }""", rows)
    write(page, "интеграционные.json", '{"200":205}')
    page.locator("#pick").click()
    page.locator("#continueMigration").click()

    def row(n):
        return page.locator(f'tr[data-remark="{n}"]')

    expect(page.locator("body")).to_have_attribute("data-version", "2.15")
    headings = page.locator("#open th")
    expect(headings).to_have_count(9)
    assert headings.all_text_contents()[1:6] == ["↓Номер", "Даты", "Описание", "Фото", "Ответственный"]
    expect(row(200).locator(".num")).to_have_text("200(205)")
    expect(row(201).locator(".num")).to_have_text("201")
    expect(row(202).locator(".num")).to_have_text("202(007)")
    assert row(200).locator(".remark-dates").inner_text() == "25.11.2026\n- 28.11.2026"
    assert row(202).locator(".remark-dates").inner_text() == "25.11.2026\n—"
    page.locator("#num").fill("201")
    expect(page.locator("#out")).to_contain_text("Короткое замечание")
    number = row(200).get_by_role("button", name="200(205)", exact=True)
    number.scroll_into_view_if_needed()
    number.focus()
    position = page.evaluate("window.scrollY")
    number.press("Enter")
    detail = page.get_by_role("dialog", name="Замечание №200")
    expect(detail).to_be_visible()
    expect(detail).to_contain_text("Проверить результат.")
    expect(detail).to_contain_text("Ссылка появится после обновления реестра из Exon.")
    expect(page.locator("#num")).to_have_value("201")
    assert page.evaluate("window.scrollY") == position
    page.keyboard.press("Escape")
    expect(detail).to_be_hidden()
    expect(number).to_be_focused()
    expect(page.locator("#out")).to_contain_text("Короткое замечание")
    page.locator("#sortBtn").click()
    expect(page.locator("#open tbody tr").first).to_have_attribute("data-remark", "200")

    for n in [201, 202, 204]:
        expect(row(n).locator(".remark-description-toggle")).to_be_hidden()
    for n in [200, 203]:
        expect(row(n).get_by_role("button", name="Развернуть", exact=True)).to_be_visible()

    description = row(200).locator(".remark-description")
    toggle = row(200).get_by_role("button", name="Развернуть", exact=True)
    collapsed_height = description.evaluate("el => el.getBoundingClientRect().height")
    line_height = description.evaluate("el => parseFloat(getComputedStyle(el).lineHeight)")
    assert abs(collapsed_height - line_height * 5) < 1
    expect(description).to_have_css("-webkit-line-clamp", "5")
    toggle.focus()
    toggle.press("Enter")
    fold = row(200).get_by_role("button", name="Свернуть", exact=True)
    expect(fold).to_have_attribute("aria-expanded", "true")
    expect(description).to_contain_text("Проверить результат.")
    assert description.evaluate("el => el.clientHeight === el.scrollHeight")
    assert description.bounding_box()["height"] > collapsed_height
    expect(row(203).get_by_role("button", name="Развернуть", exact=True)).to_be_visible()
    fold.press("Space")
    expect(toggle).to_have_attribute("aria-expanded", "false")
    assert description.bounding_box()["height"] == collapsed_height

    width = row(200).locator(".desc").bounding_box()["width"]
    page.set_viewport_size({"width": 390, "height": 900})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    expect(row(204).get_by_role("button", name="Развернуть", exact=True)).to_be_visible()
    page.set_viewport_size({"width": 1280, "height": 900})
    expect(row(204).locator(".remark-description-toggle")).to_be_hidden()

    if os.getenv("REMARKS_TABLE_PREVIEW"):
        row(200).scroll_into_view_if_needed()
        page.screenshot(path=os.environ["REMARKS_TABLE_PREVIEW"])

    page.locator('.version-switch a[href="./sborka-v2.11.html"]').click()
    expect(page.locator("body")).to_have_attribute("data-version", "2.11")
    expect(page.locator("#open th")).to_have_count(11)
    old_width = row(200).locator(".desc").bounding_box()["width"]
    assert width > old_width + 100, (width, old_width)
    page.locator('.version-switch a[href="./sborka.html"]').click()
    expect(row(200).locator(".num")).to_have_text("200(205)")
    assert not errors, errors
    assert not requests, requests
    ctx.close()
    print(f"PASS: compact columns, responsive five-line descriptions, keyboard and v2.11 archive ({old_width:.0f} → {width:.0f} px)")


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
