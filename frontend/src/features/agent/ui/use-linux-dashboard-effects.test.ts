import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { subscribeLinuxDashboardResume } from "./use-linux-dashboard-effects";

class VisibilityTarget extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
}

const persistedPageShow = (): Event => {
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  return event;
};

describe("linux dashboard resume lifecycle", () => {
  test("pauses when inactive and coalesces visibility and focus resume events", () => {
    const documentTarget = new VisibilityTarget();
    const windowTarget = new EventTarget();
    const events: string[] = [];
    const unsubscribe = subscribeLinuxDashboardResume(documentTarget, windowTarget, {
      onHidden: () => events.push("hidden"),
      onVisible: () => events.push("visible"),
    });

    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    windowTarget.dispatchEvent(new Event("focus"));

    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    windowTarget.dispatchEvent(new Event("focus"));
    windowTarget.dispatchEvent(new Event("pageshow"));
    windowTarget.dispatchEvent(persistedPageShow());
    windowTarget.dispatchEvent(new Event("blur"));
    windowTarget.dispatchEvent(new Event("focus"));

    assert.deepEqual(events, ["hidden", "visible", "visible", "hidden", "visible"]);

    unsubscribe();
    windowTarget.dispatchEvent(new Event("blur"));
    windowTarget.dispatchEvent(new Event("focus"));
    assert.equal(events.length, 5);
  });
});
