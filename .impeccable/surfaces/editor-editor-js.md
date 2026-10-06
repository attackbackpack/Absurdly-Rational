---
version: 1
slug: "editor-editor-js"
primary_target: "editor/editor.js"
related_targets: ["editor/editor.css","editor/index.html","editor/lib/reorder.js","editor/lib/overlay.js","SITE_EDITOR_GUIDE.md"]
---

# Editor card ordering

- Scope and mode: Reordering inside the authenticated visual editor; Operate mode.
- Audience and job: The site owner arranges published content while seeing the real page in the editor preview.
- Action: Choose **Reorder cards**, move a card with its grip, then choose **Done rearranging** or leave the mode. Drag with a pointer, or focus a grip and press Space, use the arrow keys, then press Space to drop. Escape restores the order from before the current move. Completed drops update the editor draft; **Save & publish** remains the explicit publish action.
- Content and structure: Reordering covers meme bank cards, reading topics, essays within a topic, podcast guest cards, and homepage format cards. Hidden entries keep their positional slots, the meme add control stays last, the reading topic width rhythm (7/5/5/7) follows position, and the first essay keeps the lead-card role.
- Constraints: Keep the existing dark signal-board design, copy, assets, and page-specific layouts. The editor adds ordering controls over the preview; it does not introduce a new visual world or alter public-page content to expose those controls.
- Direction: The toolbar clearly distinguishes **Reorder cards** from **Done rearranging**. In the preview, body-level 44px teal grips identify movable cards; a restrained ±0.35° wiggle signals the active mode. Insertion uses a 240ms spatial FLIP transition, bypassed for reduced-motion preferences. Pointer and keyboard moves share the same ordering and cancellation behavior. Pointer swaps trigger at two-thirds overlap of the smaller card's area; targets use captured layout bounds during FLIP and rearm when overlap falls to one-half or less.
- Draft continuity: On each iframe attach, repaint the rendered collections from the current draft before interaction, so an older deployed page cannot replace a newer draft order. Only a completed drop changes the draft; the existing save and publish flow handles persistence.
