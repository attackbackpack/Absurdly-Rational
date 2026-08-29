# Using the visual site editor

The visual editor at [absurdlyrational.com/editor/](https://absurdlyrational.com/editor/)
publishes approved content changes directly to the public site. Pages CMS, a draft branch, and a
pull request are not part of this workflow.

## Publish a change

1. Open the editor and sign in with the editor password.
2. Use the site navigation inside the editor to open the page you want to change.
3. Hover over highlighted text or images and make the edit.
4. Click **Save & publish**, then confirm that the change should update the public website.
5. Wait about a minute for GitHub Pages to rebuild the site, then click **Reload site**.

Each publish creates a Git commit on `main`, which provides a history of every change. If a
mistake is small, correct it in the editor and publish again. For a larger rollback, revert the
content commit on GitHub instead of rewriting generated HTML.

## What the editor can change

The editor can update the structured content files in `_data/` and add images under
`assets/uploads/`. The Worker rejects attempts to change templates, CSS, JavaScript, deployment
workflows, or other repository code.

## Password safety

Anyone with the editor password can publish allowed content to the public website. Use a unique
passphrase and do not share it in email, chat, or repository files. To change it, run this command
from the repository root and enter the new value when prompted:

```bash
npx wrangler secret put EDITOR_PASSWORD --config worker/wrangler.toml
```

Changing a Worker secret does not require a Git commit or push.
