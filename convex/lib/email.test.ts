import { afterEach, describe, expect, test, vi } from "vitest";
import { parseSender, sendEmail } from "./email";

const email = { to: "client@example.com", subject: "Code", text: "123456", html: "<p>123456</p>" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("parseSender", () => {
  test("name and address", () => {
    expect(parseSender("Acervus Finance <me@gmail.com>")).toEqual({ name: "Acervus Finance", email: "me@gmail.com" });
    expect(parseSender('"Acervus" <me@gmail.com>')).toEqual({ name: "Acervus", email: "me@gmail.com" });
  });
  test("name without angle brackets", () => {
    expect(parseSender("Acervus Finance me@gmail.com")).toEqual({ name: "Acervus Finance", email: "me@gmail.com" });
  });
  test("bare address", () => {
    expect(parseSender(" me@gmail.com ")).toEqual({ email: "me@gmail.com" });
  });
});

describe("sendEmail", () => {
  test("uses Brevo when its key is set", async () => {
    vi.stubEnv("BREVO_API_KEY", "brevo-test");
    vi.stubEnv("RESEND_API_KEY", "resend-test");
    vi.stubEnv("EMAIL_FROM", "Acervus Finance <me@gmail.com>");
    const fetch = vi.fn(async () => new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await sendEmail(email);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("brevo-test");
    expect(JSON.parse(init.body as string)).toMatchObject({
      sender: { name: "Acervus Finance", email: "me@gmail.com" },
      to: [{ email: "client@example.com" }],
      textContent: "123456",
    });
  });

  test("uses Resend without a Brevo key", async () => {
    vi.stubEnv("BREVO_API_KEY", "");
    vi.stubEnv("RESEND_API_KEY", "resend-test");
    vi.stubEnv("EMAIL_FROM", "Acervus <me@acervus.com>");
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await sendEmail(email);
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe("https://api.resend.com/emails");
  });

  test("a refused message is an error", async () => {
    vi.stubEnv("BREVO_API_KEY", "brevo-test");
    vi.stubEnv("EMAIL_FROM", "me@gmail.com");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendEmail(email)).rejects.toThrow("could not be sent");
  });
});
