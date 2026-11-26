"""python -B tests/remarks_browser.py

Requires Python Playwright, Chromium and PyMuPDF. Tests real Chromium filesystem
handles in an isolated profile. The OS chooser is replaced with an OPFS handle.
"""
import base64
import functools
import io
import json
import os
import re
import shutil
import tempfile
import threading
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import fitz
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PEOPLE = "ответственные.json"
LINKS = "назначения.json"
NUMBERS = list(range(125, 180))
ORG = "ООО «Север & Юг» <проект> " + "Ж" * 240
NAME = "Ирина 李 🌍"


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def start(chromium, profile, origin, errors, requests):
    ctx = chromium.launch_persistent_context(profile, executable_path=os.getenv("CHROMIUM") or shutil.which("chromium"),
                                             headless=True, viewport={"width": 1280, "height": 900})
    ctx.add_init_script("""
      window.testDir = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("Замечания", {create:true});
      window.showDirectoryPicker = async () => {
        if (window.denyPicker) throw new DOMException("Доступ запрещён.", "NotAllowedError");
        return testDir();
      };
    """)
    def offline(route):
        if route.request.url.startswith(origin):
            route.continue_()
        else:
            requests.append(route.request.url)
            route.abort()
    ctx.route("http**/*", offline)
    page = ctx.pages[0]
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("dialog", lambda dialog: dialog.accept())
    page.set_default_timeout(8000)
    page.goto(origin + "sborka.html")
    return ctx, page


def write(page, name, value):
    page.evaluate("""async ([name, value]) => {
        const handle = await (await testDir()).getFileHandle(name, {create:true});
        const writer = await handle.createWritable();
        await writer.write(value); await writer.close();
    }""", [name, value])


def read(page, name):
    return page.evaluate("""async name =>
      (await (await (await testDir()).getFileHandle(name)).getFile()).text()
    """, name)


def snapshot(page):
    return page.evaluate("""async () => {
        const result = {};
        for await (const [name, handle] of (await testDir()).entries()) {
            const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
            result[name] = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
        }
        return result;
    }""")


def dump(page, numbers, closed=()):
    page.evaluate(r"""async ([numbers, closed]) => {
        const rows = [['Номер','Статус','Описание','Дата','Срок устранения']];
        for (const n of numbers) {
            const text = n === 125 ? Array.from({length:150}, (_, i) => 'Строка ' + i + ' ' + 'проверка '.repeat(9))
                .concat('КОНЕЦ_ОПИСАНИЯ').join('\n') : 'Замечание ' + n;
            rows.push([n, closed.includes(n) ? 'Закрыто' : 'К устранению', text, '01.02.2026', '10.02.2026']);
        }
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Акты');
        const dir = await testDir();
        const handle = await dir.getFileHandle('выгрузка.xlsx', {create:true});
        const writer = await handle.createWritable();
        await writer.write(XLSX.write(workbook,{bookType:'xlsx',type:'array'})); await writer.close();
    }""", [numbers, list(closed)])


def add(page, **fields):
    page.locator("#respAdd").click()
    for key, value in fields.items():
        page.locator(f"#respForm [name={key}]").fill(value)
    page.locator("#respCreate").click()
    expect(page.locator("#respEditor")).to_be_hidden()
    return json.loads(read(page, PEOPLE))["people"][-1]["id"]


def row(page, n):
    return page.locator(f"[data-resp='{n}']")


def choose(page, button, query, index=0):
    button.click()
    page.locator("#respPickerSearch").fill(query)
    page.locator("#respOptions button").nth(index).click()
    expect(page.locator("#respPicker")).to_be_hidden()


def card(page, pid):
    target = page.locator(f"details[data-person='{pid}']")
    if not target.evaluate("element => element.open"):
        target.locator("summary").click()
    return target


def docx(page):
    page.locator("#num").fill("126")
    page.locator("#go").click()
    expect(page.locator("#out")).to_contain_text("Сохранено:")
    data = base64.b64decode(snapshot(page)["Акт об Устранении №ИНТ-126.docx"])
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def export(page, numbers=None):
    button = page.locator("#journalBtn" if numbers is None else "#pdfBtn")
    if numbers:
        page.locator("#num").fill(" ".join(map(str, numbers)))
    expect(button).to_be_enabled()
    with page.expect_download(timeout=60000) as result:
        button.click()
    return fitz.open(result.value.path())


