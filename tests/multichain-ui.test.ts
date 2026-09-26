import "./register-tsx.ts";
import assert from "node:assert/strict";
import { after, afterEach, mock, test } from "node:test";
import { createElement } from "react";
import { Window } from "happy-dom";
const window = new Window({ url: "http://localhost:3000" });
for (const [key, value] of Object.entries({ window, self: window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, Node: window.Node, Event: window.Event, MouseEvent: window.MouseEvent, FormData: window.FormData, IS_REACT_ACT_ENVIRONMENT: true }))
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
const { render, screen, fireEvent, waitFor, cleanup } = await import("@testing-library/react");
const { MintJobForm } = await import("../components/mint-job-form.tsx");
afterEach(cleanup);
after(() => window.happyDOM.abort());

for (const [chainId, symbol, label] of [[5042002, "USDC", "Arc Testnet"], [763373, "ETH", "Ink Sepolia"]] as const) {
  test(`web review submits explicit ${label} network and retries idempotently`, async () => {
    const calls: Record<string, unknown>[] = [];
    const fetchMock = mock.method(globalThis, "fetch", async (_url: string | URL | Request, options?: RequestInit) => {
      calls.push(JSON.parse(String(options?.body)));
      if (calls.length === 1) throw new Error("private-provider-data");
      return Response.json({ id: "11111111-1111-4111-8111-111111111111", chainId, state: "SCHEDULED" }, { status: 201 });
    });
    try {
      render(createElement(MintJobForm));
      assert.equal(screen.queryByRole("option", { name: /Base/ }), null);
      fireEvent.change(screen.getByLabelText("Network"), { target: { value: String(chainId) } });
      fireEvent.change(screen.getByLabelText("Contract address"), { target: { value: `0x${"22".repeat(20)}` } });
      fireEvent.change(screen.getByLabelText("Encoded mint calldata"), { target: { value: "0x12345678" } });
      fireEvent.change(screen.getByLabelText(`Total mint value (${symbol}), excluding gas`), { target: { value: "0.25" } });
      fireEvent.submit(screen.getByRole("button", { name: "Review mint" }).closest("form")!);
      assert.ok(screen.getByText(`Network: ${label}`));
      assert.ok(screen.getByText(`Total: 0.25 ${symbol} + gas`));
      assert.equal(calls.length, 0);
      fireEvent.click(screen.getByRole("button", { name: "Confirm mint" }));
      await waitFor(() => assert.match(screen.getByRole("alert").textContent!, /Retry uses the same/));
      assert.ok(!window.document.body.textContent.includes("private-provider-data"));
      fireEvent.click(screen.getByRole("button", { name: "Confirm mint" }));
      await waitFor(() => assert.ok(screen.getByRole("status")));
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[0], calls[1]);
      assert.equal(calls[0].chainId, chainId);
      assert.equal(calls[0].valueWei, "250000000000000000");
      assert.equal(screen.getByRole("link", { name: "View job and status" }).getAttribute("href"), "/dashboard/jobs/11111111-1111-4111-8111-111111111111");
    } finally { fetchMock.mock.restore(); }
  });
}
