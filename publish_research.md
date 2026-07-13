# Automated Publishing & Versioning Research for SVSCH

This document details the research, options, and recommended configuration for automating the publishing of the `svsch` NPM package and the SVSCH VS Code extension via GitHub Actions on every merge to `master`.

---

## 1. Overview of the SVSCH Packaging Setup

The `svsch` repository contains a dual-packaged project:
1. **NPM Package (`svsch`)**: Installs the CLI tool, using [.npmignore](file:///workspaces/svsch-master/.npmignore) to publish the CLI runner (`dist/cli.js`) and the SV parser binary, while ignoring extension-specific files.
2. **VS Code Extension (`svsch`)**: Installs the editor extension, using [.vscodeignore](file:///workspaces/svsch-master/.vscodeignore) to package the webview and extension files, excluding the CLI runner.

Currently, the existing CI workflow [.github/workflows/ci.yml](file:///workspaces/svsch-master/.github/workflows/ci.yml) has jobs to verify compilation, bundle the extension (`package_extension`), and pack the npm package (`pack_npm`). Adding automated publishing requires a versioning strategy and a release workflow that runs upon merging.

---

## 2. Versioning & Release Strategies

To handle the requirement of **merging multiple PRs per patch/minor version** versus **sometimes releasing a new version for every PR**, we compare the industry-standard options:

### Comparison Table

| Strategy | Contributor Overhead | Grouping Multiple PRs | Auto-Changelog | Release Trigger | Suitability for `svsch` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Release Please** (Recommended) | **None** (requires Conventional Commits) | **Excellent** (aggregates in a running Release PR) | Yes | Merging the Release PR | **High**: Zero setup for PR contributors. Keeps a draft release PR open that aggregates all merged PRs. Publishing triggers only when that PR is merged. |
| **Changesets** | **Low** (run `npx changeset` in PR) | **Excellent** (changeset files accumulate in master) | Yes | Merging the "Version Packages" PR | **High**: Extremely flexible. Contributors specify semantic bumps explicitly. Bumps accumulate on master until a version PR is merged. |
| **Semantic Release** | **None** (requires Conventional Commits) | **Poor** (each merge triggers a publish if version-worthy) | Yes | Every merge to `master` | **Medium**: Releases a new version *every* time a fix/feature PR is merged. Harder to group multiple PRs unless using a staging branch. |
| **Tag-based Release** | **Manual** (requires bumping version & tagging) | **Excellent** (manual control) | Manual/GitHub-based | Pushing tag `v*` | **Low**: Simple, but lacks automation. Requires manual version bump commits. |

---

### Recommended Option: Google's **Release Please**

**Release Please** uses conventional commit messages (e.g. `feat: ...`, `fix: ...`) to determine version bumps.

1. When PRs are merged to `master`, Release Please scans commits and opens/updates a **Release PR** (e.g., `chore(main): release 0.2.0`).
2. This Release PR updates `package.json` (bumping the version) and appends entries to `CHANGELOG.md`.
3. If you merge 5 more PRs, Release Please automatically updates that *same open Release PR*, consolidating the version bump and changelog entries.
4. When you are ready to publish, you simply **merge the Release PR**.
5. Once merged, Release Please creates a git tag/GitHub release, which triggers your NPM and VS Code publishing workflow.

---

### Alternative Option: **Changesets**

If you prefer not to enforce Conventional Commits, **Changesets** is the best alternative.

1. Developers include a small markdown file in their PR by running `npx changeset` (e.g., `.changeset/yellow-cows-jump.md`), specifying the bump type (patch/minor/major) and changelog message.
2. Multiple PRs are merged to `master`, accumulating these files.
3. A GitHub Action detects these files and maintains an open "Version Packages" PR on `master`.
4. When you merge the "Version Packages" PR, the version is bumped, the changelog is updated, the changeset files are deleted, and the publishing workflow runs.

---

## 3. GitHub Actions Publishing Workflow Templates

Below are the configurations for publishing the **NPM Package** and **VS Code Marketplace Extension**.

### Token Requirements (Secrets)

Before running these workflows, the following GitHub Secrets must be added to your repository:
* `NPM_TOKEN`: NPM automation token for publishing the npm package.
* `VSCE_PAT`: Azure DevOps Personal Access Token with access to the Visual Studio Marketplace.
* `OVSX_PAT` *(Optional)*: Open VSX registry token to publish the extension to open-vsx.org (used by VSCodium).

---

### Workflow Design: `.github/workflows/release.yml`

This workflow utilizes **Release Please** to automate version bumping, tagging, and then runs the publishing jobs.

```yaml
name: Release & Publish

on:
  push:
    branches:
      - master

permissions:
  contents: write
  pull-requests: write
  id-token: write # Required for NPM provenance signing

jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      release_created: ${{ steps.release.outputs.release_created }}
      tag_name: ${{ steps.release.outputs.tag_name }}
    steps:
      - uses: google-apis/release-please-action@v4
        id: release
        with:
          release-type: node

  publish:
    needs: release-please
    if: ${{ needs.release-please.outputs.release_created }}
    runs-on: ubuntu-latest
    # Using the CI container to ensure consistent build tools (cmake, ninja, etc.)
    container:
      image: ghcr.io/thedeepestspace/svsch-ci:latest # Ensure this matches your built CI image
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Restore node modules
        uses: actions/cache@v4
        with:
          path: node_modules
          key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}

      - name: Install dependencies
        run: npm ci

      # 1. Compile and build all artifacts
      - name: Compile SVSCH
        run: npm run compile
        env:
          SURELOG_AUTO_INSTALL: 1

      # 2. Publish to NPM with Provenance
      - name: Setup Node for NPM
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'

      - name: Publish NPM Package
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      # 3. Publish to VS Code Marketplace
      - name: Publish VS Code Extension
        run: npx vsce publish -p ${{ secrets.VSCE_PAT }}

      # 4. Optional: Publish to Open VSX Registry
      - name: Publish to Open VSX
        run: npx ovsx publish -p ${{ secrets.OVSX_PAT }}
        continue-on-error: true
```

> [!TIP]
> **NPM Provenance** (`--provenance`) establishes a verifiable link between the published package on npmjs.com and the GitHub Actions run that built it. It requires `id-token: write` permissions.

---

## 4. Step-by-Step Credentials Setup

### A. VS Code Marketplace Token (`VSCE_PAT`)
1. Go to [Azure DevOps](https://dev.azure.com/) and sign in.
2. In the top right corner, click the **User Settings** icon and select **Personal Access Tokens**.
3. Click **New Token**:
   * **Name**: `svsch-release-token`
   * **Organization**: Select **All accessible organizations**.
   * **Scopes**: Select **Custom defined**, scroll to the bottom, click **Show all scopes**, find **Marketplace**, and check **Acquire** & **Publish**.
4. Copy the generated PAT and add it as a secret named `VSCE_PAT` in your GitHub Repository Settings (`Settings -> Secrets and variables -> Actions`).

### B. NPM Automation Token (`NPM_TOKEN`)
1. Sign in to your [npm account](https://www.npmjs.com/).
2. Click your profile avatar and select **Access Tokens**.
3. Click **Generate New Token** and select **Classic Token**.
4. Choose **Automation** type (allows bypassing 2FA during CI publish).
5. Copy the token and add it as `NPM_TOKEN` to your GitHub Repository Secrets.

### C. Open VSX Token (`OVSX_PAT`)
1. Go to [Open VSX Registry](https://open-vsx.org/) and sign in.
2. Go to your settings/profile and generate a new Access Token.
3. Add it as `OVSX_PAT` to your GitHub Repository Secrets.
