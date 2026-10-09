import assert from "node:assert/strict";
import { test } from "node:test";

import { parseScheduleText } from "./telegram-interface.ts";

// Friday 2026-10-09T10:00:00Z.
const now = new Date("2026-10-09T10:00:00.000Z");

test("relative durations resolve against now", () => {
  assert.equal(parseScheduleText("in 5 hours", now), "2026-10-09T15:00:00.000Z");
  assert.equal(parseScheduleText("in 20 minutes", now), "2026-10-09T10:20:00.000Z");
  assert.equal(parseScheduleText("in 2 days", now), "2026-10-11T10:00:00.000Z");
  assert.equal(parseScheduleText("in 400 days", now), null);
});

test("bare clock times take the next UTC occurrence", () => {
  assert.equal(parseScheduleText("14:30", now), "2026-10-09T14:30:00.000Z");
  assert.equal(parseScheduleText("09:00", now), "2026-10-10T09:00:00.000Z");
  assert.equal(parseScheduleText("2:30pm", now), "2026-10-09T14:30:00.000Z");
  assert.equal(parseScheduleText("2:30am", now), "2026-10-10T02:30:00.000Z");
  assert.equal(parseScheduleText("14:30pm", now), "2026-10-09T14:30:00.000Z");
  assert.equal(parseScheduleText("25:00", now), null);
});

test("tomorrow resolves with or without a time", () => {
  assert.equal(parseScheduleText("tomorrow", now), "2026-10-10T10:00:00.000Z");
  assert.equal(parseScheduleText("tomorrow 14:30", now), "2026-10-10T14:30:00.000Z");
  assert.equal(parseScheduleText("tomorrow at 9am", now), "2026-10-10T09:00:00.000Z");
});

test("weekdays resolve to the nearest future match", () => {
  assert.equal(parseScheduleText("Monday", now), "2026-10-12T10:00:00.000Z");
  assert.equal(parseScheduleText("Friday", now), "2026-10-16T10:00:00.000Z");
  assert.equal(parseScheduleText("next Friday", now), "2026-10-16T10:00:00.000Z");
  assert.equal(parseScheduleText("Friday 14:30", now), "2026-10-09T14:30:00.000Z");
  assert.equal(parseScheduleText("Friday 09:00", now), "2026-10-16T09:00:00.000Z");
});

test("month days skip missing dates and roll forward", () => {
  assert.equal(parseScheduleText("18th", now), "2026-10-18T00:00:00.000Z");
  assert.equal(parseScheduleText("on the 18th 14:30", now), "2026-10-18T14:30:00.000Z");
  assert.equal(parseScheduleText("9th", now), "2026-11-09T00:00:00.000Z");
  assert.equal(
    parseScheduleText("30th", new Date("2026-02-01T10:00:00.000Z")),
    "2026-03-30T00:00:00.000Z",
  );
  assert.equal(parseScheduleText("32nd", now), null);
});

test("nonsense stays invalid", () => {
  for (const text of ["yesterday", "someday", "13:pm", "Friday 25:00", ""])
    assert.equal(parseScheduleText(text, now), null);
});
