// styles.js — CSS design system for the agent portal
// Full CSS shipped in every portal — unused selectors are harmless

/**
 * Generate the complete CSS string, including dynamic author badge styles.
 * @param {object} authors - { name: { color, bg } } from config
 * @returns {string} CSS string
 */
function getStyles(authors) {
  let authorCSS = '';
  for (const [authorName, style] of Object.entries(authors || {})) {
    authorCSS += `  .author-badge.${authorName} { background: ${style.bg}; color: ${style.color}; }\n`;
    authorCSS += `  .journal-entry.author-${authorName} { border-left: 3px solid ${style.color}; }\n`;
  }

  return `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; color: #222; display: flex; height: 100vh; }

  /* Sidebar */
  #sidebar { width: 280px; min-width: 280px; background: #fff; border-right: 1px solid #ddd; display: flex; flex-direction: column; }
  #sidebar-header { padding: 16px 16px 8px; display: flex; align-items: center; gap: 8px; }
  #sidebar-header h1 { font-size: 18px; color: #444; }
  .status-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .status-green { background: #4caf50; }
  .status-yellow { background: #ff9800; }
  .status-red { background: #f44336; }
  #next-run { font-size: 12px; color: #888; padding: 0 16px 12px; font-weight: 400; }
  #quick-stats { font-size: 12px; color: #666; padding: 0 16px 12px; border-bottom: 1px solid #eee; }
  #quick-stats span { display: block; margin-bottom: 2px; }

  /* Main panel */
  #main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

  /* Tabs */
  #tabs { display: flex; background: #fff; border-bottom: 1px solid #ddd; padding: 0 24px; }
  .tab { padding: 12px 20px; font-size: 14px; font-weight: 500; color: #666; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.15s; }
  .tab:hover { color: #333; }
  .tab.active { color: #1a73e8; border-bottom-color: #1a73e8; }

  /* Content area */
  #content { flex: 1; overflow-y: auto; padding: 24px 32px; }
  #content .empty { color: #999; text-align: center; margin-top: 30vh; font-size: 16px; }

  /* Journal thread */
  .journal-thread { max-width: 800px; }
  .journal-entry { margin-bottom: 16px; padding: 12px 16px; background: #fff; border-radius: 8px; border: 1px solid #e8e8e8; }
  .journal-entry-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 13px; flex-wrap: wrap; }
  .journal-entry-header .timestamp { color: #888; }
  .author-badge { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 10px; }
  .tag-badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 8px; text-transform: uppercase; }
  .tag-output { background: #e8f5e9; color: #2e7d32; }
  .tag-feedback { background: #fff3e0; color: #e65100; }
  .tag-outcome { background: #e3f2fd; color: #1565c0; }
  .tag-observation { background: #f3e5f5; color: #7b1fa2; }
  .tag-note { background: #f5f5f5; color: #616161; }
  .tag-direction { background: #fce4ec; color: #c62828; }
  .tag-question { background: #fff8e1; color: #f57f17; }
  .journal-entry-body { font-size: 14px; line-height: 1.6; }
  .journal-entry-body p { margin-bottom: 8px; }
  .journal-entry-body a { color: #1a73e8; }

  /* Author-specific badge styles from config */
${authorCSS}
  /* Add note form */
  #add-note { max-width: 800px; margin-top: 16px; padding: 16px; background: #fff; border-radius: 8px; border: 1px solid #ddd; }
  #add-note h3 { font-size: 14px; color: #555; margin-bottom: 10px; }
  #add-note-form { display: flex; flex-direction: column; gap: 10px; }
  #add-note-form .form-row { display: flex; gap: 10px; align-items: flex-start; }
  #note-text { flex: 1; min-height: 60px; border: 1px solid #ddd; border-radius: 6px; padding: 8px; font-family: inherit; font-size: 14px; resize: vertical; }
  #note-tag { border: 1px solid #ddd; border-radius: 6px; padding: 8px; font-family: inherit; font-size: 14px; background: #fff; }
  #note-submit { padding: 8px 20px; background: #1a73e8; color: #fff; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; align-self: flex-end; }
  #note-submit:hover { background: #1557b0; }
  #note-submit:disabled { background: #aaa; cursor: not-allowed; }

  /* GitHub tab */
  .gh-section { max-width: 800px; margin-bottom: 32px; }
  .gh-section h2 { font-size: 16px; color: #444; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
  .gh-item { padding: 10px 16px; background: #fff; border-radius: 8px; border: 1px solid #e8e8e8; margin-bottom: 6px; display: flex; align-items: center; gap: 10px; }
  .gh-item a { color: #1a73e8; text-decoration: none; font-weight: 500; font-size: 14px; }
  .gh-item a:hover { text-decoration: underline; }
  .gh-item .number { color: #888; font-size: 13px; min-width: 36px; }
  .gh-item .date { color: #aaa; font-size: 12px; margin-left: auto; white-space: nowrap; }
  .gh-label { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 8px; margin-left: 6px; }
  .state-badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 8px; text-transform: uppercase; }
  .state-open { background: #e8f5e9; color: #2e7d32; }
  .state-merged { background: #ede7f6; color: #4527a0; }
  .state-closed { background: #fce4ec; color: #c62828; }
  .refresh-btn { padding: 4px 14px; background: #fff; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; cursor: pointer; color: #555; }
  .refresh-btn:hover { background: #f5f5f5; }

  /* Status tab */
  .status-section { max-width: 800px; margin-bottom: 28px; }
  .status-section h2 { font-size: 16px; color: #444; margin-bottom: 12px; }
  .status-card { padding: 14px 18px; background: #fff; border-radius: 8px; border: 1px solid #e8e8e8; margin-bottom: 8px; }
  .status-card .label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .status-card .value { font-size: 14px; color: #333; }
  .event-item { padding: 8px 14px; background: #fff; border-radius: 6px; border: 1px solid #e8e8e8; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .event-item .event-ts { color: #888; font-size: 12px; min-width: 100px; }
  .event-type-badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 8px; text-transform: uppercase; }
  .event-type-cycle_start { background: #e8f5e9; color: #2e7d32; }
  .event-type-cycle_end { background: #e3f2fd; color: #1565c0; }
  .event-type-research { background: #fff3e0; color: #e65100; }
  .event-type-error { background: #fce4ec; color: #c62828; }
  .event-type-reflect { background: #f3e5f5; color: #7b1fa2; }
  .event-type-notify { background: #fff8e1; color: #f57f17; }
  .event-type-default { background: #f5f5f5; color: #616161; }
  .win-item { padding: 10px 14px; background: #fff; border-radius: 6px; border: 1px solid #e8e8e8; margin-bottom: 4px; }
  .win-item .win-desc { font-size: 14px; }
  .win-item .win-meta { font-size: 12px; color: #888; margin-top: 4px; }

  /* Markdown styling */
  .md-content h1 { font-size: 24px; margin-bottom: 8px; }
  .md-content h2 { font-size: 20px; margin-top: 24px; margin-bottom: 8px; }
  .md-content h3 { font-size: 16px; margin-top: 20px; margin-bottom: 6px; }
  .md-content p { margin-bottom: 12px; line-height: 1.6; }
  .md-content ul, .md-content ol { margin-bottom: 12px; padding-left: 24px; }
  .md-content li { margin-bottom: 4px; line-height: 1.5; }
  .md-content blockquote { border-left: 4px solid #1a73e8; padding: 12px 16px; margin-bottom: 16px; background: #f0f7ff; color: #333; }
  .md-content a { color: #1a73e8; }
  .md-content code { background: #f0f0f0; padding: 2px 5px; border-radius: 3px; font-size: 0.9em; }
  .md-content pre { background: #f0f0f0; padding: 12px; border-radius: 6px; overflow-x: auto; margin-bottom: 12px; }
  .md-content pre code { background: none; padding: 0; }
  .md-content table { border-collapse: collapse; margin-bottom: 12px; }
  .md-content th, .md-content td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  .md-content th { background: #f5f5f5; }
`;
}

module.exports = { getStyles };
