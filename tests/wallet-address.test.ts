import "./register-tsx.ts";
import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { createElement } from "react";
import { Window } from "happy-dom";
const window = new Window({ url: "http://localhost:3000" });
for (const [key, value] of Object.entries({ window, self: window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, Node: window.Node, Event: window.Event, MouseEvent: window.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true }))
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
const { render, screen, fireEvent, cleanup } = await import("@testing-library/react");
const { WalletAddress } = await import("../components/wallet-address.tsx");
afterEach(cleanup);
after(() => window.happyDOM.abort());

const ADDRESS = `0x${"12".repeat(20)}`;

test("wallet address truncates middle by default and reveals on toggle", () => {
  render(createElement(WalletAddress, { address: ADDRESS }));
  assert.ok(!window.document.body.textContent.includes(ADDRESS));
  assert.ok(screen.getByText(`${ADDRESS.slice(0, 12)}…${ADDRESS.slice(-8)}`));
  fireEvent.click(screen.getByRole("button", { name: "Show full address" }));
  assert.ok(screen.getByText(ADDRESS));
  assert.equal(screen.getByRole("button").getAttribute("aria-pressed"), "true");
  fireEvent.click(screen.getByRole("button", { name: "Hide full address" }));
  assert.ok(!window.document.body.textContent.includes(ADDRESS));
});
