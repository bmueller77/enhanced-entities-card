# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.9.3.0]

### Added
- Per‑entry `hide_state: true` to hide the value text (e.g. for pure toggle switches).
- Per‑entry `icon_position: right` to place the icon at the far right; the icon gap
  moves to the icon side.

## [0.9.2.0]

### Added
- Per‑entry `action`: `more-info` (default), `toggle`, or `none` (read‑only).

### Changed
- State maps now also match `on`/`off`, `1`/`0` and `yes`/`no` (case‑insensitive), so
  `true`/`false` maps work directly with switches (previously they fell back to a
  “?” icon).

## [0.9.1.0]

### Added
- Markdown rows resolve `{iobroker.object.id}` templates **live**, using the same
  render‑template subscription the stock markdown card uses.
- Links `[text](url)` and images `![alt](url)` in markdown rows.

## [0.9.0.0] — initial public pre‑release

First English, GitHub‑ready baseline. Consolidates the earlier internal development
iterations into a clean release (full English header, code comments and editor UI).

### Features
- Static per‑entry `icon_color`.
- State‑dependent `icon` / `icon_color` via true/false maps or numeric threshold
  lists (the highest threshold ≤ value wins).
- `color_gradient` — linear RGB interpolation of the icon color between adjacent
  numeric thresholds.
- Inline value display when `name` is omitted or blank.
- `type: divider` rows (1px line, fixed 5px side gap).
- `type: markdown` rows with optional `align` (left / center / right), fixed 10px
  side gap, rendered via `ha-markdown`.
- Global appearance options: `font_size`, `row_gap`, `padding_top/bottom/left/right`,
  `icon_size`, `icon_gap`.
- Visual GUI editor with entity search (`ha-entity-picker`), icon search
  (`ha-icon-picker`), color pickers and per‑row move/delete controls.

---

Versions before `0.9.0.0` were internal development iterations and are not published.
