# Absurdly Rational: owner setup for Pages CMS

This repository is prepared for Pages CMS with a review-first publishing flow. The public site remains a static GitHub Pages site. Pages CMS saves Dad's work to an `editor` branch, GitHub Pages renders that branch at `/preview/`, and only an owner-approved merge into `main` changes the public site.

## One-time activation

The repository owner should do these steps. Do not put a GitHub token, Pages CMS secret, or login credential in this repository or in browser JavaScript.

1. Commit and push the CMS migration and preview workflow files to `main` in `attackbackpack/Absurdly-Rational`.
2. In GitHub, create a branch named exactly `editor` from the updated `main` branch. Keep this branch; do not configure pull requests to delete it automatically.
3. In **Settings → Pages → Build and deployment**, select **GitHub Actions** as the Pages source. The `Deploy site with draft preview` workflow publishes `main` at the site root and `editor` under `/preview/` in one artifact.
4. If **Settings → Environments → github-pages** has deployment-branch restrictions, allow only `main` and `editor`. The combined workflow is safe to run from either branch because it always builds the public root from `main`.
5. In **Settings → Actions → General → Workflow permissions**, enable **Allow GitHub Actions to create and approve pull requests**. The review workflow creates a pull request but never approves or merges it.
6. Protect `main` with a branch rule or ruleset that requires a pull request before merging. Do not give the Pages CMS GitHub App bypass permission. This is the enforcement that prevents an accidental Pages CMS save on `main` from publishing.
7. Open [app.pagescms.org](https://app.pagescms.org/) and sign in with the GitHub account that owns the repository.
8. Install the Pages CMS GitHub App. In GitHub’s repository picker, select only `attackbackpack/Absurdly-Rational`; do not grant the app access to every repository.
9. Open the repository and switch to the `editor` branch. The first editor section should be `Start here — preview & review`, followed by `Site & homepage`, `Readings`, `Podcasts`, and `Meme bank`.
10. In Pages CMS collaborator settings, invite your dad using the email address he will use to sign in. He does not need the source files, VS Code, a GitHub account, or repository settings access.
11. Have him accept the invitation, open the `editor` branch in Pages CMS, and make a small text-only test edit. After saving, confirm the preview workflow succeeds and the change appears at [absurdlyrational.com/preview/](https://absurdlyrational.com/preview/) with the `Draft preview — Not public` banner.

The owner’s GitHub authorization is the authority that connects Pages CMS to this repository. The owner, not the website, controls the GitHub App installation and collaborator list.

## Dad's browser-only workflow

1. Sign in to Pages CMS and confirm the selected branch is `editor` before changing anything.
2. Edit text or images and click **Save**. Saving commits to `editor`, runs validation, and refreshes the draft preview. It does not change the public root.
3. Wait for `Deploy site with draft preview` to finish, then review [absurdlyrational.com/preview/](https://absurdlyrational.com/preview/) on a computer or phone.
4. Return to Pages CMS and choose **Request owner review** in the sidebar. Confirm the dialog. This creates a new `editor` → `main` pull request or adds a refresh note to the existing open request.
5. Continue editing if needed. Every save refreshes the same preview; use **Request owner review** again only when the owner should take another look.

The preview URL is unlisted and carries `noindex`, `nofollow`, and `noarchive`, but it is not password-protected. Do not use it for confidential or legally sensitive drafts.

## Owner approval and publishing

1. Open the pull request created by `Request owner review`.
2. Review the draft website at [absurdlyrational.com/preview/](https://absurdlyrational.com/preview/), the changed files, and the automated validation checks.
3. Request more changes or approve the pull request.
4. Merge with **Create a merge commit**. Do not squash, and do not delete `editor`; preserving the branch ancestry keeps future review requests limited to new edits.
5. Wait for `Deploy site with draft preview` to finish. The public root now reflects `main`, while `/preview/` continues to show the editor branch.

If templates or system files are changed directly on `main` later, merge `main` back into `editor` before Dad's next editing session so his preview uses the current site code.

The CMS configuration prevents deleting its structured JSON data files. To hide a reading, podcast guest, or meme from the public site, use its `Show on site` toggle rather than deleting the data file or changing layout code.

## Editing images safely

Each editable image has the same four controls:

- `Image file`: choose an upload from the repository’s `assets/uploads` media area.
- `Alternative text`: describe meaningful content. Leave it empty only when the image is decorative and the surrounding visible text already says the same thing.
- `Image fit`: choose `Fill frame (crop)` for a full visual tile or `Show complete image` when cropping would remove important content.
- `Crop focus`: when using crop, preserve the top, bottom, left, right, corner, or center of the image.

The defaults are intentionally different by content type:

- Reading thumbnails use cover, so portrait and landscape art fits the editorial grid.
- Meme tiles use cover for the wall, but the opened meme dialog always uses contain so the complete uploaded image is visible.
- Hero, podcast, and guest images can use contain when the complete artwork matters.
- Leaving an optional image blank restores the built-in geometric artwork.

The site constrains fit and focus to the choices in the editor. It does not accept arbitrary CSS from content fields, and long titles/descriptions wrap without creating horizontal overflow.

## Optimizing uploads

After uploading or replacing images:

1. Open the Pages CMS media area.
2. Select the uploaded image set or open the media action menu.
3. Choose `Optimize uploaded images`.
4. Confirm the GitHub Actions run completes successfully.

The workflow uses `sharp` to cap image dimensions at 2400px, rotate according to camera metadata, create WebP output, and update structured JSON references. Original uploads remain in Git history, so the owner can recover them if needed. The workflow only creates a commit when it actually changes media or references, and its commit does not dispatch the optimization workflow again.

If the action is not visible, confirm that GitHub Actions is enabled for this repository and that the Pages CMS GitHub App has the repository permissions it requested. The normal content-validation workflow runs automatically on content/media pushes and pull requests.

## Rollback

If an edit is wrong:

1. Open the repository’s GitHub commit history.
2. Identify the Pages CMS commit that introduced the bad change.
3. Use GitHub’s `Revert` action on the merge commit, or have the repository owner run `git revert -m 1 <merge-commit-sha>` locally.
4. Push the revert to `main` and wait for the normal Pages deployment.

Reverting is safer than editing generated HTML by hand because it restores the JSON/media reference and the exact prior page output together. Do not use `git reset --hard` on the shared production branch.

## Boundaries

Your dad can edit the labeled content and media fields on `editor`. The templates, CSS, JavaScript, image-fit class mapping, canonical URLs, JSON-LD structure, navigation, deployment workflow, and GitHub branch rules remain protected repository code. Pages CMS collaborators cannot manage the CMS configuration or collaborator list, and the protected `main` branch is the final publishing boundary.
