## Summary

- [ ] Purpose of change is clear.
- [ ] Tests cover critical paths (unit and/or integration).
- [ ] OpenAPI updated if routes changed.

## Security Checklist

- [ ] No secrets or credentials included.
- [ ] Input validation with Zod for any new endpoints.
- [ ] AuthZ enforced (RBAC/ownership) where applicable.
- [ ] Rate limit/lockout considered for sensitive flows.
- [ ] No excessive data exposure; DTOs minimal.
- [ ] Docs updated (README/security/diagrams) if affected.
