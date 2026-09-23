import "./register-tsx.ts";
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import { createElement } from "react";
import { Window } from "happy-dom";
const window = new Window({ url: "http://localhost:3000" });
for (const [key, value] of Object.entries({
  window,
  self: window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
let signInFails = true;
let signInOptions: unknown;
const authMock = mock.module("@/lib/auth-client", {
  exports: {
    authClient: {
      signIn: {
        social: async (options: unknown) => {
          signInOptions = options;
          if (signInFails) throw new Error("private-provider-token");
          return { error: { message: "private-provider-response" } };
        },
      },
      signOut: async () => ({ error: { message: "private-session-data" } }),
    },
  },
});
const { render, screen, fireEvent, waitFor, cleanup } =
  await import("@testing-library/react");
const { GoogleSignInButton } =
  await import("../components/google-sign-in-button.tsx");
const { TelegramLinkPanel } =
  await import("../components/telegram-link-panel.tsx");
const { SignOutButton } = await import("../components/sign-out-button.tsx");
const { default: AuthError } = await import("../app/auth/error/page.tsx");
let linked = false;
let apiFails = false;
const calls: { url: string; method: string }[] = [];
const fetchMock = mock.method(
  globalThis,
  "fetch",
  async (url: string | URL | Request, options?: RequestInit) => {
    calls.push({ url: String(url), method: options?.method ?? "GET" });
    if (apiFails) throw new Error("private-link-token");
    return new Response(
      JSON.stringify(
        options?.method === "POST"
          ? {
              url: "https://t.me/ArmMintBot?start=test-only-link",
              expiresAt: new Date(Date.now() + 600_000).toISOString(),
            }
          : { linked, username: linked ? "alice" : null },
      ),
      { headers: { "content-type": "application/json" } },
    );
  },
);
beforeEach(() => {
  signInFails = true;
  signInOptions = null;
  linked = false;
  apiFails = false;
  calls.length = 0;
});
afterEach(cleanup);
after(() => {
  fetchMock.mock.restore();
  authMock.restore();
  window.happyDOM.abort();
});

test("Google button uses the actual social flow and recovers from transport/provider errors without leaking details", async () => {
  render(createElement(GoogleSignInButton));
  const button = screen.getByRole("button", { name: "Continue with Google" });
  fireEvent.click(button);
  await waitFor(() =>
    assert.equal((button as HTMLButtonElement).disabled, false),
  );
  assert.match(screen.getByRole("alert").textContent!, /Please try again/);
  assert.deepEqual(signInOptions, {
    provider: "google",
    callbackURL: "/",
    errorCallbackURL: "/auth/error",
  });
  signInFails = false;
  fireEvent.click(button);
  await waitFor(() =>
    assert.equal((button as HTMLButtonElement).disabled, false),
  );
  assert.equal(document.body.textContent!.includes("private-"), false);
});

test("signed-in linking UI creates a deep link then displays committed linked status on refresh", async () => {
  render(
    createElement(TelegramLinkPanel, {
      initialStatus: { linked: false, username: null },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Link Telegram" }));
  const deepLink = await screen.findByRole("link", {
    name: "Open Telegram and press Start",
  });
  assert.match(
    deepLink.getAttribute("href")!,
    /^https:\/\/t.me\/ArmMintBot\?start=/,
  );
  assert.equal(deepLink.getAttribute("rel"), "noreferrer");
  linked = true;
  fireEvent.click(
    screen.getByRole("button", { name: "I’ve pressed Start — check link" }),
  );
  await waitFor(() =>
    assert.match(screen.getByRole("status").textContent!, /linked as @alice/),
  );
  assert.equal(screen.queryByRole("button", { name: "Link Telegram" }), null);
  assert.equal(
    screen.queryByRole("link", { name: "Open Telegram and press Start" }),
    null,
  );
  assert.deepEqual(calls, [
    { url: "/api/telegram/link", method: "POST" },
    { url: "/api/telegram/link", method: "GET" },
  ]);
});

test("existing links are displayed without generating credentials and failed requests can be retried", async () => {
  const view = render(
    createElement(TelegramLinkPanel, {
      initialStatus: { linked: true, username: null },
    }),
  );
  assert.match(screen.getByRole("status").textContent!, /Telegram is linked/);
  assert.equal(calls.length, 0);
  view.unmount();
  render(
    createElement(TelegramLinkPanel, {
      initialStatus: { linked: false, username: null },
    }),
  );
  apiFails = true;
  fireEvent.click(screen.getByRole("button", { name: "Link Telegram" }));
  await screen.findByRole("alert");
  assert.equal(
    document.body.textContent!.includes("private-link-token"),
    false,
  );
  apiFails = false;
  fireEvent.click(screen.getByRole("button", { name: "Link Telegram" }));
  await screen.findByRole("link", { name: "Open Telegram and press Start" });
});

test("OAuth recovery page offers a fresh Google attempt and sign-out errors stay generic", async () => {
  const view = render(createElement(AuthError));
  assert.ok(screen.getByRole("heading", { name: "Sign-in wasn’t completed" }));
  assert.ok(screen.getByRole("button", { name: "Continue with Google" }));
  assert.equal(
    screen.getByRole("link", { name: "Back to ArmMint" }).getAttribute("href"),
    "/",
  );
  view.unmount();
  render(createElement(SignOutButton));
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByRole("alert");
  assert.equal(
    document.body.textContent!.includes("private-session-data"),
    false,
  );
});
