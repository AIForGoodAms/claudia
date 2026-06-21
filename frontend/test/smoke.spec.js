// Smoke test — run against `python main.py` with stubbed OpenRouter calls.
// Verifies the option grid renders and selecting speaks. Not a unit test; this
// exercises real WS + DOM. Marked manual in CI until a fake-backed fixture exists.
import { test, expect } from "@playwright/test";

test("renders options and selects one", async ({ page }) => {
  await page.goto("http://127.0.0.1:8000/");
  await expect(page.locator("h1")).toHaveText("Kies een antwoord");
});
