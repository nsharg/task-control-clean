import { describe, expect, test } from "vitest";
import { textDir } from "../lib/dir";

describe("textDir", () => {
  test("mostly Hebrew reads right to left", () => {
    expect(textDir("הכפתור לא עובד בדף ההתחברות")).toBe("rtl");
    // Digits, punctuation and markdown don't count toward the ratio.
    expect(textDir("**באג** #12 — 404 בדף הבית")).toBe("rtl");
    expect(textDir("הכפתור לא עובד בדף ההתחברות ב-Safari")).toBe("rtl");
    // 13 Hebrew letters of 19 is 68%, just under the line.
    expect(textDir("הכפתור לא עובד ב-Safari")).toBe("ltr");
  });

  test("below 70% Hebrew stays left to right", () => {
    expect(textDir("Login button broken")).toBe("ltr");
    expect(textDir("Login button broken בדף")).toBe("ltr");
    expect(textDir("")).toBe("ltr");
    expect(textDir("12345 !!!")).toBe("ltr");
  });
});