def cases(chromium, origin, profile):
    errors, requests = [], []
    ctx, page = start(chromium, profile, origin, errors, requests)
    dump(page, NUMBERS)
    for name, content in {
        "комментарии.json": {"125": "Комментарий 🔵", "126": {"c1": "Текст", "c2": "Примечание"}},
        "интеграционные.json": {"126": "ИНТ-126"},
        "названия_комментариев.json": {"c1": "Ответ", "c2": "Дополнение"},
        "последовательности_актов.json": {"open": NUMBERS, "closed": [8], "new": [], "meta": "Сохранить"},
    }.items():
        write(page, name, json.dumps(content, ensure_ascii=False, indent=1))
    page.evaluate("""async () => {
        const dir = await testDir(), canvas = document.createElement('canvas');
        canvas.width = 320; canvas.height = 420;
        for (const [slot, color] of [[1,'#778877'], [2,'#be7755']]) {
            const g = canvas.getContext('2d'); g.fillStyle=color; g.fillRect(0,0,320,420);
            const b = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg'));
            const writer = await (await dir.getFileHandle('125_'+slot+'.jpg',{create:true})).createWritable();
            await writer.write(b); await writer.close();
        }
    }""")
    before = snapshot(page)
    page.locator("#pick").click()
    expect(page.locator("#migration")).to_be_visible()
    assert snapshot(page) == before
    with page.expect_download() as downloaded:
        page.locator("#backupFolder").click()
    with zipfile.ZipFile(downloaded.value.path()) as archive:
        assert {key: base64.b64encode(archive.read(key)).decode() for key in archive.namelist()} == before
    page.locator("#continueMigration").click()
    expect(page.locator(".row-sel:visible")).to_have_count(len(NUMBERS))
    migrated = snapshot(page)
    assert set(migrated) == set(before) | {PEOPLE, LINKS}
    assert all(migrated[key] == value for key, value in before.items())
    assert json.loads(read(page, PEOPLE))["people"] == []
    print("PASS  bytewise backup and migration from v2.8", flush=True)

    a = add(page, organization=ORG)
    b = add(page, name=NAME)
    c = add(page, name=NAME)
    assert len({a,b,c}) == 3
    choose(page, row(page,125), "север")
    expect(row(page,125)).to_contain_text("Север")
    page.locator(".row-sel[data-n='126']").check()
    page.locator(".row-sel[data-n='127']").check()
    choose(page, page.locator("#respBulk"), "ирина", index=1)
    expect(row(page,126)).to_contain_text(NAME)
    assert json.loads(read(page, LINKS))["assignments"] == {"125":a, "126":c, "127":c}
    page.locator("#respFilter").select_option(c)
    expect(page.locator(".row-sel:visible")).to_have_count(2)
    page.locator(".row-sel[data-n='127']").uncheck()
    page.locator("#respClear").click()
    expect(page.locator(".row-sel:visible")).to_have_count(1)
    assert json.loads(read(page, LINKS))["assignments"] == {"125":a, "127":c}
    page.locator("#respFilter").select_option("none")
    expect(row(page,126)).to_be_visible()
    page.locator("#respFilter").select_option("")
    page.locator("#respGroup").check()
    page.locator("#respSearch").fill("юг")
    expect(page.locator("#respCards details")).to_have_count(1)
    page.locator("#respSearch").fill("")
    for width in [1280, 390]:
        page.set_viewport_size({"width":width, "height":900})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.set_viewport_size({"width":1280, "height":900})

    card(page,a).get_by_role("button", name="Редактировать").click()
    for key, value in {"name": NAME, "phone": "+7 (000) 123-45-67", "email":"qa@example.invalid", "comment":"НЕ_ПЕЧАТАТЬ"}.items():
        page.locator(f"#respForm [name={key}]").fill(value)
    expect(page.locator("#respEditStatus")).to_have_text("Сохранено.")
    page.keyboard.press("Escape")
    expect(page.locator("#respEditor")).to_be_hidden()
    assert json.loads(read(page, PEOPLE))["people"][0]["comment"] == "НЕ_ПЕЧАТАТЬ"
    card(page,c).get_by_role("button", name="Выше").click()
    expect(page.locator("#respCards details").nth(1)).to_have_attribute("data-person", c)
    card(page,b).get_by_role("button", name="Удалить").click()
    expect(page.locator(f"details[data-person='{b}']")).to_have_count(0)

    tab = ctx.new_page()
    tab.goto(origin + "sborka.html")
    expect(row(tab,125)).to_contain_text("Север")
    for _ in range(2):
        page.evaluate("() => { window.testBatch = Promise.all(Array.from({length:14}, (_, i) => RemarksStore.assign([200+i], RemarksStore.people[0].id))); }")
        # Both tabs update different remark numbers in the same file.
        tab.evaluate("() => Promise.all(Array.from({length:14}, (_, i) => RemarksStore.assign([300+i], RemarksStore.people[1].id)))")
        page.evaluate("() => window.testBatch")
    assert len(json.loads(read(page, LINKS))["assignments"]) == 30
    tab.close()
    page.reload()
    expect(row(page,125)).to_contain_text("Север")
    card(page,a).get_by_role("button", name="Удалить", exact=True).click()
    expect(row(page,125)).to_contain_text("архив")
    assert json.loads(read(page, LINKS))["assignments"]["125"] == a
    card(page,a).get_by_role("button", name="Восстановить").click()
    expect(card(page,a).get_by_role("button", name="В архив")).to_be_visible()
    card(page,a).get_by_role("button", name="В архив").click()
    expect(row(page,125)).to_contain_text("архив")
    print("PASS  searchable assignment, bulk, filter, duplicates, autosave, reorder, archive, locks", flush=True)

    dump(page, NUMBERS, closed=[125])
    page.reload()
    expect(row(page,125)).to_have_count(0)
    assert json.loads(read(page, LINKS))["assignments"]["125"] == a
    dump(page, NUMBERS[1:])
    page.reload()
    expect(page.locator(".row-sel")).to_have_count(54)
    assert json.loads(read(page, LINKS))["assignments"]["125"] == a
    dump(page, NUMBERS)
    ctx.close()
    ctx, page = start(chromium, profile, origin, errors, requests)
    expect(row(page,125)).to_contain_text("архив")
    new_docx = docx(page)
    stable = snapshot(page)
    page.locator('.version-switch a[href="./sborka-v2.8.html"]').click()
    expect(page.locator(".row-sel")).to_have_count(len(NUMBERS))
    assert new_docx == docx(page)
    assert all(snapshot(page)[file] == stable[file] for file in (PEOPLE, LINKS))
    page.locator('.version-switch a[href="./sborka.html"]').click()
    expect(row(page,125)).to_contain_text("архив")
    print("PASS  closed/disappearing remarks, browser restart, versions and DOCX parity", flush=True)

    with export(page,[125]) as single, export(page,[125,126]) as selected, export(page) as journal:
        text = "".join(p.get_text() for p in single)
        for value in [NAME, "+7 (000) 123-45-67", "qa@example.invalid", "КОНЕЦ_ОПИСАНИЯ", "Комментарий 🔵"]:
            assert value in text, value
        assert all("Строка " + str(i) + " проверка" in text for i in range(150))
        assert "НЕ_ПЕЧАТАТЬ" not in text
        assert len(single[0].get_image_info()) >= 2
        assert len(selected) == len(single) + 1 and "Не назначен" in selected[-1].get_text()
        summary = [p for p in journal if p.rect.width > p.rect.height]
        assert len(summary) > 1 and len(journal) == len(summary) + len(single) - 1 + len(NUMBERS)
        cover = "\n".join(p.get_text() for p in summary)
        assert "Ответственный" in cover and "Не назначен" in cover and "qa@example.invalid" not in cover
        assert all(re.search(rf"^\s*{n}\s*$", cover, flags=re.MULTILINE) for n in NUMBERS)
        for p in journal:
            area = fitz.Rect(20, 20, p.rect.width - 20, p.rect.height - 20)
            assert all(area.contains(fitz.Rect(block[:4])) for block in p.get_text("blocks"))
        if os.getenv("REMARKS_PREVIEW"):
            output = Path(os.environ["REMARKS_PREVIEW"])
            output.mkdir(parents=True, exist_ok=True)
            journal.save(output / "journal.pdf")
            summary[0].get_pixmap().save(output / "summary.png")
            single[0].get_pixmap().save(output / "detail.png")
            page.evaluate("window.scrollTo(0, 0)")
            page.screenshot(path=output / "ui.png")
    print("PASS  PDF for 1, 2 and 55 rows, contacts, Unicode, line bounds, photos", flush=True)

    for bad in ["{", '{"schemaVersion":999,"assignments":{}}']:
        write(page, LINKS, bad)
        page.reload()
        expect(page.locator("#folderStatus")).to_contain_text(LINKS)
        assert read(page, LINKS) == bad
    write(page, LINKS, base64.b64decode(stable[LINKS]).decode())
    page.locator("#retryFolder").click()
    expect(row(page,125)).to_contain_text("архив")
    page.evaluate("window.denyPicker = true")
    page.locator("#pick").click()
    expect(page.locator("#folderStatus")).to_contain_text("Доступ запрещён")
    assert not errors, errors
    assert not requests, requests
    ctx.close()
    print("PASS  corrupt/schema recovery, access denied, offline", flush=True)


def main():
    handler = functools.partial(Handler, directory=ROOT)
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as localhost, tempfile.TemporaryDirectory() as profile, sync_playwright() as p:
        thread = threading.Thread(target=localhost.serve_forever, daemon=True)
        thread.start()
        try:
            cases(p.chromium, f"http://127.0.0.1:{localhost.server_port}/", profile)
        finally:
            localhost.shutdown()
            thread.join()


if __name__ == "__main__":
    main()
