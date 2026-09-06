# Client Site Agent Notes

This is the deployable website repo for a client. It should use the central IQAN agency harness, not a copied local harness.

## Harness

- If this repo is inside `web-clients/`, read `../../../AGENTS.md` first, then `../../../agency-workflows/AGENTS.md`.
- Start client work from the relevant workflow in `../../../agency-workflows/workflows/`.
- Use deterministic tools from `../../../agency-workflows/tools/` before improvising manual steps.
- Do not recreate `workflows/`, `tools/`, `skills/`, `HARNESS.md`, or `CONSTRAINTS.md` inside this site repo unless the user explicitly asks.

## Client State

- Read `../notes.md` and `../design/brief.md` before implementation.
- For new or substantially redesigned brand work, confirm `direction_approved` before
  high-fidelity implementation and `representative_surface_approved` before full-site rollout.
- Use `../PROGRESS.md`, `../DECISIONS.md`, a feature list, or a run summary when work needs durable state.
- Record external links, verification results, open blockers, and next actions in client state files.

## Guardrails

- Do not invent business facts such as hours, phone numbers, menu items, prices, locations, legal claims, certifications, reviews, or availability.
- Do not commit secrets, `.env` files, OAuth tokens, raw client source media, or generated temporary output.
- Verify changes with the site's local checks and any workflow-specific feedback before declaring work complete.
- Keep structural completion, technical verification, visual review, client approval, and launch readiness separate. A build or route 200 is not visual approval.
- For launch-candidate UI, require current-source evidence at 1440x900 desktop and a true 390x844 mobile viewport using the central visual-evidence validator.
