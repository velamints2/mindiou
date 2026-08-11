import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetSessionId,
  isPublicRoute,
  navigate,
  parseRoute,
  recallDraftId,
  recallReportId,
  recallSessionId,
  rememberDraftId,
  rememberReportId,
  rememberSessionId
} from "./router";

describe("parseRoute", () => {
  it("returns landing for empty hash", () => {
    expect(parseRoute().name).toBe("landing");
  });

  it("parses public routes", () => {
    location.hash = "#/how-it-works";
    expect(parseRoute().name).toBe("how-it-works");
  });

  it("parses the genesis archive", () => {
    location.hash = "#/genesis";
    expect(parseRoute()).toEqual({ name: "genesis" });
  });

  it("parses the public assessment", () => {
    location.hash = "#/assessment";
    expect(parseRoute()).toEqual({ name: "assessment" });
  });

  it("parses login route", () => {
    location.hash = "#/login";
    expect(parseRoute().name).toBe("login");
  });

  it("parses app route", () => {
    location.hash = "#/app";
    expect(parseRoute().name).toBe("app");
  });

  it("parses the user profile route", () => {
    location.hash = "#/profile";
    expect(parseRoute()).toEqual({ name: "profile" });
  });

  it("parses timeline with draftId", () => {
    location.hash = "#/timeline/draft-123";
    const route = parseRoute();
    expect(route.name).toBe("timeline");
    if (route.name === "timeline") expect(route.draftId).toBe("draft-123");
  });

  it("parses report with reportId", () => {
    location.hash = "#/report/rpt-456";
    const route = parseRoute();
    expect(route.name).toBe("report");
    if (route.name === "report") expect(route.reportId).toBe("rpt-456");
  });

  it("parses session with sessionId", () => {
    location.hash = "#/session/ses-789";
    const route = parseRoute();
    expect(route.name).toBe("session");
    if (route.name === "session") expect(route.sessionId).toBe("ses-789");
  });

  it("keeps project-memory agent session links on the agent session page", () => {
    location.hash = "#/agent-sessions/pm-session-1";
    expect(parseRoute()).toEqual({ name: "agent-session", sessionId: "pm-session-1" });
  });

  it("returns not-found for missing params", () => {
    location.hash = "#/timeline";
    expect(parseRoute().name).toBe("not-found");
  });

  it("returns not-found for unknown path", () => {
    location.hash = "#/unknown";
    expect(parseRoute().name).toBe("not-found");
  });

  it("decodes URI-encoded params", () => {
    location.hash = "#/report/rpt%20with%20space";
    const route = parseRoute();
    if (route.name === "report") expect(route.reportId).toBe("rpt with space");
  });
});

describe("isPublicRoute", () => {
  it("landing and how-it-works are public", () => {
    expect(isPublicRoute({ name: "landing" })).toBe(true);
    expect(isPublicRoute({ name: "how-it-works" })).toBe(true);
    expect(isPublicRoute({ name: "genesis" })).toBe(true);
    expect(isPublicRoute({ name: "assessment" })).toBe(true);
  });

  it("product routes are not public", () => {
    expect(isPublicRoute({ name: "app" })).toBe(false);
    expect(isPublicRoute({ name: "login" })).toBe(false);
    expect(isPublicRoute({ name: "timeline", draftId: "d" })).toBe(false);
    expect(isPublicRoute({ name: "report", reportId: "r" })).toBe(false);
    expect(isPublicRoute({ name: "session", sessionId: "s" })).toBe(false);
  });

  it("admin is not public", () => {
    expect(isPublicRoute({ name: "admin" })).toBe(false);
  });
});

describe("navigate", () => {
  it("sets hash for landing", () => {
    navigate({ name: "landing" });
    expect(location.hash).toBe("");
  });

  it("sets hash for app", () => {
    navigate({ name: "app" });
    expect(location.hash).toBe("#/app");
  });

  it("sets hash for the user profile", () => {
    navigate({ name: "profile" });
    expect(location.hash).toBe("#/profile");
  });

  it("sets hash for genesis", () => {
    navigate({ name: "genesis" });
    expect(location.hash).toBe("#/genesis");
  });

  it("sets hash for assessment", () => {
    navigate({ name: "assessment" });
    expect(location.hash).toBe("#/assessment");
  });

  it("sets hash with encoded param", () => {
    navigate({ name: "report", reportId: "rpt/123" });
    expect(location.hash).toBe("#/report/rpt%2F123");
  });

  it("sets hash for session", () => {
    navigate({ name: "session", sessionId: "s-1" });
    expect(location.hash).toBe("#/session/s-1");
  });
});

// sessionStorage 持久化：刷新可恢复的 reportId / draftId / sessionId
describe("session persistence", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("remembers and recalls report id", () => {
    rememberReportId("rpt-persist-1");
    expect(recallReportId()).toBe("rpt-persist-1");
  });

  it("remembers and recalls draft id", () => {
    rememberDraftId("draft-persist-1");
    expect(recallDraftId()).toBe("draft-persist-1");
  });

  it("remembers and recalls session id", () => {
    rememberSessionId("ses-persist-1");
    expect(recallSessionId()).toBe("ses-persist-1");
  });

  it("forgets session id after rememberSessionId", () => {
    rememberSessionId("ses-persist-2");
    expect(recallSessionId()).toBe("ses-persist-2");
    forgetSessionId();
    expect(recallSessionId()).toBeNull();
  });

  it("returns null when nothing has been set", () => {
    expect(recallReportId()).toBeNull();
    expect(recallDraftId()).toBeNull();
    expect(recallSessionId()).toBeNull();
  });
});
