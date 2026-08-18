---
name: "📣 Scrape Mentions on OSPO Repos"
description: Scrape all @mentions from github/ospo and github/ospo-aw and publish a report issue
engine: copilot
on:
  schedule:
    - cron: "0 10 * * 1-5"
  workflow_dispatch:
permissions:
  copilot-requests: write
safe-outputs:
  create-issue:
strict: false
timeout-minutes: 30
steps:
  - name: Scrape mentions from issues and pull requests
    run: |
      python3 << 'PYEOF'
      import json
      import re
      import subprocess

      repos = ["github/ospo", "github/ospo-aw"]
      mention_re = re.compile(r'@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))')

      def gh_json(path):
          result = subprocess.run(
              ["gh", "api", "--paginate", path],
              capture_output=True,
              text=True,
              check=False,
          )
          if result.returncode != 0:
              return []
          blobs = [b for b in result.stdout.split("\n\n") if b.strip()]
          data = []
          for blob in blobs:
              parsed = json.loads(blob)
              if isinstance(parsed, list):
                  data.extend(parsed)
              else:
                  data.append(parsed)
          return data

      def find_mentions(text):
          if not text:
              return []
          return sorted(set(mention_re.findall(text)))

      findings = []
      for repo in repos:
          items = gh_json(f"repos/{repo}/issues?state=all&per_page=100")
          for item in items:
              number = item.get("number")
              if not number:
                  continue

              kind = "pull_request" if item.get("pull_request") else "issue"
              url = item.get("html_url")

              body_mentions = find_mentions(item.get("body", "")) + find_mentions(item.get("title", ""))
              if body_mentions:
                  findings.append({
                      "repo": repo,
                      "type": kind,
                      "number": number,
                      "source": "body_or_title",
                      "url": url,
                      "mentions": sorted(set(body_mentions)),
                  })

              issue_comments = gh_json(f"repos/{repo}/issues/{number}/comments?per_page=100")
              for comment in issue_comments:
                  mentions = find_mentions(comment.get("body", ""))
                  if mentions:
                      findings.append({
                          "repo": repo,
                          "type": kind,
                          "number": number,
                          "source": "issue_comment",
                          "url": comment.get("html_url", url),
                          "mentions": mentions,
                      })

              if kind == "pull_request":
                  review_comments = gh_json(f"repos/{repo}/pulls/{number}/comments?per_page=100")
                  for comment in review_comments:
                      mentions = find_mentions(comment.get("body", ""))
                      if mentions:
                          findings.append({
                              "repo": repo,
                              "type": kind,
                              "number": number,
                              "source": "review_comment",
                              "url": comment.get("html_url", url),
                              "mentions": mentions,
                          })

                  reviews = gh_json(f"repos/{repo}/pulls/{number}/reviews?per_page=100")
                  for review in reviews:
                      mentions = find_mentions(review.get("body", ""))
                      if mentions:
                          findings.append({
                              "repo": repo,
                              "type": kind,
                              "number": number,
                              "source": "review_body",
                              "url": review.get("html_url", url),
                              "mentions": mentions,
                          })

      with open("/tmp/ospo-mentions.json", "w") as f:
          json.dump({
              "repos": repos,
              "total_findings": len(findings),
              "findings": findings
          }, f, indent=2)

      print(f"Scraped {len(findings)} mention records")
      PYEOF
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
---

# OSPO Mention Scraper

You are a **GitHub mention scraping analyst**.

Your goal is to scrape all `@mentions` from `github/ospo` and `github/ospo-aw` using `/tmp/ospo-mentions.json`, then publish a complete report issue.

## Step 1: Read the scraped data

1. Read `/tmp/ospo-mentions.json`
2. Confirm both repositories were included: `github/ospo` and `github/ospo-aw`
3. If the file is missing or empty, stop and do not create an issue

## Step 2: Build the mention report

Produce:

1. A total mention record count
2. Mention counts by repository
3. Mention counts by user handle (e.g., `@octocat`)
4. A detailed list of findings including:
   - repo
   - issue/pr number
   - source (`body_or_title`, `issue_comment`, `review_comment`, `review_body`)
   - URL
   - mentions found

## Step 3: Create an issue

Create an issue titled:

`[Mentions] OSPO and OSPO-AW mention scrape — YYYY-MM-DD`

Issue body must include:

- Summary totals
- Per-repo counts
- Top mentioned handles (descending)
- Full findings table
- Timestamp of report generation

## Rules

- Do not modify code, files, labels, or pull requests.
- Do not drop findings unless they are exact duplicates.
- Do not infer or invent missing mention data.
