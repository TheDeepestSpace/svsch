// Shared <head>/CSS/page chrome for the gh-pages dashboard viewers under
// dev/*/index.html — extracted out of ci-duration.mjs and mem-profile.mjs,
// which each hand-rolled their own copy of the same template-literal
// `<!DOCTYPE html>...` string ("styled consistently" by copy-paste, per
// ci-duration.mjs's own comment on dev/bench/index.html). A metric's own
// module now only supplies what's actually page-specific.
//
// dev/bench/index.html is deliberately NOT one of the templates this module
// replaces: it's generated entirely by the third-party
// benchmark-action/github-action-benchmark action (its own Chart.js UI and
// data.js), not by anything in this repo, so there's no call site here to
// update for it. The pages this module does cover just aim to look
// consistent with it (same font stack/muted palette), the same way
// ci-duration.mjs's original comment did.
export function renderDashboardPage({ title, heading = title, description, bodyHtml }) {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, minimum-scale=1.0, initial-scale=1, user-scalable=yes" />
    <style>
      html {
        font-family: BlinkMacSystemFont,-apple-system,"Segoe UI",Roboto,Oxygen,Ubuntu,Cantarell,"Fira Sans","Droid Sans","Helvetica Neue",Helvetica,Arial,sans-serif;
        -webkit-font-smoothing: antialiased;
        background-color: #fff;
        font-size: 16px;
      }
      body {
        color: #4a4a4a;
        margin: 8px;
      }
      h1 {
        font-size: 1.75rem;
        font-weight: 600;
      }
      img {
        max-width: 100%;
      }
      .small {
        font-size: 0.75rem;
      }
      h2 {
        font-size: 1.25rem;
        font-weight: 600;
        margin-bottom: 4px;
      }
      section + section {
        margin-top: 32px;
        padding-top: 24px;
        border-top: 1px solid #e1e0d9;
      }
    </style>
    <title>${title}</title>
  </head>
  <body>
    <h1>${heading}</h1>
    <p class="small">${description}</p>
    ${bodyHtml}
  </body>
</html>
`;
}

// One metric's <section> on the combined dev/index.html master dashboard
// (#413) — a heading, that metric's own body markup (typically its trend
// chart <img>), and a link back to its own full per-metric page. Shared so
// generate-master-dashboard.mjs's own dev/bench section (derived directly
// from history-averages.json, since bench has no record-*.mjs of its own to
// write a section.html fragment) renders identically to the 4 metrics that
// do write one.
export function renderDashboardSection({ heading, bodyHtml, href, linkLabel = 'Full history →' }) {
  return `<section>
      <h2>${heading}</h2>
      ${bodyHtml}
      <p class="small"><a href="${href}">${linkLabel}</a></p>
    </section>`;
}
