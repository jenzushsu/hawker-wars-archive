# Hawker Wars article site

`article.md` is the published source. `index.html` is the generated GitHub Pages page. Seven charts appear as PNG images in the article, with SVG originals available in the footer. The recorded seed-23 replay appears as `replay/hawker-wars-replay.gif`.

To rebuild the HTML from the committed Markdown and template:

```sh
cd site
pandoc article.md --from markdown --to html5 --standalone --toc --toc-depth=2 \
  --template template.html \
  --metadata 'title=From Mario to Hawker Wars: Decision Models in Sequential Operations' \
  --output index.html
```

The generated site is committed so Pages deployment does not require Pandoc. The workflow uploads only this `site/` directory on changes to `main` or manual dispatch. Markdown source, the earlier draft, Mario source, results, per-tick action strings and stockout summaries remain downloadable from the page.

The six repeated-round data and per-tick replay were verified in [the evaluation report](https://github.com/jenzushsu/hawker-wars/blob/22cbc8fd6f31ef767b4b1b348cbfe52d281ac580/docs/deployment/repeated-seed-evaluation.md). The SVG/PNG figures and GIF are derived from recorded simulation states. GIF time represents accelerated simulated ticks, not provider inference latency.
