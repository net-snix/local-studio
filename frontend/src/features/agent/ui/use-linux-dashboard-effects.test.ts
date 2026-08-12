import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { subscribeLinuxDashboardActivity } from "./use-linux-dashboard-effects";

class VisibilityTarget extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
}

const persistedPageShow = (): Event => {
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  return event;
};

describe("linux dashboard activity lifecycle", () => {
  test("keeps background collection active and checks recovery on return", () => {
    const documentTarget = new VisibilityTarget();
    const windowTarget = new EventTarget();
    const events: string[] = [];
    const unsubscribe = subscribeLinuxDashboardActivity(documentTarget, windowTarget, () =>
      events.push("active"),
    );

    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    windowTarget.dispatchEvent(new Event("blur"));
    windowTarget.dispatchEvent(new Event("focus"));

    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    windowTarget.dispatchEvent(new Event("focus"));
    windowTarget.dispatchEvent(new Event("pageshow"));
    windowTarget.dispatchEvent(persistedPageShow());
    assert.deepEqual(events, ["active", "active", "active", "active"]);

    unsubscribe();
    windowTarget.dispatchEvent(new Event("focus"));
    assert.equal(events.length, 4);
  });
});
