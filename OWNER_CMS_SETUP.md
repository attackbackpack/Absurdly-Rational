# Absurdly Rational: owner setup for Pages CMS

This repository is prepared for Pages CMS. The public site remains a static GitHub Pages site; Pages CMS edits the structured JSON and uploaded media in GitHub, and Jekyll rebuilds the same public URLs.

## One-time activation

The repository owner should do these steps. Do not put a GitHub token, Pages CMS secret, or login credential in this repository or in browser JavaScript.

1. Make sure the CMS migration files in this repository have been committed and pushed to the branch GitHub Pages publishes. The current repository is `attackbackpack/Absurdly-Rational`.
2. Open [app.pagescms.org](https://app.pagescms.org/) and sign in with the GitHub account that owns the repository.
3. Install the Pages CMS GitHub App. In GitHub’s repository picker, select only `attackbackpack/Absurdly-Rational`; do not grant the app access to every repository.
4. Open the repository in Pages CMS. The editor sections should be `Site & homepage`, `Readings`, `Podcasts`, and `Meme bank`.
5. In Pages CMS, open the collaborator settings and invite your dad using the email address he will use to sign in. He does not need access to the code, `.pages.yml`, workflows, or GitHub repository settings.
6. Have him accept the invitation, sign in at [app.pagescms.org](https://app.pagescms.org/), open this repository, and make a small text-only test edit first.

The owner’s GitHub authorization is the authority that connects Pages CMS to this repository. The owner, not the website, controls the GitHub App installation and collaborator list.

## What saving means

Pages CMS writes edits as Git commits. On the production branch, saving a change is therefore a publish action: GitHub Pages will rebuild the site and the public page will update after the build finishes.

Before giving your dad production-branch access, decide whether you want him to publish directly or have you review changes first. For review-first operation, have him work on an owner-controlled editing branch and review/merge the commits into the GitHub Pages branch. Keep the production branch protected in GitHub if you want review to be mandatory.

The CMS configuration prevents deleting the four single JSON data files. To hide a reading, podcast guest, or meme from the public site, use its `Show on site` toggle rather than deleting the data file or changing layout code.

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
3. Use GitHub’s `Revert` action, or have the repository owner run `git revert <commit-sha>` locally.
4. Push the revert to the GitHub Pages branch and wait for the normal Pages build.

Reverting is safer than editing generated HTML by hand because it restores the JSON/media reference and the exact prior page output together. Do not use `git reset --hard` on the shared production branch.

## Boundaries

Your dad can edit the labeled content and media fields. The templates, CSS, JavaScript, image-fit class mapping, canonical URLs, JSON-LD structure, navigation, and GitHub Actions remain protected repository code. Pages CMS collaborators cannot manage the CMS configuration or collaborator list.
