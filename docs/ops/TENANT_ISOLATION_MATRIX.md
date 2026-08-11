# Tenant isolation and authorization acceptance matrix

This is the release gate for user, project, report, device-token and MCP isolation. A passing status means the request is rejected with `401` or resource-shaped `404`; it must not leak whether another user's resource exists.

| Boundary | Required assertion | Existing automated coverage |
| --- | --- | --- |
| URL report ID | User A cannot read or answer User B's report/card | `src/mvp0-api.test.ts` |
| URL session ID | User A cannot read, continue or end User B's MVP-1 session | `src/mvp1-api.test.ts` |
| Project ID | User A cannot open, search, mutate or delete User B's project | `src/project-ownership-api.test.ts`, `src/project-memory-store.test.ts` |
| Project transfer | Removing a member immediately removes project-scoped access | required before team sharing is enabled |
| Hook/MCP token | Token is bound to one project; another project is rejected | `src/project-hook-token-api.test.ts`, `src/remote-mcp.test.ts`, `src/mindiou-agent-context.test.ts` |
| MCP session reuse | A session initialized by Token A cannot be reused with Token B | `src/remote-mcp.test.ts` |
| Device token | User B's device token cannot read User A's report or invoke a user-scoped channel | `src/device-token-api.test.ts`, `src/mvp1-api.test.ts` |
| Revocation | Revoked device/Hook token cannot access an existing session | token API and remote MCP tests |
| Export | Export must use the authenticated owner, never a URL-supplied owner ID | export endpoint must be added before enabling data export |
| Delete | Delete must use the authenticated owner and remove sessions, reports, projects and tokens | deletion endpoint must be added before enabling account deletion |
| Admin | Admin views default to aggregates and redacted metadata; raw content requires explicit audited break-glass access | admin route review required |

## Release rule

Any new route that accepts an ID must add a cross-user test before merge. The route must resolve the resource through an owner-aware store method; a plain `get(id)` followed by an owner check is not sufficient if the response or error differs for another tenant.

## Automated entry point

```bash
npm run test:security
```

This command runs the report, session, project, transfer, Hook/MCP, device-token and revocation scenarios together. Any new URL ID, project ID, report ID, session ID, export or delete route must add at least one A/B tenant cross-user test here before release.
