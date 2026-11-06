# MEKONIQ brand 1.0.0

Canonical inputs are all files in this directory except release.json. Original artwork was copied unchanged from the approved Lab spec; assets-manifest.json preserves supplied hashes. PNG wordmarks are preferred because SVG text depends on external system fonts. Fonts are copied unchanged from trial/data/public/fonts (Be Vietnam Pro 400/700 Latin and Vietnamese; JetBrains Mono 500). fonts/OFL.txt contains both copyright notices and the SIL OFL license. Japanese uses system fallback.

Load fonts.css, tokens.css, components.css in that order. Apply mq-theme to the app root and set color-scheme:dark before first paint. Components are scoped; apps own accessible semantics, dialog focus and disabled/loading action guards. gallery.html is an internal review fixture, not a product route.

Run node scripts/build-brand.mjs before committing canonical changes. Alias validation rejects cycles/unknown names; generated declarations sort keys. Commit canonical inputs before exporting. Export refuses dirty canonical inputs and records the last commit touching them, excluding release.json. Version must change for each content release.

Export: node scripts/export-brand.mjs --target <brand-directory>. Checks: node scripts/check-brand.mjs --dir <brand-directory> [--against <release.json>]. Consumer checkers are standalone Node scripts and require no sibling checkout. The receipt lists every payload file and does not hash itself. Export refuses unrecognized existing files and any symlinks, stages beside the target, then renames directories with rollback. No runtime or app pin is changed.
