/**
 * MyndHyve CLI — WhatsApp Message Formatting
 *
 * Converts between Markdown and WhatsApp's formatting syntax.
 * WhatsApp uses: *bold*, _italic_, ~strikethrough~, ```monospace```
 */

/**
 * Convert basic Markdown formatting to WhatsApp format.
 * Only handles inline formatting — block-level (headers, lists)
 * are left as-is since WhatsApp doesn't support them.
 *
 * Limitation: nested/overlapping formatting (e.g., `*_bold italic_*`)
 * may produce incorrect results. Simple cases are handled correctly.
 */
export function markdownToWhatsApp(text: string): string {
  // Bold: **text** or __text__ → *text*
  let result = text.replace(/\*\*(.+?)\*\*/g, '*$1*');
  result = result.replace(/__(.+?)__/g, '*$1*');

  // Italic: *text* (single) or _text_ → _text_
  // Careful: don't convert already-converted *bold* markers
  // Only convert single asterisks that aren't part of double
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '_$1_');

  // Strikethrough: ~~text~~ → ~text~
  result = result.replace(/~~(.+?)~~/g, '~$1~');

  // Inline code: `text` → ```text```
  // Note: WhatsApp uses triple backticks for monospace
  result = result.replace(/(?<!`)``?(?!`)(.+?)(?<!`)``?(?!`)/g, '```$1```');

  return result;
}

/**
 * Convert WhatsApp formatting to Markdown.
 */
export function whatsAppToMarkdown(text: string): string {
  // Bold: *text* → **text**
  let result = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '**$1**');

  // Italic: _text_ → *text*
  result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '*$1*');

  // Strikethrough: ~text~ → ~~text~~
  result = result.replace(/(?<!~)~(?!~)(.+?)(?<!~)~(?!~)/g, '~~$1~~');

  // Monospace: ```text``` → `text`
  result = result.replace(/```(.+?)```/g, '`$1`');

  return result;
}
