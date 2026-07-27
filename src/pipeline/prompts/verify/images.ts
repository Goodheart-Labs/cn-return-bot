/**
 * Shared image rule for the source verifier's vision mode (verifier_images A/B
 * test). Images reach the model as content parts laid out in reading order —
 * a heading, then the images it names — so both verifier flows can state the
 * same thing about what is attached and what to do with it.
 */

/** Bullet appended to both verifier prompts' Rules block when images are attached. */
export const IMAGE_RULE = `- Images are attached below the text under headings naming where each came from ("Post images", "Quoted post images", "Images from cited source <url>"). Sometimes a tweet and a source are about similar but different events. You can tell whether they are about the same event or not from the images.`;
