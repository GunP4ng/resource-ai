"""Run with `python3 tests/report-print-chromium.py` from the repo root.

Requires an existing Bun, Python Playwright, Chromium and PyMuPDF setup.
RESOURCE_QA_CHROMIUM can point at an alternate local Chromium executable.
RESOURCE_QA_EVIDENCE_DIR saves each named PDF and its rendered page PNGs.
The standalone test runs outside Bun CI and uses a temporary local account.
"""

from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import secrets
import selectors
import socket
import subprocess
import tempfile
import unittest
from urllib.request import ProxyHandler, build_opener

import fitz
from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[1]
USAGE = "사용량은 청구·비용 증빙이 아닙니다. 사진 실행 여부는 설정이나 실행 식별자로 확인할 수 없습니다."
DESCRIPTION = "QA 로그인 연구 PET 사출 부산물"
MINIMUM_LAST_PAGE_BODY = 80


@contextmanager
def local_operator():
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(("RESOURCE_", "AZURE_OPENAI_"))}
    password = secrets.token_urlsafe(32)
    with tempfile.TemporaryDirectory(prefix="resource-print-") as state:
        subprocess.run(
            ["bun", "scripts/o-account.ts", "create", "--state-dir", state,
             "--username", "print-qa", "--stdin-secret"],
            cwd=REPO, env=env, input=password + "\n", text=True, check=True, capture_output=True,
        )
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        origin = f"http://localhost:{port}"
        env.update(PORT=str(port), RESOURCE_MODEL_RUNNER="subscription", RESOURCE_APP_AUTH="local-operator",
                   RESOURCE_STATE_DIR=state, RESOURCE_PRIVATE_PHOTOS="off")
        process = subprocess.Popen(["bun", "tests/synthetic-app.ts"], cwd=REPO, env=env,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                if not selector.select(timeout=10):
                    raise RuntimeError("Test app startup timed out")
            ready = process.stdout.readline()
            if process.poll() is not None or origin not in ready:
                raise RuntimeError(f"Test app failed to start: {ready.strip()}")
            print(ready, end="", flush=True)
            http = build_opener(ProxyHandler({}))
            with http.open(origin + "/health", timeout=0.5) as response:
                if response.status != 200:
                    raise RuntimeError(f"Test app health returned {response.status}")
            yield origin, password
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            process.stdout.close()


def normalized(text):
    return " ".join(text.split())


class ChromiumPrintTest(unittest.TestCase):
    def pdf_pages(self, page, check_marker_bounds=False, artifact=None):
        data = page.pdf(prefer_css_page_size=True)
        evidence = os.environ.get("RESOURCE_QA_EVIDENCE_DIR")
        if evidence and artifact:
            directory = Path(evidence)
            directory.mkdir(parents=True, exist_ok=True)
            (directory / f"{artifact}.pdf").write_bytes(data)
        with fitz.open(stream=data, filetype="pdf") as document:
            texts = []
            for number, sheet in enumerate(document, start=1):
                self.assertAlmostEqual(sheet.rect.width, 595.28, delta=2)
                self.assertAlmostEqual(sheet.rect.height, 841.89, delta=2)
                texts.append(normalized(sheet.get_text()))
                if evidence and artifact:
                    sheet.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False).save(
                        str(Path(evidence) / f"{artifact}-page-{number}.png"))
                if check_marker_bounds:
                    margin = 18 * 72 / 25.4
                    for x0, y0, x1, y1, text, *_ in sheet.get_text("blocks"):
                        if "PRINT-MARKER-" in text or "Synthetic wrapping paragraph text." in text:
                            self.assertGreaterEqual(min(x0, y0), margin - 2)
                            self.assertLessEqual(x1, sheet.rect.width - margin + 2)
                            self.assertLessEqual(y1, sheet.rect.height - margin + 2)
            self.assertTrue(texts and all(texts), "PDF contains an empty page")
            return texts

    def submit(self, page, origin, description, polymer="PET", mass="100"):
        response = page.request.post(origin + "/cases", headers={"Origin": origin}, max_redirects=0,
                                     form=dict(description=description, process="사출", polymer=polymer,
                                               contamination="없음", hazardousContact="no", massKg=mass,
                                               region="울산", assessmentDate="2026-11-25"))
        self.assertEqual(response.status, 303)
        path = response.headers["location"]
        self.assertRegex(path, r"^/cases/[^/?#]+$")
        return origin + path

    def assert_report_ending(self, pages, footer):
        self.assertEqual(" ".join(pages).count(footer), 1)
        self.assertEqual(" ".join(pages).count(USAGE), 1)
        self.assertTrue(pages[-1].endswith(f"{USAGE} {footer}"),
                        f"Page {len(pages)} ends with {pages[-1][-200:]!r}")

    def assert_substantive_last_page(self, pages, footer, label):
        self.assert_report_ending(pages, footer)
        ending = f"{USAGE} {footer}"
        body = pages[-1][:-len(ending)].strip()
        amount = len(body)
        print(f"{label}: pages={len(pages)} last_page_body={amount}", flush=True)
        evidence = os.environ.get("RESOURCE_QA_EVIDENCE_DIR")
        if evidence:
            (Path(evidence) / f"{label}.json").write_text(json.dumps({
                "pages": len(pages), "lastPageBody": amount,
                "lastPageText": pages[-1],
            }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        self.assertGreaterEqual(amount, MINIMUM_LAST_PAGE_BODY,
                                f"{label} page {len(pages)} has only {amount} body characters before the notice/footer")

    def check_report(self, page, url):
        self.assertEqual(page.goto(url + "/report").status, 200)
        default_pages = self.pdf_pages(page, artifact="authenticated-pet")
        page.emulate_media(media="print")
        print_style = page.locator("#advanced").evaluate(
            "node => ({inside: getComputedStyle(node).breakInside, after: getComputedStyle(node).breakAfter})")
        page.emulate_media(media=None)
        print(f"Report print CSS: {print_style}", flush=True)
        self.assertEqual(page.locator("[data-stage-method], #hypothetical-summary, "
                                      "[data-public-scenario-result], [data-research-result], "
                                      "[data-directory-row], [data-recycling-directory-row]").count(), 0)
        footer = page.locator("main footer")
        self.assertEqual(footer.count(), 1)
        footer_text = normalized(footer.inner_text())
        disclosure = page.locator("#advanced")
        usage = disclosure.get_by_text(USAGE, exact=True)
        details = page.locator("main details")
        states = details.evaluate_all("elements => elements.map(el => el.open)")
        self.assertFalse(disclosure.evaluate("el => el.open"))
        self.assertFalse(usage.is_visible())

        self.assert_substantive_last_page(default_pages, footer_text, "authenticated-pet")
        default_text = " ".join(default_pages)
        # Vary the last block's position around the observed page boundary (688–704 px).
        # The separate oversized-content case below verifies printable text fragmentation.
        for pixels in range(624, 801, 8):
            with self.subTest(margin_px=pixels):
                style = page.add_style_tag(content=f"@media print{{#advanced{{margin-top:{pixels}px}}}}")
                try:
                    pages = self.pdf_pages(page)
                finally:
                    style.evaluate("style => style.remove()")
                self.assertEqual(details.evaluate_all("elements => elements.map(el => el.open)"), states)
                self.assertEqual(" ".join(pages), default_text)
                self.assert_report_ending(pages, footer_text)

        self.assertTrue(footer.is_visible())
        disclosure.locator("summary").press("Enter")
        self.assertTrue(usage.is_visible())
        disclosure.locator("summary").press("Enter")
        self.assertFalse(usage.is_visible())
        page.locator("#result-context > summary").press("Enter")
        opened_states = details.evaluate_all("elements => elements.map(el => el.open)")
        self.assertNotEqual(opened_states, states)
        self.assertEqual(" ".join(self.pdf_pages(page)), default_text)
        self.assertEqual(details.evaluate_all("elements => elements.map(el => el.open)"), opened_states)
        page.locator("#result-context > summary").press("Enter")

        markers = [f"PRINT-MARKER-{index:03d}" for index in range(65)]
        paragraphs = [f"{marker} " + "Synthetic wrapping paragraph text. " * 12 for marker in markers]
        usage.evaluate("""(last, paragraphs) => {
          for (const text of paragraphs) {
            const p = document.createElement('p');
            p.textContent = text.trim();
            last.before(p);
          }
        }""", paragraphs)
        pages = self.pdf_pages(page, check_marker_bounds=True)
        self.assertGreaterEqual(sum("PRINT-MARKER-" in text for text in pages), 3)
        self.assert_report_ending(pages, footer_text)
        text = " ".join(pages)
        self.assertEqual(re.findall(r"PRINT-MARKER-\d{3}", text), markers)
        for paragraph in paragraphs:
            self.assertEqual(text.count(paragraph.strip()), 1, paragraph.split()[0])
            text = text.replace(paragraph, "", 1)
        self.assertEqual(text, default_text)
        self.assertEqual(details.evaluate_all("elements => elements.map(el => el.open)"), states)
        return footer_text

    def check_material_report(self, page, url, label):
        self.assertEqual(page.goto(url + "/report").status, 200)
        footer = normalized(page.locator("main footer").inner_text())
        pages = self.pdf_pages(page, artifact=label)
        self.assert_substantive_last_page(pages, footer, label)

    def check_inquiry(self, page, url, footer, description=None):
        self.assertEqual(page.goto(url + "/inquiry").status, 200)
        questions = page.locator("[data-inquiry-question]").all_text_contents()
        self.assertEqual(len(questions), 4)
        pages = self.pdf_pages(page)
        # Inquiry allows line breaks within Korean words.
        first = "".join(pages[0].split())
        for content in [page.locator("[data-inquiry-status]").inner_text(), *questions,
                        *page.locator("[data-inquiry-reply] p").all_text_contents()]:
            self.assertIn("".join(content.split()), first)
        text = "".join(" ".join(pages).split())
        self.assertNotIn("".join(footer.split()), text)
        self.assertNotIn("문의서인쇄", text)
        if description is None:
            self.assertEqual(len(pages), 1)
        else:
            appendix = "별지·신고내용전문"
            self.assertNotIn(appendix, first)
            self.assertIn(appendix, "".join(pages[1].split()))
            self.assertIn("".join(description.split()), "".join(" ".join(pages[1:]).split()))

    def test_authenticated_pet_a4(self):
        with sync_playwright() as pw, pw.chromium.launch(
            executable_path=os.environ.get("RESOURCE_QA_CHROMIUM"), args=["--no-proxy-server"],
        ) as browser, local_operator() as (origin, password):
            print(f"Chromium {browser.version}", flush=True)
            with browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme="light",
                                     service_workers="block") as context:
                context.route("**/*", lambda route: route.continue_()
                              if route.request.url.startswith(origin + "/") else route.abort())
                page = context.new_page()
                page.goto(origin + "/login")
                page.locator('[name="username"]').fill("print-qa")
                page.locator('[name="password"]').fill(password)
                page.get_by_role("button", name="로그인").press("Enter")
                page.wait_for_url(origin + "/cases")
                page.goto(origin + "/")
                url = self.submit(page, origin, DESCRIPTION)
                footer = self.check_report(page, url)
                for label, polymer, mass in [
                    ("authenticated-hdpe", "HDPE", "100"),
                    ("authenticated-pp", "PP", "100"),
                    ("authenticated-default", "", ""),
                ]:
                    material_url = self.submit(page, origin, f"QA 로그인 {label} 사출 부산물", polymer, mass)
                    self.check_material_report(page, material_url, label)
                self.check_inquiry(page, url, footer)
                description = " ".join(f"synthetic-appendix-{index:02d}" for index in range(30))
                self.check_inquiry(page, self.submit(page, origin, description), footer, description)


if __name__ == "__main__":
    unittest.main()
